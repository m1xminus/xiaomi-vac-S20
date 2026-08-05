"""Local MIoT client for ijai-family vacuums (synchronous; wrap in executor under HA)."""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass

from miio import MiotDevice

from .spec.registry import card_baseline_gaps, get_profile
from .spec.types import CoreCapability, MapCapability, ModelProfile, SettingsCapability

_LOGGER = logging.getLogger(__name__)


class DeviceCommunicationError(Exception):
    """Raised when a required device property cannot be read."""


# Length range for the wifi serial that seeds the map AES key. Firmware isn't
# consistent here — v3 reports 19, the old code only allowed 18 or 20 — so this
# is a range rather than a whitelist (issue #4).
_WIFI_SN_MIN_LEN = 16
_WIFI_SN_MAX_LEN = 24


def _is_wifi_sn(value: str) -> bool:
    return _WIFI_SN_MIN_LEN <= len(value) <= _WIFI_SN_MAX_LEN and value.isupper()


# Packed room-preference string format used by sweep.set-preference-ii /
# get-preference-ii (siid 7, aiid 9/10). One string per room:
#   "{prefer_type}_{room_id}_{clean_mode}_{wind_power}_{water_level}_
#    {twice_clean}_{carpet}_{choose}"
# prefer_type: 1 = room preference, 2 = floor preference (not used here)
# clean_mode: 0 Sweep, 1 Sweep+Mop, 2 Mop, 3 Sweep then Mop
# wind_power (fan speed): 0 Silent, 1 Basic, 2 Strong, 3 Full Speed
# water_level: 0-3
# twice_clean: 0/1
# carpet: 0 not set, 1 auto-boost on, 2 off
# choose: 0/1 — whether this room is included in the next custom clean
_PREF_FIELDS = (
    "prefer_type", "room_id", "clean_mode", "wind_power",
    "water_level", "twice_clean", "carpet", "choose",
)
_PREF_DEFAULTS = {
    "prefer_type": 1, "clean_mode": 0, "wind_power": 1,
    "water_level": 2, "twice_clean": 1, "carpet": 1, "choose": 0,
}


def format_room_preference(pref: dict) -> str:
    """Build one packed preference string. Requires 'room_id'; everything
    else falls back to a sane default (matches the Mi Home app's own
    defaults) so callers only need to specify what they're changing."""
    if "room_id" not in pref:
        raise ValueError("room preference is missing required 'room_id'")
    values = {**_PREF_DEFAULTS, "room_id": pref["room_id"], **pref}
    return "_".join(str(values[field]) for field in _PREF_FIELDS)


def parse_room_preferences(raw_out: str) -> list[dict]:
    """Parse the JSON array of packed strings returned by get-preference-ii
    into a list of {field: value} dicts (values left as str, matching the
    wire format — callers can int() what they need)."""
    try:
        packed = json.loads(raw_out)
    except (TypeError, ValueError) as err:
        raise ValueError(f"Unexpected preference payload: {raw_out!r}") from err
    prefs = []
    for entry in packed:
        parts = entry.split("_")
        if len(parts) < len(_PREF_FIELDS):
            _LOGGER.debug("Skipping malformed room preference entry: %r", entry)
            continue
        prefs.append(dict(zip(_PREF_FIELDS, parts)))
    return prefs


def merge_room_preferences(current: list[dict], updates: list[dict]) -> list[dict]:
    """Safe merge for a 'set these rooms active with these settings, leave
    every other room's saved settings untouched but mark them inactive'
    workflow — mirrors a fetch-then-selectively-overwrite pattern rather
    than a raw replace, so a partial `updates` list can never silently wipe
    preferences for rooms you didn't mention.

    - Rooms in both `current` and `updates`: fields you specify in the
      update win, anything you don't specify keeps its CURRENT value
      (not a hardcoded default), and the room is marked active (choose=1)
      — matching this field's hardcoded behaviour, not overridable.
    - Rooms only in `current` (not mentioned in `updates`): kept exactly
      as-is except marked inactive (choose=0).
    - Rooms only in `updates` (the device has no existing entry for them):
      appended using format_room_preference's defaults + whatever you gave,
      marked active. This is the "brand new room id" edge case; normally
      every room id already has a current entry once the vacuum has built
      a map, since Mi Home seeds one for every detected room.
    """
    current_by_id = {str(p["room_id"]): p for p in current}
    updates_by_id = {str(u["room_id"]): u for u in updates}

    merged = []
    for room_id, existing in current_by_id.items():
        update = updates_by_id.get(room_id)
        if update is not None:
            merged.append({**existing, **update, "room_id": room_id, "choose": 1})
        else:
            merged.append({**existing, "choose": 0})
    for room_id, update in updates_by_id.items():
        if room_id not in current_by_id:
            merged.append({**update, "room_id": room_id, "choose": 1})
    return merged


@dataclass
class VacuumStatus:
    activity: str
    raw_status: int
    battery: int | None
    fault: int | None
    fan_speed_raw: int | None
    water_level_raw: int | None
    mode_raw: int | None
    sweep_type_raw: int | None
    repeat_raw: int | None
    alarm_raw: int | None
    volume_raw: int | None
    main_brush_life: int | None
    side_brush_life: int | None
    filter_life: int | None
    mop_life: int | None
    main_brush_hours: int | None
    side_brush_hours: int | None
    filter_hours: int | None
    mop_hours: int | None
    door_state: int | None
    cloth_state: int | None
    clean_area: int | None
    clean_time: int | None
    last_clean_area: int | None
    last_clean_time: int | None
    last_clean_start: int | None


class IjaiVacuumDevice:
    """Thin wrapper over python-miio MiotDevice driven by a ModelProfile.

    Refuses to build for a model that has no profile or no runnable ``core``
    (rich-reference-only profiles, e.g. roidmi) — no blanket ijai fallback.
    """

    def __init__(self, host: str, token: str, model: str, timeout: int = 5):
        self.host = host
        self.token = token
        self.model = model
        profile = get_profile(model)
        if profile is None or profile.core is None:
            raise ValueError(f"{model} is not a runnable vacuum profile (no core)")
        gaps = card_baseline_gaps(profile)
        if gaps:
            raise ValueError(
                f"{model} does not satisfy the card baseline: {', '.join(gaps)}"
            )
        self.profile: ModelProfile = profile
        self.core: CoreCapability = profile.core
        self._dev = MiotDevice(host, token, timeout=timeout)

    # --- helpers ---------------------------------------------------------
    def _batch_get(self, props: list, chunk_size: int | None = None) -> dict:
        """Batch-read MIoT props in one (or chunked) get_properties call.

        Returns {Prop: value|None}; properties whose device code is non-zero map
        to None.  Raises DeviceCommunicationError on network/protocol failure.
        Chunk size is `chunk_size` if given, else self.profile.max_properties —
        use one of these for devices that reject large batches (e.g.
        IJAI_CORE_LEGACY, and apparently some individual d106gl units: a 25-prop
        single batch triggered a hard "Unable to recover failed command" that a
        10-prop batch never did, even though profile.max_properties was unset).
        """
        if not props:
            return {}
        batch_size = chunk_size if chunk_size is not None else self.profile.max_properties
        miio_props = [
            {"did": f"{p.siid}-{p.piid}", "siid": p.siid, "piid": p.piid}
            for p in props
        ]
        try:
            raw = self._dev.get_properties(
                miio_props, property_getter="get_properties", max_properties=batch_size
            )
        except Exception as ex:  # noqa: BLE001
            raise DeviceCommunicationError(
                f"Property batch read failed ({len(props)} props): {ex}"
            ) from ex
        value_map: dict[tuple[int, int], object] = {
            (r["siid"], r["piid"]): r.get("value")
            for r in raw
            if isinstance(r, dict) and r.get("code", -1) == 0
        }
        return {p: value_map.get((p.siid, p.piid)) for p in props}

    def _set(self, prop, value) -> None:
        if prop is None:
            raise ValueError(f"{self.model} does not support this property")
        self._dev.set_property_by(prop.siid, prop.piid, value)

    def _action(self, action, params=None) -> dict:
        if action is None:
            raise ValueError(f"{self.model} does not support this action")
        return self._dev.call_action_by(action.siid, action.aiid, params or [])

    # --- telemetry -------------------------------------------------------
    def status(self) -> VacuumStatus:
        c = self.core
        cc = self.profile.consumables
        ch = self.profile.clean_history
        # Consumable life (brush/filter/mop % and hours remaining) and
        # clean-time/area (live in-progress + last-completed) are wired via
        # profile.consumables / profile.clean_history — confirmed against
        # xiaomi.vacuum.d106gl's own MIoT spec.
        #
        # IMPORTANT: kept as a SEPARATE, best-effort batch from core telemetry.
        # A single 25-prop batch was observed to hard-fail ("Unable to recover
        # failed command") on real hardware where a 10-prop batch never had,
        # even with profile.max_properties unset — this device's local
        # protocol handling doesn't reliably scale with batch size. Core
        # status/battery/etc. is required for basic vacuum operation and must
        # keep raising on failure; consumables/history must NOT be able to
        # block that — if the extras batch fails, log it and report None
        # rather than taking the whole entity (and config entry setup) down.
        core_poll = [p for p in (
            c.status, c.battery, c.fault, c.fan_speed, c.water_level,
            c.mode, c.sweep_type, c.repeat, c.alarm, c.volume,
        ) if p is not None]
        vals = self._batch_get(core_poll)
        _raw = vals.get(c.status)
        try:
            raw = int(_raw)
        except (TypeError, ValueError) as ex:
            raise DeviceCommunicationError(
                f"Required property {c.status.siid}/{c.status.piid} read failed: "
                f"returned {_raw!r}"
            ) from ex

        consumable_poll = [p for p in (
            cc.main_brush_life, cc.side_brush_life, cc.hypa_life, cc.mop_life,
            cc.main_brush_hours, cc.side_brush_hours, cc.hypa_hours, cc.mop_hours,
            cc.door_state, cc.cloth_state,
        ) if p is not None] if cc is not None else []
        clean_history_poll = [p for p in (
            ch.live_clean_time, ch.live_clean_area,
            ch.use_time, ch.clean_area, ch.start_time,
        ) if p is not None] if ch is not None else []
        extra_poll = consumable_poll + clean_history_poll
        extra_vals: dict = {}
        if extra_poll:
            try:
                # Conservative chunk size regardless of profile.max_properties —
                # this failure showed up even on a profile with no cap set.
                extra_vals = self._batch_get(extra_poll, chunk_size=8)
            except DeviceCommunicationError as ex:
                _LOGGER.warning(
                    "%s: consumables/clean-history read failed, reporting as "
                    "unavailable this cycle (core status still OK): %s",
                    self.model, ex,
                )

        return VacuumStatus(
            activity=c.status_map.get(raw, "idle"),
            raw_status=raw,
            battery=_as_int(vals.get(c.battery)),
            fault=_as_int(vals.get(c.fault)),
            fan_speed_raw=_as_int(vals.get(c.fan_speed)),
            water_level_raw=_as_int(vals.get(c.water_level)),
            mode_raw=_as_int(vals.get(c.mode)),
            sweep_type_raw=_as_int(vals.get(c.sweep_type)),
            repeat_raw=_as_int(vals.get(c.repeat)),
            alarm_raw=_as_int(vals.get(c.alarm)),
            volume_raw=_as_int(vals.get(c.volume)),
            main_brush_life=_as_int(extra_vals.get(cc.main_brush_life)) if cc else None,
            side_brush_life=_as_int(extra_vals.get(cc.side_brush_life)) if cc else None,
            filter_life=_as_int(extra_vals.get(cc.hypa_life)) if cc else None,
            mop_life=_as_int(extra_vals.get(cc.mop_life)) if cc else None,
            main_brush_hours=_as_int(extra_vals.get(cc.main_brush_hours)) if cc else None,
            side_brush_hours=_as_int(extra_vals.get(cc.side_brush_hours)) if cc else None,
            filter_hours=_as_int(extra_vals.get(cc.hypa_hours)) if cc else None,
            mop_hours=_as_int(extra_vals.get(cc.mop_hours)) if cc else None,
            door_state=_as_int(extra_vals.get(cc.door_state)) if cc else None,
            cloth_state=_as_int(extra_vals.get(cc.cloth_state)) if cc else None,
            clean_area=_as_int(extra_vals.get(ch.live_clean_area)) if ch else None,
            clean_time=_as_int(extra_vals.get(ch.live_clean_time)) if ch else None,
            last_clean_area=_as_int(extra_vals.get(ch.clean_area)) if ch else None,
            last_clean_time=_as_int(extra_vals.get(ch.use_time)) if ch else None,
            last_clean_start=_as_int(extra_vals.get(ch.start_time)) if ch else None,
        )

    # --- control ---------------------------------------------------------
    def start(self) -> None:
        self._action(self.core.start)

    def stop(self) -> None:
        self._action(self.core.stop)

    def pause(self) -> None:
        self._action(self.core.pause if self.core.pause is not None else self.core.stop)

    def return_home(self) -> None:
        self._action(self.core.charge)

    def locate(self) -> None:
        if self.core.locate is not None:
            self._action(self.core.locate)
        elif self.core.alarm is not None:
            self.set_alarm(True)
        else:
            raise ValueError(f"{self.model} has no locate capability")

    def set_fan_speed(self, preset: str) -> None:
        self._set(self.core.fan_speed, self.core.fan_speeds[preset])

    def set_water_level(self, preset: str) -> None:
        self._set(self.core.water_level, self.core.water_levels[preset])

    def set_mode(self, preset: str) -> None:
        self._set(self.core.mode, self.core.modes[preset])

    def set_sweep_type(self, preset: str) -> None:
        self._set(self.core.sweep_type, self.core.sweep_types[preset])

    def set_repeat(self, on: bool) -> None:
        self._set(self.core.repeat, 1 if on else 0)

    def set_alarm(self, on: bool) -> None:
        self._set(self.core.alarm, on)

    def set_volume(self, value: int) -> None:
        self._set(self.core.volume, int(value))

    # consumable-index per xiaomi.vacuum.d106gl's own MIoT spec (siid 7,
    # aiid 1 reset-consumable): 1 Main brush, 2 Side brush, 3 HEPA filter,
    # 4 Mop cloth. Not verified as identical on every ijai-family profile —
    # if a future profile's ordering differs, this constant would need a
    # per-profile override rather than being treated as universal.
    _CONSUMABLE_INDEX = {"main_brush": 1, "side_brush": 2, "filter": 3, "mop": 4}

    def reset_consumable(self, which: str) -> None:
        """Reset a consumable's life counter after replacing it.
        `which` is one of 'main_brush', 'side_brush', 'filter', 'mop'."""
        cap = self.profile.consumables
        if cap is None or cap.reset_consumable is None:
            raise ValueError(f"{self.model} has no reset-consumable action")
        index = self._CONSUMABLE_INDEX.get(which)
        if index is None:
            raise ValueError(
                f"Unknown consumable {which!r}; expected one of {sorted(self._CONSUMABLE_INDEX)}"
            )
        self._action(cap.reset_consumable, [index])

    def clean_segments(self, room_ids: list[int | str]) -> None:
        cap = self.profile.room_clean
        if cap is None:
            raise ValueError(f"{self.model} has no room-clean capability")
        # Prefer sweep.set-room-clean: it takes map/device room ids. The
        # vacuum.start-room-sweep action wants Mijia room ids (prop 2/10), so
        # map ids sent through it fail at device level (verified on v17
        # hardware, issue #7). Room-ids must stay a CSV string — the device
        # reads an integer as empty ids, which means a full global clean.
        preferred = self.room_clean_set_params(room_ids)
        if preferred is not None:
            action, params = preferred
            self._action(action, params)
            return
        fallback = self.room_clean_start_params(room_ids)
        if fallback is not None:
            action, params = fallback
            self._action(action, params)
            return
        raise ValueError(f"{self.model} has no usable room-clean action")

    def room_clean_start_params(self, room_ids: list[int | str]) -> tuple[object, list] | None:
        """Return the direct room-clean action and params, when available."""
        cap = self.profile.room_clean
        if cap is None or cap.start is None:
            return None
        return cap.start, [",".join(str(r) for r in room_ids)]

    def room_clean_set_params(self, room_ids: list[int | str]) -> tuple[object, list] | None:
        """Return the set-room-clean action and params, when available."""
        cap = self.profile.room_clean
        if not (
            cap is not None
            and cap.set_room_clean is not None
            and cap.clean_room_ids is not None
            and cap.clean_room_mode is not None
            and cap.clean_room_oper is not None
        ):
            return None
        values = {
            cap.clean_room_mode.piid: 0,  # global/all rooms mode
            cap.clean_room_oper.piid: 1,  # start
            cap.clean_room_ids.piid: ",".join(str(r) for r in room_ids),
        }
        return cap.set_room_clean, [values[piid] for piid in cap.set_room_clean.in_piids]

    def get_current_map_id(self) -> int | None:
        """Live read of the currently-active map id (needed to scope
        get/set-preference-ii calls to the right map)."""
        cap = self.profile.map
        if not isinstance(cap, MapCapability) or cap.current_map_id is None:
            return None
        try:
            val = self._dev.get_property_by(
                cap.current_map_id.siid, cap.current_map_id.piid
            )[0].get("value")
        except Exception as err:  # noqa: BLE001
            _LOGGER.debug("current_map_id read failed: %s", err)
            return None
        return int(val) if val is not None else None

    def get_room_preferences_params(self, map_id: int) -> tuple[object, list] | None:
        """Return the get-preference-ii action and params, when available."""
        cap = self.profile.room_clean
        if cap is None or cap.get_preference is None:
            return None
        return cap.get_preference, [int(map_id)]

    def set_room_preferences_params(
        self, preferences: list[dict], map_id: int
    ) -> tuple[object, list] | None:
        """Return the set-preference-ii action and params, when available.

        Each dict in `preferences` needs at least 'room_id'; other fields
        (clean_mode, wind_power, water_level, twice_clean, carpet, choose)
        fall back to sane defaults — see format_room_preference().
        """
        cap = self.profile.room_clean
        if cap is None or cap.set_preference is None:
            return None
        packed = [format_room_preference(p) for p in preferences]
        pref_json = json.dumps(packed, separators=(",", ":"))
        return cap.set_preference, [pref_json, int(map_id)]

    def get_room_preferences(self, map_id: int | None = None) -> list[dict]:
        """Local (non-cloud) fetch of current per-room cleaning preferences."""
        resolved_map_id = map_id if map_id is not None else self.get_current_map_id()
        if resolved_map_id is None:
            raise ValueError(f"{self.model}: could not determine the current map id")
        params = self.get_room_preferences_params(resolved_map_id)
        if params is None:
            raise ValueError(f"{self.model} has no get-preference action")
        action, action_params = params
        result = self._action(action, action_params)
        out = result.get("out") if isinstance(result, dict) else None
        raw = out[0] if out else None
        if raw is None:
            raise ValueError(f"{self.model}: get-preference returned no data: {result!r}")
        return parse_room_preferences(raw)

    def set_room_preferences(
        self, preferences: list[dict], map_id: int | None = None
    ) -> dict:
        """Local (non-cloud) push of per-room cleaning preferences.

        RAW variant: sends exactly the entries you give it, nothing more.
        If the device replaces its whole preference set rather than
        merging, omitting a room here can reset/deactivate it. For a
        merge-safe "activate these rooms, preserve everything else"
        workflow, use apply_room_preferences instead.
        """
        resolved_map_id = map_id if map_id is not None else self.get_current_map_id()
        if resolved_map_id is None:
            raise ValueError(f"{self.model}: could not determine the current map id")
        params = self.set_room_preferences_params(preferences, resolved_map_id)
        if params is None:
            raise ValueError(f"{self.model} has no set-preference action")
        action, action_params = params
        return self._action(action, action_params)

    def apply_room_preferences(
        self, active_rooms: list[dict], map_id: int | None = None
    ) -> dict:
        """Fetch current per-room preferences, merge in `active_rooms`
        (marking them chosen and overriding only the fields you specify —
        see merge_room_preferences), mark every other known room as not
        chosen, and push the full merged set back. This is the safe
        variant: unlike set_room_preferences, it can't silently wipe
        settings for rooms you didn't mention.
        """
        resolved_map_id = map_id if map_id is not None else self.get_current_map_id()
        if resolved_map_id is None:
            raise ValueError(f"{self.model}: could not determine the current map id")
        current = self.get_room_preferences(resolved_map_id)
        merged = merge_room_preferences(current, active_rooms)
        return self.set_room_preferences(merged, resolved_map_id)

    # --- maps ------------------------------------------------------------
    def map_list(self) -> list[dict]:
        """Return [{'name', 'id', 'cur'}...] via get-map-list action.

        List-style maps only (ijai/viomi). dreame's blob map is a different shape
        (DreameMapCapability) with no map list — its decode is not yet implemented.

        The output piid varies by profile (ijai: siid 10/piid 4; viomi v12/v13/v15:
        siid 7/piid 11; viomi v45: siid 10/piid 4) — read from the profile's own
        `get_map_list.out_piids` rather than hardcoding ijai's value.
        """
        cap = self.profile.map
        if not isinstance(cap, MapCapability) or cap.get_map_list is None:
            return []
        out_piid = cap.get_map_list.out_piids[0] if cap.get_map_list.out_piids else 4
        res = self._action(cap.get_map_list)
        for out in res.get("out", []):
            if out.get("piid") == out_piid:
                try:
                    payload = json.loads(out["value"])
                except (ValueError, KeyError):
                    return []
                # viomi v15's map-list is an array-of-arrays, not a list of dicts
                # (spec/profiles/viomi.py VIOMI_V15_MAP) — reject any shape whose
                # items aren't {"id": ...} dicts rather than crashing fetch_all's
                # m.get("cur")/m["id"] reads downstream.
                if not isinstance(payload, list) or not all(
                    isinstance(m, dict) and "id" in m for m in payload
                ):
                    _LOGGER.debug("map-list payload has unsupported shape: %r", payload)
                    return []
                return payload
        return []

    def request_map_upload(self, map_id: int) -> dict:
        """Trigger a fresh upload for a map-list map; returns raw out."""
        cap = self.profile.map
        if not isinstance(cap, MapCapability):
            raise ValueError(f"{self.model} has no map-upload capability")
        actions = []
        if cap.get_map_list is not None and cap.upload_by_mapid_ii is not None:
            actions.append(cap.upload_by_mapid_ii)
        if cap.upload_by_mapid is not None:
            actions.append(cap.upload_by_mapid)
        elif cap.upload_by_mapid_ii is not None:
            actions.append(cap.upload_by_mapid_ii)
        if not actions:
            raise ValueError(f"{self.model} has no map-upload capability")
        last_error: Exception | None = None
        for action in actions:
            try:
                return self._action(action, [int(map_id)])
            except Exception as err:  # noqa: BLE001
                last_error = err
                if action is not actions[-1]:
                    _LOGGER.debug(
                        "map upload action %s/%s failed, trying fallback: %s",
                        action.siid, action.aiid, err,
                    )
                    continue
                raise
        raise ValueError(f"{self.model} map-upload failed: {last_error}")

    def set_current_map(self, map_id: int) -> None:
        """Switch the vacuum's active map (multi-map devices)."""
        cap = self.profile.map
        if not isinstance(cap, MapCapability) or cap.set_current_map is None:
            raise ValueError(f"{self.model} has no map-switch capability")
        self._action(cap.set_current_map, [int(map_id)])

    def get_mac(self) -> str | None:
        """Device MAC (used in the map AES key). From local miIO info()."""
        try:
            return self._dev.info().mac_address
        except Exception:  # noqa: BLE001
            return None

    def get_map_encrypt_enabled(self) -> bool | None:
        """Live read of the model's map-encrypt toggle (siid 7/piid 55 on
        profiles that expose it — modeled as SettingsCapability.map_encrypt,
        NOT MapCapability; the "sweep" service (7) carries this toggle, not
        the "map" service (10)).

        None when the profile doesn't declare this prop, or the read failed
        (caller should assume encrypted — the historical/default behaviour —
        rather than silently skipping decryption on an ambiguous read).
        """
        cap = self.profile.settings
        prop = getattr(cap, "map_encrypt", None) if isinstance(cap, SettingsCapability) else None
        if prop is None:
            return None
        try:
            val = self._dev.get_property_by(prop.siid, prop.piid)[0].get("value")
        except Exception as err:  # noqa: BLE001
            _LOGGER.debug("map_encrypt: siid %s/piid %s read failed: %s", prop.siid, prop.piid, err)
            return None
        return bool(val)

    def get_wifi_sn(self, user_id: str | None = None) -> str | None:
        """Serial used to seed the map AES key (siid 1, piid 5 on 2022+ models)."""
        for piid in (5, 3):
            try:
                val = self._dev.get_property_by(1, piid)[0].get("value")
            except Exception as err:  # noqa: BLE001
                _LOGGER.debug("wifi_sn: siid 1/piid %s read failed: %s", piid, err)
                continue
            if isinstance(val, str) and _is_wifi_sn(val):
                return val
            _LOGGER.debug("wifi_sn: siid 1/piid %s value %r did not match expected shape", piid, val)
        try:
            raw = self._dev.get_property_by(7, 45)[0].get("value", "")
        except Exception as err:  # noqa: BLE001
            _LOGGER.debug("wifi_sn: siid 7/piid 45 fallback read failed: %s", err)
            return None
        for part in str(raw).split(","):
            # The serial sits before an optional ";<uid>" suffix on siid 7/piid 45.
            p = part.replace('"', "").split(";")[0]
            if _is_wifi_sn(p) and p.isalnum():
                return p
        _LOGGER.debug("wifi_sn: siid 7/piid 45 value %r had no matching serial part", raw)
        return None


def _as_int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
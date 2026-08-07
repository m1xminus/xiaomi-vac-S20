"""Vacuum entity for Xiaomi (ijai-family) vacuums."""
from __future__ import annotations

import logging

import voluptuous as vol
from homeassistant.components.vacuum import (
    StateVacuumEntity,
    VacuumActivity,
    VacuumEntityFeature,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv, entity_platform
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback, SupportsResponse
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import XiaomiConfigEntry
from .cloud.connector import XiaomiCloud
from .const import (
    CONF_DEVICE_ID,
    CONF_PASS_TOKEN,
    CONF_SERVER,
    CONF_SERVICE_TOKEN,
    CONF_SSECURITY,
    CONF_USER_ID,
    CONF_USERNAME,
    DOMAIN,
)
from .coordinator import XiaomiVacuumCoordinator
from .device import IjaiVacuumDevice
from .spec.types import MapCapability

# Serialise commands to the device (one MIoT write at a time).
PARALLEL_UPDATES = 1

_LOGGER = logging.getLogger(__name__)

_ACTIVITY = {
    "cleaning": VacuumActivity.CLEANING,
    "paused": VacuumActivity.PAUSED,
    "idle": VacuumActivity.IDLE,
    "returning": VacuumActivity.RETURNING,
    "docked": VacuumActivity.DOCKED,
    "error": VacuumActivity.ERROR,
}

_BASE_SUPPORT = (
    VacuumEntityFeature.START
    | VacuumEntityFeature.PAUSE
    | VacuumEntityFeature.STOP
    | VacuumEntityFeature.STATE
)

async def async_setup_entry(
    hass: HomeAssistant, entry: XiaomiConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator = entry.runtime_data.control
    async_add_entities([XiaomiVacuum(coordinator, entry)])

    platform = entity_platform.async_get_current_platform()
    platform.async_register_entity_service(
        "clean_segment",
        {vol.Required("segments"): vol.All(cv.ensure_list, [vol.Coerce(int)])},
        "async_clean_segment",
    )
    platform.async_register_entity_service(
        "refresh_map",
        {vol.Required("confirm_movement"): vol.All(cv.boolean, vol.Equal(True))},
        "async_refresh_map",
    )
    platform.async_register_entity_service(
        "get_room_preferences",
        {vol.Optional("map_id"): vol.Coerce(int)},
        "async_get_room_preferences",
        supports_response=SupportsResponse.ONLY,
    )
    platform.async_register_entity_service(
        "set_room_preferences",
        {
            vol.Required("preferences"): vol.All(cv.ensure_list, [dict]),
            vol.Optional("map_id"): vol.Coerce(int),
        },
        "async_set_room_preferences",
    )
    platform.async_register_entity_service(
        "apply_room_preferences",
        {
            vol.Required("active_rooms"): vol.All(cv.ensure_list, [dict]),
            vol.Optional("map_id"): vol.Coerce(int),
        },
        "async_apply_room_preferences",
    )
    platform.async_register_entity_service(
        "resume_or_start",
        {vol.Optional("map_id"): vol.Coerce(int)},
        "async_resume_or_start",
    )


class XiaomiVacuum(CoordinatorEntity[XiaomiVacuumCoordinator], StateVacuumEntity):
    _attr_has_entity_name = True
    _attr_name = None

    def __init__(self, coordinator: XiaomiVacuumCoordinator, entry: ConfigEntry) -> None:
        super().__init__(coordinator)
        self._entry = entry
        self._device = coordinator.device
        core = self._device.core
        support = _BASE_SUPPORT
        if core.charge is not None:
            support |= VacuumEntityFeature.RETURN_HOME
        if core.locate is not None or core.alarm is not None:
            support |= VacuumEntityFeature.LOCATE
        self._attr_supported_features = support
        base = entry.unique_id or entry.entry_id
        self._attr_unique_id = f"{base}_vacuum"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, base)},
            manufacturer="Xiaomi",
            model=self._device.model,
            name=entry.title,
        )

    @property
    def activity(self) -> VacuumActivity:
        return _ACTIVITY.get(self.coordinator.data.activity, VacuumActivity.IDLE)

    @property
    def extra_state_attributes(self) -> dict:
        return {"fault": self.coordinator.data.fault, "model": self._device.model}

    async def async_start(self) -> None:
        await self.hass.async_add_executor_job(self._device.start)
        await self.coordinator.async_request_refresh()

    async def async_resume_or_start(self, map_id: int | None = None) -> None:
        """Start button's real intent: continue whatever room-clean job is
        currently marked "chosen" on the device, if any, rather than always
        starting a fresh full-home clean. vacuum.start (async_start above)
        maps to a bare MIoT action with no room/job reference at all — it
        is structurally incapable of resuming a specific room-clean job,
        it can only ever begin a new full-home one.

        Reads the "chosen" rooms straight from the device/cloud (not any
        client-side memory) purely to DECIDE whether there's something to
        resume. The actual resume call itself sends an EMPTY room-ids
        string with oper=1 — captured directly from the real Mi Home app's
        own traffic (`in=["", 0, 1]`), not the chosen room ids. An earlier
        version of this re-sent the explicit room ids and separately
        re-applied preferences first, on the theory that mirroring the
        "start a new clean" sequence was needed — that was a guess made
        without evidence, and it was wrong: Mi Home's own resume does
        neither of those things, it just sends the bare empty-id resume
        oper against whatever job the device already has paused
        internally. Falls back to a plain start if nothing is chosen (e.g.
        the last clean was already full-home) or if any of this fails for
        any reason — never blocks starting the vacuum just because this
        nicety couldn't be resolved.
        """
        try:
            result = await self.async_get_room_preferences(map_id)
            chosen = [
                int(p["room_id"]) for p in result.get("preferences", [])
                if str(p.get("choose")) == "1"
            ]
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning(
                "%s: resume_or_start couldn't read room preferences, falling back "
                "to a plain start: %s", self._device.model, err,
            )
            chosen = []
        if not chosen:
            _LOGGER.debug("%s: resume_or_start found no chosen rooms, starting a plain clean", self._device.model)
            await self.async_start()
            return
        _LOGGER.debug("%s: resume_or_start found chosen rooms %s, resuming (empty-id resume oper)", self._device.model, chosen)
        data = self._entry.data
        if _has_cloud_session(data):
            try:
                await self.hass.async_add_executor_job(_cloud_resume_room_clean, data, self._device)
                await self.coordinator.async_request_refresh()
                return
            except Exception as cloud_err:  # noqa: BLE001
                _LOGGER.warning(
                    "%s: cloud resume failed, falling back to re-sending room ids: %s",
                    self._device.model, cloud_err,
                )
        # Last-resort fallback if the empty-id resume itself couldn't be
        # sent at all (no cloud session, or the cloud call raised) — not
        # confirmed to behave like a true resume, but better than doing
        # nothing when the person pressed play.
        await self.async_clean_segment(chosen)

    async def async_stop(self, **kwargs) -> None:
        await self.hass.async_add_executor_job(self._device.stop)
        await self.coordinator.async_request_refresh()

    async def async_return_to_base(self, **kwargs) -> None:
        await self.hass.async_add_executor_job(self._device.return_home)
        await self.coordinator.async_request_refresh()

    async def async_refresh_map(self, confirm_movement: bool) -> None:
        data = self._entry.runtime_data
        if data.map is None:
            raise HomeAssistantError("Refresh map requires a cloud map session")
        await data.map.async_refresh_map_with_movement(
            confirm_movement=confirm_movement,
            use_mqtt=data.mqtt is not None,
        )

    async def async_pause(self) -> None:
        """Job-aware pause when a room-specific clean is running: re-issues
        the SAME room-clean action with oper=2 (Pause) and an EMPTY
        room-ids string — captured directly from the real Mi Home app's
        own traffic (`in=["", 0, 2]`), confirmed to make the device's
        status hold at Paused across multiple subsequent polls, matching
        the app's own behavior exactly. An earlier version re-sent the
        actual chosen room ids instead of an empty string; that version
        preserved the chosen-rooms preference correctly but never got the
        device to report a genuine Paused status — it drifted straight to
        Idle regardless of which oper value was tried, because the room
        ids themselves were the wrong parameter to be sending here.

        This device profile has no dedicated core.pause action at all
        (see CoreCapability), so the generic path silently falls back to
        a full core.stop — confirmed on real hardware to cancel the job
        outright and clear which rooms were chosen. Falls back to that
        plain device pause/stop if there's no room-specific job active,
        or if the room-aware pause itself fails for any reason — never
        blocks pausing just because this couldn't be resolved.
        """
        try:
            result = await self.async_get_room_preferences()
            chosen = [
                int(p["room_id"]) for p in result.get("preferences", [])
                if str(p.get("choose")) == "1"
            ]
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning(
                "%s: pause couldn't read room preferences, falling back to a plain pause/stop: %s",
                self._device.model, err,
            )
            chosen = []
        if chosen:
            data = self._entry.data
            if _has_cloud_session(data):
                try:
                    await self.hass.async_add_executor_job(_cloud_pause_room_clean, data, self._device)
                    _LOGGER.debug(
                        "%s: paused room-clean job (job-aware, empty-id pause; chosen rooms %s preserved)",
                        self._device.model, chosen,
                    )
                    await self.coordinator.async_request_refresh()
                    return
                except Exception as cloud_err:  # noqa: BLE001
                    _LOGGER.warning(
                        "%s: cloud job-aware pause failed, falling back to plain pause/stop: %s",
                        self._device.model, cloud_err,
                    )
        await self.hass.async_add_executor_job(self._device.pause)
        await self.coordinator.async_request_refresh()

    async def async_locate(self, **kwargs) -> None:
        await self.hass.async_add_executor_job(self._device.locate)

    async def _refresh_map_soon(self) -> None:
        """Nudge the map coordinator to refresh right away after an action
        that changes which rooms are "chosen", instead of waiting for its
        own independent poll cycle. The chosen-rooms flag the card reads is
        only refreshed as part of that coordinator's own update — without
        this, there's an unnecessary extra delay (up to that coordinator's
        full cycle) before the card's persistent selection highlight
        catches up to what was actually just sent to the device."""
        map_coord = getattr(self._entry.runtime_data, "map", None)
        if map_coord is not None:
            await map_coord.async_request_refresh()

    async def async_clean_segment(self, segments: list[int]) -> None:
        """Clean one or more rooms by their map room id (tap-to-clean)."""
        if not segments:
            # An empty room-ids list is NOT "clean nothing" on this hardware —
            # it's silently interpreted as "no specific rooms selected", which
            # falls back to a full-home clean with no error surfaced anywhere
            # (confirmed on real hardware: siid 7/aiid 3 with in=['', 0, 1]
            # actually ran a full clean). Reject it outright instead of
            # letting that happen invisibly, whoever the caller is — the
            # card, an automation, or a manual service call.
            raise HomeAssistantError(
                "clean_segment called with no room ids — refusing, since an empty "
                "list is silently treated as a full-home clean by this device rather "
                "than \"clean nothing\""
            )
        data = self._entry.data
        if _has_cloud_session(data):
            # ijai proven, xiaomi inferred, viomi/dreame/roidmi best-effort-unverified — plan v1.2.2
            try:
                await self.hass.async_add_executor_job(
                    _cloud_clean_segments, data, self._device, segments
                )
                _LOGGER.debug("%s: room-clean served via cloud", self._device.model)
                await self.coordinator.async_request_refresh()
                await self._refresh_map_soon()
                return
            except Exception as cloud_err:  # noqa: BLE001
                _LOGGER.warning(
                    "%s: cloud room-clean failed, falling back to local (may no-op on ijai): %s",
                    self._device.model,
                    cloud_err,
                )
        # Local fallback — also used when no cloud session is configured.
        try:
            await self.hass.async_add_executor_job(self._device.clean_segments, segments)
            _LOGGER.debug("%s: room-clean served via local", self._device.model)
        except Exception as err:  # noqa: BLE001
            raise HomeAssistantError(f"Room cleaning failed: {err}") from err
        await self.coordinator.async_request_refresh()
        await self._refresh_map_soon()

    async def async_get_room_preferences(self, map_id: int | None = None) -> dict:
        """Read current per-room clean-mode/fan-power/water-level/enabled
        settings. Returns {'preferences': [...]} for the frontend/scripts to
        consume — see set_room_preferences to write them back."""
        data = self._entry.data
        if _has_cloud_session(data):
            try:
                prefs = await self.hass.async_add_executor_job(
                    _cloud_get_room_preferences, data, self._device, map_id
                )
                return {"preferences": prefs}
            except Exception as cloud_err:  # noqa: BLE001
                _LOGGER.warning(
                    "%s: cloud get-preferences failed, falling back to local: %s",
                    self._device.model, cloud_err,
                )
        try:
            prefs = await self.hass.async_add_executor_job(
                self._device.get_room_preferences, map_id
            )
            return {"preferences": prefs}
        except Exception as err:  # noqa: BLE001
            raise HomeAssistantError(f"Reading room preferences failed: {err}") from err

    async def async_set_room_preferences(
        self, preferences: list[dict], map_id: int | None = None
    ) -> None:
        """Write per-room clean-mode/fan-power/water-level/enabled settings.
        Each entry needs at least 'room_id'; unspecified fields keep the
        Mi Home app's own defaults — see device.format_room_preference."""
        data = self._entry.data
        if _has_cloud_session(data):
            try:
                await self.hass.async_add_executor_job(
                    _cloud_set_room_preferences, data, self._device, preferences, map_id
                )
                return
            except Exception as cloud_err:  # noqa: BLE001
                _LOGGER.warning(
                    "%s: cloud set-preferences failed, falling back to local: %s",
                    self._device.model, cloud_err,
                )
        try:
            await self.hass.async_add_executor_job(
                self._device.set_room_preferences, preferences, map_id
            )
        except Exception as err:  # noqa: BLE001
            raise HomeAssistantError(f"Setting room preferences failed: {err}") from err

    async def async_apply_room_preferences(
        self, active_rooms: list[dict], map_id: int | None = None
    ) -> None:
        """Safe variant of set_room_preferences: fetches current settings
        first, overrides only the rooms/fields you specify, marks every
        other known room inactive without touching its saved settings.
        Won't silently wipe preferences for rooms you didn't mention."""
        data = self._entry.data
        if _has_cloud_session(data):
            try:
                await self.hass.async_add_executor_job(
                    _cloud_apply_room_preferences, data, self._device, active_rooms, map_id
                )
                await self._refresh_map_soon()
                return
            except Exception as cloud_err:  # noqa: BLE001
                _LOGGER.warning(
                    "%s: cloud apply-preferences failed, falling back to local: %s",
                    self._device.model, cloud_err,
                )
        try:
            await self.hass.async_add_executor_job(
                self._device.apply_room_preferences, active_rooms, map_id
            )
        except Exception as err:  # noqa: BLE001
            raise HomeAssistantError(f"Applying room preferences failed: {err}") from err
        await self._refresh_map_soon()


def _has_cloud_session(data: dict) -> bool:
    return all(
        data.get(k)
        for k in (
            CONF_USERNAME, CONF_USER_ID, CONF_SSECURITY,
            CONF_SERVICE_TOKEN, CONF_SERVER, CONF_DEVICE_ID,
        )
    )


def _cloud_action_ok(response: object) -> bool:
    if not isinstance(response, dict):
        return False
    if response.get("code", 0) != 0:
        return False
    result = response.get("result")
    if isinstance(result, dict) and result.get("code", 0) != 0:
        return False
    if isinstance(result, list):
        return all(not isinstance(item, dict) or item.get("code", 0) == 0 for item in result)
    return True


def _cloud_clean_segments(data: dict, device: IjaiVacuumDevice, segments: list[int]) -> None:
    required = (
        data.get(CONF_USERNAME),
        data.get(CONF_USER_ID),
        data.get(CONF_SSECURITY),
        data.get(CONF_SERVICE_TOKEN),
        data.get(CONF_SERVER),
        data.get(CONF_DEVICE_ID),
    )
    if not all(required):
        raise ValueError("Room cleaning cloud fallback requires a Xiaomi cloud session")

    cloud = XiaomiCloud(str(data[CONF_USERNAME]))
    cloud.restore_session(
        data[CONF_USER_ID],
        data[CONF_SSECURITY],
        data[CONF_SERVICE_TOKEN],
        data.get(CONF_PASS_TOKEN),
    )

    # set-room-clean (siid 7/aiid 3) is the ONLY action that takes map/device
    # room ids correctly — try it first, and try it BOTH ways signed (plain,
    # then RC4), since set-preference-ii (siid 7/aiid 9) was confirmed
    # rejected by this device specifically over the RC4 path while the plain
    # path succeeded. Only after both signing attempts on the correct action
    # genuinely fail do we fall back to start-room-sweep (siid 2/aiid 7) —
    # and that fallback is loud on purpose: it wants Mijia room ids, not map
    # ids, so map ids sent through it can "succeed" at the transport level
    # while silently running a FULL clean instead of the rooms you picked
    # (verified on v17 hardware, issue #7). A silent full-clean fallback is
    # worse than a loud failure, so this path warns every time it's used.
    preferred = device.room_clean_set_params(segments)
    if preferred is not None:
        action, params = preferred
        _LOGGER.debug(
            "%s: set-room-clean params: siid=%s aiid=%s in=%s",
            device.model, action.siid, action.aiid, params,
        )
        for caller, label in (
            (cloud.cloud_action_plain, "plain"),
            (cloud.cloud_action, "RC4"),
        ):
            response = caller(str(data[CONF_SERVER]), str(data[CONF_DEVICE_ID]), action.siid, action.aiid, params)
            if _cloud_action_ok(response):
                _LOGGER.debug("%s: room-clean served via cloud (set-room-clean, %s signing)", device.model, label)
                return
            _LOGGER.debug("%s: set-room-clean via %s signing rejected: %s", device.model, label, response)

    fallback = device.room_clean_start_params(segments)
    if fallback is None:
        raise ValueError(f"{device.model} has no supported room-clean action")
    action, params = fallback
    _LOGGER.warning(
        "%s: set-room-clean failed over both signing methods — falling back to "
        "start-room-sweep, which is KNOWN to silently run a full clean instead of "
        "the selected rooms on map-id hardware (see device.clean_segments). If "
        "this fires, room selection is not actually working right now.",
        device.model,
    )
    response = cloud.cloud_action_plain(
        str(data[CONF_SERVER]), str(data[CONF_DEVICE_ID]), action.siid, action.aiid, params,
    )
    if _cloud_action_ok(response):
        return
    response = cloud.cloud_action(
        str(data[CONF_SERVER]), str(data[CONF_DEVICE_ID]), action.siid, action.aiid, params,
    )
    if _cloud_action_ok(response):
        return
    raise ValueError("Xiaomi cloud rejected every room-clean action")


def _cloud_room_clean_oper(
    data: dict, device: IjaiVacuumDevice, params: tuple, label: str,
) -> None:
    """Shared cloud caller for the pause/resume room-clean oper — see
    device.room_clean_pause_params / room_clean_resume_params for what's
    actually being sent and why (both use an empty room-ids string,
    confirmed from real Mi Home app traffic)."""
    required = (
        data.get(CONF_USERNAME), data.get(CONF_USER_ID), data.get(CONF_SSECURITY),
        data.get(CONF_SERVICE_TOKEN), data.get(CONF_SERVER), data.get(CONF_DEVICE_ID),
    )
    if not all(required):
        raise ValueError(f"Room-clean {label} requires a Xiaomi cloud session")
    action, action_params = params
    cloud = XiaomiCloud(str(data[CONF_USERNAME]))
    cloud.restore_session(
        data[CONF_USER_ID], data[CONF_SSECURITY],
        data[CONF_SERVICE_TOKEN], data.get(CONF_PASS_TOKEN),
    )
    _LOGGER.debug(
        "%s: room-clean %s params: siid=%s aiid=%s in=%s",
        device.model, label, action.siid, action.aiid, action_params,
    )
    for caller, sig_label in (
        (cloud.cloud_action_plain, "plain"),
        (cloud.cloud_action, "RC4"),
    ):
        response = caller(str(data[CONF_SERVER]), str(data[CONF_DEVICE_ID]), action.siid, action.aiid, action_params)
        if _cloud_action_ok(response):
            _LOGGER.debug("%s: room-clean %s served via cloud (%s signing)", device.model, label, sig_label)
            return
        _LOGGER.debug("%s: room-clean %s via %s signing rejected: %s", device.model, label, sig_label, response)
    raise ValueError(f"Xiaomi cloud rejected room-clean {label} action")


def _cloud_pause_room_clean(data: dict, device: IjaiVacuumDevice) -> None:
    """Job-aware pause: siid 7/aiid 3 with oper=2 (Pause) and an EMPTY
    room-ids string — see device.room_clean_pause_params."""
    params = device.room_clean_pause_params()
    if params is None:
        raise ValueError(f"{device.model} has no room-clean pause action")
    _cloud_room_clean_oper(data, device, params, "pause")


def _cloud_resume_room_clean(data: dict, device: IjaiVacuumDevice) -> None:
    """Job-aware resume: siid 7/aiid 3 with oper=1 (Start) and an EMPTY
    room-ids string — see device.room_clean_resume_params. NOT the same
    as starting a new room clean (room_clean_set_params), which sends
    real room ids; this addresses whatever job the device already has
    paused internally."""
    params = device.room_clean_resume_params()
    if params is None:
        raise ValueError(f"{device.model} has no room-clean resume action")
    _cloud_room_clean_oper(data, device, params, "resume")


def _cloud_get_current_map_id(data: dict, device: IjaiVacuumDevice) -> int:
    """Cloud-native equivalent of device.get_current_map_id() — reads
    siid 10/piid 2 via cloud_get_prop instead of a local property read, so
    the cloud code path never silently depends on local reachability
    (matches how the confirmed-working reference script always resolves
    map id via a cloud status call, never local)."""
    cap = device.profile.map
    if not isinstance(cap, MapCapability) or cap.current_map_id is None:
        raise ValueError(f"{device.model} has no current-map-id property")
    cloud = XiaomiCloud(str(data[CONF_USERNAME]))
    cloud.restore_session(
        data[CONF_USER_ID], data[CONF_SSECURITY],
        data[CONF_SERVICE_TOKEN], data.get(CONF_PASS_TOKEN),
    )
    response = cloud.cloud_get_prop_plain(
        str(data[CONF_SERVER]), str(data[CONF_DEVICE_ID]),
        cap.current_map_id.siid, cap.current_map_id.piid,
    )
    result = response.get("result") if isinstance(response, dict) else None
    value = None
    if isinstance(result, list) and result:
        first = result[0]
        if isinstance(first, dict):
            value = first.get("value")
    if value is None:
        raise ValueError(f"Xiaomi cloud returned no current-map-id: {response!r}")
    _LOGGER.debug("%s: resolved current map id = %s", device.model, value)
    return int(value)


def _cloud_get_room_preferences(
    data: dict, device: IjaiVacuumDevice, map_id: int | None
) -> list[dict]:
    required = (
        data.get(CONF_USERNAME), data.get(CONF_USER_ID), data.get(CONF_SSECURITY),
        data.get(CONF_SERVICE_TOKEN), data.get(CONF_SERVER), data.get(CONF_DEVICE_ID),
    )
    if not all(required):
        raise ValueError("Room preferences require a Xiaomi cloud session")
    resolved_map_id = map_id if map_id is not None else _cloud_get_current_map_id(data, device)
    params = device.get_room_preferences_params(resolved_map_id)
    if params is None:
        raise ValueError(f"{device.model} has no get-preference action")
    action, action_params = params
    cloud = XiaomiCloud(str(data[CONF_USERNAME]))
    cloud.restore_session(
        data[CONF_USER_ID], data[CONF_SSECURITY],
        data[CONF_SERVICE_TOKEN], data.get(CONF_PASS_TOKEN),
    )
    _LOGGER.debug(
        "%s: get-preference params: siid=%s aiid=%s in=%s (map_id=%s)",
        device.model, action.siid, action.aiid, action_params, resolved_map_id,
    )
    response = cloud.cloud_action_plain(
        str(data[CONF_SERVER]), str(data[CONF_DEVICE_ID]),
        action.siid, action.aiid, action_params,
    )
    if not _cloud_action_ok(response):
        _LOGGER.debug("%s: get-preference via plain signing rejected: %s — retrying RC4", device.model, response)
        response = cloud.cloud_action(
            str(data[CONF_SERVER]), str(data[CONF_DEVICE_ID]),
            action.siid, action.aiid, action_params,
        )
    if not _cloud_action_ok(response):
        raise ValueError(f"Xiaomi cloud rejected get-preference: {response}")
    result = response.get("result") if isinstance(response, dict) else None
    out = result.get("out") if isinstance(result, dict) else None
    raw = out[0] if out else None
    if raw is None:
        raise ValueError(f"{device.model}: get-preference returned no data: {response!r}")
    from .device import parse_room_preferences
    parsed = parse_room_preferences(raw)
    chosen_now = [p["room_id"] for p in parsed if str(p.get("choose")) == "1"]
    _LOGGER.debug("%s: get-preference result — rooms currently chosen: %s", device.model, chosen_now)
    return parsed


def _cloud_set_room_preferences(
    data: dict, device: IjaiVacuumDevice, preferences: list[dict], map_id: int | None
) -> None:
    required = (
        data.get(CONF_USERNAME), data.get(CONF_USER_ID), data.get(CONF_SSECURITY),
        data.get(CONF_SERVICE_TOKEN), data.get(CONF_SERVER), data.get(CONF_DEVICE_ID),
    )
    if not all(required):
        raise ValueError("Room preferences require a Xiaomi cloud session")
    resolved_map_id = map_id if map_id is not None else _cloud_get_current_map_id(data, device)
    params = device.set_room_preferences_params(preferences, resolved_map_id)
    if params is None:
        raise ValueError(f"{device.model} has no set-preference action")
    action, action_params = params
    cloud = XiaomiCloud(str(data[CONF_USERNAME]))
    cloud.restore_session(
        data[CONF_USER_ID], data[CONF_SSECURITY],
        data[CONF_SERVICE_TOKEN], data.get(CONF_PASS_TOKEN),
    )
    # set-preference-ii specifically: the RC4-encrypted cloud_action() path
    # (cloud.cloud_action) got a clean HTTP response but the DEVICE rejected
    # the action with an action-specific error (-706012015) — confirmed on
    # real hardware. A plain (non-RC4) signed call with the same payload,
    # matching a proven-working reference implementation, succeeded against
    # the same account/device/action immediately after. Scoped to just this
    # call rather than switching cloud_action() everywhere, since every
    # other cloud call (map, room-clean, active-map switch, prop reads) is
    # already confirmed working via the RC4 path — no reason to risk
    # regressing those without the same kind of confirmation.
    _LOGGER.debug(
        "%s: set-preference params: siid=%s aiid=%s map_id=%s pref_json=%s",
        device.model, action.siid, action.aiid, resolved_map_id, action_params[0],
    )
    response = cloud.cloud_action_plain(
        str(data[CONF_SERVER]), str(data[CONF_DEVICE_ID]),
        action.siid, action.aiid, action_params,
    )
    if not _cloud_action_ok(response):
        raise ValueError(f"Xiaomi cloud rejected set-preference: {response}")


def _cloud_apply_room_preferences(
    data: dict, device: IjaiVacuumDevice, active_rooms: list[dict], map_id: int | None
) -> None:
    """Cloud-native merge-safe apply: fetch current preferences, merge in
    `active_rooms` (see device.merge_room_preferences — unmentioned rooms
    keep their saved settings and are just marked inactive, never reset),
    push the full merged set back. All three steps share ONE resolved
    map_id so a device-side map switch mid-call can't split them across
    two different maps."""
    resolved_map_id = map_id if map_id is not None else _cloud_get_current_map_id(data, device)
    current = _cloud_get_room_preferences(data, device, resolved_map_id)
    from .device import merge_room_preferences
    merged = merge_room_preferences(current, active_rooms)
    _cloud_set_room_preferences(data, device, merged, resolved_map_id)


def _cloud_set_current_map(data: dict, device: IjaiVacuumDevice, map_id: int) -> None:
    # ijai proven, xiaomi inferred, viomi/dreame/roidmi best-effort-unverified — plan v1.2.2
    cap = device.profile.map
    if not isinstance(cap, MapCapability):
        raise ValueError(f"{device.model} has no cloud-mappable map capability")
    action = cap.set_current_map
    if action is None:
        raise ValueError(f"{device.model} has no set-current-map action")
    cloud = XiaomiCloud(str(data[CONF_USERNAME]))
    cloud.restore_session(
        data[CONF_USER_ID],
        data[CONF_SSECURITY],
        data[CONF_SERVICE_TOKEN],
        data.get(CONF_PASS_TOKEN),
    )
    response = cloud.cloud_action(
        str(data[CONF_SERVER]),
        str(data[CONF_DEVICE_ID]),
        action.siid,
        action.aiid,
        [int(map_id)],
    )
    if not _cloud_action_ok(response):
        raise ValueError(f"Xiaomi cloud rejected map-switch: {response}")

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
        await self.hass.async_add_executor_job(self._device.pause)
        await self.coordinator.async_request_refresh()

    async def async_locate(self, **kwargs) -> None:
        await self.hass.async_add_executor_job(self._device.locate)

    async def async_clean_segment(self, segments: list[int]) -> None:
        """Clean one or more rooms by their map room id (tap-to-clean)."""
        data = self._entry.data
        if _has_cloud_session(data):
            # ijai proven, xiaomi inferred, viomi/dreame/roidmi best-effort-unverified — plan v1.2.2
            try:
                await self.hass.async_add_executor_job(
                    _cloud_clean_segments, data, self._device, segments
                )
                _LOGGER.debug("%s: room-clean served via cloud", self._device.model)
                await self.coordinator.async_request_refresh()
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

    # Same preference order as device.clean_segments: set-room-clean takes
    # map room ids; start-room-sweep wants Mijia ids and fails with map ids.
    attempts = [
        params
        for params in (
            device.room_clean_set_params(segments),
            device.room_clean_start_params(segments),
        )
        if params is not None
    ]
    if not attempts:
        raise ValueError(f"{device.model} has no supported room-clean action")

    cloud = XiaomiCloud(str(data[CONF_USERNAME]))
    cloud.restore_session(
        data[CONF_USER_ID],
        data[CONF_SSECURITY],
        data[CONF_SERVICE_TOKEN],
        data.get(CONF_PASS_TOKEN),
    )
    for action, params in attempts:
        response = cloud.cloud_action(
            str(data[CONF_SERVER]),
            str(data[CONF_DEVICE_ID]),
            action.siid,
            action.aiid,
            params,
        )
        if _cloud_action_ok(response):
            return
    raise ValueError("Xiaomi cloud rejected every room-clean action")


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
    response = cloud.cloud_get_prop(
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
    return parse_room_preferences(raw)


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
    response = cloud.cloud_action(
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
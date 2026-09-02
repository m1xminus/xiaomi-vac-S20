"""Sensors: battery + consumables + clean stats (control coordinator)."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.const import PERCENTAGE, EntityCategory, UnitOfArea, UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import XiaomiConfigEntry
from .const import DOMAIN
from .coordinator import XiaomiVacuumCoordinator
from .device import VacuumStatus
from .spec.types import ModelProfile

# Read-only platform fed by the coordinator; no device writes to serialise.
PARALLEL_UPDATES = 0


@dataclass(frozen=True, kw_only=True)
class XiaomiSensorDescription(SensorEntityDescription):
    value_fn: Callable[[VacuumStatus], int | str | datetime | None]
    # Returns True when the profile actually exposes this sensor's data source.
    # None means always include (no capability gate).
    supported_fn: Callable[[ModelProfile], bool] | None = None


_DOOR_STATE_OPTIONS = ["none", "dust_box", "water_box", "two_in_one"]
_CLOTH_STATE_OPTIONS = ["none", "exist"]


# Canonical sensor catalogue. Clean area/time are still parked (no coordinator
# support yet — see status() in device.py). Consumable life (brush/filter/mop,
# % and hours remaining) is wired via ConsumablesCapability, confirmed against
# xiaomi.vacuum.d106gl's own MIoT spec (siid 7).
_ALL_SENSORS: tuple[XiaomiSensorDescription, ...] = (
    XiaomiSensorDescription(
        key="status", translation_key="status",
        device_class=SensorDeviceClass.ENUM,
        options=["cleaning", "paused", "idle", "returning", "docked", "error"],
        value_fn=lambda s: s.activity,
        # status is always populated (required prop, raises on failure)
    ),
    XiaomiSensorDescription(
        key="battery", translation_key="battery",
        device_class=SensorDeviceClass.BATTERY, native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT, value_fn=lambda s: s.battery,
        supported_fn=lambda p: p.core is not None and p.core.battery is not None,
    ),
    XiaomiSensorDescription(
        # Raw code only — deliberately NOT device_class=ENUM. The public
        # MIoT spec documents this as a bare uint32 (0-3000) with no named
        # value list at all, and there's no reliable, complete mapping
        # available anywhere for this device (checked; even similar
        # devices' community-tracked code lists are openly incomplete).
        # Community reports for a related device family show codes in
        # this same numeric range can be ordinary status-adjacent events
        # (e.g. charging/fully-charged) rather than real faults, so showing
        # a plausible-sounding decoded name would risk being actively
        # misleading. Showing the honest raw number lets it be checked
        # directly against what the Xiaomi app displays.
        key="fault", translation_key="fault",
        entity_category=EntityCategory.DIAGNOSTIC, value_fn=lambda s: s.fault,
        supported_fn=lambda p: p.core is not None and p.core.fault is not None,
    ),
    XiaomiSensorDescription(
        key="main_brush_life", translation_key="main_brush_life",
        native_unit_of_measurement=PERCENTAGE, entity_category=EntityCategory.DIAGNOSTIC,
        state_class=SensorStateClass.MEASUREMENT, value_fn=lambda s: s.main_brush_life,
        supported_fn=lambda p: p.consumables is not None and p.consumables.main_brush_life is not None,
    ),
    XiaomiSensorDescription(
        key="side_brush_life", translation_key="side_brush_life",
        native_unit_of_measurement=PERCENTAGE, entity_category=EntityCategory.DIAGNOSTIC,
        state_class=SensorStateClass.MEASUREMENT, value_fn=lambda s: s.side_brush_life,
        supported_fn=lambda p: p.consumables is not None and p.consumables.side_brush_life is not None,
    ),
    XiaomiSensorDescription(
        key="filter_life", translation_key="filter_life",
        native_unit_of_measurement=PERCENTAGE, entity_category=EntityCategory.DIAGNOSTIC,
        state_class=SensorStateClass.MEASUREMENT, value_fn=lambda s: s.filter_life,
        supported_fn=lambda p: p.consumables is not None and p.consumables.hypa_life is not None,
    ),
    XiaomiSensorDescription(
        key="mop_life", translation_key="mop_life",
        native_unit_of_measurement=PERCENTAGE, entity_category=EntityCategory.DIAGNOSTIC,
        state_class=SensorStateClass.MEASUREMENT, value_fn=lambda s: s.mop_life,
        supported_fn=lambda p: p.consumables is not None and p.consumables.mop_life is not None,
    ),
    XiaomiSensorDescription(
        key="main_brush_hours", translation_key="main_brush_hours",
        native_unit_of_measurement=UnitOfTime.HOURS, entity_category=EntityCategory.DIAGNOSTIC,
        state_class=SensorStateClass.MEASUREMENT, value_fn=lambda s: s.main_brush_hours,
        supported_fn=lambda p: p.consumables is not None and p.consumables.main_brush_hours is not None,
    ),
    XiaomiSensorDescription(
        key="side_brush_hours", translation_key="side_brush_hours",
        native_unit_of_measurement=UnitOfTime.HOURS, entity_category=EntityCategory.DIAGNOSTIC,
        state_class=SensorStateClass.MEASUREMENT, value_fn=lambda s: s.side_brush_hours,
        supported_fn=lambda p: p.consumables is not None and p.consumables.side_brush_hours is not None,
    ),
    XiaomiSensorDescription(
        key="filter_hours", translation_key="filter_hours",
        native_unit_of_measurement=UnitOfTime.HOURS, entity_category=EntityCategory.DIAGNOSTIC,
        state_class=SensorStateClass.MEASUREMENT, value_fn=lambda s: s.filter_hours,
        supported_fn=lambda p: p.consumables is not None and p.consumables.hypa_hours is not None,
    ),
    XiaomiSensorDescription(
        key="mop_hours", translation_key="mop_hours",
        native_unit_of_measurement=UnitOfTime.HOURS, entity_category=EntityCategory.DIAGNOSTIC,
        state_class=SensorStateClass.MEASUREMENT, value_fn=lambda s: s.mop_hours,
        supported_fn=lambda p: p.consumables is not None and p.consumables.mop_hours is not None,
    ),
    XiaomiSensorDescription(
        key="door_state", translation_key="door_state",
        device_class=SensorDeviceClass.ENUM, options=_DOOR_STATE_OPTIONS,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda s: (
            _DOOR_STATE_OPTIONS[s.door_state]
            if s.door_state is not None and 0 <= s.door_state < len(_DOOR_STATE_OPTIONS)
            else None
        ),
        supported_fn=lambda p: p.consumables is not None and p.consumables.door_state is not None,
    ),
    XiaomiSensorDescription(
        key="cloth_state", translation_key="cloth_state",
        device_class=SensorDeviceClass.ENUM, options=_CLOTH_STATE_OPTIONS,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda s: (
            _CLOTH_STATE_OPTIONS[s.cloth_state]
            if s.cloth_state is not None and 0 <= s.cloth_state < len(_CLOTH_STATE_OPTIONS)
            else None
        ),
        supported_fn=lambda p: p.consumables is not None and p.consumables.cloth_state is not None,
    ),
    # Live, in-progress clean (only meaningful while cleaning/paused; resets
    # each run) vs last COMPLETED clean (a snapshot of the previous run) —
    # separate device properties, kept as separate sensors.
    XiaomiSensorDescription(
        key="clean_time", translation_key="clean_time",
        native_unit_of_measurement=UnitOfTime.MINUTES, state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda s: s.clean_time,
        supported_fn=lambda p: p.clean_history is not None and p.clean_history.live_clean_time is not None,
    ),
    XiaomiSensorDescription(
        key="clean_area", translation_key="clean_area",
        native_unit_of_measurement=UnitOfArea.SQUARE_METERS, state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda s: s.clean_area,
        supported_fn=lambda p: p.clean_history is not None and p.clean_history.live_clean_area is not None,
    ),
    XiaomiSensorDescription(
        key="last_clean_time", translation_key="last_clean_time",
        native_unit_of_measurement=UnitOfTime.SECONDS, state_class=SensorStateClass.MEASUREMENT,
        entity_category=EntityCategory.DIAGNOSTIC, value_fn=lambda s: s.last_clean_time,
        supported_fn=lambda p: p.clean_history is not None and p.clean_history.use_time is not None,
    ),
    XiaomiSensorDescription(
        key="last_clean_area", translation_key="last_clean_area",
        native_unit_of_measurement=UnitOfArea.SQUARE_METERS,
        entity_category=EntityCategory.DIAGNOSTIC, value_fn=lambda s: s.last_clean_area,
        supported_fn=lambda p: p.clean_history is not None and p.clean_history.clean_area is not None,
    ),
    XiaomiSensorDescription(
        key="last_clean_start", translation_key="last_clean_start",
        device_class=SensorDeviceClass.TIMESTAMP, entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda s: (
            datetime.fromtimestamp(s.last_clean_start, tz=timezone.utc)
            if s.last_clean_start else None
        ),
        supported_fn=lambda p: p.clean_history is not None and p.clean_history.start_time is not None,
    ),
)


def build_sensors(profile: ModelProfile) -> tuple[XiaomiSensorDescription, ...]:
    """Return only the sensor descriptions supported by *profile*.

    Each descriptor with a ``supported_fn`` is tested against the profile;
    descriptors without one are always included.
    """
    return tuple(
        d for d in _ALL_SENSORS
        if d.supported_fn is None or d.supported_fn(profile)
    )


async def async_setup_entry(
    hass: HomeAssistant, entry: XiaomiConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator = entry.runtime_data.control
    sensors = build_sensors(coordinator.device.profile)
    entities: list[SensorEntity] = [
        XiaomiVacuumSensor(coordinator, entry, d) for d in sensors
    ]
    # Selected-rooms sensor rides the MAP coordinator, not the control one:
    # the chosen-rooms state is read as part of that coordinator's own poll
    # cycle (see map_coordinator._apply_chosen_rooms), so there's no extra
    # device round-trip for this — it's data already being fetched and
    # merged, just never exposed as an entity before. Only added when a map
    # coordinator actually exists (cloud session configured); local-only
    # setups have no source for it.
    if entry.runtime_data.map is not None:
        entities.append(XiaomiSelectedRoomsSensor(entry.runtime_data.map, entry))
    async_add_entities(entities)


class XiaomiVacuumSensor(CoordinatorEntity[XiaomiVacuumCoordinator], SensorEntity):
    _attr_has_entity_name = True
    entity_description: XiaomiSensorDescription

    def __init__(self, coordinator, entry, description: XiaomiSensorDescription) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        base = entry.unique_id or entry.entry_id
        self._attr_unique_id = f"{base}_{description.key}"
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, base)})

    @property
    def native_value(self) -> int | str | datetime | None:
        return self.entity_description.value_fn(self.coordinator.data)


class XiaomiSelectedRoomsSensor(SensorEntity):
    """How many rooms are currently marked for cleaning on the device.

    State is the COUNT (a stable, always-valid number that's easy to use in
    automations and triggers); the room names and ids go in attributes,
    since names can be arbitrarily long and HA truncates state strings at
    255 characters — a long enough room list would silently corrupt the
    state value if it lived there.

    Sourced from the device itself (not from any card-side selection), so
    it reflects what's genuinely chosen on the vacuum regardless of whether
    the selection was made from this card, the Mi Home app, or persisted
    from an earlier session.
    """

    _attr_has_entity_name = True
    _attr_translation_key = "rooms_selected"
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_icon = "mdi:select-group"

    def __init__(self, map_coordinator, entry) -> None:
        self._map = map_coordinator
        base = entry.unique_id or entry.entry_id
        self._attr_unique_id = f"{base}_rooms_selected"
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, base)})

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.async_on_remove(self._map.async_add_listener(self.async_write_ha_state))

    def _rooms(self) -> list[dict]:
        data = getattr(self._map, "data", None)
        vector = getattr(data, "vector", None)
        if not isinstance(vector, dict):
            return []
        rooms = vector.get("rooms")
        return rooms if isinstance(rooms, list) else []

    @property
    def available(self) -> bool:
        return self._map.last_update_success

    @property
    def native_value(self) -> int | None:
        rooms = self._rooms()
        # Distinguish "nothing is selected" (0) from "we couldn't read the
        # selection at all" (None/unknown). _apply_chosen_rooms returns early
        # without tagging anything if the read fails, so a room list where NO
        # room carries a 'chosen' key means unknown, not empty — reporting 0
        # there would look like a real "no rooms selected" answer and could
        # drive an automation on data we never actually got.
        if not any("chosen" in r for r in rooms):
            return None
        return sum(1 for r in rooms if r.get("chosen"))

    @property
    def extra_state_attributes(self) -> dict:
        rooms = self._rooms()
        if not any("chosen" in r for r in rooms):
            return {}
        chosen = [r for r in rooms if r.get("chosen")]
        return {
            "rooms": [r.get("name") or f"Room {r.get('id')}" for r in chosen],
            "room_ids": [r.get("id") for r in chosen],
        }

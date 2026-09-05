"""Polling coordinator for a Xiaomi vacuum (local MIoT)."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from miio.exceptions import DeviceException

from .const import DEFAULT_SCAN_INTERVAL, DOMAIN
from .device import DeviceCommunicationError, IjaiVacuumDevice, VacuumStatus

_LOGGER = logging.getLogger(__name__)


class XiaomiVacuumCoordinator(DataUpdateCoordinator[VacuumStatus]):
    """Fetches status from the vacuum over local MIoT on an interval."""

    def __init__(
        self, hass: HomeAssistant, entry: ConfigEntry, device: IjaiVacuumDevice
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}:{device.model}",
            update_interval=timedelta(seconds=DEFAULT_SCAN_INTERVAL),
        )
        self.device = device
        self.entry = entry
        # Snapshot of the LIVE clean_time/clean_area counters (device.py's
        # clean_area/clean_time, siid 7 piid 22/23), captured the moment a
        # job that was running or paused ends with the vacuum back on its
        # dock (see the transition check in _async_update_data below for the
        # exact activity values this covers). Deliberately NOT sourced from
        # the device's own
        # "record" properties (last_clean_time/last_clean_area/last_clean_start,
        # siid 7 piid 27/28/29) exposed as separate sensors in sensor.py —
        # those have been seen to read back unknown/unavailable and it's
        # unconfirmed whether this hardware's firmware ever repopulates them
        # (see PROJECT_KNOWLEDGE.md). The live counters, by contrast, are
        # confirmed (direct observation) to hold the just-finished job's
        # totals right up until the NEXT job starts — so the 'returning' ->
        # 'docked' edge is the reliable moment to grab them before they get
        # overwritten. Kept as plain attributes here (not on VacuumStatus,
        # which is a stateless per-poll device snapshot rebuilt from scratch
        # every cycle in device.py) because this is state that must persist
        # ACROSS polls; the sensor entities that read these in sensor.py use
        # RestoreEntity so the values also survive an HA restart.
        self.last_completed_clean_duration: int | None = None
        self.last_completed_clean_area: int | None = None
        self.last_completed_clean_end: datetime | None = None

    async def _async_update_data(self) -> VacuumStatus:
        try:
            status = await self.hass.async_add_executor_job(self.device.status)
        except (DeviceException, DeviceCommunicationError) as err:
            raise UpdateFailed(f"Error polling vacuum: {err}") from err
        # Was never actually logging what got fetched — only HA's own generic
        # "Finished fetching... (success: True)" line existed, which says
        # nothing about the actual status/battery/fault values. Needed to
        # diagnose the paused->idle drift the person reported, and useful
        # generally for anything status-related going forward.
        _LOGGER.debug(
            "%s: status poll — activity=%s raw_status=%s battery=%s fault=%s",
            self.device.model, status.activity, status.raw_status, status.battery, status.fault,
        )

        prev_activity = self.data.activity if self.data is not None else None
        # A completed session is any transition INTO 'docked' from an
        # activity that means a job was actually running or paused:
        # 'cleaning' -> 'docked', 'paused' -> 'docked', or 'returning' ->
        # 'docked'. Originally this only fired on 'returning' -> 'docked'
        # (the literal case asked for), but that misses two real scenarios:
        #   1. The vacuum is paused, then sent straight to the dock. It's
        #      unconfirmed whether this hardware's firmware always surfaces
        #      an intermediate 'returning' state for that specific path
        #      (untested — no debug log captured for it) — 'paused' is
        #      included so the snapshot still fires even if it's skipped.
        #   2. Our own polling is only every ~10s (DEFAULT_SCAN_INTERVAL),
        #      so a genuinely real 'returning' state can simply fall between
        #      two polls on a vacuum that's already close to its dock —
        #      'cleaning' is included so that case isn't silently missed
        #      just because we polled at the wrong moment.
        # 'idle' -> 'docked' and 'error' -> 'docked' are deliberately NOT
        # included: nothing was actually running in either case.
        if prev_activity in ("cleaning", "paused", "returning") and status.activity == "docked":
            # Job just ended (or was sent home) and the vacuum is back on
            # the dock. Guard on both counters actually being present this
            # poll — the consumables/clean-history batch is best-effort
            # (device.py logs a warning and reports None on failure rather
            # than raising) — so a transient read failure on exactly this
            # cycle must not stomp a good previous snapshot with None.
            if status.clean_time is not None and status.clean_area is not None:
                self.last_completed_clean_duration = status.clean_time
                self.last_completed_clean_area = status.clean_area
                self.last_completed_clean_end = dt_util.utcnow()
                _LOGGER.debug(
                    "%s: clean finished — duration=%s min, area=%s m2",
                    self.device.model, status.clean_time, status.clean_area,
                )
            else:
                _LOGGER.warning(
                    "%s: activity went %s -> docked but clean_time/"
                    "clean_area were unavailable this poll; last-completed-"
                    "clean snapshot NOT updated (keeping previous value)",
                    self.device.model, prev_activity,
                )

        return status

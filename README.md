<div align="center">

# Xiaomi Vacuum S20 Integration and Card for Home Assistant    m1xminus  <a href="https://www.buymeacoffee.com/m1xminus" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" style="height: 30px !important;width: 117px !important;" ></a>

**Live maps, room cleaning, local control, enhanced sensors, and custom presets tailored specifically for the Xiaomi Robot Vacuum S20 (`xiaomi.vacuum.d106gl`).**

> [!NOTE]
> This repository is a specialized fork of [letitbe-dull/xiaomi-vac](https://github.com/letitbe-dull/xiaomi-vac) focused on optimizing performance, expanded sensor data, and preset capabilities for the **Xiaomi S20 (`d106gl`)**.

</div>

---

## Why this fork?

While the upstream integration provides broad multi-model support, this fork is specifically enhanced for the **Xiaomi Vacuum S20 (`xiaomi.vacuum.d106gl`)**. It expands consumable monitoring, exposes extended vacuum statistics, and introduces an improved dashboard card featuring interactive preset action buttons for automation scripts.

### Key Enhancements

* **Presets support:** Launch standard or custom cleaning routines directly from the card using Home Assistant scripts.
* **Expanded consumable tracking:** Dedicated sensors for main brush, side brush, filter, and mop cloth replacement cycles.
* **Live statistics:** Sensors for total cleaned area and active cleaning duration.
* **Optimized live map rendering:** Cloud-assisted vector map parsing with live position, path trace, and segment highlighting tailored for the S20 platform.
  
### Supported and Tested Vacuums 
* **Xiaomi S20** - Full support
* **Xiaomi S10** - Full support (Tested by @cpmarexel2f)

---

## Installation

### Option A: HACS (recommended)

This repository isn't in the default HACS store, so it needs to be added as a custom repository first.

1. Open **HACS** in your Home Assistant sidebar.
2. Click the **⋮** (three-dot menu) in the top-right corner and choose **Custom repositories**.
3. Paste in the repository URL:
   ```
   https://github.com/m1xminus/xiaomi-vac-S20
   ```
4. Set the category to **Integration**, then click **Add**.
5. Find **Xiaomi Vacuum** in the HACS list, open it, and click **Download**.
6. **Restart Home Assistant** (Settings → System → Restart).
7. Go to **Settings → Devices & Services → Add Integration**, search for **Xiaomi Vacuum**, and follow the setup wizard.

The Lovelace card (`xiaomi-vac-card`) is registered automatically on startup — you don't need to add it as a separate dashboard resource.

### Option B: Manual installation

1. Download this repository (**Code → Download ZIP**, or `git clone`).
2. Copy the **`custom_components/xiaomi_vac`** folder into your Home Assistant config directory, so you end up with:
   ```
   config/custom_components/xiaomi_vac/
   ```
   Copy only the `xiaomi_vac` folder itself — not the whole repo, and not the repo root's other files (`tests/`, `README.md`, etc. don't belong in `custom_components/`).
3. **Restart Home Assistant.**
4. Go to **Settings → Devices & Services → Add Integration**, search for **Xiaomi Vacuum**, and follow the setup wizard.

---

## Improved Lovelace Card

The integration includes an upgraded version of `xiaomi-vac-card` with full support for quick action preset buttons, allowing you to trigger complex scripts with a single tap.

<div align="center">
  <video src="https://github.com/user-attachments/assets/8b8f7174-44c6-4a26-a447-fc6f58ad008a" controls width="450"></video>
</div>

## More Sensors

<div align="center">
  <img src="https://github.com/user-attachments/assets/bb72dd03-7964-46fe-b664-cc3f26a17ac9" alt="Sensors Overview" width="400" />
  <br><br>
  <img src="https://github.com/user-attachments/assets/7beffb7d-cdc1-49a9-a853-5003c68f8f39" alt="Detailed Sensors View" width="400" />
</div>

## 📱 Live Cleaning Notifications (Android)

Get a live, updating Android notification while the vacuum cleans — current
status, selected rooms, area covered, and battery — plus a finished summary
with total duration and area cleaned once it's back on the dock.
<div align="center">
  <img width="300" height="120" alt="Livenotification3" src="https://github.com/user-attachments/assets/54965e23-d464-43cd-b694-2117493b0ac9" />
  <img width="300" height="120" alt="Livenotification2" src="https://github.com/user-attachments/assets/d53e7fb4-5f04-473a-a2c1-502457282b0c" />
  <img width="300" height="120" alt="Livenotification" src="https://github.com/user-attachments/assets/698ad1ac-7316-4c81-8869-312a81842fac" />
</div>

<div align="center">
  <!-- add screenshots / GIF here -->
</div>

### Requirements

- Home Assistant Companion App on Android (this uses `chronometer` and
  `progress` notification fields that are Android-only — this exact style of
  live notification isn't available on iOS)
- Integration version **1.2.8 or newer** — the finished summary reads the
  `last_completed_clean_duration` / `last_completed_clean_area` sensors
  added in that release
- The `rooms_selected` sensor (added automatically once a map coordinator is
  configured)

### Example automation

Replace `vacuum.your_vacuum_entity_id` and the sensor entity IDs below with
your own, and list your own `notify.mobile_app_*` targets under `phones`.
`expected_minutes` only drives the progress-bar percentage — set it to
roughly how long an average clean takes for you.

```yaml
alias: Vacuum - Live cleaning notification (Android)
description: ''
triggers:
  - trigger: state
    entity_id: vacuum.your_vacuum_entity_id
    to: cleaning
actions:
  - variables:
      start_ts: '{{ as_timestamp(now()) | int }}'
  - repeat:
      for_each: '{{ phones }}'
      sequence:
        - action: '{{ repeat.item }}'
          data:
            title: 🧹 Cleaning started
            message: Updating room details…
            data:
              tag: vacuum_clean_live
              sticky: true
              notification_icon: mdi:robot-vacuum
              chronometer: true
              when: '{{ start_ts }}'
              progress: 0
              progress_max: 100
  - repeat:
      while:
        - condition: template
          value_template: >-
            {{ states('vacuum.your_vacuum_entity_id') in ['cleaning', 'returning',
            'paused'] }}
        - condition: template
          value_template: '{{ repeat.index < 240 }}'
      sequence:
        - repeat:
            for_each: '{{ phones }}'
            sequence:
              - action: '{{ repeat.item }}'
                data:
                  title: >-
                    {% set s = states('vacuum.your_vacuum_entity_id') %} {{ '🧹
                    Cleaning' if s == 'cleaning'
                       else '⏸️ Paused' if s == 'paused'
                       else '🔙 Returning to dock' }}
                  message: >-
                    {% set r = state_attr('sensor.your_vacuum_rooms_selected',
                    'rooms') %}
                    Rooms: {{ r | join(', ') if r and r | length > 0 else 'Whole
                    house' }}
                    Area: {{ states('sensor.your_vacuum_clean_area') }} m²  ·
                    Battery: {{ states('sensor.your_vacuum_battery') }}%
                  data:
                    tag: vacuum_clean_live
                    alert_once: true
                    sticky: true
                    notification_icon: mdi:robot-vacuum
                    chronometer: true
                    when: '{{ start_ts }}'
                    progress_max: 100
                    progress: |-
                      {{ [ ((states('sensor.your_vacuum_clean_time') | int(0))
                           / expected_minutes * 100) | round(0) | int, 100 ] | min }}
        - delay:
            seconds: 30
  - choose:
      - conditions:
          - condition: state
            entity_id: vacuum.your_vacuum_entity_id
            state: docked
        sequence:
          - repeat:
              for_each: '{{ phones }}'
              sequence:
                - action: '{{ repeat.item }}'
                  data:
                    title: ✅ Cleaning finished
                    message: >-
                      {% set r =
                      state_attr('sensor.your_vacuum_rooms_selected', 'rooms')
                      %}
                      {% set dur =
                      states('sensor.your_vacuum_last_completed_clean_duration') %}
                      {% set area =
                      states('sensor.your_vacuum_last_completed_clean_area') %}
                      Rooms: {{ r | join(', ') if r and r | length > 0 else
                      'Whole house' }}
                      Duration: {{ dur ~ ' min' if dur not in
                      ['unknown','unavailable','none'] else '—' }}
                      Area cleaned: {{ area ~ ' m²' if area not in
                      ['unknown','unavailable','none'] else '—' }}
                    data:
                      tag: vacuum_clean_live
                      sticky: false
                      notification_icon: mdi:check-circle
                      progress: -1
    default:
      - repeat:
          for_each: '{{ phones }}'
          sequence:
            - action: '{{ repeat.item }}'
              data:
                title: ⚠️ Cleaning stopped
                message: >-
                  Stopped before docking — state is {{
                  states('vacuum.your_vacuum_entity_id') }}
                data:
                  tag: vacuum_clean_live
                  sticky: false
                  notification_icon: mdi:alert
                  progress: -1
mode: restart
variables:
  phones:
    - notify.mobile_app_your_phone_1
    - notify.mobile_app_your_phone_2
  expected_minutes: 60
```

## Standard Dashboard Configuration

Add this configuration to your Lovelace dashboard (replace entity names with your device's actual entity IDs):

```yaml
type: custom:xiaomi-vac-card
vacuum: vacuum.your_vacuum_entity_id
map: camera.your_vacuum_map_entity_id
activeMap: select.your_vacuum_active_map_entity_id
fan: select.your_vacuum_fan_speed_entity_id
water: select.your_vacuum_water_level_entity_id
mode: select.your_vacuum_cleaning_mode_entity_id
show_vacuum_page: false
show_map: true
show_controls: true
show_fan: true
show_water: true
show_mode: true
show_room_labels: true
allow_room_cleaning: true
show_active_map: true
presets:
  - name: Clean Entire House
    script: script.clean_entire_house
  - name: Vacuum & Mop Allowed Rooms
    script: script.vacuum_and_mop_living_kitchen
```
## Custom Scripts - Used as Presets

# Building Custom Clean Scripts

This guide shows how to build Home Assistant scripts that clean specific rooms with specific settings — for example "vacuum and mop the kitchen and hallway on strong suction", triggered from a dashboard button, a voice assistant, or an automation.

No external tools needed. Everything here uses services provided by this integration.

---

## Before you start: find your room IDs

Every room on your vacuum's map has a numeric ID. These are assigned by the vacuum, not by you, and they're what the scripts refer to.

**The easiest way to find them:**

1. Go to **Developer Tools → States**
2. Find your map camera entity (something like `camera.your_vacuum_map`)
3. Look at its `rooms` attribute

You'll see a list like:

```yaml
rooms:
  - id: 10
    name: Living Room
  - id: 11
    name: Kitchen
  - id: 12
    name: Hallway
```

Write down the IDs for the rooms you care about. They stay stable unless you re-map your home or split/merge rooms in the Xiaomi app.

> **Note:** These are *map* room IDs, which are not the same as the room names you may have assigned in the Mi Home app's own room list. Always use the IDs from the camera attribute above.

---

## The basic pattern

Every custom clean script follows the same two steps:

1. **`apply_room_preferences`** — tell the vacuum *which* rooms to clean and *how* to clean each one
2. **`clean_segment`** — tell it to start

These are separate because the vacuum stores the "how" as per-room settings first, then acts on them. A short delay between the two lets the settings commit before cleaning starts.

### Minimal example

```yaml
alias: Clean Kitchen
mode: single
sequence:
  - action: xiaomi_vac.apply_room_preferences
    target:
      entity_id: vacuum.your_vacuum
    data:
      active_rooms:
        - room_id: 11
          clean_mode: 1
          wind_power: 2
          water_level: 2
  - delay:
      milliseconds: 1000
  - action: xiaomi_vac.clean_segment
    target:
      entity_id: vacuum.your_vacuum
    data:
      segments: [11]
```

This cleans room 11 (the kitchen) in sweep + mop mode, strong suction, water level 2.

---

## What each part means

### `entity_id`

Your vacuum entity — find it under **Settings → Devices & Services → Xiaomi Vacuum**. It looks like `vacuum.something`. It's the same in both steps.

### `active_rooms`

The list of rooms to clean, each with its own settings. This is the important one to understand:

- **Rooms you list here are marked active** for the next clean.
- **Rooms you *don't* list are marked inactive** — they get skipped.
- **Their saved settings are not erased**, just deactivated. Your other scripts still work exactly as configured.

This means you never need to "clear" a previous selection. Listing the rooms you want is enough.

### `room_id`

The numeric room ID from the camera attribute. Use plain numbers, not quoted strings — `room_id: 11`, not `room_id: '11'`.

### `delay`

One second between applying settings and starting. This isn't cosmetic — the vacuum needs a moment to commit the settings before the clean command lands. Without it, the clean can start using the *previous* settings.

### `segments`

The list of room IDs to actually clean. **This should match the rooms you listed in `active_rooms`.**

```yaml
segments: [10, 11, 12]
```

> **Important:** Never pass an empty list. On this hardware, an empty room list is interpreted as "clean everything" rather than "clean nothing" — the integration will refuse an empty list rather than let that happen silently, but it's worth knowing why.

---

## Settings reference

All settings are optional. **Any setting you leave out keeps whatever that room already had saved** — it does not reset to a default.

### `clean_mode`

| Value | Meaning |
|-------|---------|
| `0` | Sweep (vacuum only) |
| `1` | Sweep + Mop (at the same time) |
| `2` | Mop only |
| `3` | Sweep, then Mop (two passes) |

### `wind_power` (suction)

| Value | Meaning |
|-------|---------|
| `0` | Silent |
| `1` | Basic |
| `2` | Strong |
| `3` | Full Speed |

### `water_level`

| Value | Meaning |
|-------|---------|
| `0` | Off / none |
| `1` | Low |
| `2` | Medium |
| `3` | High |

Only relevant in modes that use water (`1`, `2`, `3`).

### `twice_clean`

| Value | Meaning |
|-------|---------|
| `0` | Single pass |
| `1` | Clean each room twice |

### `carpet`

| Value | Meaning |
|-------|---------|
| `0` | Not set |
| `1` | Auto carpet boost |
| `2` | Off |

---

## Full example: multiple rooms

```yaml
alias: Custom Clean - Vacuum & Mop (Living, Kitchen, Hall, WC)
description: ''
mode: single
sequence:
  - action: xiaomi_vac.apply_room_preferences
    target:
      entity_id: vacuum.your_vacuum
    data:
      active_rooms:
        - room_id: 10
          clean_mode: 1
          wind_power: 2
          water_level: 2
        - room_id: 14
          clean_mode: 1
          wind_power: 2
          water_level: 2
        - room_id: 15
          clean_mode: 1
          wind_power: 2
          water_level: 2
        - room_id: 16
          clean_mode: 1
          wind_power: 2
          water_level: 2
  - delay:
      milliseconds: 1000
  - action: xiaomi_vac.clean_segment
    target:
      entity_id: vacuum.your_vacuum
    data:
      segments: [10, 14, 15, 16]
```

### Different settings per room

Each room is independent — you can mix and match freely:

```yaml
active_rooms:
  # Kitchen: mop heavily
  - room_id: 11
    clean_mode: 1
    wind_power: 2
    water_level: 3
  # Bedroom: quiet, no water (carpet)
  - room_id: 12
    clean_mode: 0
    wind_power: 0
    water_level: 0
```

---

## 🐛 Reporting Issues

> [!IMPORTANT]
> **Please include debug logs with every issue.** This integration talks to your vacuum over both local and cloud connections, and "it doesn't work" without logs is almost impossible to diagnose. Issues opened without logs will likely just get a request to add them, which slows everything down — save everyone the round-trip and include them up front.

### How to enable debug logging

**Easiest way (no config file editing):**

1. Go to **Settings → Devices & Services**.
2. Find **Xiaomi Vacuum** and click into it.
3. Click the **⋮** (three-dot menu) → **Enable debug logging**.
4. Reproduce the problem (trigger the button, service call, or automation that's misbehaving).
5. Go back to the same **⋮** menu → **Disable debug logging** — this automatically downloads a `.log` file with everything captured while it was on.

**Alternative (YAML method):** add this to your `configuration.yaml`, then restart Home Assistant:

```yaml
logger:
  default: warning
  logs:
    custom_components.xiaomi_vac: debug
```

Reproduce the issue, then grab the log from **Settings → System → Logs**, or directly from `config/home-assistant.log`.

### ⚠️ Before you paste logs into a public issue — remove personal data first

Debug logs from this integration can include information tied to your Xiaomi account and device. **Search your log and redact (replace with `[REDACTED]`) any of the following before posting:**

- `mac=...` — your vacuum's MAC address
- `wifi_sn=...` — your vacuum's WiFi serial number
- `user_id=...` — your Xiaomi account's numeric user ID
- `device_id=...` / `did=...` — your vacuum's device ID
- `ssecurity=...`, `service_token=...`, `pass_token=...` — cloud session credentials
- Your local network details — router/device IP addresses (e.g. `192.168.x.x`), if they appear
- Your Xiaomi account email/username, if it appears anywhere in the log

A quick way to check: search the log for your email address and any of the field names above before pasting it in. If in doubt, leave it out — a maintainer can always ask for a specific missing detail rather than you having to un-post a leaked token.

### What to include in your issue

Please copy this template into your issue and fill it in:

```markdown
**Vacuum model:** (e.g. xiaomi.vacuum.d106gl / Xiaomi S20)
**Home Assistant version:**
**Integration version:** (see custom_components/xiaomi_vac/manifest.json, or the HACS entry)

**What happened:**


**What you expected to happen:**


**Steps to reproduce:**
1.
2.
3.

**Debug log (redacted — see above):**
```
paste your redacted log here
```
```

Issues with a clear description, reproduction steps, and a redacted debug log get resolved far faster than "it's broken" — thanks for taking the time to include them.

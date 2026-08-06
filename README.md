<div align="center">

# Xiaomi Vacuum S20 Integration and Card for Home Assistant   m1xminus  <a href="https://www.buymeacoffee.com/m1xminus" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" style="height: 30px !important;width: 117px !important;" ></a>

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


### Standard Dashboard Configuration

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

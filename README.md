<div align="center">

# Xiaomi Vacuum S20 Integration and Card for Home Assistant | m1xminus  <a href="https://www.buymeacoffee.com/m1xminus" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" style="height: 30px !important;width: 117px !important;" ></a>

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

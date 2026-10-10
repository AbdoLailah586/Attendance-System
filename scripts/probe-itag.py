"""Read-only BLE compatibility probe for one explicitly selected tag.

Install Bleak in a dedicated environment, then pass --address. This probe never
pairs, unpairs, writes an alarm/reset command, or records nearby devices. It
disconnects its own GATT connection before returning.
"""

import argparse
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import time

from bleak import BleakClient, BleakScanner


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def emit(event, **fields):
    print(json.dumps({"event": event, **fields}, ensure_ascii=False), flush=True)


async def scan_target(address, seconds):
    packets = []
    target_device = None
    started = time.monotonic()

    def received(device, data):
        nonlocal target_device
        if device.address.upper() != address:
            return
        target_device = device
        packets.append({
            "elapsed_seconds": round(time.monotonic() - started, 3),
            "received_at": utc_now(),
            "name": data.local_name or device.name,
            "rssi_dbm": data.rssi,
            "service_uuids": data.service_uuids,
            "manufacturer_data": {str(key): value.hex() for key, value in data.manufacturer_data.items()},
            "service_data": {key: value.hex() for key, value in data.service_data.items()},
        })

    async with BleakScanner(detection_callback=received):
        await asyncio.sleep(seconds)
    return target_device, {"duration_seconds": seconds, "packet_count": len(packets), "packets": packets}


async def probe(args):
    address = args.address.upper()
    result = {"started_at": utc_now(), "target_address": address, "read_only": True,
              "pairing_requested": False, "characteristic_writes": 0}
    emit("scan_before_start", duration_seconds=args.scan_seconds)
    device, result["scan_before"] = await scan_target(address, args.scan_seconds)
    emit("scan_before_complete", packet_count=result["scan_before"]["packet_count"])
    connection = {"connected": False, "services": [], "connection_samples": [], "errors": []}
    disconnected = asyncio.Event()

    def on_disconnect(client):
        disconnected.set()

    client = BleakClient(device or address, disconnected_callback=on_disconnect, pair=False,
                         timeout=args.connect_timeout, winrt={"use_cached_services": False})
    try:
        emit("connect_start")
        await asyncio.wait_for(client.connect(), timeout=args.connect_timeout + 5)
        connection["connected"] = client.is_connected
        connection["connected_at"] = utc_now()
        connection["mtu_size"] = client.mtu_size
        emit("connect_complete", connected=client.is_connected)
        for service in client.services:
            entry = {"uuid": service.uuid, "description": service.description, "characteristics": []}
            for characteristic in service.characteristics:
                char = {"uuid": characteristic.uuid, "description": characteristic.description,
                        "properties": characteristic.properties}
                # Reading explicitly readable attributes is safe; no notification
                # subscription (which writes CCCD), alert, or reset command is used.
                if "read" in characteristic.properties:
                    try:
                        value = await asyncio.wait_for(client.read_gatt_char(characteristic), timeout=5)
                        char["read_hex"] = value.hex()
                        if characteristic.uuid.lower() == "00002a19-0000-1000-8000-00805f9b34fb" and len(value) == 1:
                            char["battery_percent"] = int(value[0])
                    except Exception as error:
                        char["read_error"] = str(error)
                entry["characteristics"].append(char)
            connection["services"].append(entry)
        emit("services_complete", service_count=len(connection["services"]))
        started = time.monotonic()
        while time.monotonic() - started < args.hold_seconds:
            connection["connection_samples"].append({"elapsed_seconds": round(time.monotonic() - started, 3),
                                                      "connected": client.is_connected})
            if not client.is_connected:
                break
            try:
                await asyncio.wait_for(disconnected.wait(), timeout=2)
            except asyncio.TimeoutError:
                pass
        connection["held_seconds"] = round(time.monotonic() - started, 3)
        connection["connected_at_hold_end"] = client.is_connected
    except Exception as error:
        connection["errors"].append(str(error))
        emit("connection_error", message=str(error))
    finally:
        if client.is_connected:
            await asyncio.wait_for(client.disconnect(), timeout=10)
        connection["probe_disconnected"] = not client.is_connected
        result["connection"] = connection
        emit("probe_disconnected", disconnected=connection["probe_disconnected"])

    emit("scan_after_start", duration_seconds=args.scan_seconds)
    _, result["scan_after"] = await scan_target(address, args.scan_seconds)
    emit("scan_after_complete", packet_count=result["scan_after"]["packet_count"])
    result["finished_at"] = utc_now()
    result["interpretation"] = {
        "live_advertisement_observed": result["scan_before"]["packet_count"] > 0,
        "advertisement_after_disconnect_observed": result["scan_after"]["packet_count"] > 0,
        "gatt_connection_success": connection["connected"],
        "gps_coordinates_observed": False,
        "gps_note": "The probe only reads exposed GATT data; absence of coordinates here is not proof that the hardware has no GPS receiver.",
        "sleep_or_range_behavior_tested": False,
        "caution": "Nearby stationary tests do not establish out-of-range return, unattended lifetime, or presence of the employee.",
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    emit("saved", output=str(output), interpretation=result["interpretation"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--address", required=True, help="Bluetooth address of the user's selected tag only")
    parser.add_argument("--scan-seconds", type=float, default=15)
    parser.add_argument("--hold-seconds", type=float, default=20)
    parser.add_argument("--connect-timeout", type=float, default=15)
    parser.add_argument("--output", default="artifacts/itag-ble-probe.json")
    args = parser.parse_args()
    if not 1 <= args.scan_seconds <= 60 or not 1 <= args.hold_seconds <= 60 or not 1 <= args.connect_timeout <= 30:
        parser.error("Bounded durations required: scan/hold 1-60 seconds, connection timeout 1-30 seconds")
    asyncio.run(probe(args))


if __name__ == "__main__":
    main()

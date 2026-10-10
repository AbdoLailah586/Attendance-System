"""Temporary, explicit BLE range test on one USB-connected reader.

Uses firmware 1.4's test target without changing employee attendance or pairing.
The target expires in at most 30 minutes and is not retained after restart.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys
import time
import serial

spec = importlib.util.spec_from_file_location("reader_usb", Path(__file__).with_name("reader-usb.py"))
reader_usb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader_usb)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True)
    parser.add_argument("--expected-device", required=True)
    parser.add_argument("--address")
    parser.add_argument("--clear", action="store_true")
    parser.add_argument("--grace-seconds", type=int, default=90)
    parser.add_argument("--duration-seconds", type=int, default=900)
    args = parser.parse_args()
    if not args.clear and not args.address:
        parser.error("--address is required unless --clear is selected")
    port = serial.Serial()
    port.port, port.baudrate = args.port, 115200
    port.timeout, port.write_timeout = 0.25, 3
    port.dtr = port.rts = False
    port.open()
    try:
        time.sleep(2)
        port.reset_input_buffer()
        status = reader_usb.reply(port, "--status", "status")
        if status.get("device_id") != args.expected_device:
            raise RuntimeError("Wrong branch reader. No settings changed.")
        if not status.get("ble_enabled"):
            raise RuntimeError("Install BLE reader firmware 1.4.0 or newer first.")
        command = {"command": "ble_test_config", "device_id": args.expected_device,
                   "enabled": not args.clear, "address": (args.address or "").upper(),
                   "grace_seconds": args.grace_seconds, "duration_seconds": args.duration_seconds}
        result = reader_usb.reply(port, json.dumps(command, separators=(",", ":")), "ble_test_config")
        if not result.get("ok"):
            raise RuntimeError("Reader rejected test target: " + str(result.get("error", "unknown")))
        print(json.dumps(result))
        time.sleep(3)
        print(json.dumps(reader_usb.reply(port, "--status", "status")))
    finally:
        port.close()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (serial.SerialException, RuntimeError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

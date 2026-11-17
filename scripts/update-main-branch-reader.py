"""Install the prepared main-branch update from this laptop's private folder."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import runpy
import site
import sys
import time
from uuid import UUID

import serial
from serial.tools import list_ports

VERSION = "1.4.6"
APP_OFFSET = 0x10000
APP_SIZE = 0x300000
PARTITION_OFFSET = 0x8000
PARTITION_SIZE = 0xC00


def load_package(folder):
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    image = folder / "firmware.bin"
    contents = image.read_bytes()
    if manifest["version"] != VERSION or not 0 < len(contents) <= APP_SIZE or contents[0] != 0xE9:
        raise RuntimeError("The prepared firmware is not a valid 1.4.6 application image.")
    if hashlib.sha256(contents).hexdigest() != manifest["image_sha256"]:
        raise RuntimeError("The prepared firmware file is damaged or has been replaced.")
    device_id = str(UUID(manifest["device_id"]))
    mac = bytes.fromhex(manifest["mac"].replace(":", ""))
    table_digest = bytes.fromhex(manifest["partition_sha256"])
    if len(mac) != 6 or len(table_digest) != 32 or device_id.encode() + b"\0" not in contents:
        raise RuntimeError("The package identity or partition signature is invalid.")
    return image, device_id, mac, table_digest


def find_port():
    ports = [port.device for port in list_ports.comports() if port.vid is not None]
    if not ports:
        raise RuntimeError("No USB serial reader found. Connect the main branch ESP32 with a USB data cable and reopen this file.")
    if len(ports) != 1:
        raise RuntimeError("More than one USB serial device found. Leave only the main branch reader connected and reopen this file.")
    return ports[0]


def install(esptool, port, image, expected_mac, table_digest):
    # Keep the same serial connection from identity check through the write.
    with esptool.ESP32ROM(port) as esp:
        esp.connect(attempts=3)
        try:
            if bytes(esp.read_mac()) != expected_mac:
                raise RuntimeError("This ESP32 is not the original main branch reader. No flash was written.")
            stub = esp.run_stub()
            partitions = stub.read_flash(PARTITION_OFFSET, PARTITION_SIZE)
            if hashlib.sha256(partitions).digest() != table_digest:
                raise RuntimeError("The partition layout differs from the original reader. No flash was written.")
            print("Main branch reader confirmed. Uploading firmware 1.4.6. Keep USB connected.")
            stub.sync_stub_detected = True  # esptool.main reuses the running RAM stub.
            esptool.main([
                "--chip", "esp32", "--port", port, "--baud", "460800",
                "--before", "no_reset", "--after", "no_reset_stub",
                "write_flash", hex(APP_OFFSET), str(image),
            ], esp=stub)
        finally:
            esp.hard_reset()


def verify_boot(port_name, expected_device):
    reply = runpy.run_path(str(Path(__file__).with_name("reader-usb.py")))["reply"]
    deadline = time.monotonic() + 25
    time.sleep(2)
    while time.monotonic() < deadline:
        try:
            with serial.Serial(baudrate=115200, timeout=0.25, write_timeout=2) as port:
                port.port = port_name
                port.dtr = False
                port.rts = False
                port.open()
                status = reply(port, "--status", "status", timeout=4)
        except (serial.SerialException, RuntimeError):
            time.sleep(1)
            continue
        if status.get("device_id") != expected_device or status.get("firmware") != VERSION:
            raise RuntimeError("The reader booted with an unexpected firmware version or identity.")
        return status
    raise RuntimeError("Flash write verified, but the reader did not report its version over USB after reboot.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-package", action="store_true", help="Check the prepared files without opening USB")
    args = parser.parse_args()
    package = Path(os.environ["LOCALAPPDATA"]) / "JoeStore" / "Attendance" / "MainReaderUpdate-1.4.6"
    try:
        image, device_id, mac, table_digest = load_package(package)
    except (OSError, KeyError, ValueError) as error:
        raise RuntimeError("The private update package is missing or invalid on this laptop.") from error

    esp_root = Path(os.environ.get("PLATFORMIO_CORE_DIR", Path.home() / ".platformio")) / "packages" / "tool-esptoolpy"
    if not (esp_root / "esptool.py").is_file():
        raise RuntimeError("The local PlatformIO ESP32 flash tool is missing.")
    sys.path.insert(0, str(esp_root))
    site.addsitedir(str(esp_root / "_contrib"))
    try:
        import esptool
    except ImportError as error:
        raise RuntimeError("The local PlatformIO ESP32 flash tool is incomplete.") from error

    if args.check_package:
        print("Firmware 1.4.6 package and flash tool verified.")
        return
    port = find_port()
    print(f"Checking the original main branch reader on {port}...")
    install(esptool, port, image, mac, table_digest)
    status = verify_boot(port, device_id)
    print("SUCCESS: The main branch reader booted firmware 1.4.6.")
    print(f"Local storage: {'ready' if status.get('storage_ready') else 'needs checking'}; queued card reads: {status.get('queued_events', 'unknown')}.")
    if not status.get("wifi_connected"):
        print("Wi-Fi is not connected yet. Check Ping from the dashboard once the reader is back on the branch network.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, serial.SerialException) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)

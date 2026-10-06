"""Private Wi-Fi input travels over stdin and USB; never print credentials."""
import argparse
import json
import sys
import time
import serial


def reply(port, command, expected, timeout=8):
    port.write((command + "\n").encode("utf-8"))
    port.flush()
    deadline = time.monotonic() + timeout
    retry_at = time.monotonic() + 1.5
    while time.monotonic() < deadline:
        # Status is read-only and safe to retry if concurrent upload logs obscure
        # a reply. Never resend a configuration/format command automatically.
        if expected == "status" and time.monotonic() >= retry_at:
            port.write((command + "\n").encode("utf-8"))
            port.flush()
            retry_at = time.monotonic() + 1.5
        line = port.readline()
        if not line.startswith(b"{"):
            continue
        try:
            value = json.loads(line)
        except (ValueError, UnicodeDecodeError):
            continue
        if value.get("command") == expected:
            return value
    raise RuntimeError("No USB reply. Close Serial Monitor and install firmware 1.2.0 or newer first.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True)
    parser.add_argument("--expected-device")
    parser.add_argument("--apply-wifi", action="store_true")
    parser.add_argument("--initialize-new-storage", action="store_true")
    parser.add_argument("--test-feedback", action="store_true")
    args = parser.parse_args()
    settings = json.load(sys.stdin) if args.apply_wifi else None
    port = serial.Serial()
    port.port = args.port
    port.baudrate = 115200
    port.timeout = 0.25
    port.write_timeout = 3
    port.dtr = False
    port.rts = False
    port.open()
    try:
        time.sleep(2)
        port.reset_input_buffer()
        status = reply(port, "--status", "status")
        if args.expected_device and status.get("device_id") != args.expected_device:
            raise RuntimeError("Wrong branch reader connected. No settings changed.")
        if args.test_feedback:
            if not status.get("feedback_enabled"):
                raise RuntimeError("Install firmware 1.3.0 with sound/light feedback enabled first.")
            result = reply(port, "--feedback-test", "feedback_test")
            if not result.get("ok"):
                raise RuntimeError("Sound/light feedback is disabled on this reader.")
            time.sleep(4)
            status = reply(port, "--status", "status")
        if args.initialize_new_storage:
            if status.get("storage_ready"):
                raise RuntimeError("Storage already mounted; refusing to format it.")
            port.write(b"--format\n")
            port.flush()
            time.sleep(2)
            status = reply(port, "--status", "status")
            if not status.get("storage_ready"):
                raise RuntimeError("New storage initialization failed.")
        if settings is not None:
            request = {
                "command": "wifi_config",
                "device_id": status["device_id"],
                "ssid": settings["ssid"],
                "password": settings["password"],
            }
            result = reply(port, json.dumps(request, ensure_ascii=False, separators=(",", ":")), "wifi_config")
            if not result.get("ok"):
                raise RuntimeError("Reader rejected settings: " + str(result.get("error", "unknown")))
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                time.sleep(1)
                status = reply(port, "--status", "status")
                if status.get("wifi_connected") and status.get("clock_ready"):
                    break
        # Firmware status deliberately excludes passwords, SSIDs and API tokens.
        print(json.dumps(status, ensure_ascii=True))
        if settings is not None and not status.get("wifi_connected"):
            print("Settings saved, but Wi-Fi is not connected. Check the password and 2.4 GHz signal.", file=sys.stderr)
            return 2
        return 0
    finally:
        port.close()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (serial.SerialException, RuntimeError, ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

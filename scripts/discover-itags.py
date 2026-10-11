"""Discover advertising iTag devices only; never pair, connect or write to them."""
import argparse
import asyncio
import json
from bleak import BleakScanner

async def discover(seconds):
    tags = {}
    def receive(device, advertisement):
        name = advertisement.local_name or device.name or ''
        if not any(label in name.casefold() for label in ('itag', 'iteq', 'it eq', 'i tag')):
            return
        tags[device.address.upper()] = {'address': device.address.upper(), 'name': name, 'rssi_dbm': advertisement.rssi}
    async with BleakScanner(detection_callback=receive):
        await asyncio.sleep(seconds)
    print(json.dumps({'read_only': True, 'seconds': seconds, 'tags': list(tags.values())}, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seconds', type=int, default=15, choices=range(1, 31))
    asyncio.run(discover(parser.parse_args().seconds))

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { bleAddress, ensureBleSchema, readerFor } from '@/lib/ble';

// Firmware-reported sightings of ANY nearby BLE address (not just already-assigned tags),
// collected only while an admin-started discovery session is active for this reader.
export async function POST(req: NextRequest) {
  try {
    const credential = req.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!credential) return NextResponse.json({ error: 'Device credential required' }, { status: 401 });
    const body = await req.json().catch(() => null);
    if (!body || typeof body.device_id !== 'string' || !Array.isArray(body.sightings) || body.sightings.length > 50)
      return NextResponse.json({ error: 'Invalid reader or sighting batch (0-50)' }, { status: 400 });
    for (const sighting of body.sightings) {
      if (!sighting || !bleAddress(sighting.address) || (sighting.rssi !== undefined && sighting.rssi !== null && (!Number.isInteger(sighting.rssi) || sighting.rssi < -127 || sighting.rssi > 20)))
        return NextResponse.json({ error: 'Invalid sighting address or RSSI' }, { status: 400 });
    }
    await ensureBleSchema();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('attendance-ble-write'))");
      const reader = await readerFor(client, body.device_id, credential);
      if (!reader) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'Device disabled or credential invalid' }, { status: 401 }); }
      const session = (await client.query('SELECT until FROM ble_discovery_sessions WHERE device_id=$1', [reader.id])).rows[0];
      const active = !!session && +new Date(session.until) > Date.now();
      if (active) for (const sighting of body.sightings) {
        await client.query(`INSERT INTO ble_discovery_sightings(device_id,address,rssi,last_seen_at) VALUES($1,$2,$3,NOW())
          ON CONFLICT(device_id,address) DO UPDATE SET rssi=$3,last_seen_at=NOW()`, [reader.id, bleAddress(sighting.address), sighting.rssi ?? null]);
      }
      await client.query('COMMIT');
      return NextResponse.json({ success: true, active, until: active ? session.until : null }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  } catch (error) { console.error('BLE discovery upload', error); return NextResponse.json({ error: 'Keep sightings and retry later' }, { status: 503 }); }
}

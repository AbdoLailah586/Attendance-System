import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { uuid } from '@/lib/nfc';
import { BLE_DEFAULT_GRACE, BLE_STALE_SECONDS, activeCardSession, bleAddress, bleTime, ensureBleSchema, readerFor } from '@/lib/ble';

export async function POST(req: NextRequest) {
  try {
    const credential = req.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!credential) return NextResponse.json({ error: 'Device credential required' }, { status: 401 });
    const body = await req.json().catch(() => null);
    if (!body || !uuid(body.device_id) || !uuid(body.boot_id) || !['ready', 'fault'].includes(body.receiver_state) || !Array.isArray(body.events) || body.events.length > 100)
      return NextResponse.json({ error: 'Invalid reader, boot, receiver state or batch (0–100 events)' }, { status: 400 });
    const heartbeatAt = body.heartbeat_at === undefined ? new Date() : bleTime(body.heartbeat_at);
    if (!heartbeatAt) return NextResponse.json({ error: 'Invalid heartbeat UTC timestamp' }, { status: 400 });
    for (const event of body.events) {
      if (!event || !uuid(event.event_id) || !bleAddress(event.tag_address) || !['seen', 'not_seen'].includes(event.state) || !bleTime(event.recorded_at)
        || (event.boot_id !== undefined && !uuid(event.boot_id))
        || (event.rssi !== undefined && event.rssi !== null && (!Number.isInteger(event.rssi) || event.rssi < -127 || event.rssi > 20)))
        return NextResponse.json({ error: 'Invalid BLE event, timestamp, address or RSSI' }, { status: 400 });
    }
    await ensureBleSchema();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('attendance-ble-write'))");
      const reader = await readerFor(client, body.device_id, credential, true);
      if (!reader) { await client.query('ROLLBACK'); return NextResponse.json({ error: 'Device disabled or credential invalid' }, { status: 401 }); }
      const previous = (await client.query('SELECT * FROM ble_receiver_heartbeats WHERE device_id=$1 AND recorded_at<=$2 ORDER BY recorded_at DESC,id DESC LIMIT 1', [reader.id, heartbeatAt])).rows[0];
      const continuous = body.receiver_state === 'ready' && previous?.state === 'ready' && previous.boot_id === body.boot_id
        && +heartbeatAt - +new Date(previous.recorded_at) < BLE_STALE_SECONDS * 1000
        && Date.now() - +new Date(previous.received_at) < BLE_STALE_SECONDS * 1000;
      const healthStartedAt = continuous ? previous.health_started_at : heartbeatAt;
      await client.query('INSERT INTO ble_receiver_heartbeats(device_id,boot_id,state,recorded_at,health_started_at) VALUES($1,$2,$3,$4,$5)',
        [reader.id, body.boot_id, body.receiver_state, heartbeatAt, healthStartedAt]);
      const acknowledged = [];
      for (const event of body.events) {
        const old = (await client.query('SELECT status FROM ble_events WHERE device_id=$1 AND event_id=$2', [reader.id, event.event_id])).rows[0];
        if (old) { acknowledged.push({ event_id: event.event_id, status: old.status, duplicate: true }); continue; }
        const address = bleAddress(event.tag_address), time = bleTime(event.recorded_at);
        const tag = (await client.query(`SELECT id,user_id,grace_seconds FROM ble_tags WHERE address=$1 AND assigned_at<=$2
          AND (revoked_at IS NULL OR revoked_at>$2) ORDER BY assigned_at DESC LIMIT 1`, [address, time])).rows[0];
        const session = tag ? await activeCardSession(client, tag.user_id, time!) : null;
        const status = tag ? (session ? 'accepted' : 'outside_session') : 'unknown_tag';
        await client.query(`INSERT INTO ble_events(device_id,event_id,boot_id,tag_address,tag_assignment_id,user_id,branch_id,state,recorded_at,rssi,grace_seconds,status)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [reader.id, event.event_id, event.boot_id || body.boot_id, address, tag?.id || null, session ? tag.user_id : null, reader.branch_id, event.state, time, event.rssi ?? null, tag?.grace_seconds || BLE_DEFAULT_GRACE, status]);
        acknowledged.push({ event_id: event.event_id, status, duplicate: false });
      }
      await client.query('UPDATE nfc_devices SET last_seen_at=NOW() WHERE id=$1', [reader.id]);
      await client.query('COMMIT');
      return NextResponse.json({ success: true, acknowledged, server_time: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  } catch (error) { console.error('BLE upload', error); return NextResponse.json({ error: 'Keep observations and retry later' }, { status: 503 }); }
}

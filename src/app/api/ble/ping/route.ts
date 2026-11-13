import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/auth';
import { BLE_STALE_SECONDS, ensureBleSchema, receiverState, type BleHeartbeat } from '@/lib/ble';
import { BLE_PING_SECONDS, type AdminReaderStatus, type BleReaderPing } from '@/lib/ble-types';
import { query } from '@/lib/db';
import { uuid } from '@/lib/nfc';
import { readerPingFields } from '@/lib/reader-ping';

const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(req: NextRequest) {
  try {
    if ((await getActiveSession(req))?.role !== 'admin') {
      return NextResponse.json({ error: 'صلاحيات المدير مطلوبة' }, { status: 403, headers });
    }
    await ensureBleSchema();
    const { rows } = await query<{
      id: string; name: string; branch_name: string; active: boolean; checked_at: Date;
      last_seen_at: Date | null; last_scan_at: Date | null; heartbeat: BleHeartbeat | null; ping: BleReaderPing | null;
    }>(`
      SELECT d.id,d.name,b.name AS branch_name,d.is_active AND b.is_active AS active,
        NOW() AS checked_at,d.last_seen_at,s.received_at AS last_scan_at,to_jsonb(h) AS heartbeat,to_jsonb(p) AS ping
      FROM nfc_devices d JOIN branches b ON b.id=d.branch_id
      LEFT JOIN LATERAL (SELECT * FROM ble_receiver_heartbeats WHERE device_id=d.id AND recorded_at<=NOW()
        ORDER BY recorded_at DESC,id DESC LIMIT 1) h ON true
      LEFT JOIN LATERAL (SELECT received_at FROM nfc_scans WHERE device_id=d.id
        ORDER BY received_at DESC,id DESC LIMIT 1) s ON true
      LEFT JOIN LATERAL (SELECT ${readerPingFields} FROM ble_reader_pings WHERE device_id=d.id) p ON true
      ORDER BY d.created_at`);
    const readers: AdminReaderStatus[] = rows.map(row => ({
      id: row.id, name: row.name, branch_name: row.branch_name,
      connection: !row.active ? 'disabled' : !row.last_seen_at ? 'never_seen' :
        +row.checked_at - +row.last_seen_at < BLE_STALE_SECONDS * 1000 ? 'connected' : 'stale',
      last_seen_at: row.last_seen_at?.toISOString() ?? null,
      last_scan_at: row.last_scan_at?.toISOString() ?? null,
      receiver_state: row.active ? receiverState(row.heartbeat ?? undefined, +row.checked_at) : 'disabled',
      last_heartbeat_at: row.heartbeat ? new Date(row.heartbeat.received_at).toISOString() : null,
      ping: row.active ? row.ping : null,
    }));
    return NextResponse.json({ readers }, { headers });
  } catch (error) {
    console.error('Read reader status', error);
    return NextResponse.json({ error: 'تعذر تحديث حالة القارئات' }, { status: 503, headers });
  }
}

export async function POST(req: NextRequest) {
  try {
    if ((await getActiveSession(req))?.role !== 'admin') {
      return NextResponse.json({ error: 'صلاحيات المدير مطلوبة' }, { status: 403, headers });
    }
    const body = await req.json().catch(() => null);
    if (!uuid(body?.device_id)) {
      return NextResponse.json({ error: 'اختار قارئ صالح' }, { status: 400, headers });
    }
    await ensureBleSchema();
    const { rows: [created] } = await query<BleReaderPing>(`
      INSERT INTO ble_reader_pings(device_id, ping_id, started_at, expires_at)
      SELECT d.id, $2, statement_timestamp(), statement_timestamp() + $3::int * INTERVAL '1 second'
      FROM nfc_devices d JOIN branches b ON b.id=d.branch_id
      WHERE d.id=$1 AND d.is_active AND b.is_active
      ON CONFLICT (device_id) DO UPDATE
      SET ping_id=EXCLUDED.ping_id, started_at=EXCLUDED.started_at, expires_at=EXCLUDED.expires_at, pong_at=NULL, diagnostics=NULL
      WHERE ble_reader_pings.pong_at IS NOT NULL OR ble_reader_pings.expires_at <= clock_timestamp()
      RETURNING ${readerPingFields}`, [body.device_id, randomUUID(), BLE_PING_SECONDS]);
    if (created) return NextResponse.json(created, { headers });

    // If a test is already waiting for the same reader, share its result.
    const { rows: [current] } = await query<BleReaderPing>(`
      SELECT ${readerPingFields} FROM ble_reader_pings
      WHERE device_id=$1 AND EXISTS (
        SELECT 1 FROM nfc_devices d JOIN branches b ON b.id=d.branch_id
        WHERE d.id=$1 AND d.is_active AND b.is_active
      )`, [body.device_id]);
    if (!current) return NextResponse.json({ error: 'القارئ مش موجود أو معطّل' }, { status: 404, headers });
    return NextResponse.json(current, { headers });
  } catch (error) {
    console.error('Start reader ping', error);
    return NextResponse.json({ error: 'تعذر بدء الاختبار' }, { status: 503, headers });
  }
}

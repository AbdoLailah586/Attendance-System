import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { uuid } from '@/lib/nfc';
import { BLE_DEFAULT_GRACE, BLE_HEARTBEAT_SECONDS, BLE_STALE_SECONDS, activeCardSession, ensureBleSchema, readerFor } from '@/lib/ble';

export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get('device_id');
    const credential = req.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!credential) return NextResponse.json({ error: 'Device credential required' }, { status: 401 });
    if (!uuid(deviceId)) return NextResponse.json({ error: 'Invalid device ID' }, { status: 400 });
    await ensureBleSchema();
    const client = await getPool().connect();
    try {
      if (!(await readerFor(client, deviceId!, credential))) return NextResponse.json({ error: 'Device disabled or credential invalid' }, { status: 401 });
      const rows = (await client.query(`SELECT address,grace_seconds,user_id FROM ble_tags t
        JOIN users u ON u.id=t.user_id AND u.is_active=TRUE AND u.role='employee'
        WHERE revoked_at IS NULL ORDER BY t.id`)).rows;
      const tags = [];
      for (const tag of rows) {
        const session = await activeCardSession(client, tag.user_id, new Date());
        tags.push({ address: tag.address, grace_seconds: tag.grace_seconds, enabled: !!session, tracking_active: !!session,
          tracking_until: session ? new Date(session.finish).toISOString() : null });
      }
      return NextResponse.json({ protocol: 'attendance-ble-v1', mode: 'experimental', heartbeat_seconds: BLE_HEARTBEAT_SECONDS,
        receiver_stale_seconds: BLE_STALE_SECONDS, default_grace_seconds: BLE_DEFAULT_GRACE, tags,
        capacity_exceeded: tags.filter(t => t.enabled).length > 3, server_time: new Date().toISOString() },
      { headers: { 'Cache-Control': 'private, no-store' } });
    } finally { client.release(); }
  } catch (error) { console.error('BLE config', error); return NextResponse.json({ error: 'Configuration temporarily unavailable' }, { status: 503 }); }
}

import type { PoolClient } from 'pg';
import { query } from './db';
import { ensureAttendanceSchema } from './schema';
import { tokenHash } from './nfc';

export const BLE_HEARTBEAT_SECONDS = 30;
export const BLE_STALE_SECONDS = 90;
export const BLE_DEFAULT_GRACE = 90;
export const bleAddress = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/[:-]/g, '').toUpperCase();
  return /^[0-9A-F]{12}$/.test(compact) ? compact.match(/.{2}/g)!.join(':') : null;
};
export const bleTime = (value: unknown): Date | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(+date) && +date <= Date.now() + 120000 && +date >= Date.now() - 90 * 86400000 ? date : null;
};

let migration: Promise<unknown> | undefined;
export async function ensureBleSchema() {
  await ensureAttendanceSchema();
  if (!migration) migration = query(`
    SELECT pg_advisory_xact_lock(hashtext('attendance-ble-schema'));
    CREATE TABLE IF NOT EXISTS ble_tags (
      id SERIAL PRIMARY KEY, address VARCHAR(17) NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id), assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ, assigned_by INTEGER REFERENCES users(id), revoked_by INTEGER REFERENCES users(id),
      grace_seconds INTEGER NOT NULL DEFAULT 90 CHECK(grace_seconds BETWEEN 60 AND 600)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ble_tag_active ON ble_tags(address) WHERE revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS ble_tag_history ON ble_tags(address,assigned_at);
    CREATE TABLE IF NOT EXISTS ble_events (
      id BIGSERIAL PRIMARY KEY, device_id UUID NOT NULL REFERENCES nfc_devices(id) ON DELETE CASCADE,
      event_id UUID NOT NULL, boot_id UUID NOT NULL, tag_address VARCHAR(17) NOT NULL,
      tag_assignment_id INTEGER REFERENCES ble_tags(id) ON DELETE SET NULL, user_id INTEGER REFERENCES users(id),
      branch_id VARCHAR(50) NOT NULL, state VARCHAR(12) NOT NULL CHECK(state IN ('seen','not_seen')),
      recorded_at TIMESTAMPTZ NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      rssi INTEGER CHECK(rssi BETWEEN -127 AND 20), grace_seconds INTEGER NOT NULL,
      status VARCHAR(20) NOT NULL CHECK(status IN ('accepted','unknown_tag','outside_session')), UNIQUE(device_id,event_id)
    );
    CREATE INDEX IF NOT EXISTS ble_events_time ON ble_events(recorded_at DESC);
    CREATE INDEX IF NOT EXISTS ble_events_address ON ble_events(device_id,tag_address,recorded_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS ble_receiver_heartbeats (
      id BIGSERIAL PRIMARY KEY, device_id UUID NOT NULL REFERENCES nfc_devices(id) ON DELETE CASCADE,
      boot_id UUID NOT NULL, state VARCHAR(8) NOT NULL CHECK(state IN ('ready','fault')),
      recorded_at TIMESTAMPTZ NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), health_started_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ble_heartbeats_device_time ON ble_receiver_heartbeats(device_id,recorded_at DESC,id DESC);
  `).catch(error => { migration = undefined; throw error; });
  return migration;
}

export async function readerFor(client: PoolClient, id: string, credential: string, lock = false) {
  return (await client.query(`SELECT d.id,d.name,d.branch_id FROM nfc_devices d
    JOIN branches b ON b.id=d.branch_id AND b.is_active=TRUE
    WHERE d.id=$1 AND d.token_hash=$2 AND d.is_active=TRUE ${lock ? 'FOR UPDATE OF d' : ''}`,
  [id, tokenHash(credential)])).rows[0];
}

export async function activeCardSession(client: PoolClient, userId: number, at: Date) {
  const row = (await client.query(`SELECT i.timestamp AS start,LEAST(COALESCE(o.timestamp,'infinity'::timestamptz),
    COALESCE(i.tracking_deadline,i.timestamp+(COALESCE(u.max_tracking_hours,s.max_tracking_hours,12)::int*INTERVAL '1 hour')),
    COALESCE((SELECT MIN(n.timestamp) FROM attendance_logs n WHERE n.user_id=i.user_id AND n.source='nfc' AND n.event_type='clock_in' AND n.timestamp>i.timestamp),'infinity'::timestamptz)) AS finish
    FROM attendance_logs i JOIN users u ON u.id=i.user_id CROSS JOIN settings s
    LEFT JOIN attendance_logs o ON o.user_id=i.user_id AND o.shift_day=i.shift_day AND o.source='nfc' AND o.event_type='clock_out'
    WHERE s.id='main' AND i.user_id=$1 AND i.source='nfc' AND i.event_type='clock_in' AND i.timestamp<=$2 ORDER BY i.timestamp DESC LIMIT 1`, [userId, at])).rows[0];
  return row && +at >= +new Date(row.start) && +at < +new Date(row.finish) ? row : null;
}

export interface BleHeartbeat {
  device_id: string; boot_id: string; state: 'ready' | 'fault'; recorded_at: string | Date; received_at: string | Date; health_started_at: string | Date;
}
export interface BleEvent {
  id?: string; device_id: string; boot_id: string; tag_address: string; tag_assignment_id: number | null;
  user_id: number | null; state: 'seen' | 'not_seen'; recorded_at: string | Date; received_at: string | Date;
  grace_seconds: number; rssi: number | null;
}
export interface BleTag {
  id: number; address: string; user_id: number; assigned_at: string | Date; revoked_at: string | Date | null;
  grace_seconds: number; name?: string; username?: string;
}
export type BleObservationState = 'seen' | 'not_seen' | 'unknown';
export function latestAt<T extends { recorded_at: string | Date }>(rows: T[], at: number): T | undefined {
  let lo = 0, hi = rows.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (+new Date(rows[mid].recorded_at) <= at) lo = mid + 1; else hi = mid; }
  return rows[lo - 1];
}
export function observationAt(event: BleEvent | undefined, heartbeat: BleHeartbeat | undefined, tag: BleTag, at: number): BleObservationState {
  if (!heartbeat || heartbeat.state !== 'ready' || at - +new Date(heartbeat.recorded_at) >= BLE_STALE_SECONDS * 1000) return 'unknown';
  if (+new Date(heartbeat.received_at) - +new Date(heartbeat.recorded_at) > BLE_STALE_SECONDS * 1000) return 'unknown';
  if (!event || event.boot_id !== heartbeat.boot_id || event.tag_assignment_id !== tag.id) return 'unknown';
  if (+new Date(event.recorded_at) < +new Date(heartbeat.health_started_at)) return 'unknown';
  if (+new Date(tag.assigned_at) > at || (tag.revoked_at && +new Date(tag.revoked_at) <= at)) return 'unknown';
  if (event.state === 'not_seen') return 'not_seen';
  return at - +new Date(event.recorded_at) < event.grace_seconds * 1000 ? 'seen' : 'unknown';
}

export function receiverState(heartbeat: BleHeartbeat | undefined, now = Date.now()) {
  if (!heartbeat || +new Date(heartbeat.recorded_at) > now || now - +new Date(heartbeat.recorded_at) >= BLE_STALE_SECONDS * 1000 || now - +new Date(heartbeat.received_at) >= BLE_STALE_SECONDS * 1000) return 'stale';
  return heartbeat.state;
}

// Integrate only explicit observations within the official card window. Gaps in receiver
// health and every reboot break continuity; a missing signal never becomes physical absence.
export function observationReport(tags: BleTag[], events: BleEvent[], heartbeats: BleHeartbeat[], windows: { start: number; end: number }[], deviceId: string, userId: number, from: number, to: number) {
  const ownTags = tags.filter(t => t.user_id === userId);
  const addresses = new Set(ownTags.map(t => t.address));
  const deviceEvents = events.filter(e => e.device_id === deviceId && addresses.has(e.tag_address));
  const deviceHeartbeats = heartbeats.filter(h => h.device_id === deviceId);
  const byAddress = new Map<string, BleEvent[]>();
  for (const event of deviceEvents) { const list = byAddress.get(event.tag_address) || []; list.push(event); byAddress.set(event.tag_address, list); }
  let seen = 0, notSeen = 0, unknown = 0, session = 0;
  for (const window of windows) {
    const start = Math.max(from, window.start), end = Math.min(to, window.end);
    if (start >= end) continue;
    const points = new Set([start, end]);
    const point = (time: number) => { if (time > start && time < end) points.add(time); };
    for (const tag of ownTags) { point(+new Date(tag.assigned_at)); if (tag.revoked_at) point(+new Date(tag.revoked_at)); }
    for (const h of deviceHeartbeats) { point(+new Date(h.recorded_at)); point(+new Date(h.recorded_at) + BLE_STALE_SECONDS * 1000); }
    for (const e of deviceEvents) { point(+new Date(e.recorded_at)); if (e.state === 'seen') point(+new Date(e.recorded_at) + e.grace_seconds * 1000); }
    const ordered = [...points].sort((a, b) => a - b);
    for (let i = 0; i < ordered.length - 1; i++) {
      const at = ordered[i], elapsed = ordered[i + 1] - at;
      const active = ownTags.filter(t => +new Date(t.assigned_at) <= at && (!t.revoked_at || +new Date(t.revoked_at) > at));
      const heartbeat = latestAt(deviceHeartbeats, at);
      const states = active.map(tag => observationAt(latestAt(byAddress.get(tag.address) || [], at), heartbeat, tag, at));
      session += elapsed;
      if (states.includes('seen')) seen += elapsed;
      else if (states.length && states.every(s => s === 'not_seen')) notSeen += elapsed;
      else unknown += elapsed;
    }
  }
  return { observed_seconds: seen / 1000, not_seen_seconds: notSeen / 1000, unknown_seconds: unknown / 1000, session_seconds: session / 1000 };
}

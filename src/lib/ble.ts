import type { PoolClient } from 'pg';
import { query } from './db';
import { ensureAttendanceSchema } from './schema';
import { tokenHash } from './nfc';
import { businessDay } from './card-day';
import { addDays } from './period-report';
import { cairoTime, validDay } from './time';
import type { AppUser } from './types';
import type { StoreSettings } from './geo';
import type { BleObservationState, BleRangeDaySummary, BleRangeSummary, BleSummary, BleUserPresence } from './ble-types';
export type { BleObservationState } from './ble-types';

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
export function latestAt<T extends { recorded_at: string | Date }>(rows: T[], at: number): T | undefined {
  let lo = 0, hi = rows.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (+new Date(rows[mid].recorded_at) <= at) lo = mid + 1; else hi = mid; }
  return rows[lo - 1];
}

export interface BleReceiverDefinition {
  id: string; name: string; branch_id: string; branch_name: string; is_active: boolean; configured_at: string | Date | null;
}
export interface BleCardWindow {
  user_id: number; shift_day: string | null; start: string | Date; finish: string | Date; departure: string | Date | null;
}

export function combineObservationStates(states: BleObservationState[]): BleObservationState {
  if (states.includes('seen')) return 'seen';
  return states.length > 0 && states.every(state => state === 'not_seen') ? 'not_seen' : 'unknown';
}

export function combinedObservationReport(tags: BleTag[], events: BleEvent[], heartbeats: BleHeartbeat[],
  windows: { start: number; end: number }[], receivers: BleReceiverDefinition[], userId: number, from: number, to: number): BleSummary {
  const ownTags = tags.filter(t => t.user_id === userId), addresses = new Set(ownTags.map(t => t.address));
  const eligibleReceivers = receivers.filter(r => r.is_active && r.configured_at !== null);
  const ids = new Set(eligibleReceivers.map(r => r.id));
  const ownEvents = events.filter(e => ids.has(e.device_id) && addresses.has(e.tag_address));
  const relevantHeartbeats = heartbeats.filter(h => ids.has(h.device_id));
  const eventsByKey = new Map<string, BleEvent[]>(), heartbeatsByDevice = new Map<string, BleHeartbeat[]>();
  for (const event of ownEvents) { const key = `${event.device_id}/${event.tag_address}`, list = eventsByKey.get(key) || []; list.push(event); eventsByKey.set(key, list); }
  for (const heartbeat of relevantHeartbeats) { const list = heartbeatsByDevice.get(heartbeat.device_id) || []; list.push(heartbeat); heartbeatsByDevice.set(heartbeat.device_id, list); }
  const totals = { seen: 0, not_seen: 0, unknown: 0 };
  let session = 0;
  // Normalize overlapping card windows before integration; no branch or session can
  // multiply elapsed time. Window boundaries still come exclusively from NFC.
  const merged: { start: number; end: number }[] = [];
  for (const window of [...windows].sort((a, b) => a.start - b.start)) {
    const start = Math.max(from, window.start), end = Math.min(to, window.end);
    if (start >= end) continue;
    const previous = merged.at(-1);
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else merged.push({ start, end });
  }
  for (const window of merged) {
    const points = new Set([window.start, window.end]);
    const point = (time: number) => { if (time > window.start && time < window.end) points.add(time); };
    for (const tag of ownTags) { point(+new Date(tag.assigned_at)); if (tag.revoked_at) point(+new Date(tag.revoked_at)); }
    for (const receiver of eligibleReceivers) point(+new Date(receiver.configured_at!));
    for (const heartbeat of relevantHeartbeats) { point(+new Date(heartbeat.recorded_at)); point(+new Date(heartbeat.recorded_at) + BLE_STALE_SECONDS * 1000); }
    for (const event of ownEvents) { point(+new Date(event.recorded_at)); if (event.state === 'seen') point(+new Date(event.recorded_at) + event.grace_seconds * 1000); }
    const ordered = [...points].sort((a, b) => a - b);
    for (let i = 0; i < ordered.length - 1; i++) {
      const at = ordered[i], elapsed = ordered[i + 1] - at;
      const activeTags = ownTags.filter(t => +new Date(t.assigned_at) <= at && (!t.revoked_at || +new Date(t.revoked_at) > at));
      const states = eligibleReceivers.filter(r => +new Date(r.configured_at!) <= at).map(receiver => {
        const heartbeat = latestAt(heartbeatsByDevice.get(receiver.id) || [], at);
        return combineObservationStates(activeTags.map(tag => observationAt(latestAt(eventsByKey.get(`${receiver.id}/${tag.address}`) || [], at), heartbeat, tag, at)));
      });
      totals[combineObservationStates(states)] += elapsed; session += elapsed;
    }
  }
  return { observed_seconds: totals.seen / 1000, not_seen_seconds: totals.not_seen / 1000, unknown_seconds: totals.unknown / 1000, session_seconds: session / 1000 };
}

interface BleDataset {
  tags: BleTag[]; receivers: BleReceiverDefinition[]; events: BleEvent[]; heartbeats: BleHeartbeat[]; windows: BleCardWindow[];
  latestEvents: BleEvent[]; latestHeartbeats: BleHeartbeat[]; truncated: boolean;
}

async function loadBleDataset(userIds: number[], from: number, to: number, now: number): Promise<BleDataset> {
  const [tags, receivers, windows] = await Promise.all([
    query<BleTag>('SELECT * FROM ble_tags WHERE user_id=ANY($1::int[]) ORDER BY assigned_at,id', [userIds]),
    query<BleReceiverDefinition>(`SELECT d.id,d.name,d.branch_id,b.name AS branch_name,(d.is_active AND b.is_active) AS is_active,
      (SELECT MIN(h.recorded_at) FROM ble_receiver_heartbeats h WHERE h.device_id=d.id AND h.recorded_at<=NOW()) AS configured_at
      FROM nfc_devices d JOIN branches b ON b.id=d.branch_id ORDER BY d.created_at`),
    query<BleCardWindow>(`SELECT i.user_id,to_char(i.shift_day,'YYYY-MM-DD') AS shift_day,i.timestamp AS start,o.timestamp AS departure,LEAST(COALESCE(o.timestamp,'infinity'::timestamptz),
      COALESCE(i.tracking_deadline,i.timestamp+(COALESCE(u.max_tracking_hours,s.max_tracking_hours,12)::int*INTERVAL '1 hour')),
      COALESCE((SELECT MIN(n.timestamp) FROM attendance_logs n WHERE n.user_id=i.user_id AND n.source='nfc' AND n.event_type='clock_in' AND n.timestamp>i.timestamp),'infinity'::timestamptz)) AS finish
      FROM attendance_logs i JOIN users u ON u.id=i.user_id CROSS JOIN settings s
      LEFT JOIN attendance_logs o ON o.user_id=i.user_id AND o.shift_day=i.shift_day AND o.source='nfc' AND o.event_type='clock_out'
      WHERE s.id='main' AND i.user_id=ANY($1::int[]) AND i.source='nfc' AND i.event_type='clock_in' AND i.timestamp>=$2 AND i.timestamp<=$3 ORDER BY i.timestamp`,
    [userIds, new Date(from - 36 * 3600000), new Date(Math.min(to, now))]),
  ]);
  const assignmentIds = tags.rows.map(tag => tag.id);
  const [events, heartbeats, latestEvents, latestHeartbeats] = await Promise.all([
    query<BleEvent>(`WITH prior AS (SELECT DISTINCT ON(device_id,tag_address) * FROM ble_events WHERE tag_assignment_id=ANY($1::int[]) AND recorded_at<$2
        ORDER BY device_id,tag_address,recorded_at DESC,id DESC), recent AS (SELECT * FROM ble_events WHERE tag_assignment_id=ANY($1::int[])
        AND recorded_at>=$2 AND recorded_at<$3 ORDER BY recorded_at,id LIMIT 200001)
      SELECT * FROM prior UNION ALL SELECT * FROM recent ORDER BY recorded_at,id LIMIT 200001`, [assignmentIds, new Date(from - 600000), new Date(to)]),
    query<BleHeartbeat>('SELECT * FROM ble_receiver_heartbeats WHERE recorded_at>=$1 AND recorded_at<$2 ORDER BY recorded_at,id LIMIT 200001', [new Date(from - 600000), new Date(to)]),
    query<BleEvent>(`SELECT DISTINCT ON(device_id,tag_address) * FROM ble_events WHERE tag_assignment_id=ANY($1::int[]) AND recorded_at<=NOW()
      ORDER BY device_id,tag_address,recorded_at DESC,id DESC`, [assignmentIds]),
    query<BleHeartbeat>('SELECT DISTINCT ON(device_id) * FROM ble_receiver_heartbeats WHERE recorded_at<=NOW() ORDER BY device_id,recorded_at DESC,id DESC'),
  ]);
  return { tags: tags.rows, receivers: receivers.rows, windows: windows.rows, events: events.rows, heartbeats: heartbeats.rows,
    latestEvents: latestEvents.rows, latestHeartbeats: latestHeartbeats.rows, truncated: events.rows.length > 200000 || heartbeats.rows.length > 200000 };
}

export async function loadBlePresence(users: Pick<AppUser, 'id' | 'name' | 'username' | 'is_active' | 'role'>[], settings: StoreSettings, now = new Date()): Promise<Map<number, BleUserPresence>> {
  await ensureBleSchema();
  if (!users.length) return new Map();
  const boundary = settings.business_day_start_time || '10:00';
  const day = businessDay(now, boundary), from = +cairoTime(day, boundary), end = +cairoTime(addDays(day, 1), boundary);
  const dataset = await loadBleDataset(users.map(u => u.id), from, Math.min(end, +now), +now);
  const result = new Map<number, BleUserPresence>();
  for (const user of users) {
    const ownTags = dataset.tags.filter(tag => tag.user_id === user.id), activeTags = ownTags.filter(tag => !tag.revoked_at);
    const ownWindows = dataset.windows.filter(window => window.user_id === user.id);
    const windows = ownWindows.map(window => ({ start: +new Date(window.start), end: +new Date(window.finish) }));
    const current = ownWindows.findLast(window => +new Date(window.start) <= +now && +new Date(window.finish) > +now);
    const latest = current || ownWindows.at(-1);
    const active = !!current && user.is_active !== false && user.role === 'employee';
    const receivers = dataset.receivers.map(receiver => {
      const heartbeat = dataset.latestHeartbeats.find(h => h.device_id === receiver.id);
      const health = receiver.is_active ? receiverState(heartbeat, +now) : 'disabled';
      const state = health === 'ready' ? combineObservationStates(activeTags.map(tag => {
        const event = dataset.latestEvents.find(e => e.device_id === receiver.id && e.tag_address === tag.address);
        return observationAt(event, heartbeat, tag, +now);
      })) : 'unknown';
      return { id: receiver.id, name: receiver.name, branch_id: receiver.branch_id, branch_name: receiver.branch_name,
        configured: !!receiver.configured_at, receiver_state: health, state, last_heartbeat: heartbeat ? new Date(heartbeat.recorded_at).toISOString() : null } as BleUserPresence['receivers'][number];
    });
    const tags = activeTags.map(tag => ({ id: tag.id, address: tag.address, grace_seconds: tag.grace_seconds,
      observations: receivers.map(receiver => {
        const event = dataset.latestEvents.find(e => e.device_id === receiver.id && e.tag_address === tag.address);
        const heartbeat = dataset.latestHeartbeats.find(h => h.device_id === receiver.id);
        return { device_id: receiver.id, branch_id: receiver.branch_id, branch_name: receiver.branch_name, in_card_session: active,
          state: receiver.receiver_state === 'ready' ? observationAt(event, heartbeat, tag, +now) : 'unknown',
          last_observation: event ? new Date(event.recorded_at).toISOString() : null, rssi: event?.rssi ?? null };
      }) }));
    const configuredReceivers = receivers.filter(receiver => receiver.configured && receiver.receiver_state !== 'disabled');
    const state = active ? combineObservationStates(configuredReceivers.map(receiver => receiver.state)) : 'off_shift';
    const observedBranches = [...new Map(configuredReceivers.filter(receiver => active && receiver.state === 'seen')
      .map(receiver => [receiver.branch_id, { id: receiver.branch_id, name: receiver.branch_name }])).values()];
    const ownIds = new Set(ownTags.map(tag => tag.id));
    const captured = dataset.latestEvents.filter(event => ownIds.has(event.tag_assignment_id!) && event.user_id === user.id
      && windows.some(window => +new Date(event.recorded_at) >= window.start && +new Date(event.recorded_at) < window.end))
      .sort((a, b) => +new Date(b.recorded_at) - +new Date(a.recorded_at))[0];
    const reportEvents = dataset.truncated ? [] : dataset.events, reportHeartbeats = dataset.truncated ? [] : dataset.heartbeats;
    const summary = combinedObservationReport(ownTags, reportEvents, reportHeartbeats, windows, dataset.receivers, user.id, from, Math.min(end, +now));
    const branches = [...new Map(dataset.receivers.map(receiver => [receiver.branch_id, receiver])).values()].map(receiver => ({
      id: receiver.branch_id, name: receiver.branch_name,
      ...combinedObservationReport(ownTags, reportEvents, reportHeartbeats, windows, dataset.receivers.filter(r => r.branch_id === receiver.branch_id), user.id, from, Math.min(end, +now)),
    }));
    result.set(user.id, { user: { id: user.id, name: user.name, username: user.username }, tracking_mode: activeTags.length ? 'ble' : 'gps',
      server_time: now.toISOString(), business_day: { day, start: new Date(from).toISOString(), end: new Date(end).toISOString(), boundary },
      session: { active, from: latest ? new Date(latest.start).toISOString() : null, until: latest ? new Date(latest.finish).toISOString() : null,
        firstArrival: latest ? new Date(latest.start).toISOString() : null, lastDeparture: latest?.departure ? new Date(latest.departure).toISOString() : null,
        state: active ? 'active' : latest ? (latest.departure ? 'closed' : 'expired') : 'waiting',
        missing_checkout: !!latest && !latest.departure && +new Date(latest.finish) <= +now },
      tags, receivers, state, branch_id: observedBranches.length === 1 ? observedBranches[0].id : null,
      branch_name: observedBranches.length === 1 ? observedBranches[0].name : observedBranches.length > 1 ? 'مرصود لدى أكثر من فرع' : null,
      observed_branches: observedBranches, captured_at: captured ? new Date(captured.recorded_at).toISOString() : null,
      summary, branches, experimental: true, truncated: dataset.truncated });
  }
  return result;
}

// Report callers supply their own interval (daily/weekly/payroll cycle) as UTC
// instants. No calendar or payroll assumption is made here.
export async function loadBleRangeSummaries(userIds: number[], from: number, to: number, shiftDays?: string[]): Promise<Map<number, BleRangeSummary>> {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || userIds.some(id => !Number.isInteger(id) || id < 1))
    throw new RangeError('Invalid BLE report interval or employee IDs');
  if (shiftDays && (!Array.isArray(shiftDays) || shiftDays.some(day => !validDay(day)))) throw new RangeError('Invalid BLE shift-day selector');
  await ensureBleSchema();
  const ids = [...new Set(userIds)], result = new Map<number, BleRangeSummary>();
  if (!ids.length) return result;
  const now = Date.now(), end = Math.min(to, now);
  const empty = (): BleSummary => ({ observed_seconds: 0, not_seen_seconds: 0, unknown_seconds: 0, session_seconds: 0 });
  if (end <= from) {
    for (const id of ids) result.set(id, { summary: empty(), branches: [], truncated: false, has_ble_history: false,
      ...(shiftDays ? { daily: Object.fromEntries(shiftDays.map(day => [day, { summary: empty(), branches: [], truncated: false, has_ble_history: false }])) } : {}) });
    return result;
  }
  const dataset = await loadBleDataset(ids, from, end, now);
  const events = dataset.truncated ? [] : dataset.events, heartbeats = dataset.truncated ? [] : dataset.heartbeats;
  const branches = [...new Map(dataset.receivers.map(receiver => [receiver.branch_id, receiver])).values()];
  for (const id of ids) {
    const tags = dataset.tags.filter(tag => tag.user_id === id);
    const selected = dataset.windows.filter(window => window.user_id === id && (!shiftDays || (window.shift_day && shiftDays.includes(window.shift_day))));
    const summarize = (rows: BleCardWindow[], historyFrom = from, historyEnd = end): BleRangeDaySummary => {
      const windows = rows.map(window => ({ start: +new Date(window.start), end: +new Date(window.finish) }));
      return { summary: combinedObservationReport(tags, events, heartbeats, windows, dataset.receivers, id, from, end),
        branches: branches.map(branch => ({ id: branch.branch_id, name: branch.branch_name,
          ...combinedObservationReport(tags, events, heartbeats, windows, dataset.receivers.filter(receiver => receiver.branch_id === branch.branch_id), id, from, end) })),
        truncated: dataset.truncated,
        has_ble_history: historyEnd > historyFrom && tags.some(tag => +new Date(tag.assigned_at) < historyEnd && (!tag.revoked_at || +new Date(tag.revoked_at) > historyFrom)) };
    };
    const summary: BleRangeSummary = summarize(selected);
    if (shiftDays) summary.daily = Object.fromEntries([...new Set(shiftDays)].map(day => {
      const rows = selected.filter(window => window.shift_day === day);
      const dayFrom = rows.length ? Math.max(from, Math.min(...rows.map(row => +new Date(row.start)))) : Math.max(from, +cairoTime(day));
      const dayEnd = rows.length ? Math.min(end, Math.max(...rows.map(row => +new Date(row.finish)))) : Math.min(end, +cairoTime(addDays(day, 1)));
      return [day, summarize(rows, dayFrom, dayEnd)];
    }));
    if (summary.daily) summary.has_ble_history = Object.values(summary.daily).some(day => day.has_ble_history);
    result.set(id, summary);
  }
  return result;
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

import { query } from './db';
import type { StoreSettings,Branch } from './geo';

let migration: Promise<unknown> | undefined;
export function ensureAttendanceSchema() {
  if (!migration) migration = query(`
    SELECT pg_advisory_xact_lock(hashtext('attendance-schema'));
    ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS client_event_id UUID;
    ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
    UPDATE attendance_logs SET received_at=timestamp WHERE received_at IS NULL;
    ALTER TABLE attendance_logs ALTER COLUMN received_at SET DEFAULT NOW();
    ALTER TABLE attendance_logs ALTER COLUMN received_at SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS attendance_event_unique ON attendance_logs(user_id, client_event_id);
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS attendance_reset_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS work_days INTEGER[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS cycle_start_day INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS grace_period_mins INTEGER NOT NULL DEFAULT 30;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS attendance_start_date DATE;
    UPDATE users SET attendance_start_date=(created_at AT TIME ZONE 'Africa/Cairo')::date WHERE attendance_start_date IS NULL;
    CREATE TABLE IF NOT EXISTS employee_policies (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      effective_from DATE NOT NULL, shift_start VARCHAR(5) NOT NULL, shift_end VARCHAR(5) NOT NULL,
      work_days INTEGER[] NOT NULL, cycle_start_day INTEGER NOT NULL CHECK(cycle_start_day BETWEEN 1 AND 31),
      role VARCHAR(20) NOT NULL, is_active BOOLEAN NOT NULL, grace_period_mins INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id,effective_from)
    );
    INSERT INTO employee_policies(user_id,effective_from,shift_start,shift_end,work_days,cycle_start_day,role,is_active,grace_period_mins)
    SELECT id,'1900-01-01',COALESCE(shift_start,'10:00'),COALESCE(shift_end,'22:00'),work_days,cycle_start_day,role,is_active,grace_period_mins FROM users
    ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS branches (
      id VARCHAR(50) PRIMARY KEY, name VARCHAR(100) NOT NULL,
      lat DOUBLE PRECISION NOT NULL, lng DOUBLE PRECISION NOT NULL,
      radius INTEGER NOT NULL CHECK (radius BETWEEN 10 AND 5000), is_active BOOLEAN NOT NULL DEFAULT TRUE
    );
    INSERT INTO branches (id, name, lat, lng, radius)
    SELECT 'branch1', branch1_name, branch1_lat, branch1_lng, branch1_radius FROM settings WHERE id = 'main'
    ON CONFLICT DO NOTHING;
    INSERT INTO branches (id, name, lat, lng, radius)
    SELECT 'branch2', branch2_name, branch2_lat, branch2_lng, branch2_radius FROM settings WHERE id = 'main'
    ON CONFLICT DO NOTHING;
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS attendance_mode VARCHAR(20) NOT NULL DEFAULT 'nfc';
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS nfc_enabled_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'mobile';
    ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS shift_day DATE;
    ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS nfc_scan_id BIGINT;
    CREATE UNIQUE INDEX IF NOT EXISTS nfc_shift_action ON attendance_logs(user_id,shift_day,event_type) WHERE source='nfc';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS nfc_in_before INTEGER NOT NULL DEFAULT 60;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS nfc_in_after INTEGER NOT NULL DEFAULT 120;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS nfc_out_before INTEGER NOT NULL DEFAULT 60;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS nfc_out_after INTEGER NOT NULL DEFAULT 180;
    ALTER TABLE employee_policies ADD COLUMN IF NOT EXISTS nfc_in_before INTEGER NOT NULL DEFAULT 60;
    ALTER TABLE employee_policies ADD COLUMN IF NOT EXISTS nfc_in_after INTEGER NOT NULL DEFAULT 120;
    ALTER TABLE employee_policies ADD COLUMN IF NOT EXISTS nfc_out_before INTEGER NOT NULL DEFAULT 60;
    ALTER TABLE employee_policies ADD COLUMN IF NOT EXISTS nfc_out_after INTEGER NOT NULL DEFAULT 180;
    CREATE TABLE IF NOT EXISTS nfc_devices (
      id UUID PRIMARY KEY, name VARCHAR(100) NOT NULL, branch_id VARCHAR(50) NOT NULL REFERENCES branches(id),
      token_hash VARCHAR(64) NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE, last_seen_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS nfc_cards (
      id SERIAL PRIMARY KEY, uid VARCHAR(20) NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), revoked_at TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS nfc_card_active ON nfc_cards(uid) WHERE revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS nfc_scans (
      id BIGSERIAL PRIMARY KEY, device_id UUID NOT NULL REFERENCES nfc_devices(id), event_id UUID NOT NULL,
      card_uid VARCHAR(20) NOT NULL, user_id INTEGER REFERENCES users(id), branch_id VARCHAR(50) NOT NULL,
      recorded_at TIMESTAMPTZ, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), status VARCHAR(40) NOT NULL,
      event_type VARCHAR(20), shift_day DATE, reviewed_by INTEGER REFERENCES users(id), review_note TEXT,
      reviewed_at TIMESTAMPTZ, UNIQUE(device_id,event_id)
    );
    CREATE INDEX IF NOT EXISTS nfc_scans_received ON nfc_scans(received_at DESC);
    CREATE TABLE IF NOT EXISTS nfc_review_audit (
      id BIGSERIAL PRIMARY KEY, scan_id BIGINT NOT NULL REFERENCES nfc_scans(id), admin_id INTEGER NOT NULL REFERENCES users(id),
      previous_data JSONB NOT NULL, new_data JSONB NOT NULL, note TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS business_day_start_time VARCHAR(5) NOT NULL DEFAULT '10:00';
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS max_tracking_hours INTEGER NOT NULL DEFAULT 12;
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS scan_debounce_secs INTEGER NOT NULL DEFAULT 30;
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS daily_flow_enabled_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE users ADD COLUMN IF NOT EXISTS attendance_open_time VARCHAR(5);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS checkout_open_time VARCHAR(5);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS max_tracking_hours INTEGER;
    ALTER TABLE employee_policies ADD COLUMN IF NOT EXISTS attendance_open_time VARCHAR(5);
    ALTER TABLE employee_policies ADD COLUMN IF NOT EXISTS checkout_open_time VARCHAR(5);
    ALTER TABLE employee_policies ADD COLUMN IF NOT EXISTS max_tracking_hours INTEGER;
    ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS tracking_deadline TIMESTAMPTZ;
    ALTER TABLE nfc_scans ADD COLUMN IF NOT EXISTS business_day DATE;
    ALTER TABLE nfc_scans ADD COLUMN IF NOT EXISTS flow_version INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE nfc_scans ADD COLUMN IF NOT EXISTS day_rule JSONB;
    CREATE TABLE IF NOT EXISTS nfc_day_rules (
      user_id INTEGER NOT NULL REFERENCES users(id), business_day DATE NOT NULL,
      day_start TIMESTAMPTZ NOT NULL, day_end TIMESTAMPTZ NOT NULL,
      shift_day DATE NOT NULL, shift_start TIMESTAMPTZ NOT NULL, shift_end TIMESTAMPTZ NOT NULL,
      attendance_open TIMESTAMPTZ NOT NULL, checkout_open TIMESTAMPTZ NOT NULL,
      max_tracking_hours INTEGER NOT NULL, debounce_secs INTEGER NOT NULL,
      PRIMARY KEY(user_id,business_day)
    );
    CREATE INDEX IF NOT EXISTS nfc_scans_business_day ON nfc_scans(user_id,business_day,recorded_at);
    CREATE TABLE IF NOT EXISTS nfc_day_rule_history (
      id BIGSERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),business_day DATE NOT NULL,
      effective_at TIMESTAMPTZ NOT NULL,rules JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS nfc_day_rule_history_lookup ON nfc_day_rule_history(user_id,business_day,effective_at DESC);
  `).catch(error => { migration = undefined; throw error; });
  return migration;
}

export async function loadSettings() {
  await ensureAttendanceSchema();
  const [settings, branches] = await Promise.all([
    query<StoreSettings>("SELECT * FROM settings WHERE id = 'main'"),
    query<Branch>('SELECT * FROM branches WHERE is_active = TRUE ORDER BY id'),
  ]);
  if (!settings.rows[0]) throw new Error('Missing store settings');
  return { ...settings.rows[0], branches: branches.rows };
}

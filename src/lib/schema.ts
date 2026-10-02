import { query } from './db';
import type { StoreSettings,Branch } from './geo';

let migration: Promise<unknown> | undefined;
export function ensureAttendanceSchema() {
  if (!migration) migration = query(`
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

import { query } from './db';

let migration: Promise<unknown> | undefined;
export function ensureAttendanceSchema() {
  if (!migration) migration = query(`
    ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS client_event_id UUID;
    ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
    UPDATE attendance_logs SET received_at=timestamp WHERE received_at IS NULL;
    ALTER TABLE attendance_logs ALTER COLUMN received_at SET DEFAULT NOW();
    ALTER TABLE attendance_logs ALTER COLUMN received_at SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS attendance_event_unique ON attendance_logs(user_id, client_event_id);
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
    query("SELECT * FROM settings WHERE id = 'main'"),
    query('SELECT * FROM branches WHERE is_active = TRUE ORDER BY id'),
  ]);
  if (!settings.rows[0]) throw new Error('Missing store settings');
  return { ...settings.rows[0], branches: branches.rows };
}

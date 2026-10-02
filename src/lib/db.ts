import { Pool } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set in environment variables');
    }
    pool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false,
      },
      max: 5,
      allowExitOnIdle: true,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      console.error('Unexpected database error on idle client:', err);
    });
  }
  return pool;
}

export async function query(text: string, params?: unknown[]) {
  const p = getPool();
  return await p.query(text, params);
}

export async function initDatabase() {
  const p = getPool();
  const client = await p.connect();

  try {
    await client.query('BEGIN');

    // Settings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id VARCHAR(50) PRIMARY KEY,
        branch1_name VARCHAR(100) NOT NULL DEFAULT 'المحل الأول (الفرع الرئيسي)',
        branch1_lat DOUBLE PRECISION NOT NULL DEFAULT 30.0444,
        branch1_lng DOUBLE PRECISION NOT NULL DEFAULT 31.2357,
        branch1_radius INTEGER NOT NULL DEFAULT 40,
        branch2_name VARCHAR(100) NOT NULL DEFAULT 'المحل الثاني (الفرع الثاني)',
        branch2_lat DOUBLE PRECISION NOT NULL DEFAULT 30.0448,
        branch2_lng DOUBLE PRECISION NOT NULL DEFAULT 31.2362,
        branch2_radius INTEGER NOT NULL DEFAULT 40,
        shift_start_time VARCHAR(10) NOT NULL DEFAULT '10:00',
        shift_end_time VARCHAR(10) NOT NULL DEFAULT '22:00',
        grace_period_mins INTEGER NOT NULL DEFAULT 30,
        ping_interval_secs INTEGER NOT NULL DEFAULT 60,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Insert initial settings if not exists
    await client.query(`
      INSERT INTO settings (id, branch1_name, branch1_lat, branch1_lng, branch1_radius,
                           branch2_name, branch2_lat, branch2_lng, branch2_radius,
                           shift_start_time, shift_end_time, grace_period_mins, ping_interval_secs)
      VALUES ('main', 'المحل الأول (الفرع الرئيسي)', 30.0444, 31.2357, 40,
                      'المحل الثاني (الفرع الثاني)', 30.0448, 31.2362, 40,
                      '10:00', '22:00', 30, 60)
      ON CONFLICT (id) DO NOTHING;
    `);

    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(150) NOT NULL,
        phone VARCHAR(50),
        role VARCHAR(20) NOT NULL DEFAULT 'employee',
        shift_start VARCHAR(10) DEFAULT '10:00',
        shift_end VARCHAR(10) DEFAULT '22:00',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Seed default admin and 5 employees if table is empty
    const usersCount = await client.query('SELECT COUNT(*) FROM users');
    if (parseInt(usersCount.rows[0].count, 10) === 0) {
      await client.query(`
        INSERT INTO users (username, password, name, phone, role, shift_start, shift_end)
        VALUES 
          ('admin', 'admin123', 'مدير النظام (أدمن)', '01000000000', 'admin', '10:00', '22:00'),
          ('emp1', '123456', 'أحمد محمود', '01011112222', 'employee', '10:00', '22:00'),
          ('emp2', '123456', 'محمد علي', '01022223333', 'employee', '10:00', '22:00'),
          ('emp3', '123456', 'كريم حسن', '01033334444', 'employee', '10:00', '22:00'),
          ('emp4', '123456', 'يوسف إبراهيم', '01044445555', 'employee', '10:00', '22:00'),
          ('emp5', '123456', 'عمر فاروق', '01055556666', 'employee', '10:00', '22:00');
      `);
    }

    // Attendance logs (pings and events)
    await client.query(`
      CREATE TABLE IF NOT EXISTS attendance_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        branch_id VARCHAR(50) NOT NULL,
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        accuracy DOUBLE PRECISION,
        distance_branch1 DOUBLE PRECISION,
        distance_branch2 DOUBLE PRECISION,
        event_type VARCHAR(50) DEFAULT 'ping'
      );
    `);

    // Indexes for high performance querying
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_attendance_user_time ON attendance_logs(user_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_attendance_timestamp ON attendance_logs(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_attendance_branch ON attendance_logs(branch_id);
    `);

    await client.query('COMMIT');
    console.log('Database tables successfully initialized!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error initializing database:', err);
    throw err;
  } finally {
    client.release();
  }
}

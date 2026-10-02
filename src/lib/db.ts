import { Pool, type QueryResultRow } from 'pg';

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

export async function query<Row extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) {
  const p = getPool();
  return await p.query<Row>(text, params);
}


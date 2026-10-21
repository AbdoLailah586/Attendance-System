// Full logical backup (schema-defining source files + every table's rows) to a local,
// git-repo-external folder. This repo is public on GitHub; backups must never land in it.
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const { Pool, types } = pg;
// pg's default DATE (oid 1082) parser builds a JS Date in the LOCAL timezone, which then
// shifts by a day when round-tripped through Date#toJSON's UTC ISO string. Keep the raw
// "YYYY-MM-DD" text instead so restore writes back the exact same calendar date.
types.setTypeParser(1082, value => value);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(__dirname);

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(repoRoot, '.env');
  if (!fs.existsSync(envPath)) throw new Error('DATABASE_URL is not set and no .env file was found at ' + envPath);
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^DATABASE_URL=(.*)$/);
    if (match) return match[1].trim();
  }
  throw new Error('DATABASE_URL not found in ' + envPath);
}

function backupRoot() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'JoeStore', 'Attendance', 'Backups');
}

function assertOutsideRepo(targetPath) {
  const resolved = path.resolve(targetPath), repo = path.resolve(repoRoot);
  if (resolved === repo || resolved.startsWith(repo + path.sep))
    throw new Error('Refusing to write backup data inside the git repository (it is public on GitHub): ' + resolved);
}

// Captured verbatim so a backup can always rebuild its own schema, even if these
// files change again later in the repo's history.
const SCHEMA_SOURCE_FILES = [
  ['init-db.mjs', path.join(repoRoot, 'scripts', 'init-db.mjs')],
  ['schema.ts', path.join(repoRoot, 'src', 'lib', 'schema.ts')],
  ['ble.ts', path.join(repoRoot, 'src', 'lib', 'ble.ts')],
];

async function main() {
  const connectionString = loadDatabaseUrl();
  const url = new URL(connectionString);
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });
  const client = await pool.connect();
  // Pooled (pgbouncer-style) connections can hand back a backend another session left with a
  // non-default search_path; never assume "public" implicitly.
  await client.query('SET search_path TO public');
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = path.join(backupRoot(), timestamp);
    assertOutsideRepo(outDir);
    fs.mkdirSync(path.join(outDir, 'data'), { recursive: true });
    fs.mkdirSync(path.join(outDir, 'schema'), { recursive: true });

    for (const [name, srcPath] of SCHEMA_SOURCE_FILES) {
      if (!fs.existsSync(srcPath)) throw new Error('Missing expected schema source file: ' + srcPath);
      fs.copyFileSync(srcPath, path.join(outDir, 'schema', name));
    }

    const tables = (await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'
      ORDER BY table_name`)).rows.map(r => r.table_name);
    if (!tables.length) throw new Error('No tables found in the public schema; refusing to write an empty backup.');

    console.log(`Backing up ${tables.length} tables from ${url.hostname}${url.pathname}...`);
    const manifest = {
      taken_at: new Date().toISOString(),
      source_host: url.hostname,
      source_database: url.pathname.replace(/^\//, ''),
      tables: {},
    };
    let totalRows = 0;
    for (const table of tables) {
      const rows = (await client.query(`SELECT * FROM "${table}"`)).rows;
      fs.writeFileSync(path.join(outDir, 'data', `${table}.json`), JSON.stringify(rows, null, 2));
      manifest.tables[table] = rows.length;
      totalRows += rows.length;
      console.log(`  ${table}: ${rows.length} rows`);
    }
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`Backup complete: ${outDir}`);
    console.log(`${tables.length} tables, ${totalRows} rows total.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => { console.error('Backup failed:', error.message); process.exitCode = 1; });

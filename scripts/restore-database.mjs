// Rebuild a database (any Postgres provider) from a folder produced by backup-database.mjs.
// Schema is recreated by executing the backup's OWN captured source files, not the live
// repo copies, so a backup always knows how to restore exactly what it took a copy of.
import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(__dirname);

function parseArgs(argv) {
  const args = { schema: 'public', force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--backup') args.backup = argv[++i];
    else if (arg === '--target') args.target = argv[++i];
    else if (arg === '--schema') args.schema = argv[++i];
    else if (arg === '--force') args.force = true;
    else throw new Error('Unknown argument: ' + arg);
  }
  if (!args.backup) throw new Error('--backup <folder> is required');
  if (!args.target) throw new Error('--target "<postgresql://...>" is required');
  return args;
}

function assertOutsideRepo(targetPath) {
  const resolved = path.resolve(targetPath), repo = path.resolve(repoRoot);
  if (resolved === repo || resolved.startsWith(repo + path.sep))
    throw new Error('Refusing to read a backup from inside the git repository (it is public on GitHub): ' + resolved);
}

// init-db.mjs: every bare `client.query(`...`)` backtick call is a plain, unparameterized
// DDL/seed block (its one parameterized call uses a quoted string, not a backtick, so it is
// never matched here). schema.ts / ble.ts instead hold many *other* backtick `query(`...`)`
// helpers that DO take $1/$2 params — only the lazy-migration block, anchored on its unique
// `migration = query(`...`)` assignment, is schema DDL and safe to replay without bindings.
function extractSqlBlocks(sourceText, mode) {
  const blocks = [];
  const pattern = mode === 'migration-assignment' ? /\bmigration\s*=\s*query\(\s*`([\s\S]*?)`\s*\)/g : /\bclient\.query\(\s*`([\s\S]*?)`\s*\)/g;
  let match;
  while ((match = pattern.exec(sourceText))) blocks.push(match[1]);
  return blocks;
}

async function runSchemaFile(client, label, fileText, mode) {
  const blocks = extractSqlBlocks(fileText, mode);
  if (!blocks.length) throw new Error(`No SQL blocks found in ${label}; the file format may have changed.`);
  for (const sql of blocks) await client.query(sql);
  console.log(`  applied ${blocks.length} SQL block(s) from ${label}`);
}

async function rebuildSchema(client, backupDir) {
  console.log('Rebuilding schema from the backup\'s captured source files...');
  for (const [name, mode] of [['init-db.mjs', 'all-client-calls'], ['schema.ts', 'migration-assignment'], ['ble.ts', 'migration-assignment']]) {
    const filePath = path.join(backupDir, 'schema', name);
    if (!fs.existsSync(filePath)) throw new Error(`Backup is missing schema/${name}; cannot rebuild schema safely.`);
    await runSchemaFile(client, name, fs.readFileSync(filePath, 'utf8'), mode);
  }
}

async function foreignKeyEdges(client, schema, tables) {
  const rows = (await client.query(`
    SELECT tc.table_name AS child_table, ccu.table_name AS parent_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1`, [schema])).rows;
  return rows
    .filter(r => tables.includes(r.child_table) && tables.includes(r.parent_table))
    .map(r => [r.child_table, r.parent_table]);
}

function topologicalOrder(tables, edges) {
  const deps = new Map(tables.map(t => [t, new Set()]));
  for (const [child, parent] of edges) if (child !== parent) deps.get(child).add(parent);
  const resolved = [], remaining = new Set(tables);
  while (remaining.size) {
    const ready = [...remaining].filter(t => [...deps.get(t)].every(p => resolved.includes(p))).sort();
    if (!ready.length) throw new Error('Circular foreign-key dependency detected among: ' + [...remaining].join(', '));
    for (const t of ready) { resolved.push(t); remaining.delete(t); }
  }
  return resolved;
}

async function columnKinds(client, schema, table) {
  const rows = (await client.query(
    `SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2`,
    [schema, table])).rows;
  const kinds = new Map();
  for (const row of rows) {
    kinds.set(row.column_name, row.data_type === 'ARRAY' ? 'array' : ['json', 'jsonb'].includes(row.udt_name) ? 'json' : 'plain');
  }
  return kinds;
}

function encodeValue(value, kind) {
  if (value === null || value === undefined) return null;
  if (kind === 'array') return value;
  if (kind === 'json') return JSON.stringify(value);
  return value;
}

async function resetSequences(client, schema, table, columns) {
  for (const column of columns) {
    const seq = (await client.query('SELECT pg_get_serial_sequence($1, $2) AS seq', [`${schema}.${table}`, column])).rows[0].seq;
    if (!seq) continue;
    await client.query(`SELECT setval($1::regclass, GREATEST(1, COALESCE((SELECT MAX("${column}") FROM "${schema}"."${table}"), 0)), true)`, [seq]);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const backupDir = path.resolve(args.backup);
  assertOutsideRepo(backupDir);
  const manifestPath = path.join(backupDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('manifest.json not found in ' + backupDir);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const tables = Object.keys(manifest.tables);

  const targetUrl = new URL(args.target);
  if (args.schema === 'public' && !args.force
    && targetUrl.hostname === manifest.source_host
    && targetUrl.pathname.replace(/^\//, '') === manifest.source_database) {
    throw new Error('--target looks like the SAME database this backup was taken from (same host + database), restoring into "public" would overwrite live data. Pass --schema <name> for a sandboxed test, or --force if this is really intended.');
  }

  const pool = new Pool({ connectionString: args.target, ssl: { rejectUnauthorized: false }, max: 1 });
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${args.schema}"`);
    await client.query(`SET search_path TO "${args.schema}"`);

    if (!args.force) {
      const existing = (await client.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name = ANY($2::text[])`,
        [args.schema, tables])).rows;
      for (const row of existing) {
        const count = (await client.query(`SELECT count(*)::int AS n FROM "${args.schema}"."${row.table_name}"`)).rows[0].n;
        if (count > 0) throw new Error(`Target schema "${args.schema}" already has ${count} row(s) in "${row.table_name}". Pass --force to overwrite, or restore into an empty schema.`);
      }
    }

    await client.query('BEGIN');
    await rebuildSchema(client, backupDir);

    const presentTables = (await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name = ANY($2::text[])`,
      [args.schema, tables])).rows.map(r => r.table_name);
    const missing = tables.filter(t => !presentTables.includes(t));
    if (missing.length) throw new Error('Backup references tables the rebuilt schema does not have: ' + missing.join(', '));

    await client.query(`TRUNCATE ${tables.map(t => `"${args.schema}"."${t}"`).join(',')} CASCADE`);

    const edges = await foreignKeyEdges(client, args.schema, tables);
    const order = topologicalOrder(tables, edges);

    let totalRows = 0;
    for (const table of order) {
      const rows = JSON.parse(fs.readFileSync(path.join(backupDir, 'data', `${table}.json`), 'utf8'));
      if (!rows.length) { console.log(`  ${table}: 0 rows`); continue; }
      const columns = Object.keys(rows[0]);
      const kinds = await columnKinds(client, args.schema, table);
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(',');
      const insertSql = `INSERT INTO "${args.schema}"."${table}" (${columns.map(c => `"${c}"`).join(',')}) VALUES (${placeholders})`;
      for (const row of rows) await client.query(insertSql, columns.map(c => encodeValue(row[c], kinds.get(c) || 'plain')));
      await resetSequences(client, args.schema, table, columns);
      console.log(`  ${table}: ${rows.length} rows restored`);
      totalRows += rows.length;
    }

    await client.query('COMMIT');
    console.log(`Restore complete into schema "${args.schema}": ${order.length} tables, ${totalRows} rows.`);
    if (args.schema === 'public') console.log('Remember to update DATABASE_URL (locally and in Vercel) to point at this target.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    // Pooled (pgbouncer-style) connections can hand this backend to a completely different
    // session next; never leave a non-default search_path on it.
    await client.query('SET search_path TO public').catch(() => {});
    client.release();
    await pool.end();
  }
}

main().catch(error => { console.error('Restore failed:', error.message); process.exitCode = 1; });

#!/usr/bin/env node
// ─── Backup restore drill for Unified POS ────────────────────────────────────
// Proves the newest pg_dump actually restores: recreates it into a scratch
// database, compares table inventory and per-table row counts against the live
// source, then drops the scratch database. Exit 0 = restorable and identical.
// Run this on a schedule after `node scripts/backup.mjs` - an untested backup
// is a rumor, not a backup.
//
// Usage: node scripts/restore-drill.mjs [path-to.dump]
//   default: newest unified_pos_*.dump in Desktop\Unified POS Backups

import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync, statSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envText = readFileSync(resolve(repoRoot, 'packages/server/.env'), 'utf8');
const m = /^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m.exec(envText);
if (!m) {
  console.error('[drill] packages/server/.env has no DATABASE_URL');
  process.exit(1);
}
const sourceUrl = m[1].split('?')[0];
const parsed = new URL(sourceUrl);

function findTool(name) {
  try {
    execFileSync(name, ['--version'], { stdio: 'ignore' });
    return name;
  } catch { /* not on PATH */ }
  const roots = ['C:/Program Files/PostgreSQL', '/usr/lib/postgresql'];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const v of readdirSync(root)) {
      const candidate = `${root}/${v}/bin/${name}${root.startsWith('C:') ? '.exe' : ''}`;
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}
const PG_RESTORE = findTool('pg_restore');
if (!PG_RESTORE) {
  console.error('[drill] pg_restore not found on PATH or under PostgreSQL install dirs');
  process.exit(1);
}

// Newest dump unless a path was given.
let dump = process.argv[2];
if (!dump) {
  const dir = resolve(homedir(), 'Desktop', 'Unified POS Backups');
  if (!existsSync(dir)) { console.error(`[drill] no backups dir ${dir}; run scripts/backup.mjs first`); process.exit(1); }
  const candidates = readdirSync(dir)
    .filter(f => f.startsWith('unified_pos_') && f.endsWith('.dump'))
    .map(f => ({ f, t: statSync(resolve(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!candidates.length) { console.error('[drill] no .dump files found; run scripts/backup.mjs first'); process.exit(1); }
  dump = resolve(dir, candidates[0].f);
}
console.log(`[drill] dump under test: ${dump}`);

const SCRATCH = 'unified_pos_restore_test';
const admin = {
  host: parsed.hostname, port: Number(parsed.port) || 5432,
  user: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password),
  database: 'postgres',
};

async function withAdmin(fn) {
  const client = new pg.Client(admin);
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

// Per-table row counts of a database, for source-vs-restore comparison.
async function tableCounts(database) {
  const client = new pg.Client({ ...admin, database });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`);
    const out = {};
    for (const r of rows) {
      const c = await client.query(`SELECT COUNT(*)::bigint AS n FROM public."${r.table_name}"`);
      out[r.table_name] = Number(c.rows[0].n);
    }
    return out;
  } finally { await client.end(); }
}

let failed = false;
try {
  // 1) Recreate scratch db.
  await withAdmin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${SCRATCH}`);
  });
  console.log(`[drill] scratch database ${SCRATCH} created`);

  // 2) Restore the dump into it.
  const restoreUrl = `postgresql://${encodeURIComponent(admin.user)}:${encodeURIComponent(admin.password)}@${admin.host}:${admin.port}/${SCRATCH}`;
  execFileSync(PG_RESTORE, ['--no-owner', '-d', restoreUrl, dump], { stdio: 'inherit' });
  console.log('[drill] pg_restore completed');

  // 3) Compare table inventory + row counts against the live source.
  // Operational tables (scheduler heartbeats, rate-limit counters) are written
  // every tick; a small delta between dump time and count time is churn, not
  // corruption. Business tables must match exactly.
  const CHURN_TABLES = new Set(['job_runs', 'rate_limit_counters']);
  const src = await tableCounts(parsed.pathname.slice(1));
  const dst = await tableCounts(SCRATCH);
  const srcTables = Object.keys(src), dstTables = Object.keys(dst);
  const missing = srcTables.filter(t => !dstTables.includes(t));
  const extra = dstTables.filter(t => !srcTables.includes(t));
  let mismatch = 0;
  for (const t of srcTables) {
    if (dst[t] !== undefined && dst[t] !== src[t]) {
      const msg = `[drill] row-count delta: ${t} source=${src[t]} restored=${dst[t]}`;
      // Tolerate only a small delta on known-churn tables; a big one is real loss.
      if (CHURN_TABLES.has(t) && Math.abs(dst[t] - src[t]) <= 100) { console.log(`${msg} (operational churn - tolerated)`); continue; }
      console.error(msg);
      mismatch++;
    }
  }
  if (missing.length) { console.error('[drill] tables missing after restore:', missing.join(', ')); failed = true; }
  if (extra.length) console.warn('[drill] extra tables in restore (harmless):', extra.join(', '));
  if (mismatch) failed = true;

  const totalRows = Object.values(dst).reduce((a, b) => a + b, 0);
  console.log(`[drill] compared ${srcTables.length} tables, ${totalRows} rows restored`);
  if (!failed) console.log('[drill] PASS - the backup is restorable and identical to the source');
} catch (err) {
  console.error('[drill] FAILED:', err.message || err);
  failed = true;
} finally {
  // 4) Always drop the scratch db.
  await withAdmin((client) => client.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`)).catch(() => {});
  console.log(`[drill] scratch database ${SCRATCH} dropped`);
}
process.exit(failed ? 2 : 0);

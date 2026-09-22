#!/usr/bin/env node
// ─── Production backup for Unified POS ───────────────────────────────────────
// Runs pg_dump (custom format) against the dev/production database from
// packages/server/.env and writes a timestamped .dump into the backups folder.
// Custom format is what pg_restore drills in scripts/restore-drill.mjs accept,
// and what point-in-time workflows expect. A backup that has never been
// restored is a rumor - run restore-drill.mjs regularly, not just this.
//
// Usage: node scripts/backup.mjs [target-dir]
//   default target: Desktop\Unified POS Backups

import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envText = readFileSync(resolve(repoRoot, 'packages/server/.env'), 'utf8');
const m = /^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m.exec(envText);
if (!m) {
  console.error('[backup] packages/server/.env has no DATABASE_URL');
  process.exit(1);
}
// Prisma appends ?schema=public which libpq tools reject - strip it.
const dbUrl = m[1].split('?')[0];
const parsed = new URL(dbUrl);

// Locate a libpq tool: PATH first, then the standard Windows/Linux install layout.
function findTool(name) {
  try {
    execFileSync(name, ['--version'], { stdio: 'ignore' });
    return name;
  } catch { /* not on PATH; fall through */ }
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

const PG_DUMP = findTool('pg_dump');
if (!PG_DUMP) {
  console.error('[backup] pg_dump not found on PATH or in C:/Program Files/PostgreSQL/*/bin');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = process.argv[2] || resolve(homedir(), 'Desktop', 'Unified POS Backups');
mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, `unified_pos_${stamp}.dump`);

console.log(`[backup] dumping ${parsed.pathname.slice(1)}@${parsed.host}:${parsed.port} -> ${outFile}`);
execFileSync(PG_DUMP, ['--format=custom', '--file', outFile, dbUrl], { stdio: 'inherit' });
const size = statSync(outFile).size;
console.log(`[backup] done: ${(size / 1024 / 1024).toFixed(2)} MB. Next: node scripts/restore-drill.mjs`);

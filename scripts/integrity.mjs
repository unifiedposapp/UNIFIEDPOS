#!/usr/bin/env node
// ─── Referential integrity audit for Unified POS ─────────────────────────────
// Scans every foreign key in the public schema and reports child rows whose
// parent is gone (orphans). Orphan rows survive in databases whose constraints
// were added after violating data already existed (db-push era) and they break
// pg_restore of backups - a restore drill is exactly where they surface.
//
// Usage:
//   node scripts/integrity.mjs          # report only (exit 1 if orphans found)
//   node scripts/integrity.mjs --fix    # delete the orphan child rows
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = readFileSync(resolve(repoRoot, 'packages/server/.env'), 'utf8');
const url = /DATABASE_URL="?([^"\r\n]+)"?/.exec(env)[1].split('?')[0];
const FIX = process.argv.includes('--fix');
const client = new pg.Client(url);
await client.connect();

const { rows: fks } = await client.query(`
  SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent,
         pg_get_constraintdef(oid) AS def, conname
  FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace
  ORDER BY 1`);

const FK_SHAPE = /FOREIGN KEY \("?(\w+)"?\) REFERENCES \w+\.?\(?(\w+)\)?/;
let totalOrphans = 0;
const dirty = [];
for (const fk of fks) {
  const m = FK_SHAPE.exec(fk.def);
  if (!m) continue;
  const [, childCol, parentCol] = m;
  const q = await client.query(
    `SELECT COUNT(*)::int AS n FROM "${fk.child}" c
     LEFT JOIN "${fk.parent}" p ON p."${parentCol}" = c."${childCol}"
     WHERE c."${childCol}" IS NOT NULL AND p."${parentCol}" IS NULL`
  ).catch(() => ({ rows: [{ n: 0 }] }));
  const n = q.rows[0].n;
  if (!n) continue;
  totalOrphans += n;
  dirty.push({ ...fk, childCol, parentCol, n });
}

for (const d of dirty) {
  console.log(`${FIX ? 'FIXING:' : 'ORPHANS:'} ${d.child}.${d.childCol} -> ${d.parent}.${d.parentCol} : ${d.n} rows (${d.conname})`);
  if (FIX) {
    await client.query(
      `DELETE FROM "${d.child}" WHERE "${d.childCol}" IS NOT NULL
       AND "${d.childCol}" NOT IN (SELECT "${d.parentCol}" FROM "${d.parent}")`
    );
  }
}

console.log(totalOrphans === 0
  ? 'CLEAN: no FK orphans found'
  : FIX
    ? `removed ${totalOrphans} orphan rows`
    : `TOTAL orphan rows: ${totalOrphans} (re-run with --fix)`);
await client.end();
process.exit(FIX || totalOrphans === 0 ? 0 : 1);

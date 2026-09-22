// One-shot helper: create/drop a scratch shadow database so that
// `prisma migrate diff --from-migrations ...` can generate the incremental SQL
// for the global-hardening tables without touching the real dev database.
import fs from 'node:fs';
import pg from 'pg';

const env = fs.readFileSync('packages/server/.env', 'utf8');
const url = /DATABASE_URL="?([^"\r\n]+)"?/.exec(env)?.[1];
if (!url) throw new Error('DATABASE_URL not found in packages/server/.env');

const u = new URL(url);
const dbName = process.argv[2] === 'drop' ? 'unified_pos_shadow' : 'unified_pos_shadow';
const admin = new pg.Client({
  host: u.hostname,
  port: Number(u.port || 5432),
  user: u.username,
  password: decodeURIComponent(u.password),
  database: 'postgres',
});
await admin.connect();
try {
  if (process.argv[2] === 'drop') {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    console.log('dropped', dbName);
  } else {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${dbName}`);
    console.log('created', dbName);
  }
} finally {
  await admin.end();
}

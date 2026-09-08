#!/usr/bin/env node
/**
 * Post-deploy smoke test (zero dependencies — uses Node 20's global fetch).
 *
 * Hits the liveness + readiness probes of a deployed instance and exits non-zero
 * on any failure, so a deploy pipeline or release hook can gate promotion on it.
 *
 * Usage:
 *   node scripts/smoke-test.mjs
 *   SMOKE_URL=https://pos.example.com node scripts/smoke-test.mjs
 *   SMOKE_TIMEOUT_MS=15000 node scripts/smoke-test.mjs
 *
 * Env:
 *   SMOKE_URL         base URL of the running app (default http://localhost:3001)
 *   SMOKE_TIMEOUT_MS  per-request timeout in ms (default 8000)
 */

const baseUrl = (process.env.SMOKE_URL || 'http://localhost:3001').replace(/\/+$/, '');
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 8000);

/** Each check asserts an HTTP status and (optionally) a JSON body predicate. */
const checks = [
  {
    name: 'liveness   GET /api/health',
    path: '/api/health',
    expect: 200,
    body: (b) => b && b.status === 'ok',
  },
  {
    name: 'readiness  GET /api/ready',
    path: '/api/ready',
    expect: 200,
    body: (b) => b && b.status === 'ready',
  },
];

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'manual' });
  } finally {
    clearTimeout(timer);
  }
}

async function runCheck(check) {
  const url = `${baseUrl}${check.path}`;
  try {
    const res = await fetchWithTimeout(url);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* body is not JSON */
    }
    const statusOk = res.status === check.expect;
    const bodyOk = !check.body || Boolean(check.body(json));
    if (statusOk && bodyOk) {
      console.log(`  PASS  ${check.name} — HTTP ${res.status}`);
      return true;
    }
    console.error(
      `  FAIL  ${check.name} — HTTP ${res.status} (expected ${check.expect})` +
        (text ? ` body=${text.slice(0, 160)}` : ''),
    );
    return false;
  } catch (err) {
    console.error(`  FAIL  ${check.name} — ${err && err.message ? err.message : err}`);
    return false;
  }
}

async function main() {
  console.log(`[smoke] target ${baseUrl} (timeout ${timeoutMs}ms)`);
  let failed = 0;
  for (const check of checks) {
    const ok = await runCheck(check);
    if (!ok) failed++;
  }
  if (failed > 0) {
    console.error(`[smoke] ${failed} check(s) failed.`);
    process.exit(1);
  }
  console.log('[smoke] all checks passed.');
  process.exit(0);
}

main();

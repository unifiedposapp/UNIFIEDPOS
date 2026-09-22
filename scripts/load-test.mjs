#!/usr/bin/env node
// ─── Dependency-free load test for Unified POS ───────────────────────────────
// Hammers a running server with concurrent workers across a mix of anonymous
// and authenticated scenarios, then reports RPS, error rate and p50/p95/p99
// latency. Uses only node:fetch - no k6/artillery install needed, so any host
// running this repo can produce capacity evidence.
//
// Usage:
//   node scripts/load-test.mjs [--base http://localhost:3001] [--concurrency 25]
//     [--requests 40] [--email admin@pos.com] [--password Ekwueme_2025]
//
// Exit code: 0 if server-error rate <= 1%, 2 if higher, 1 on setup failure.
// 429s are reported as THROTTLED (the abuse guard working), not as failures.

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2).toLowerCase()] = process.argv[i + 1];
}

const BASE = (args.base || 'http://localhost:3001').replace(/\/+$/, '');
const CONCURRENCY = Number(args.concurrency || 25);
const PER_WORKER = Number(args.requests || 40);
const EMAIL = args.email || 'admin@pos.com';
const PASSWORD = args.password || 'Ekwueme_2025';

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  // Authenticate once; authenticated scenarios degrade gracefully if login fails.
  let token = null;
  try {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const j = await r.json();
    token = j?.data?.token || null;
  } catch { /* anonymous-only run */ }
  if (!token) console.warn('[load] login failed - running anonymous scenarios only');

  const scenarios = [
    { name: 'health      ', url: `${BASE}/api/health`, auth: false },
    { name: 'me          ', url: `${BASE}/api/auth/me`, auth: true },
    { name: 'floor-plan  ', url: `${BASE}/api/restaurant/overview`, auth: true },
  ].filter(s => s.auth !== true || token);

  const stats = scenarios.map(s => ({ ...s, latencies: [], errors: 0, throttled: 0, ok: 0 }));
  const started = Date.now();

  const worker = async () => {
    for (let i = 0; i < PER_WORKER; i++) {
      const s = stats[i % stats.length];
      const t0 = performance.now();
      try {
        const res = await fetch(s.url, { headers: s.auth && token ? { Authorization: `Bearer ${token}` } : {} });
        await res.arrayBuffer(); // drain body
        if (res.ok) s.ok++;
        else if (res.status === 429) s.throttled++;
        else s.errors++; // 5xx / 4xx other than throttle = real failure
      } catch {
        s.errors++;
      }
      s.latencies.push(performance.now() - t0);
    }
  };

  console.log(`[load] base=${BASE} concurrency=${CONCURRENCY} requests/worker=${PER_WORKER} scenarios=${stats.map(s => s.name.trim()).join(', ')}`);
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const elapsed = (Date.now() - started) / 1000;

  let totalOk = 0, totalErr = 0, totalThrottled = 0;
  console.log('\n scenario        ok throttled err    p50ms   p95ms   p99ms   max');
  for (const s of stats) {
    s.latencies.sort((a, b) => a - b);
    totalOk += s.ok; totalErr += s.errors; totalThrottled += s.throttled;
    console.log(
      ` ${s.name}  ${String(s.ok).padStart(5)} ${String(s.throttled).padStart(8)} ${String(s.errors).padStart(4)}` +
      `  ${percentile(s.latencies, 50).toFixed(1).padStart(6)} ${percentile(s.latencies, 95).toFixed(1).padStart(6)}` +
      ` ${percentile(s.latencies, 99).toFixed(1).padStart(6)} ${s.latencies[s.latencies.length - 1].toFixed(1).padStart(6)}`
    );
  }
  const total = totalOk + totalErr + totalThrottled;
  const errRate = total ? (totalErr / total) * 100 : 100;
  console.log(`\n[load] ${total} requests in ${elapsed.toFixed(1)}s -> ${(total / elapsed).toFixed(0)} req/s | throttled(429): ${totalThrottled} | failures: ${totalErr} (${errRate.toFixed(2)}%)`);
  if (errRate > 1) { console.error('[load] FAIL: server-error rate above 1%'); process.exit(2); }
  if (totalThrottled > 0) console.log('[load] note: 429s mean the rate limiter is protecting the API - raise RATE_LIMIT_MAX_PER_MIN on the target for a raw-capacity run.');
  console.log('[load] PASS');
}

main().catch(err => { console.error('[load] setup failure:', err); process.exit(1); });

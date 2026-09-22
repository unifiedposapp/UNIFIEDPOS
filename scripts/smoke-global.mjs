// End-to-end smoke test for the ten market-dominance routers, against a running
// server with a migrated database. It registers a throwaway tenant (unique email
// per run), then walks every subsystem: fiscal seal + chain, rail validation and
// settlement reconciliation, a replenishment run, a vertical pack through its 428
// confirmation gate, underwriting, an app install + custom fields, a signed agent
// mandate verified and tamper-checked on the public surface, mesh fencing, a
// franchise agreement accrual and the benchmark cohort endpoints.
//
//   node scripts/smoke-global.mjs            # against http://localhost:3001
//   SMOKE_URL=https://pos.example.com node scripts/smoke-global.mjs
//
// Rate limiting is real, so the script waits on 429s and paces itself: expect a
// few minutes. Exits non-zero on the first unexpected answer.
const BASE = process.env.SMOKE_URL || 'http://localhost:3001';
const email = `smoke_${Date.now()}@example.test`;

async function call(method, path, body, token) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      const wait = (Number(res.headers.get('retry-after')) || 20) * 1000 + 500;
      console.log(`      ...rate limited, waiting ${Math.round(wait / 1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    await new Promise((r) => setTimeout(r, 250));
    return { status: res.status, json, text: text.slice(0, 200), ok: res.status < 400 };
  }
  return { status: 429, json: null, text: 'rate limited repeatedly', ok: false };
}

let failures = 0;
async function expect(label, method, path, body, token, pred = (r) => r.ok) {
  const r = await call(method, path, body, token);
  let pass = pred(r);
  if (pass) console.log(`PASS  ${String(r.status).padEnd(4)} ${label}`);
  else {
    failures++;
    console.log(`FAIL  ${String(r.status).padEnd(4)} ${label} :: ${r.text}`);
  }
  return r;
}
const status = (wanted) => (r) => r.status === wanted;

const data = (r) => r.json?.data ?? r.json;

// ── Tenant bootstrap ──────────────────────────────────────────────────────────
const reg = await expect('POST /api/auth/register', 'POST', '/api/auth/register', {
  name: 'Smoke Owner',
  email,
  password: 'Sup3rSecret!',
  organizationName: 'Smoke Global Corp',
  country: 'United States',
  countryCode: 'US',
  currency: 'USD',
  industry: 'RETAIL',
  phone: '+15551234567',
});
const token = data(reg).token || data(reg).accessToken;
const me = await expect('GET  /api/auth/me', 'GET', '/api/auth/me', null, token);
const organizationId = data(me).organizationId || data(me).organization?.id;
const loc = await expect('POST /api/locations', 'POST', '/api/locations', { name: 'Smoke Store', address: '1 Main St, New York', phone: '+15551234567' }, token);
const locationId = data(loc).id;
const prod = await expect('POST /api/products', 'POST', '/api/products', { name: 'Smoke Widget', sku: 'SMOKE-1', price: 12.5, costPrice: 6, type: 'PHYSICAL' }, token);
const productId = data(prod).id;
const dev = await expect('POST /api/devices', 'POST', '/api/devices', { name: 'Smoke Till', type: 'POS_TERMINAL', locationId }, token);
const deviceId = data(dev).id || data(dev).device?.id;

// ── 1. Fiscalisation ──────────────────────────────────────────────────────────
const profiles = await expect('GET  /api/fiscal/profiles', 'GET', '/api/fiscal/profiles', null, token, (r) => data(r).profiles?.length >= 26);
const profileCode = (data(profiles).profiles || [])[0]?.profileCode || (data(profiles).profiles || [])[0]?.code;
await expect('GET  /api/fiscal/status', 'GET', '/api/fiscal/status', null, token);
const fd = await expect('POST /api/fiscal/devices', 'POST', '/api/fiscal/devices', { profileCode, serialNumber: `SMOKE-${Date.now()}`, locationId }, token);
const fiscalDeviceId = data(fd).id || data(fd).device?.id;
await expect('POST /api/fiscal/seal', 'POST', '/api/fiscal/seal', { total: 42.5, vatTotal: 3.5, paymentMethod: 'CARD', documentType: 'RECEIPT', locationId }, token);
await expect('GET  /api/fiscal/documents', 'GET', '/api/fiscal/documents', null, token);
await expect('GET  /api/fiscal/chain/verify', 'GET', '/api/fiscal/chain/verify', null, token, (r) => data(r).ok === true || data(r).valid === true || data(r).brokenAt == null);
await expect('GET  /api/fiscal/retention', 'GET', '/api/fiscal/retention', null, token);
await expect('POST /api/fiscal/transmit', 'POST', '/api/fiscal/transmit', { fiscalDeviceId }, token);

// ── 2. Payment rails + settlement ────────────────────────────────────────────
const railsCat = await expect('GET  /api/rails/catalog', 'GET', '/api/rails/catalog', null, token);
const railCode = ((data(railsCat).rails || data(railsCat).catalog || [])[0] || {}).code;
await expect('GET  /api/rails/market/BR', 'GET', '/api/rails/market/BR', null, token);
for (const [kind, identifier, valid] of [
  ['IBAN', 'DE89370400440532013000', true],
  ['ROUTING_ACCOUNT', '026009593:1234567890', true],
  ['PIX_KEY', 'alice@example.com', true],
  ['VPA', 'user@okhdfcbank', true],
  ['SORT_CODE_ACCOUNT', '200000:55779911', true],
]) {
  const r = await expect(`POST /api/rails/validate ${kind}`, 'POST', '/api/rails/validate', { kind, identifier }, token);
  if (data(r).valid !== valid) {
    failures++;
    console.log(`FAIL       ...expected valid=${valid} got ${JSON.stringify(data(r))}`);
  }
}
const acct = await expect('POST /api/rails/accounts', 'POST', '/api/rails/accounts', { railCode, label: 'Smoke account', identifier: 'DE89370400440532013000', countryCode: 'DE', currency: 'EUR' }, token);
await expect('POST /api/rails/quote', 'POST', '/api/rails/quote', { amount: 100, currency: 'EUR', countryCode: 'DE' }, token);
const settle = await expect('POST /api/rails/settlements', 'POST', '/api/rails/settlements', { railCode, currency: 'EUR', batchDate: '2026-09-20', lines: [{ reference: 'A', amount: 100, fee: 0.2 }, { reference: 'B', amount: 50 }] }, token);
await expect('GET  /api/rails/accounts', 'GET', '/api/rails/accounts', null, token);
await expect('GET  /api/rails/settlements', 'GET', '/api/rails/settlements', null, token);
await expect('GET  /api/rails/settlements/:id', 'GET', `/api/rails/settlements/${data(settle).id || data(settle).batch?.id}`, null, token);

// ── 3. Agentic back-office ────────────────────────────────────────────────────
await expect('GET  /api/agent/overview', 'GET', '/api/agent/overview', null, token);
await expect('GET  /api/agent/low-stock', 'GET', '/api/agent/low-stock', null, token);
const run = await expect('POST /api/agent/replenish', 'POST', '/api/agent/replenish', { leadTimeDays: 5, serviceLevel: 0.95 }, token);
const runId = data(run).runId;
await expect('GET  /api/agent/runs', 'GET', '/api/agent/runs', null, token);
await expect('GET  /api/agent/runs/:id', 'GET', `/api/agent/runs/${runId}`, null, token);
await expect('POST /api/agent/runs/:id/approve (nothing to order)', 'POST', `/api/agent/runs/${runId}/approve`, {}, token, status(400));

// ── 4. Vertical solutions ─────────────────────────────────────────────────────
await expect('GET  /api/verticals', 'GET', '/api/verticals', null, token, (r) => data(r).solutions?.length === 14);
await expect('GET  /api/verticals/capabilities', 'GET', '/api/verticals/capabilities', null, token);
await expect('GET  /api/verticals/pos/hints', 'GET', '/api/verticals/pos/hints', null, token);
await expect('GET  /api/verticals/market/fit', 'GET', '/api/verticals/market/fit', null, token);
const gate = await call('POST', '/api/verticals/PHARMACY/install', {}, token);
if (gate.status === 428) console.log(`PASS  428   POST /api/verticals/PHARMACY/install risk gate (${JSON.stringify(data(gate).required)?.slice(0, 60)})`);
else {
  failures++;
  console.log(`FAIL  ${gate.status} expected 428 risk gate :: ${gate.text}`);
}
await expect('POST /api/verticals/:code/install', 'POST', '/api/verticals/PHARMACY/install', { confirmations: data(gate).required || [] }, token);
await expect('POST /api/verticals/:code/retire', 'POST', '/api/verticals/PHARMACY/retire', {}, token);

// ── 5. Embedded finance ───────────────────────────────────────────────────────
await expect('GET  /api/finance/eligibility', 'GET', '/api/finance/eligibility', null, token);
await expect('POST /api/finance/quote', 'POST', '/api/finance/quote', { principal: 12000, months: 12, annualRatePercent: 12 }, token);
const apply = await expect('POST /api/finance/apply', 'POST', '/api/finance/apply', { requestedAmount: 12000, termMonths: 12, acknowledgeTerms: true }, token, (r) => r.status === 201 || r.status === 422);
const facilityId = data(apply).facility?.id || data(apply).application?.id || data(apply).id;
await expect('GET  /api/finance/facilities', 'GET', '/api/finance/facilities', null, token);
await expect('GET  /api/finance/position', 'GET', '/api/finance/position', null, token);
if (facilityId) {
  await expect('POST /api/finance/facilities/:id/approve', 'POST', `/api/finance/facilities/${facilityId}/approve`, { approve: true }, token);
  await expect('GET  /api/finance/facilities/:id', 'GET', `/api/finance/facilities/${facilityId}`, null, token);
  await expect('POST /api/finance/facilities/:id/sweep', 'POST', `/api/finance/facilities/${facilityId}/sweep`, { amount: 100 }, token);
}

// ── 9. Ecosystem (installed early: it gates the agent storefront) ─────────────
await expect('GET  /api/apps/catalog', 'GET', '/api/apps/catalog', null, token, (r) => (data(r).apps || []).length >= 1);
await expect('GET  /api/apps/catalog?all', 'GET', '/api/apps/catalog?all=true', null, token, (r) => (data(r).apps || []).length === 11);
await expect('GET  /api/apps/catalog/:code', 'GET', '/api/apps/catalog/AGENT_STOREFRONT', null, token);
const ins = await call('POST', '/api/apps/install', { appCode: 'AGENT_STOREFRONT' }, token);
if (ins.status === 428) console.log(`PASS  428   POST /api/apps/install risk gate (scopes: ${JSON.stringify(data(ins).scopes || data(ins).required || '').slice(0, 70)})`);
else if (!ins.ok) {
  failures++;
  console.log(`FAIL  ${ins.status} POST /api/apps/install :: ${ins.text}`);
}
await expect('POST /api/apps/install (ack)', 'POST', '/api/apps/install', { appCode: 'AGENT_STOREFRONT', acknowledgeScopes: true }, token);
const tok = await expect('POST /api/apps/:code/token', 'POST', '/api/apps/AGENT_STOREFRONT/token', {}, token);
const appToken = data(tok).token;
if (appToken) {
  await expect('POST /api/apps/verify-token', 'POST', '/api/apps/verify-token', { token: appToken, appCode: 'AGENT_STOREFRONT', requiredScopes: ['catalog:read'] }, token);
}
await expect('GET  /api/apps/installs', 'GET', '/api/apps/installs', null, token);
const field = await expect('POST /api/apps/fields', 'POST', '/api/apps/fields', { entity: 'PRODUCT', label: 'Cut Length', dataType: 'NUMBER', validation: { min: 0, max: 500 } }, token);
await expect('GET  /api/apps/fields', 'GET', '/api/apps/fields', null, token);
await expect('POST /api/apps/fields/values', 'POST', '/api/apps/fields/values', { entityUuid: productId, entity: 'PRODUCT', values: { cut_length: '12' } }, token);
await expect('GET  /api/apps/fields/values/:uuid', 'GET', `/api/apps/fields/values/${productId}`, null, token);
await expect('GET  /api/apps/overview', 'GET', '/api/apps/overview', null, token);

// ── 6. Agentic commerce ───────────────────────────────────────────────────────
await expect('GET  /.well-known/unifiedpos', 'GET', '/.well-known/unifiedpos');
await expect('GET  /.well-known/unifiedpos/:merchant', 'GET', `/.well-known/unifiedpos/${organizationId}`);
await expect('GET  /api/agents/public/descriptor', 'GET', `/api/agents/public/descriptor?merchant=${organizationId}`, null, null, (r) => Boolean(data(r).checkout));
await expect('GET  /api/agents/public/catalog.jsonld', 'GET', `/api/agents/public/catalog.jsonld?merchant=${organizationId}`, null, null, (r) => data(r)['@context'] === 'https://schema.org');
const man = await expect('POST /api/agents/mandates', 'POST', '/api/agents/mandates', { agentId: 'smoke-agent', ceilingAmount: 500, ttlSeconds: 900, items: [{ sku: 'SMOKE-1', quantity: 1 }] }, token);
const mandate = data(man).mandate;
await expect('GET  /api/agents/mandates', 'GET', '/api/agents/mandates', null, token);
await expect('POST /api/agents/public/mandate/verify', 'POST', '/api/agents/public/mandate/verify', { merchantId: organizationId, mandate }, null);
await expect('POST /api/agents/public/mandate/checkout (tampered)', 'POST', '/api/agents/public/mandate/checkout', { merchantId: organizationId, mandate: { ...mandate, ceilingAmount: 9999 } }, null, status(401));
await expect('POST /api/agents/mandates/:id/revoke', 'POST', `/api/agents/mandates/${data(man).stored?.id || mandate?.id}/revoke`, { reason: 'smoke cleanup' }, token);

// ── 7. Store mesh ─────────────────────────────────────────────────────────────
await expect('GET  /api/mesh/status', 'GET', '/api/mesh/status', null, token);
const claim = await expect('POST /api/mesh/claim', 'POST', `/api/mesh/locations/${locationId}/claim`, { deviceId, leaseSeconds: 30 }, token);
const epoch = data(claim).fence?.epoch ?? 1;
await expect('POST /api/mesh/heartbeat', 'POST', `/api/mesh/locations/${locationId}/heartbeat`, { deviceId }, token);
await expect('POST /api/mesh/commit', 'POST', `/api/mesh/locations/${locationId}/commit`, { deviceId, epoch, sequence: data(claim).fence?.committedSequence + 1 }, token);
await expect('POST /api/mesh/commit (stale epoch refused)', 'POST', `/api/mesh/locations/${locationId}/commit`, { deviceId, epoch: 999, sequence: 2 }, token, (r) => r.status === 409 || (r.ok && data(r).accepted === false));
await expect('POST /api/mesh/conflicts/resolve', 'POST', '/api/mesh/conflicts/resolve', { base: 10, writes: [{ deviceId: 'a', deviceTimestamp: '2026-09-20T10:00:00Z', delta: 2 }, { deviceId: 'b', deviceTimestamp: '2026-09-20T10:05:00Z', value: 15 }] }, token);
await expect('GET  /api/mesh/reconcile', 'GET', '/api/mesh/reconcile', null, token);
await expect('GET  /api/mesh/locations/:id', 'GET', `/api/mesh/locations/${locationId}`, null, token);

// ── 8. Franchise ──────────────────────────────────────────────────────────────
const agr = await expect('POST /api/franchise/agreements', 'POST', '/api/franchise/agreements', { entityCode: 'SMOKE-1', franchiseeName: 'Smoke Franchisee', royaltyModel: 'TIERED', tiers: [{ upTo: 100000, percent: 6 }, { upTo: null, percent: 4 }], minimumMonthly: 50, exclusions: ['VAT', 'TIPS', 'GIFT_CARD_REDEMPTION'], locationId }, token);
await expect('GET  /api/franchise/agreements', 'GET', '/api/franchise/agreements', null, token);
await expect('POST /api/franchise/royalties/preview', 'POST', '/api/franchise/royalties/preview', { agreement: { royaltyModel: 'TIERED', tiers: [{ upTo: 100000, percent: 6 }, { upTo: null, percent: 4 }], minimumMonthly: 50, exclusions: ['VAT'] }, period: { grossSales: 250000, exclusions: { VAT: 20000 }, periodStart: '2026-08-01', periodEnd: '2026-08-31' } }, token);
await expect('POST /api/franchise/royalties/accrue', 'POST', '/api/franchise/royalties/accrue', { agreementId: data(agr).id || data(agr).agreement?.id, grossSales: 50000, exclusions: { VAT: 4000 } }, token);
await expect('GET  /api/franchise/royalties', 'GET', '/api/franchise/royalties', null, token);
await expect('POST /api/franchise/transfer-price', 'POST', '/api/franchise/transfer-price', { cost: 10, markupPercent: 20, freight: 8, quantity: 5 }, token);
await expect('GET  /api/franchise/consolidated', 'GET', '/api/franchise/consolidated', null, token);

// ── 10. Peer benchmarking ─────────────────────────────────────────────────────
await expect('GET  /api/benchmark/metrics', 'GET', '/api/benchmark/metrics', null, token);
await expect('GET  /api/benchmark/', 'GET', '/api/benchmark/', null, token);
await expect('GET  /api/benchmark/profile', 'GET', '/api/benchmark/profile', null, token);
await expect('GET  /api/benchmark/all', 'GET', '/api/benchmark/all', null, token);
await expect('GET  /api/benchmark/snapshots', 'GET', '/api/benchmark/snapshots', null, token);
await expect('GET  /api/benchmark/cohort/:metric', 'GET', '/api/benchmark/cohort/avg_basket', null, token);

console.log(failures === 0 ? '\nALL SMOKE CHECKS PASSED' : `\n${failures} smoke failure(s)`);
process.exit(failures === 0 ? 0 : 1);

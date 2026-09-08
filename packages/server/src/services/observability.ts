// ─── Observability (§39) ──────────────────────────────────────────────────
// Env-gated so there are zero hard dependencies and zero cost when unused:
//  • Sentry error tracking — initialised only when SENTRY_DSN is set, loaded via
//    a *variable* dynamic import so TypeScript does not require @sentry/node to
//    be installed to compile. Install it (`npm i @sentry/node`) to activate.
//  • Lightweight in-process request metrics rendered in Prometheus text format
//    at GET /api/metrics (optionally token-gated via METRICS_TOKEN).

import { Request, Response, NextFunction } from 'express';

let requestsTotal = 0;
let errorsTotal = 0;
const byClass: Record<string, number> = {};
const startedAt = Date.now();

/** Initialise Sentry if configured. Safe no-op otherwise. */
export async function initObservability(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    // Variable specifier => TS leaves this as a runtime-only dynamic import.
    const moduleName = process.env.SENTRY_MODULE || '@sentry/node';
    const Sentry: any = await import(moduleName);
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
    });
    console.log('[observability] Sentry initialized');
  } catch {
    console.warn('[observability] SENTRY_DSN is set but the Sentry SDK could not be loaded. Run: npm i @sentry/node');
  }
}

/** Report an uncaught error to Sentry (no-op when unconfigured). */
export function captureException(err: unknown): void {
  if (!process.env.SENTRY_DSN) return;
  const moduleName = process.env.SENTRY_MODULE || '@sentry/node';
  import(moduleName).then((S: any) => S.captureException?.(err)).catch(() => { /* ignore */ });
}

/** Counts requests and response status classes. Mount early. */
export function metricsMiddleware(_req: Request, res: Response, next: NextFunction): void {
  requestsTotal++;
  res.on('finish', () => {
    const cls = `${String(res.statusCode)[0]}xx`;
    byClass[cls] = (byClass[cls] || 0) + 1;
    if (res.statusCode >= 500) errorsTotal++;
  });
  next();
}

/** True when the caller is allowed to scrape /metrics. */
export function metricsAuthorized(req: Request): boolean {
  const token = process.env.METRICS_TOKEN;
  if (!token) return true; // no token configured => open (keep it off the public internet)
  const header = req.headers.authorization;
  if (typeof header === 'string' && header === `Bearer ${token}`) return true;
  return req.query.token === token;
}

// ─── Money-path + offline-sync counters (§39) ─────────────────────────────
// In-process, dependency-free counters for the events that matter most to a
// payments business (authorisations/captures/refunds + settled volume) and the
// offline sync pipeline. Surfaced in Prometheus text at /api/metrics and as a
// JSON snapshot for the observability dashboard.

let paymentsTotal = 0;
let paymentFailuresTotal = 0;
let capturesTotal = 0;
let refundsTotal = 0;
let settledVolumeCents = 0;
let refundedVolumeCents = 0;
let syncReceivedTotal = 0;
let syncAppliedTotal = 0;
let syncFailedTotal = 0;
const paymentsByMethod: Record<string, number> = {};
const paymentsByOutcome: Record<string, number> = {};

export type PaymentOutcome = 'succeeded' | 'failed' | 'captured' | 'refunded';

/**
 * Record a payment-provider outcome and (optionally) its volume in minor units
 * (cents). Call from the gateway/charge/refund/capture paths so the money flow
 * is observable without adding a metrics dependency.
 */
export function recordPayment(
  outcome: PaymentOutcome,
  opts: { method?: string; amountCents?: number } = {}
): void {
  paymentsTotal++;
  const method = (opts.method || 'unknown').toUpperCase();
  paymentsByMethod[method] = (paymentsByMethod[method] || 0) + 1;
  paymentsByOutcome[outcome] = (paymentsByOutcome[outcome] || 0) + 1;
  if (outcome === 'failed') paymentFailuresTotal++;
  if (outcome === 'captured') capturesTotal++;
  if (outcome === 'refunded') refundsTotal++;
  const cents = Number.isFinite(opts.amountCents) ? Math.round(opts.amountCents as number) : 0;
  if (cents > 0) {
    if (outcome === 'succeeded' || outcome === 'captured') settledVolumeCents += cents;
    if (outcome === 'refunded') refundedVolumeCents += cents;
  }
}

export type SyncOutcome = 'received' | 'applied' | 'failed';

/** Record offline-sync transaction outcomes (batch-friendly via `count`). */
export function recordSync(outcome: SyncOutcome, count = 1): void {
  const n = Math.max(1, Math.round(count));
  if (outcome === 'received') syncReceivedTotal += n;
  else if (outcome === 'applied') syncAppliedTotal += n;
  else if (outcome === 'failed') syncFailedTotal += n;
}

// ─── Alert thresholds (§39) ───────────────────────────────────────────────
// Evaluated on each /api/metrics scrape and in /api/system/observability. A
// rule "fires" when its metric breaches an env-tunable threshold, so ops can
// tighten limits without a code change and point Alertmanager at pos_alert{}.

export interface AlertRule {
  name: string;
  help: string;
  threshold: number;
  /** 'gte' fires when value >= threshold; 'rate' fires when value/denominator >= threshold. */
  op: 'gte' | 'rate';
  value: () => number;
  denominator?: () => number;
}

export interface FiringAlert {
  name: string;
  help: string;
  value: number;
  threshold: number;
}

function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

/** The active alert rules with their (env-tunable) thresholds. */
export function getAlertRules(): AlertRule[] {
  return [
    { name: 'payment_failures', help: 'Failed payment attempts reached the threshold.', op: 'gte', threshold: envNum('ALERT_PAYMENT_FAILURES', 5), value: () => paymentFailuresTotal },
    { name: 'payment_failure_rate', help: 'Share of failed payments is above the threshold.', op: 'rate', threshold: envNum('ALERT_PAYMENT_FAILURE_RATE', 0.2), value: () => paymentFailuresTotal, denominator: () => paymentsTotal },
    { name: 'sync_failures', help: 'Offline-sync failures reached the threshold.', op: 'gte', threshold: envNum('ALERT_SYNC_FAILURES', 10), value: () => syncFailedTotal },
    { name: 'http_5xx', help: 'Server 5xx responses reached the threshold.', op: 'gte', threshold: envNum('ALERT_HTTP_5XX', 10), value: () => errorsTotal },
  ];
}

/** Evaluate all rules and return those currently firing. */
export function evaluateAlerts(): FiringAlert[] {
  const firing: FiringAlert[] = [];
  for (const rule of getAlertRules()) {
    if (rule.op === 'gte') {
      const v = rule.value();
      if (v >= rule.threshold) firing.push({ name: rule.name, help: rule.help, value: v, threshold: rule.threshold });
    } else {
      const denom = rule.denominator ? rule.denominator() : 0;
      if (denom > 0) {
        const ratio = rule.value() / denom;
        if (ratio >= rule.threshold) firing.push({ name: rule.name, help: rule.help, value: Number(ratio.toFixed(4)), threshold: rule.threshold });
      }
    }
  }
  return firing;
}

/** JSON snapshot of counters + firing alerts for the observability dashboard. */
export function getMetricsSnapshot() {
  return {
    uptimeSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
    http: { requestsTotal, errorsTotal, byClass: { ...byClass } },
    payments: {
      total: paymentsTotal,
      failures: paymentFailuresTotal,
      captures: capturesTotal,
      refunds: refundsTotal,
      settledVolumeCents,
      refundedVolumeCents,
      byMethod: { ...paymentsByMethod },
      byOutcome: { ...paymentsByOutcome },
    },
    sync: { received: syncReceivedTotal, applied: syncAppliedTotal, failed: syncFailedTotal },
    alerts: evaluateAlerts(),
  };
}

/** Render metrics in Prometheus text exposition format. */
export function renderMetrics(): string {
  const mem = process.memoryUsage();
  const uptime = ((Date.now() - startedAt) / 1000).toFixed(1);
  const lines: string[] = [
    '# HELP pos_http_requests_total Total HTTP requests received.',
    '# TYPE pos_http_requests_total counter',
    `pos_http_requests_total ${requestsTotal}`,
    '# HELP pos_http_errors_total Total 5xx responses.',
    '# TYPE pos_http_errors_total counter',
    `pos_http_errors_total ${errorsTotal}`,
  ];
  for (const [cls, n] of Object.entries(byClass)) {
    lines.push(`pos_http_responses_by_class{class="${cls}"} ${n}`);
  }

  // Money path
  lines.push(
    '# HELP pos_payments_total Total payment-provider calls.',
    '# TYPE pos_payments_total counter',
    `pos_payments_total ${paymentsTotal}`,
    '# HELP pos_payment_failures_total Total failed payment attempts.',
    '# TYPE pos_payment_failures_total counter',
    `pos_payment_failures_total ${paymentFailuresTotal}`,
    '# HELP pos_captures_total Total manual captures.',
    '# TYPE pos_captures_total counter',
    `pos_captures_total ${capturesTotal}`,
    '# HELP pos_refunds_total Total refunds issued.',
    '# TYPE pos_refunds_total counter',
    `pos_refunds_total ${refundsTotal}`,
    '# HELP pos_settled_volume_cents Settled volume in minor units.',
    '# TYPE pos_settled_volume_cents counter',
    `pos_settled_volume_cents ${settledVolumeCents}`,
    '# HELP pos_refunded_volume_cents Refunded volume in minor units.',
    '# TYPE pos_refunded_volume_cents counter',
    `pos_refunded_volume_cents ${refundedVolumeCents}`
  );
  for (const [method, n] of Object.entries(paymentsByMethod)) {
    lines.push(`pos_payments_by_method{method="${method}"} ${n}`);
  }
  for (const [outcome, n] of Object.entries(paymentsByOutcome)) {
    lines.push(`pos_payments_by_outcome{outcome="${outcome}"} ${n}`);
  }

  // Offline sync pipeline
  lines.push(
    '# HELP pos_sync_received_total Offline-sync transactions received.',
    '# TYPE pos_sync_received_total counter',
    `pos_sync_received_total ${syncReceivedTotal}`,
    '# HELP pos_sync_applied_total Offline-sync transactions applied.',
    '# TYPE pos_sync_applied_total counter',
    `pos_sync_applied_total ${syncAppliedTotal}`,
    '# HELP pos_sync_failed_total Offline-sync transactions that failed to apply.',
    '# TYPE pos_sync_failed_total counter',
    `pos_sync_failed_total ${syncFailedTotal}`
  );

  // Alert firing state (1 = firing, 0 = ok)
  const firing = new Set(evaluateAlerts().map((a) => a.name));
  lines.push('# HELP pos_alert Alert firing state (1=firing, 0=ok).', '# TYPE pos_alert gauge');
  for (const rule of getAlertRules()) {
    lines.push(`pos_alert{name="${rule.name}"} ${firing.has(rule.name) ? 1 : 0}`);
  }

  lines.push(
    '# HELP pos_uptime_seconds Process uptime in seconds.',
    '# TYPE pos_uptime_seconds gauge',
    `pos_uptime_seconds ${uptime}`,
    `pos_memory_rss_bytes ${mem.rss}`,
    `pos_memory_heap_used_bytes ${mem.heapUsed}`
  );
  return lines.join('\n') + '\n';
}

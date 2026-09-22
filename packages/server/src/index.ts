import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import inventoryRoutes from './routes/inventory.js';
import productRoutes from './routes/products.js';
import orderRoutes from './routes/orders.js';
import reportRoutes from './routes/reports.js';
import settingsRoutes from './routes/settings.js';
import locationRoutes from './routes/locations.js';
import registerRoutes from './routes/registers.js';
import customerRoutes from './routes/customers.js';
import auditRoutes from './routes/audit.js';
import receiptRoutes from './routes/receipts.js';
import webhookRoutes from './routes/webhooks.js';
import loyaltyRoutes from './routes/loyalty.js';
import restaurantRoutes from './routes/restaurant.js';
import accountingRoutes from './routes/accounting.js';
import employeeRoutes from './routes/employees.js';
import supplierRoutes from './routes/suppliers.js';
import purchasingRoutes from './routes/purchasing.js';
import aiRoutes from './routes/ai.js';
import developerRoutes from './routes/developer.js';
import systemRoutes from './routes/system.js';
import paymentRoutes from './routes/payments.js';
import inventoryOpsRoutes from './routes/inventory-ops.js';
import marketingRoutes from './routes/marketing.js';
import copilotRoutes from './routes/copilot.js';
import enterpriseRoutes from './routes/enterprise.js';
import retailRoutes from './routes/retail.js';
import permissionsRoutes from './routes/permissions.js';
import devicesRoutes from './routes/devices.js';
import commerceRoutes from './routes/commerce.js';
import catalogRoutes from './routes/catalog.js';
import syncRoutes from './routes/sync.js';
import notificationRoutes from './routes/notifications.js';
import complianceRoutes from './routes/compliance.js';
import fraudRoutes from './routes/fraud.js';
import paymentLinkRoutes from './routes/paymentLinks.js';
import restaurantExtRoutes from './routes/restaurantExt.js';
import publicOrderingRoutes from './routes/publicOrdering.js';
import realtimeRoutes from './routes/realtime.js';
import pushRoutes from './routes/push.js';
import aiAnalyticsRoutes from './routes/aiAnalytics.js';
import mediaRoutes from './routes/media.js';
// ─── Global-expansion subsystems (fiscal, rails, agent ops, verticals, finance,
// agentic commerce, mesh, franchise, ecosystem, benchmarking) ───
import fiscalRoutes from './routes/fiscal.js';
import railsRoutes from './routes/rails.js';
import agentOpsRoutes from './routes/agentOps.js';
import verticalsRoutes from './routes/verticals.js';
import financeRoutes from './routes/finance.js';
import agentsRoutes from './routes/agents.js';
import meshRoutes from './routes/mesh.js';
import franchiseRoutes from './routes/franchise.js';
import appsRoutes from './routes/apps.js';
import benchmarkRoutes from './routes/benchmark.js';
import wellKnownRoutes from './routes/wellKnown.js';
import { requestLogger, errorLogger } from './middleware/logger.js';
import { apiRateLimiter, authRateLimiter, paymentRateLimiter } from './middleware/rateLimiter.js';
import { idempotencyMiddleware } from './middleware/idempotency.js';
import { prisma } from './db/client.js';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { csrfProtection } from './middleware/csrf.js';
import { stripeWebhookHandler } from './routes/paymentWebhooks.js';
import { initObservability, metricsMiddleware, renderMetrics, metricsAuthorized, captureException } from './services/observability.js';
import { reviewProductionConfig, formatConfigReview, strictProdConfig } from './services/productionConfig.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';
import { registerAllJobs } from './services/scheduledJobs.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;

// Initialise error tracking (Sentry) when SENTRY_DSN is configured. No-op otherwise.
initObservability().catch(() => { /* non-fatal */ });

// Consolidated production-configuration review (§37 hardening). Logs every gap an
// operator must close before go-live; under STRICT_PROD_CONFIG=true a production
// boot with any `error`-severity finding refuses to start rather than silently
// degrading (e.g. no email provider, a CORS wildcard, a placeholder secret).
{
  const review = reviewProductionConfig();
  const report = formatConfigReview(review);
  if (review.findings.some((f) => f.severity === 'error')) {
    console.error(report);
  } else if (review.findings.length > 0) {
    console.warn(report);
  } else {
    console.log(report);
  }
  if (!review.ok && strictProdConfig()) {
    console.error('[config] STRICT_PROD_CONFIG=true and the production configuration review failed — aborting startup.');
    process.exit(1);
  }
}

// Behind a load balancer / reverse proxy (Docker, Cloud Run, nginx): trust the
// first proxy hop so req.ip and rate limiting see the real client address.
app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || 1 : 1);
app.disable('x-powered-by');

// Security headers (§37). CSP allows data:/blob: images because Settings branding
// stores base64 logos. Set DISABLE_CSP=true to tune the policy yourself.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy:
      process.env.DISABLE_CSP === 'true'
        ? false
        : {
            useDefaults: true,
            directives: {
              defaultSrc: ["'self'"],
              // js.stripe.com is allowed so Stripe Elements can load for card
              // checkout when the PSP is enabled (harmless when it is not).
              scriptSrc: ["'self'", 'https://js.stripe.com'],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'blob:'],
              fontSrc: ["'self'", 'data:'],
              connectSrc: ["'self'", 'https://api.stripe.com'],
              frameSrc: ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'],
              objectSrc: ["'none'"],
              frameAncestors: ["'self'"],
            },
          },
  })
);

// gzip response compression (a reverse proxy/CDN can also handle this).
app.use(compression());

// CORS — comma-separated allow-list so multiple frontends/regions are supported.
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin / server-to-server requests (no Origin header).
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      const err = new Error('Origin not allowed by CORS') as Error & { status?: number };
      err.status = 403;
      return callback(err);
    },
    credentials: true,
  })
);

// Stripe webhooks need the RAW body for HMAC signature verification, so this
// route is mounted BEFORE the global JSON body parser below.
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookHandler);

app.use(express.json({ limit: '12mb' })); // Raised limit: Settings branding stores base64 logo/media uploads
app.use(cookieParser()); // Parse cookies so the httpOnly session + CSRF cookies are readable (§37)
app.use(requestLogger); // Structured request logging (§39)
app.use(metricsMiddleware); // In-process request metrics (§39) — exposed at /api/metrics
app.use(apiRateLimiter); // Global rate limiting (§37)
app.use(idempotencyMiddleware()); // Idempotency for POST/PUT/PATCH (§36)
app.use(csrfProtection); // Double-submit-cookie CSRF guard for cookie-authenticated writes (§37)

// Routes — every router is mounted at BOTH /api/* and the §28 versioned alias
// /api/v1/* (non-breaking: existing /api/* clients keep working unchanged, while
// integrators can pin to /api/v1). Per-route security middleware (auth brute-force
// + payment abuse limiters) is mirrored on both prefixes.
const routeTable: { path: string; stack: any[] }[] = [
  { path: '/auth', stack: [authRateLimiter, authRoutes] }, // stricter limit to blunt brute-force (§37)
  { path: '/inventory', stack: [inventoryRoutes] },
  { path: '/products', stack: [productRoutes] },
  { path: '/orders', stack: [orderRoutes] },
  { path: '/reports', stack: [reportRoutes] },
  { path: '/settings', stack: [settingsRoutes] },
  { path: '/locations', stack: [locationRoutes] },
  { path: '/registers', stack: [registerRoutes] },
  { path: '/customers', stack: [customerRoutes] },
  { path: '/audit', stack: [auditRoutes] },
  { path: '/receipts', stack: [receiptRoutes] },
  { path: '/webhooks', stack: [webhookRoutes] },
  { path: '/loyalty', stack: [loyaltyRoutes] },
  { path: '/restaurant', stack: [restaurantRoutes] },
  { path: '/restaurant', stack: [restaurantExtRoutes] }, // §17 QR tokens / catering / food-cost (fall-through)
  { path: '/accounting', stack: [accountingRoutes] },
  { path: '/employees', stack: [employeeRoutes] },
  { path: '/suppliers', stack: [supplierRoutes] },
  { path: '/purchasing', stack: [purchasingRoutes] },
  { path: '/ai', stack: [aiRoutes] },
  { path: '/ai', stack: [aiAnalyticsRoutes] }, // §AI depth: forecast / anomalies / RFM segments (fall-through)
  { path: '/developer', stack: [developerRoutes] },
  { path: '/system', stack: [systemRoutes] },
  { path: '/payments', stack: [paymentRateLimiter, paymentRoutes] }, // stricter limit on payment endpoints (§37)
  { path: '/inventory-ops', stack: [inventoryOpsRoutes] },
  { path: '/marketing', stack: [marketingRoutes] },
  { path: '/copilot', stack: [copilotRoutes] },
  { path: '/enterprise', stack: [enterpriseRoutes] },
  { path: '/retail', stack: [retailRoutes] },
  { path: '/permissions', stack: [permissionsRoutes] },
  { path: '/devices', stack: [devicesRoutes] },
  { path: '/commerce', stack: [commerceRoutes] },
  { path: '/catalog', stack: [catalogRoutes] },
  { path: '/sync', stack: [syncRoutes] },
  { path: '/notifications', stack: [notificationRoutes] }, // §5 Notification domain
  { path: '/compliance', stack: [complianceRoutes] }, // Privacy / GDPR / CCPA / PCI-DSS compliance center
  { path: '/fraud', stack: [fraudRoutes] }, // §37 fraud alert queue
  { path: '/payment-links', stack: [paymentLinkRoutes] }, // §9 payment links (+ public checkout)
  { path: '/public', stack: [publicOrderingRoutes] }, // §17 public guest QR ordering (no auth)
  { path: '/realtime', stack: [realtimeRoutes] }, // Real-time SSE stream (eventBus bridge)
  { path: '/push', stack: [pushRoutes] }, // Web Push (VAPID) subscriptions
  { path: '/media', stack: [mediaRoutes] }, // Media asset library (S3/DB adapter)
  { path: '/fiscal', stack: [fiscalRoutes] }, // Fiscalisation: devices, hash-chain seals, verification
  { path: '/rails', stack: [paymentRateLimiter, railsRoutes] }, // Local payment rails + settlement reconciliation
  { path: '/agent', stack: [agentOpsRoutes] }, // Agentic back-office: replenishment plans awaiting approval
  { path: '/verticals', stack: [verticalsRoutes] }, // Vertical solution manifests + install/retire
  { path: '/finance', stack: [financeRoutes] }, // Embedded finance: underwriting, facilities, sweeps
  { path: '/agents', stack: [paymentRateLimiter, agentsRoutes] }, // Agentic commerce: mandates + public machine surface
  { path: '/mesh', stack: [meshRoutes] }, // Store mesh: leader election + fencing tokens
  { path: '/franchise', stack: [franchiseRoutes] }, // Royalties, transfer pricing, consolidated P&L
  { path: '/apps', stack: [appsRoutes] }, // Ecosystem: partner apps, scopes, custom fields
  { path: '/benchmark', stack: [benchmarkRoutes] }, // Peer benchmarking (k-anonymous, noised)
];
for (const r of routeTable) {
  app.use(`/api${r.path}`, ...r.stack);
  app.use(`/api/v1${r.path}`, ...r.stack); // §28 versioned public API alias
}

// Machine-facing discovery documents for buying agents (RFC 8615).
app.use('/.well-known', wellKnownRoutes);

// Liveness probe — process is up.
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Prometheus-style metrics (token-gated when METRICS_TOKEN is set).
app.get('/api/metrics', (req, res) => {
  if (!metricsAuthorized(req)) {
    res.status(401).set('Content-Type', 'text/plain').send('Unauthorized\n');
    return;
  }
  res.status(200).set('Content-Type', 'text/plain; version=0.0.4').send(renderMetrics());
});

// Readiness probe — verifies the database before traffic is routed in.
app.get('/api/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'unavailable', reason: 'database' });
  }
});

// Any unmatched /api route returns JSON (never the SPA shell).
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Serve the built SPA when present (single-container deploy). Set WEB_DIST to the
// folder holding the Vite build output; defaults to ../web/dist.
const webDist = process.env.WEB_DIST || path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  // SPA history fallback: send index.html for any non-API GET.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
  console.log(`Serving SPA from ${webDist}`);
}

// Error handler
app.use((err: Error & { status?: number }, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  errorLogger(err, req, res, _next);
  captureException(err);
  console.error('Unhandled error:', err);
  const status = err.status || 500;
  res.status(status).json({ success: false, message: status === 500 ? 'Internal server error' : err.message });
});

const server = app.listen(PORT, () => {
  console.log(`POS Server listening on port ${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
  // Start background jobs (§19 campaigns, §10 payouts, §29 webhook retry, §37
  // retention purge, expiry + reconciliation) once HTTP is accepting traffic.
  registerAllJobs();
  startScheduler();
});

// Graceful shutdown — stop accepting connections, drain, then close the DB pool.
function shutdown(signal: string) {
  console.log(`\n${signal} received — shutting down gracefully...`);
  stopScheduler(); // stop background jobs before draining connections
  server.close(async () => {
    try {
      await prisma.$disconnect();
    } finally {
      console.log('Closed HTTP server and database connections.');
      process.exit(0);
    }
  });
  // Force-exit if connections do not drain in time.
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000).unref();
}

['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => shutdown(sig)));

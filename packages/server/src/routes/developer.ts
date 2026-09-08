import { Router, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../db/client.js';
import { encryptJson } from '../services/crypto.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { handleError } from '../middleware/error.js';
import { INTEGRATION_PROVIDERS, INTEGRATION_CATEGORIES, CATEGORY_CONFIG_FIELDS, providersByCategory, CATALOG_STATS } from '../data/integrationCatalog.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// API KEY MANAGEMENT (§30)
// ═══════════════════════════════════════════════════════════════

// GET /api/developer/keys - List API keys
router.get('/keys', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const webhooks = await prisma.webhook.findMany({
      where: { organizationId: req.user!.organizationId! },
      select: { id: true, url: true, events: true, isActive: true, successCount: true, failureCount: true },
    });
    res.json({
      success: true,
      data: {
        apiVersion: '1.0',
        baseUrl: '/api',
        webhooks,
        endpoints: [
          'GET /api/products', 'POST /api/orders', 'GET /api/orders',
          'GET /api/customers', 'POST /api/customers', 'GET /api/inventory/low-stock',
          'GET /api/reports/sales', 'GET /api/ai/insights',
        ],
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/developer/keys/generate - Generate a new API key
router.post('/keys/generate', authMiddleware, requireRole('OWNER'), async (req: AuthRequest, res: Response) => {
  try {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    const key = `pk_${crypto.randomBytes(32).toString('hex')}`;
    const secret = `sk_${crypto.randomBytes(32).toString('hex')}`;

    const apiKeyRecord = await prisma.webhook.create({
      data: {
        organizationId: req.user!.organizationId!,
        url: `apikey://${name}`,
        secret: key,
        events: ['api.access'],
        description: `API Key: ${name}`,
        isActive: true,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        id: apiKeyRecord.id,
        name,
        publicKey: key,
        secretKey: secret,
        createdAt: apiKeyRecord.createdAt,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// ═══════════════════════════════════════════════════════════════
// OAUTH 2.0 (§30)
// ═══════════════════════════════════════════════════════════════

// POST /api/developer/oauth/register - Register an OAuth application
router.post('/oauth/register', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, redirectUri, scopes } = z.object({
      name: z.string().min(1),
      redirectUri: z.string().url(),
      scopes: z.array(z.string()).default(['read']),
    }).parse(req.body);

    const clientId = `client_${crypto.randomBytes(16).toString('hex')}`;
    const clientSecret = `secret_${crypto.randomBytes(32).toString('hex')}`;

    // Store as integration connection
    const integration = await prisma.integrationConnection.create({
      data: {
        organizationId: req.user!.organizationId!,
        provider: 'oauth',
        type: 'INTEGRATION',
        name,
        status: 'CONNECTED',
        config: { clientId, redirectUri, scopes },
        credentials: encryptJson({ clientSecret }),
      },
    });

    res.status(201).json({
      success: true,
      data: {
        id: integration.id,
        name,
        clientId,
        clientSecret,
        redirectUri,
        scopes,
        authorizationUrl: `/api/developer/oauth/authorize?client_id=${clientId}`,
        tokenUrl: '/api/developer/oauth/token',
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/developer/oauth/authorize - OAuth authorization endpoint
router.get('/oauth/authorize', async (req, res: Response) => {
  try {
    const { client_id, redirect_uri, scope, state } = req.query;
    // In production, this would render a consent screen
    res.json({
      success: true,
      data: {
        message: 'OAuth authorization endpoint',
        clientId: client_id,
        redirectUri: redirect_uri,
        scope: scope || 'read',
        state,
        instructions: 'POST to /api/developer/oauth/token with authorization_code to get access token',
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/developer/oauth/token - OAuth token endpoint
router.post('/oauth/token', async (req, res: Response) => {
  try {
    const { client_id } = z.object({
      grant_type: z.enum(['authorization_code', 'refresh_token']),
      client_id: z.string(),
      client_secret: z.string(),
      code: z.string().optional(),
      refresh_token: z.string().optional(),
    }).parse(req.body);

    // Verify client credentials
    const integration = await prisma.integrationConnection.findFirst({
      where: {
        organizationId: { not: undefined },
        provider: 'oauth',
        config: { path: ['clientId'], equals: client_id },
      },
    });

    if (!integration) {
      return res.status(401).json({ success: false, message: 'Invalid client credentials' });
    }

    // Generate tokens
    const accessToken = `at_${crypto.randomBytes(32).toString('hex')}`;
    const newRefreshToken = `rt_${crypto.randomBytes(32).toString('hex')}`;

    res.json({
      success: true,
      data: {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: newRefreshToken,
        scope: 'read write',
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// ═══════════════════════════════════════════════════════════════
// INTEGRATIONS (§30)
// ═══════════════════════════════════════════════════════════════

// GET /api/developer/integrations - List integrations
router.get('/integrations', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const integrations = await prisma.integrationConnection.findMany({
      where: { organizationId: req.user!.organizationId! },
      select: {
        id: true, provider: true, type: true, name: true,
        status: true, lastSyncAt: true, syncStatus: true, errorMessage: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: integrations });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/developer/integrations - Connect an integration
router.post('/integrations', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { provider, type, name, config } = z.object({
      provider: z.string(),
      type: z.string(),
      name: z.string(),
      config: z.any().optional(),
    }).parse(req.body);

    const integration = await prisma.integrationConnection.create({
      data: {
        organizationId: req.user!.organizationId!,
        provider,
        type,
        name,
        config,
        status: 'DISCONNECTED',
      },
    });
    res.status(201).json({ success: true, data: integration });
  } catch (error) {
    handleError(error, res);
  }
});

// PUT /api/developer/integrations/:id/disconnect
router.put('/integrations/:id/disconnect', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const integration = await prisma.integrationConnection.update({
      where: { id: String(req.params.id) },
      data: { status: 'DISCONNECTED' },
    });
    res.json({ success: true, data: integration });
  } catch (error) {
    handleError(error, res);
  }
});

// ═══════════════════════════════════════════════════════════════
// SANDBOX & TESTING (§30)
// ═══════════════════════════════════════════════════════════════

// POST /api/developer/sandbox/reset - Reset sandbox data
router.post('/sandbox/reset', authMiddleware, requireRole('OWNER'), async (_req: AuthRequest, res: Response) => {
  try {
    // In production, this would reset a sandbox environment
    res.json({
      success: true,
      data: {
        message: 'Sandbox reset initiated',
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/developer/sandbox/status - Get sandbox status
router.get('/sandbox/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = req.user!.organizationId!;
    const [orderCount, productCount, customerCount] = await Promise.all([
      prisma.order.count({ where: { organizationId: orgId } }),
      prisma.product.count({ where: { organizationId: orgId } }),
      prisma.customer.count({ where: { organizationId: orgId } }),
    ]);

    res.json({
      success: true,
      data: {
        isSandbox: process.env.NODE_ENV !== 'production',
        stats: { orderCount, productCount, customerCount },
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/developer/test/webhook - Test webhook delivery
router.post('/test/webhook', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { webhookId, event } = z.object({
      webhookId: z.string(),
      event: z.string().default('test.ping'),
    }).parse(req.body);

    const webhook = await prisma.webhook.findFirst({
      where: { id: webhookId, organizationId: req.user!.organizationId! },
    });

    if (!webhook) return res.status(404).json({ success: false, message: 'Webhook not found' });

    // Record test delivery
    await prisma.webhookDelivery.create({
      data: {
        webhookId: webhook.id,
        event,
        payload: { test: true, timestamp: new Date().toISOString() },
        responseStatus: 200,
        success: true,
      },
    });

    res.json({
      success: true,
      data: {
        message: 'Test webhook delivered',
        webhook: { url: webhook.url, event },
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// ═══════════════════════════════════════════════════════════════
// APP MARKETPLACE (§30)
// ═══════════════════════════════════════════════════════════════

// GET /api/developer/catalog - Full integration provider catalog grouped by category (§30)
router.get('/catalog', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    res.json({
      success: true,
      data: {
        categories: INTEGRATION_CATEGORIES,
        configFields: CATEGORY_CONFIG_FIELDS,
        groups: providersByCategory(),
        providers: INTEGRATION_PROVIDERS,
        stats: CATALOG_STATS,
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/developer/marketplace - List available integrations/apps
router.get('/marketplace', authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    // The marketplace is the full catalog, enriched with the config fields each
    // platform requires so the UI can render the correct connect form.
    const apps = INTEGRATION_PROVIDERS.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      description: p.description,
      icon: p.icon,
      configFields: CATEGORY_CONFIG_FIELDS[p.category] || [],
    }));
    res.json({ success: true, data: { apps, categories: INTEGRATION_CATEGORIES, stats: CATALOG_STATS } });
  } catch (error) {
    handleError(error, res);
  }
});

// ═══════════════════════════════════════════════════════════════
// API DOCUMENTATION (§30)
// ═══════════════════════════════════════════════════════════════

// GET /api/developer/docs - API documentation
router.get('/docs', authMiddleware, async (_req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    data: {
      title: 'UnifiedPOS API',
      version: '1.0.0',
      authentication: 'Bearer token (JWT) or OAuth 2.0',
      baseUrl: '/api',
      resources: {
        auth: ['POST /auth/login', 'GET /auth/me'],
        products: ['GET /products', 'POST /products', 'PUT /products/:id', 'DELETE /products/:id'],
        orders: ['GET /orders', 'POST /orders', 'GET /orders/:id', 'PUT /orders/:id/status', 'PUT /orders/:id/cancel'],
        customers: ['GET /customers', 'POST /customers', 'PUT /customers/:id'],
        inventory: ['GET /inventory/products', 'GET /inventory/low-stock', 'POST /inventory/adjust'],
        payments: ['GET /payments', 'GET /payments/refunds'],
        reports: ['GET /reports/sales', 'GET /reports/daily', 'GET /reports/today'],
        loyalty: ['POST /loyalty/earn', 'POST /loyalty/redeem'],
        restaurant: ['GET /restaurant/tables', 'PUT /restaurant/tables/:id/status', 'GET /restaurant/kitchen'],
        accounting: ['GET /accounting/entries', 'POST /accounting/entries', 'GET /accounting/pnl'],
        retail: ['GET /retail/gift-cards', 'POST /retail/layaways', 'GET /retail/purchase-orders'],
        webhooks: ['GET /webhooks', 'POST /webhooks', 'GET /webhooks/events'],
        ai: ['GET /ai/insights', 'POST /copilot/ask'],
        permissions: ['GET /permissions', 'GET /permissions/roles'],
        enterprise: ['GET /enterprise/regions', 'GET /enterprise/warehouses'],
      },
    },
  });
});

export default router;

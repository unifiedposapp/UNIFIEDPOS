// ─── /.well-known: the landing page a buying agent reads before it shops ─────
// An agent cannot guess which of a thousand merchants on this platform speaks its
// language. The platform document says "UnifiedPOS merchants speak mandate/1 and
// here is how to ask one"; the per-merchant document is the signed answer a
// specific storefront publishes, and it only exists once the merchant installs
// the agent storefront. Nothing here is authenticated, so nothing here leaks:
// only public catalogue facts and the rules of the protocol.

import { Router, Response } from 'express';
import { prisma } from '../db/client.js';
import { handleError } from '../middleware/error.js';
import { requestUrlBase } from '../utils/requestUrl.js';
import { MANDATE_SPEC_VERSION, AGENT_SIGNATURE_ALG, MAX_MANDATE_LINES, MAX_MANDATE_TTL_SECONDS, agentDescriptor } from '../services/agenticCommerce.js';
import { ALL_SCOPES } from '../data/appCatalog.js';
import { BENCHMARK_METRIC_KEYS } from '../services/benchmark.js';
import { FISCAL_PROFILES } from '../data/fiscalProfiles.js';
import { RAILS, railsForCountry } from '../data/paymentRails.js';
import { VERTICAL_SOLUTIONS } from '../data/verticalSolutions.js';

const router = Router();

// GET /.well-known/unifiedpos - platform capability statement for agents
router.get('/unifiedpos', (_req, res: Response) => {
  try {
    res.json({
      success: true,
      data: {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'UnifiedPOS agent commerce endpoint',
        specification: MANDATE_SPEC_VERSION,
        signatureAlgorithm: AGENT_SIGNATURE_ALG,
        mandate: { maxTtlSeconds: MAX_MANDATE_TTL_SECONDS, maxLines: MAX_MANDATE_LINES },
        // How an agent finds a merchant and what it may then call.
        discovery: {
          merchantDescriptor: '/.well-known/unifiedpos/{merchantId}',
          catalog: '/api/agents/public/catalog.jsonld?merchant={merchantId}',
          verify: '/api/agents/public/mandate/verify',
          checkout: '/api/agents/public/mandate/checkout',
        },
        coverage: {
          fiscalRegimes: FISCAL_PROFILES.length,
          paymentRails: RAILS.length,
          verticals: VERTICAL_SOLUTIONS.length,
          partnerScopes: ALL_SCOPES.length,
          benchmarkMetrics: BENCHMARK_METRIC_KEYS.length,
        },
        rules: [
          'A merchant only answers agents after installing the AGENT_STOREFRONT app.',
          'Every purchase needs a signed mandate with a ceiling; nothing is sold on a user-agent string.',
          'A mandate is single-use: its nonce is retired the moment it is spent.',
        ],
      },
    });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /.well-known/unifiedpos/:merchantId - one storefront's own declaration
router.get('/unifiedpos/:merchantId', async (req, res: Response) => {
  try {
    const merchantId = String(req.params.merchantId);
    const org = await prisma.organization.findFirst({
      where: { id: merchantId, isActive: true },
      select: { id: true, name: true, currency: true, countryCode: true },
    });
    if (!org) return res.status(404).json({ success: false, message: 'Unknown merchant' });
    const install = await prisma.appInstallation.findFirst({ where: { organizationId: org.id, appCode: 'AGENT_STOREFRONT', status: 'INSTALLED' } });
    if (!install) return res.status(404).json({ success: false, message: 'This merchant does not publish an agent storefront' });
    const rails = railsForCountry(org.countryCode);
    res.json({
      success: true,
      data: agentDescriptor({
        merchantName: org.name,
        merchantId: org.id,
        baseUrl: requestUrlBase(req),
        countryCode: org.countryCode,
        currency: org.currency,
        paymentMethods: rails.length ? rails.map((rail) => rail.code) : ['CARD', 'CASH', 'BANK_TRANSFER'],
      }),
    });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;

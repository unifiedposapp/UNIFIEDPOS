// ─── PARTNER APP CATALOG + SCOPE TABLE ───────────────────────────────────────
// An ecosystem is only safe if the scopes are honest: an app that synchronises
// gift cards has no business reading payroll. Each catalog entry declares the
// minimum it needs, and installation grants exactly that list — nothing broader,
// revocable per app.
export type AppScope =
  | 'read:orders'
  | 'write:orders'
  | 'refund:orders'
  | 'read:products'
  | 'write:products'
  | 'read:inventory'
  | 'write:inventory'
  | 'read:customers'
  | 'write:customers'
  | 'read:loyalty'
  | 'write:loyalty'
  | 'read:payments'
  | 'refund:payments'
  | 'read:reports'
  | 'read:staff'
  | 'write:staff'
  | 'read:settings'
  | 'write:settings'
  | 'read:custom_fields'
  | 'write:custom_fields'
  | 'webhook:subscribe'
  | 'fiscal:transmit';

export interface CatalogApp {
  code: string;
  name: string;
  publisher: string;
  categories: string[];
  /** Markets where the integration has a live path. */
  markets?: string[];
  version: string;
  scopes: AppScope[];
  /** Endpoints the token may call, for the developer page. */
  endpoints: string[];
  /** Events the app is allowed to subscribe to. */
  events: string[];
  writes: boolean;
  handlesPersonalData: boolean;
  pricing: 'FREE' | 'ADDON' | 'USAGE';
  description: string;
  /** Env var the live adapter reads, when one exists. */
  envKey?: string | null;
}

export const APP_CATALOG: CatalogApp[] = [
  {
    code: 'ACCOUNTING_BRIDGE',
    name: 'Accounting Bridge',
    publisher: 'UnifiedPOS',
    categories: ['FINANCE'],
    version: '1.0.0',
    scopes: ['read:orders', 'read:payments', 'read:reports', 'read:settings'],
    endpoints: ['/api/accounting/entries', '/api/reports/sales', '/api/payments'],
    events: ['order.completed', 'payment.captured'],
    writes: false,
    handlesPersonalData: false,
    pricing: 'FREE',
    description: 'Exports a journal-ready ledger: daily Z totals, taxes and tender splits.',
  },
  {
    code: 'ECOMMERCE_SYNC',
    name: 'E-commerce Catalog Sync',
    publisher: 'UnifiedPOS',
    categories: ['COMMERCE', 'MERCHANDISE'],
    version: '1.2.0',
    scopes: ['read:products', 'write:products', 'read:inventory', 'write:inventory', 'read:orders', 'write:orders'],
    endpoints: ['/api/catalog', '/api/products', '/api/inventory', '/api/orders'],
    events: ['inventory.changed', 'order.created'],
    writes: true,
    handlesPersonalData: true,
    pricing: 'ADDON',
    description: 'Keeps a webshop and the shop floor on one stock number, both directions.',
    envKey: 'COMMERCE_SYNC_URL',
  },
  {
    code: 'DELIVERY_DISPATCH',
    name: 'Delivery Dispatch',
    publisher: 'Partner Network',
    categories: ['COMMERCE', 'OPERATIONS'],
    markets: ['NG', 'KE', 'GB', 'US', 'IN', 'BR', 'AE'],
    version: '1.0.0',
    scopes: ['read:orders', 'write:orders', 'read:customers'],
    endpoints: ['/api/orders', '/api/commerce/deliveries'],
    events: ['order.created', 'order.status_changed'],
    writes: true,
    handlesPersonalData: true,
    pricing: 'USAGE',
    description: 'Pushes ready orders to courier networks and streams status back to the till.',
    envKey: 'DELIVERY_PARTNER_URL',
  },
  {
    code: 'LOYALTY_PLUS',
    name: 'Loyalty Plus',
    publisher: 'Partner Network',
    categories: ['MARKETING'],
    version: '1.1.0',
    scopes: ['read:loyalty', 'write:loyalty', 'read:customers', 'read:orders'],
    endpoints: ['/api/loyalty', '/api/customers'],
    events: ['order.completed', 'customer.created'],
    writes: true,
    handlesPersonalData: true,
    pricing: 'ADDON',
    description: 'Tiered and coalition loyalty on top of the native points ledger.',
  },
  {
    code: 'WORKFORCE_SCHED',
    name: 'Workforce & Scheduling',
    publisher: 'Partner Network',
    categories: ['PEOPLE'],
    version: '1.0.0',
    scopes: ['read:staff', 'write:staff', 'read:reports'],
    endpoints: ['/api/employees', '/api/employees/time', '/api/reports/labour'],
    events: ['shift.published'],
    writes: true,
    handlesPersonalData: true,
    pricing: 'ADDON',
    description: 'Rosters, wage law and labour cost against real hourly sales.',
  },
  {
    code: 'PROCUREMENT_AGENT',
    name: 'Procurement Agent',
    publisher: 'UnifiedPOS',
    categories: ['MERCHANDISE', 'AI'],
    version: '1.0.0',
    scopes: ['read:inventory', 'read:products', 'read:reports', 'write:orders'],
    endpoints: ['/api/agent/plans', '/api/purchasing', '/api/inventory'],
    events: ['inventory.low_stock', 'replenishment.drafted'],
    writes: true,
    handlesPersonalData: false,
    pricing: 'ADDON',
    description: 'Drafts purchase orders from the demand forecast and waits for a human to approve them.',
    envKey: 'PROCUREMENT_AGENT_URL',
  },
  {
    code: 'FISCAL_BRIDGE',
    name: 'Fiscal Bridge',
    publisher: 'Partner Network',
    categories: ['COMPLIANCE', 'FINANCE'],
    markets: ['DE', 'FR', 'IT', 'ES', 'PL', 'SA', 'NG', 'KE', 'TZ', 'BR', 'MX', 'IN', 'MY', 'RO', 'GR', 'HU', 'AR', 'CL'],
    version: '2.0.0',
    scopes: ['fiscal:transmit', 'read:orders', 'read:reports'],
    endpoints: ['/api/fiscal/documents', '/api/fiscal/transmit'],
    events: ['fiscal.document_sealed', 'fiscal.transmit_failed'],
    writes: true,
    handlesPersonalData: false,
    pricing: 'USAGE',
    description: 'Signed transport to a country fiscal regime, with retry and proof-of-filing.',
    envKey: 'FISCAL_BRIDGE_URL',
  },
  {
    code: 'WHATSAPP_NOTIFIER',
    name: 'WhatsApp Receipts & Offers',
    publisher: 'Partner Network',
    categories: ['MARKETING', 'COMPLIANCE'],
    markets: ['NG', 'KE', 'BR', 'IN', 'ID', 'AE', 'ZA', 'MX'],
    version: '1.0.0',
    scopes: ['read:customers', 'read:orders', 'webhook:subscribe'],
    endpoints: ['/api/customers', '/api/notifications', '/api/webhooks'],
    events: ['order.completed', 'campaign.sent'],
    writes: false,
    handlesPersonalData: true,
    pricing: 'USAGE',
    description: 'Opt-in receipts and offers on the channel customers actually read.',
    envKey: 'WHATSAPP_TOKEN',
  },
  {
    code: 'ANALYTICS_LENS',
    name: 'Analytics Lens',
    publisher: 'UnifiedPOS',
    categories: ['INSIGHT'],
    version: '1.3.0',
    scopes: ['read:reports', 'read:orders', 'read:products', 'read:customers'],
    endpoints: ['/api/reports', '/api/analytics', '/api/benchmark'],
    events: ['report.refreshed'],
    writes: false,
    handlesPersonalData: false,
    pricing: 'FREE',
    description: 'Read-only warehouse view, including the anonymised peer benchmark.',
  },
  {
    code: 'CUSTOM_FIELDS_STUDIO',
    name: 'Custom Fields Studio',
    publisher: 'UnifiedPOS',
    categories: ['OPERATIONS', 'DEVELOPER'],
    version: '1.0.0',
    scopes: ['read:custom_fields', 'write:custom_fields', 'read:orders', 'read:customers', 'read:products'],
    endpoints: ['/api/apps/fields', '/api/apps/fields/values'],
    events: ['order.created'],
    writes: true,
    handlesPersonalData: false,
    pricing: 'FREE',
    description: 'Add the fields your trade needs and have them follow the order everywhere.',
  },
  {
    code: 'AGENT_STOREFRONT',
    name: 'Agent Storefront',
    publisher: 'UnifiedPOS',
    categories: ['COMMERCE', 'AI'],
    version: '1.0.0',
    scopes: ['read:products', 'read:inventory', 'read:orders', 'write:orders'],
    endpoints: ['/api/agents/public', '/api/agents/checkout', '/api/catalog'],
    events: ['agent.mandate_accepted', 'agent.order_placed'],
    writes: true,
    handlesPersonalData: true,
    pricing: 'ADDON',
    description: 'Publishes the JSON-LD catalog and honours signed agent mandates.',
  },
];

const APP_BY_CODE: Record<string, CatalogApp> = Object.fromEntries(APP_CATALOG.map((a) => [a.code, a]));

export const APP_CODES: string[] = APP_CATALOG.map((a) => a.code);

export const ALL_SCOPES: AppScope[] = [...new Set(APP_CATALOG.flatMap((a) => a.scopes))].sort() as AppScope[];

export function appByCode(code: unknown): CatalogApp | null {
  return typeof code === 'string' ? APP_BY_CODE[code.toUpperCase()] || null : null;
}

/**
 * A write scope implies its read scope — but only inside the same resource, so
 * `write:orders` never quietly buys `read:customers`.
 */
export function impliedScopes(scopes: AppScope[]): AppScope[] {
  const out = new Set<AppScope>(scopes || []);
  for (const scope of [...out]) {
    const [verb, resource] = scope.split(':');
    if (verb === 'write' || verb === 'refund') out.add(`read:${resource}` as AppScope);
  }
  return [...out].sort() as AppScope[];
}

/** The riskiest thing a grant list can do, for the confirmation screen. */
export function highestRiskScope(scopes: AppScope[]): { scope: AppScope; risk: 'LOW' | 'MEDIUM' | 'HIGH' } {
  const high: AppScope[] = ['write:settings', 'refund:payments', 'refund:orders', 'fiscal:transmit', 'write:staff'];
  const medium: AppScope[] = ['write:orders', 'write:inventory', 'write:products', 'write:customers', 'write:loyalty', 'write:custom_fields', 'webhook:subscribe', 'read:payments', 'read:customers', 'read:staff'];
  for (const s of scopes || []) if (high.includes(s)) return { scope: s, risk: 'HIGH' };
  for (const s of scopes || []) if (medium.includes(s)) return { scope: s, risk: 'MEDIUM' };
  return { scope: (scopes || [])[0] || 'read:reports', risk: 'LOW' };
}

export function appsForMarket(countryCode?: string | null): CatalogApp[] {
  if (!countryCode) return APP_CATALOG;
  const code = countryCode.toUpperCase();
  return APP_CATALOG.filter((a) => !a.markets || a.markets.includes(code));
}

export function appCategories(): string[] {
  return [...new Set(APP_CATALOG.flatMap((a) => a.categories))].sort();
}

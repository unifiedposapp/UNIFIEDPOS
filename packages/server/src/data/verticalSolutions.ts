// ─── VERTICAL SOLUTION MANIFESTS ─────────────────────────────────────────────
// One POS core, many trades. A "solution" is a declarative manifest saying what
// a grocery, a pharmacy and a barber actually need on top of the shared engine:
// which capabilities switch on, what the checkout must capture, which fields the
// POS puts a button on, and which settings the install seeds. No code is
// compiled per vertical — the manifests are data, so a new trade is a new entry.
export type Capability =
  | 'BARCODE_SCAN'
  | 'WEIGHTED_ITEMS'
  | 'LOT_BATCH'
  | 'EXPIRY_TRACKING'
  | 'SERIAL_TRACKING'
  | 'AGE_VERIFICATION'
  | 'PRESCRIPTION_CAPTURE'
  | 'APPOINTMENTS'
  | 'STAFF_COMMISSION'
  | 'VARIANT_MATRIX'
  | 'LAYAWAY'
  | 'WORK_ORDERS'
  | 'COMPONENT_BOM'
  | 'RENTAL_TIMING'
  | 'PRODUCTION_PLAN'
  | 'SUBSCRIPTIONS'
  | 'CREDIT_TERMS'
  | 'VOLUME_TIER_PRICING'
  | 'DELIVERY_DISPATCH'
  | 'TABLE_SERVICE'
  | 'TRADE_IN'
  | 'WARRANTY_PLANS'
  | 'GIFT_RECEIPT'
  | 'EXCHANGE_FLOWS'
  | 'PRODUCT_SALES'
  | 'NON_STOCK_LINES'
  | 'SPLIT_PAYMENT'
  | 'ID_CAPTURE'
  | 'LOYALTY_DEFAULT';

export interface PosHints {
  /** Shortcut tiles the POS terminal surfaces for this trade. */
  quickActions: { label: string; action: string }[];
  /** Fields the cashier cannot complete a sale without. */
  requiredAtCheckout: string[];
  /** Default fulfilment route for a new cart. */
  defaultFulfillment?: string;
  /** Badges worth showing on a cart line. */
  lineBadges?: string[];
  /** Operator prompts surfaced when the solution is installed. */
  notices?: string[];
}

export interface VerticalSolution {
  code: string;
  name: string;
  tagline: string;
  /** Organization.industry values this solution is a natural fit for. */
  industries: string[];
  /** Markets where the trade profile is common enough to recommend first. */
  strongMarkets?: string[];
  version: string;
  capabilities: Capability[];
  posHints: PosHints;
  /**
   * Seeds written into the installation's own config. Deliberately not the live
   * settings table: an install must be reversible and must never corrupt a
   * merchant's configuration.
   */
  defaults: Record<string, unknown>;
  /** StoreSettings keys the install is allowed to apply, with their values. */
  settingsDelta?: Record<string, unknown>;
  /** Requires a manager's confirmation because it touches regulated activity. */
  confirmations?: string[];
  /** Capabilities this solution switches on that another solution may also own. */
  sharedCapabilities?: Capability[];
}

export const VERTICAL_SOLUTIONS: VerticalSolution[] = [
  {
    code: 'GROCERY',
    name: 'Grocery & Convenience',
    tagline: 'Barcode-first checkout, weighables and perishable dates at speed.',
    industries: ['RETAIL'],
    strongMarkets: ['NG', 'KE', 'GH', 'ZA', 'US', 'GB', 'IN', 'BR'],
    version: '1.0.0',
    capabilities: ['BARCODE_SCAN', 'WEIGHTED_ITEMS', 'EXPIRY_TRACKING', 'LOT_BATCH', 'LOYALTY_DEFAULT', 'SPLIT_PAYMENT'],
    posHints: {
      quickActions: [
        { label: 'Scan weight', action: 'weighted-scan' },
        { label: 'Department', action: 'department-filter' },
        { label: 'Aisle stock check', action: 'stock-lookup' },
      ],
      requiredAtCheckout: [],
      defaultFulfillment: 'PICKUP',
      lineBadges: ['expiresSoon', 'byWeight'],
      notices: ['Enable expiry tracking on perishables so short-dated stock can be discounted before it writes off.'],
    },
    defaults: { departmentMode: true, shortDateDiscountDays: 3, requireScaleOnWeighted: true, pluSearch: true },
    settingsDelta: { lowStockAlertEnabled: true },
  },
  {
    code: 'PHARMACY',
    name: 'Pharmacy & Health',
    tagline: 'Batch, expiry and prescription capture on every regulated line.',
    industries: ['RETAIL', 'SERVICES'],
    strongMarkets: ['NG', 'KE', 'IN', 'GB', 'DE', 'ID', 'BR', 'AE'],
    version: '1.0.0',
    capabilities: ['BARCODE_SCAN', 'LOT_BATCH', 'EXPIRY_TRACKING', 'PRESCRIPTION_CAPTURE', 'ID_CAPTURE', 'AGE_VERIFICATION', 'LOYALTY_DEFAULT'],
    posHints: {
      quickActions: [
        { label: 'Capture prescription', action: 'prescription-capture' },
        { label: 'Batch pick', action: 'batch-pick' },
        { label: 'Drug interaction check', action: 'interaction-check' },
      ],
      requiredAtCheckout: ['prescriptionRef', 'dispensingPharmacist'],
      lineBadges: ['batch', 'expiry', 'schedule'],
      notices: ['Dispensing records are clinical data: keep the retention window at or above your national medicines authority minimum.'],
    },
    defaults: { blockExpiredSale: true, requirePrescriber: true, scheduleFlags: true, refillsTracked: true },
    confirmations: ['I confirm dispensing records for this store are retained per the medicines regulator.'],
  },
  {
    code: 'FASHION',
    name: 'Fashion & Apparel',
    tagline: 'Size/colour matrix, layaway and easy returns.',
    industries: ['RETAIL'],
    strongMarkets: ['IT', 'FR', 'GB', 'US', 'AE', 'IN', 'BR', 'NG'],
    version: '1.0.0',
    capabilities: ['VARIANT_MATRIX', 'BARCODE_SCAN', 'LAYAWAY', 'GIFT_RECEIPT', 'LOYALTY_DEFAULT', 'EXCHANGE_FLOWS'],
    posHints: {
      quickActions: [
        { label: 'Size grid', action: 'variant-matrix' },
        { label: 'Layaway', action: 'start-layaway' },
        { label: 'Gift receipt', action: 'gift-receipt' },
      ],
      requiredAtCheckout: [],
      lineBadges: ['size', 'colour', 'layaway'],
      notices: ['Seasonal stock: plan markdowns against weeks-of-cover rather than margin alone.'],
    },
    defaults: { matrixBy: ['size', 'colour'], returnWindowDays: 30, giftReceiptDefault: true, layawayDepositPercent: 20 },
  },
  {
    code: 'HARDWARE',
    name: 'Hardware & Building',
    tagline: 'Loose sell, cut-to-length, component stock and trade accounts.',
    industries: ['RETAIL', 'SERVICES'],
    strongMarkets: ['US', 'GB', 'NG', 'KE', 'ZA', 'AU', 'BR', 'IN'],
    version: '1.0.0',
    capabilities: ['BARCODE_SCAN', 'COMPONENT_BOM', 'WEIGHTED_ITEMS', 'CREDIT_TERMS', 'NON_STOCK_LINES', 'DELIVERY_DISPATCH'],
    posHints: {
      quickActions: [
        { label: 'Cut / break bulk', action: 'break-bulk' },
        { label: 'Build kit', action: 'bom-explode' },
        { label: 'Trade account', action: 'credit-account' },
      ],
      requiredAtCheckout: [],
      lineBadges: ['perUnit', 'kit', 'tradePrice'],
      notices: ['Kits explode into component stock on sale so the warehouse count stays true.'],
    },
    defaults: { allowLooseUnits: true, tradePricing: true, deliveryDefault: true, negativeStockAllowed: false },
  },
  {
    code: 'AUTO_REPAIR',
    name: 'Auto Repair & Service',
    tagline: 'Work orders with parts, labour and a vehicle on file.',
    industries: ['SERVICES'],
    strongMarkets: ['US', 'GB', 'DE', 'BR', 'NG', 'KE', 'AE', 'IN'],
    version: '1.0.0',
    capabilities: ['WORK_ORDERS', 'COMPONENT_BOM', 'APPOINTMENTS', 'NON_STOCK_LINES', 'ID_CAPTURE', 'STAFF_COMMISSION'],
    posHints: {
      quickActions: [
        { label: 'Open job card', action: 'work-order' },
        { label: 'Book bay', action: 'appointment' },
        { label: 'Add labour', action: 'non-stock-line' },
      ],
      requiredAtCheckout: ['vehicleRef', 'jobCard'],
      defaultFulfillment: 'DINE_IN',
      lineBadges: ['labour', 'part', 'warranty'],
      notices: ['Labour is priced by hour band; make sure technician commission is switched on before payroll close.'],
    },
    defaults: { labourRates: { standard: 1.0, diagnostic: 1.25 }, jobCardRequired: true, partsGrossUpPercent: 20 },
  },
  {
    code: 'SALON',
    name: 'Salon & Barbershop',
    tagline: 'Appointments, staff commission and walk-in balance.',
    industries: ['SERVICES'],
    strongMarkets: ['US', 'GB', 'NG', 'KE', 'IN', 'BR', 'AE', 'ZA'],
    version: '1.0.0',
    capabilities: ['APPOINTMENTS', 'STAFF_COMMISSION', 'SUBSCRIPTIONS', 'LOYALTY_DEFAULT', 'PRODUCT_SALES'],
    posHints: {
      quickActions: [
        { label: 'Book stylist', action: 'appointment' },
        { label: 'Add service', action: 'service-line' },
        { label: 'Retail product', action: 'product-lookup' },
      ],
      requiredAtCheckout: ['staffId'],
      lineBadges: ['staff', 'commission', 'tips'],
      notices: ['Every line needs an assigned staff member or commission will be split evenly, which your team will notice.'],
    },
    defaults: { commissionPercent: 40, tipEnabled: true, noShowFee: 0, bookingLeadMinutes: 15 },
  },
  {
    code: 'QUICK_SERVICE',
    name: 'Quick-Service Food',
    tagline: 'Counter service, modifiers and a kitchen print on payment.',
    industries: ['RESTAURANT'],
    strongMarkets: ['US', 'GB', 'NG', 'KE', 'IN', 'BR', 'MX', 'AE'],
    version: '1.0.0',
    capabilities: ['TABLE_SERVICE', 'NON_STOCK_LINES', 'SPLIT_PAYMENT', 'DELIVERY_DISPATCH', 'LOYALTY_DEFAULT'],
    posHints: {
      quickActions: [
        { label: 'Order ahead', action: 'queue-ticket' },
        { label: 'Split bill', action: 'split-payment' },
        { label: 'Reprint KOT', action: 'print-kot' },
      ],
      requiredAtCheckout: [],
      defaultFulfillment: 'TAKEOUT',
      lineBadges: ['modifier', 'allergen', 'fireTime'],
      notices: ['Allergen text prints on the KOT — capture it at the line, not in the order note.'],
    },
    defaults: { autoPrintKot: true, ticketPrefix: 'Q', packagingLineDefault: true },
  },
  {
    code: 'LIQUOR',
    name: 'Liquor & Age-Restricted',
    tagline: 'Age gate on every restricted line, plus duty codes.',
    industries: ['RETAIL'],
    strongMarkets: ['US', 'GB', 'DE', 'NG', 'KE', 'ZA', 'AE', 'CA'],
    version: '1.0.0',
    capabilities: ['AGE_VERIFICATION', 'BARCODE_SCAN', 'ID_CAPTURE', 'LOT_BATCH', 'VOLUME_TIER_PRICING'],
    posHints: {
      quickActions: [
        { label: 'Check ID', action: 'age-verify' },
        { label: 'Duty band', action: 'duty-code' },
      ],
      requiredAtCheckout: ['ageVerified'],
      lineBadges: ['ageRestricted', 'duty'],
      notices: ['Refusing a sale is always safe; the terminal records who declined and why.'],
    },
    defaults: { minimumAge: 18, declineReasonRequired: true, dutyCodesEnabled: true },
    confirmations: ['I confirm the age-verification threshold matches the legal drinking age in this market.'],
  },
  {
    code: 'ELECTRONICS',
    name: 'Electronics & Mobile',
    tagline: 'Serials for warranty and IMEI capture at the counter.',
    industries: ['RETAIL', 'SERVICES'],
    strongMarkets: ['NG', 'KE', 'IN', 'CN', 'US', 'GB', 'AE', 'BR'],
    version: '1.0.0',
    capabilities: ['SERIAL_TRACKING', 'BARCODE_SCAN', 'TRADE_IN', 'WARRANTY_PLANS', 'LAYAWAY', 'CREDIT_TERMS'],
    posHints: {
      quickActions: [
        { label: 'Scan IMEI/serial', action: 'serial-capture' },
        { label: 'Add plan', action: 'warranty-plan' },
        { label: 'Trade-in valuation', action: 'trade-in' },
      ],
      requiredAtCheckout: ['serialNumber'],
      lineBadges: ['serial', 'plan', 'tradeIn'],
      notices: ['Serials are the warranty claim: without them a return becomes a write-off.'],
    },
    defaults: { serialRequired: true, planAttachPrompt: true, tradeInGradeEnabled: true },
  },
  {
    code: 'BAKERY',
    name: 'Bakery & Production Food',
    tagline: 'Bake-to-forecast production with short-dated stock.',
    industries: ['RETAIL', 'RESTAURANT'],
    strongMarkets: ['FR', 'IT', 'DE', 'GB', 'US', 'NG', 'KE'],
    version: '1.0.0',
    capabilities: ['PRODUCTION_PLAN', 'EXPIRY_TRACKING', 'LOT_BATCH', 'WEIGHTED_ITEMS', 'BARCODE_SCAN'],
    posHints: {
      quickActions: [
        { label: 'Production sheet', action: 'production-plan' },
        { label: 'Pre-order wall', action: 'preorder-board' },
      ],
      requiredAtCheckout: [],
      lineBadges: ['bakedOn', 'bestBefore', 'preOrder'],
      notices: ['Yesterday is a discount decision, not a write-off decision — set the short-date rule.'],
    },
    defaults: { produceAheadHours: 18, shortDateDiscountPercent: 50, wasteLogRequired: true },
  },
  {
    code: 'WHOLESALE',
    name: 'Wholesale & Cash & Carry',
    tagline: 'Tiered pricing, cartons and pallets, credit customers.',
    industries: ['RETAIL'],
    strongMarkets: ['NG', 'KE', 'GH', 'IN', 'ID', 'BR', 'US', 'AE'],
    version: '1.0.0',
    capabilities: ['VOLUME_TIER_PRICING', 'CREDIT_TERMS', 'COMPONENT_BOM', 'DELIVERY_DISPATCH', 'NON_STOCK_LINES'],
    posHints: {
      quickActions: [
        { label: 'Carton / pallet', action: 'unit-multiplier' },
        { label: 'Credit sale', action: 'credit-account' },
        { label: 'Price list', action: 'tier-price-list' },
      ],
      requiredAtCheckout: ['taxId'],
      lineBadges: ['tier', 'carton', 'credit'],
      notices: ['Credit sales create receivables: the invoice due-date drives your collections queue.'],
    },
    defaults: { tiers: [{ min: 1 }, { min: 12, discountPercent: 5 }, { min: 60, discountPercent: 10 }], creditDays: 30 },
  },
  {
    code: 'RENTAL',
    name: 'Equipment Rental',
    tagline: 'Time-based pricing, deposits and an overdue board.',
    industries: ['SERVICES', 'RETAIL'],
    strongMarkets: ['US', 'GB', 'DE', 'AE', 'ZA', 'BR'],
    version: '1.0.0',
    capabilities: ['RENTAL_TIMING', 'SERIAL_TRACKING', 'ID_CAPTURE', 'CREDIT_TERMS', 'NON_STOCK_LINES'],
    posHints: {
      quickActions: [
        { label: 'Start rental', action: 'rental-start' },
        { label: 'Return & settle', action: 'rental-return' },
        { label: 'Overdue board', action: 'rental-overdue' },
      ],
      requiredAtCheckout: ['rentalAgreement', 'deposit'],
      lineBadges: ['outSince', 'dueBack', 'deposit'],
      notices: ['Damage and late fees are raised on return, so capture condition at hand-out.'],
    },
    defaults: { billingUnit: 'DAY', graceHours: 2, depositPercent: 25 },
    confirmations: ['I confirm rental agreements are retained with the customer identity collected at hand-out.'],
  },
  {
    code: 'PET_CARE',
    name: 'Pet Shop & Grooming',
    tagline: 'Animal records, grooming bookings and repeat supply.',
    industries: ['RETAIL', 'SERVICES'],
    strongMarkets: ['US', 'GB', 'DE', 'NG', 'KE', 'ZA', 'AE'],
    version: '1.0.0',
    capabilities: ['APPOINTMENTS', 'SUBSCRIPTIONS', 'STAFF_COMMISSION', 'BARCODE_SCAN', 'LOYALTY_DEFAULT'],
    posHints: {
      quickActions: [
        { label: 'Book groom', action: 'appointment' },
        { label: 'Repeat delivery', action: 'subscription' },
      ],
      requiredAtCheckout: [],
      lineBadges: ['pet', 'breedRisk', 'repeat'],
      notices: ['Muzzle/breed flags print on the intake slip — capture temperament at booking.'],
    },
    defaults: { petProfileRequired: true, subscriptionDefaultWeeks: 4 },
  },
  {
    code: 'CLINIC',
    name: 'Clinic & Diagnostics',
    tagline: 'Patient identity, appointment and non-stock service lines.',
    industries: ['SERVICES'],
    strongMarkets: ['NG', 'KE', 'IN', 'AE', 'ZA', 'GB', 'BR', 'US'],
    version: '1.0.0',
    capabilities: ['APPOINTMENTS', 'ID_CAPTURE', 'NON_STOCK_LINES', 'PRESCRIPTION_CAPTURE', 'CREDIT_TERMS'],
    posHints: {
      quickActions: [
        { label: 'Register patient', action: 'patient-intake' },
        { label: 'Book slot', action: 'appointment' },
        { label: 'Bill a service', action: 'non-stock-line' },
      ],
      requiredAtCheckout: ['patientRef'],
      lineBadges: ['patient', 'clinician', 'insurance'],
      notices: ['Clinical notes belong in the patient record, never in a line-item note field.'],
    },
    defaults: { consentRequired: true, insuranceCapture: true },
    confirmations: ['I confirm patient identifiers are collected only for billing and that consent is recorded at intake.'],
  },
];

const BY_CODE: Record<string, VerticalSolution> = Object.fromEntries(VERTICAL_SOLUTIONS.map((s) => [s.code, s]));

export const VERTICAL_CODES: string[] = VERTICAL_SOLUTIONS.map((s) => s.code);

export function solutionByCode(code: unknown): VerticalSolution | null {
  return typeof code === 'string' ? BY_CODE[code.toUpperCase()] || null : null;
}

export function allCapabilities(): Capability[] {
  const set = new Set<Capability>();
  for (const s of VERTICAL_SOLUTIONS) for (const c of s.capabilities) set.add(c);
  return [...set].sort() as Capability[];
}

/** capability → solutions that provide it (the "does anyone do X?" answer). */
export function capabilityIndex(): Record<string, string[]> {
  const index: Record<string, string[]> = {};
  for (const s of VERTICAL_SOLUTIONS) {
    for (const c of s.capabilities) {
      if (!index[c]) index[c] = [];
      index[c].push(s.code);
    }
  }
  return index;
}

export function solutionsForIndustry(industry?: string | null): VerticalSolution[] {
  if (!industry) return VERTICAL_SOLUTIONS;
  const want = String(industry).toUpperCase();
  return VERTICAL_SOLUTIONS.filter((s) => s.industries.map((i) => i.toUpperCase()).includes(want));
}

/**
 * Ranking for the picker: an exact industry match first, then a market match,
 * then everything else alphabetically — deterministic, so the UI order is
 * stable between requests.
 */
export function recommendSolutions(industry?: string | null, countryCode?: string | null): { code: string; name: string; score: number; why: string[] }[] {
  return VERTICAL_SOLUTIONS.map((s) => {
    const why: string[] = [];
    let score = 0;
    if (industry && s.industries.map((i) => i.toUpperCase()).includes(String(industry).toUpperCase())) {
      score += 60;
      why.push(`built for ${String(industry).toLowerCase()} operators`);
    }
    if (countryCode && (s.strongMarkets || []).includes(countryCode.toUpperCase())) {
      score += 30;
      why.push(`common in ${countryCode.toUpperCase()}`);
    }
    score += s.capabilities.length;
    return { code: s.code, name: s.name, score, why };
  }).sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
}

export interface SolutionConflict {
  capability: Capability;
  codes: string[];
  resolution: string;
}

/**
 * Two installs that both own a capability with different behaviour is the only
 * real conflict worth warning about; anything else composes.
 */
export function solutionConflicts(codes: string[]): SolutionConflict[] {
  const wanted = codes.map((c) => solutionByCode(c)).filter(Boolean) as VerticalSolution[];
  const seen = new Map<Capability, string[]>();
  for (const s of wanted) {
    for (const c of s.capabilities) {
      const list = seen.get(c) || [];
      list.push(s.code);
      seen.set(c, list);
    }
  }
  const conflicts: SolutionConflict[] = [];
  for (const [capability, owners] of seen) {
    if (owners.length > 1) {
      conflicts.push({
        capability,
        codes: owners,
        resolution: `${owners[0]} wins: the first install of ${capability} keeps its behaviour, ${owners.slice(1).join(', ')} will see that capability already active.`,
      });
    }
  }
  return conflicts.sort((a, b) => a.capability.localeCompare(b.capability));
}

export interface InstallPlan {
  solutionCode: string;
  version: string;
  capabilities: Capability[];
  posHints: PosHints;
  defaults: Record<string, unknown>;
  settingsDelta: Record<string, unknown>;
  confirmations: string[];
  added: Capability[];
  alreadyActive: Capability[];
}

/**
 * Merge a solution onto what is already installed. Idempotent: installing twice
 * changes nothing, and a capability another install already provided is reported
 * as alreadyActive rather than re-applied.
 */
export function planInstall(code: unknown, activeCapabilities: Capability[] = [], activeCodes: string[] = []): InstallPlan {
  const solution = solutionByCode(code);
  if (!solution) {
    const err = new Error(`Unknown vertical solution ${String(code)}`) as Error & { status?: number; code?: string };
    err.status = 404;
    err.code = 'UNKNOWN_SOLUTION';
    throw err;
  }
  const ownedByOthers = new Set<Capability>();
  for (const other of activeCodes) {
    if (other === solution.code) continue;
    const s = solutionByCode(other);
    if (s) for (const c of s.capabilities) ownedByOthers.add(c);
  }
  const have = new Set(activeCapabilities);
  return {
    solutionCode: solution.code,
    version: solution.version,
    capabilities: solution.capabilities,
    posHints: solution.posHints,
    defaults: solution.defaults,
    settingsDelta: solution.settingsDelta || {},
    confirmations: solution.confirmations || [],
    added: solution.capabilities.filter((c) => !have.has(c)),
    alreadyActive: solution.capabilities.filter((c) => have.has(c) || ownedByOthers.has(c)),
  };
}

/** Union of every capability + hint set the POS should honour right now. */
export function mergeInstallations(installs: { solutionCode: string; features?: unknown; posHints?: unknown }[]): {
  capabilities: Capability[];
  quickActions: { label: string; action: string }[];
  requiredAtCheckout: string[];
  lineBadges: string[];
  notices: string[];
  defaults: Record<string, unknown>;
} {
  const capabilities = new Set<Capability>();
  const actions: { label: string; action: string }[] = [];
  const required = new Set<string>();
  const badges = new Set<string>();
  const notices: string[] = [];
  const defaults: Record<string, unknown> = {};
  const seenAction = new Set<string>();
  for (const install of installs || []) {
    for (const c of (install.features as Capability[]) || []) capabilities.add(c);
    const hints = (install.posHints || {}) as PosHints;
    for (const a of hints.quickActions || []) {
      if (seenAction.has(a.action)) continue;
      seenAction.add(a.action);
      actions.push(a);
    }
    for (const r of hints.requiredAtCheckout || []) required.add(r);
    for (const b of hints.lineBadges || []) badges.add(b);
    Object.assign(defaults, (install as any).defaults || {});
  }
  return {
    capabilities: [...capabilities].sort() as Capability[],
    quickActions: actions,
    requiredAtCheckout: [...required],
    lineBadges: [...badges],
    notices,
    defaults,
  };
}

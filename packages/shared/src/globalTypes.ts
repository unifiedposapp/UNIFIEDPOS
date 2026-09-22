// ─── Global-expansion API contracts ──────────────────────────────────────────
// The ten subsystems added for multi-country operation each answer with a
// structured envelope. These are the shapes the web client renders and the
// server produces, kept in the shared package so a drift in one is a compile
// error in the other rather than a blank screen at opening time.

export type IsoDate = string;

// ─── fiscalization ───────────────────────────────────────────────────────────
export interface FiscalProfileView {
  code: string;
  country: string;
  countryCode: string;
  regime: string;
  /** A signed receipt is legally required for every cash sale. */
  requiresSeal: boolean;
  requiresDevice: boolean;
  transmission: 'NONE' | 'SYNC' | 'ASYNC' | 'PORTAL';
  requiresQr: boolean;
  retentionYears: number;
  mandateYear: number;
  vatField: 'VAT_TOTAL' | 'GST_TOTAL' | 'TAX_TOTAL' | 'NONE';
  notes?: string;
}

/** Registration secrets are never echoed back - only whether one is on file. */
export interface FiscalDeviceView {
  id: string;
  profileCode: string;
  serialNumber: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'RETIRED' | string;
  locationId: string | null;
  lastSequence: number;
  lastSignedAt: IsoDate | null;
  hasActivationCode?: boolean;
  publicKeyRef: string | null;
  createdAt: IsoDate;
}

export interface FiscalDocumentView {
  id: string;
  organizationId: string;
  orderId: string | null;
  deviceId: string | null;
  profileCode: string;
  documentType: 'RECEIPT' | 'INVOICE' | 'CREDIT_NOTE' | string;
  receiptNumber: string;
  sequenceNumber: number;
  total: number;
  vatTotal: number;
  currency: string;
  payloadHash: string;
  previousHash: string | null;
  signedHash: string | null;
  qrPayload: string | null;
  status: 'SEALED' | 'PENDING' | 'TRANSMITTED' | 'REJECTED' | 'FAILED' | string;
  attempts: number;
  nextRetryAt: IsoDate | null;
  externalRef: string | null;
  errorMessage: string | null;
  sealedAt: IsoDate;
  transmittedAt: IsoDate | null;
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  brokenAt?: string | null;
  reason?: string | null;
  gaps?: number[];
  firstSequence?: number | null;
  lastSequence?: number | null;
}

// ─── payment rails ───────────────────────────────────────────────────────────
/** One row of the rail routing table (server data/paymentRails.ts RailDef). */
export interface RailView {
  code: string;
  name: string;
  /** ISO alpha-2 markets where the rail carries domestic receipts; '*' = everywhere. */
  countries: string[];
  currencies: string[];
  identifierKind: string;
  /** T+n business days until the money is irrevocably settled. */
  settlementDays: number;
  instant: boolean;
  maxAmount?: number | null;
  reversible: boolean;
  notes?: string;
}

export interface RailValidation {
  valid: boolean;
  /** Canonical form worth storing: uppercased, separators stripped. */
  normalized: string;
  reason?: string;
  detail?: string;
}

export interface RailAccountView {
  id: string;
  railCode: string;
  countryCode: string;
  label: string;
  /** Masked: the instrument is never echoed in full. */
  identifier: string;
  holderName: string | null;
  verification: 'UNVERIFIED' | 'VERIFIED' | 'FAILED' | string;
  isValid: boolean;
  validationNote: string | null;
  isPrimary: boolean;
  status: string;
  locationId: string | null;
  rail?: RailView | null;
}

export interface BatchHealthView {
  /** 0-100 share of statement value that matched cleanly. */
  matchRate: number;
  discrepancyValue: number;
  label: 'HEALTHY' | 'WATCH' | 'ESCALATE';
}

export interface ReconciliationSummaryView {
  lineCount: number;
  matched: number;
  amountMismatch: number;
  feeMismatch: number;
  unmatchedProvider: number;
  duplicates: number;
  unmatchedInternal: number;
  unmatchedInternalIds?: string[];
  gross: number;
  fees: number;
  expectedNet: number;
  matchedNet: number;
  variance: number;
  status: 'RECONCILED' | 'DISCREPANCY';
  lines?: SettlementLineView[];
}

export interface SettlementBatchView {
  id: string;
  organizationId: string;
  countryCode: string;
  railCode: string;
  provider: string;
  batchDate: IsoDate;
  currency: string;
  grossAmount: number;
  feeAmount: number;
  expectedNet: number;
  matchedNet: number;
  variance: number;
  lineCount: number;
  matchedCount: number;
  status: 'OPEN' | 'RECONCILED' | 'DISCREPANCY' | 'SIGNED_OFF' | string;
  discrepancyDetail?: Record<string, unknown> | null;
  signedOffBy: string | null;
  signedOffAt: IsoDate | null;
  createdAt: IsoDate;
}

export interface SettlementLineView {
  id: string;
  batchId: string;
  externalReference: string | null;
  paymentId: string | null;
  orderId: string | null;
  amount: number;
  fee: number;
  valueDate: IsoDate | null;
  status: string;
  note: string | null;
}

export interface SettlementDetailView {
  batch: SettlementBatchView;
  lines: SettlementLineView[];
  rail: RailView | null;
  health: BatchHealthView;
  settlement: { promisedOn: IsoDate; floatDays: number; instant: boolean; reversible: boolean };
  previouslySignedOff: number;
}

// ─── agentic back-office ─────────────────────────────────────────────────────
export interface ReplenishmentItemView {
  productId: string;
  sku: string | null;
  name: string;
  supplierId: string | null;
  supplierName: string | null;
  onHand: number;
  /** On hand minus reserved, plus whatever is already in transit. */
  available: number;
  inTransit: number;
  /** Forecast units over the horizon. */
  demand: number;
  safetyStock: number;
  reorderPoint: number;
  targetStock: number;
  quantity: number;
  unitCost: number;
  cost: number;
  daysOfCover: number | null;
  /** 0-1 urgency: how soon stock runs out relative to the supplier lead time. */
  urgency: number;
  action: 'ORDER' | 'WATCH' | 'NONE' | 'EXCLUDED';
}

export interface ReplenishmentPlanView {
  items: ReplenishmentItemView[];
  bySupplier: { supplierId: string | null; supplierName: string | null; lines: number; units: number; cost: number }[];
  totals: { lines: number; units: number; cost: number; trimmed: number; trimmedCost: number };
  serviceLevel: number;
}

export interface ReplenishmentRunView {
  id: string;
  trigger: 'MANUAL' | 'AUTO';
  status: 'DRAFT' | 'APPROVED' | 'ORDERED' | 'DISCARDED';
  horizonDays: number;
  itemCount: number;
  supplierCount: number;
  estimatedCost: number;
  approvedBy: string | null;
  approvedAt: IsoDate | null;
  createdAt: IsoDate;
  plan?: ReplenishmentPlanView | null;
  guardrails?: Record<string, unknown> | null;
}

/** Response of POST /agent/replenish: the draft, plus the plan already filtered. */
export interface ReplenishmentPreviewView {
  runId: string;
  status: string;
  horizonDays: number;
  lookbackDays: number;
  serviceLevel: number;
  summary: string;
  totals: ReplenishmentPlanView['totals'];
  bySupplier: ReplenishmentPlanView['bySupplier'];
  items: ReplenishmentItemView[];
  watch: ReplenishmentItemView[];
  purchaseOrders?: { id: string; supplierId: string | null; lines: number; total: number }[];
}

// ─── vertical solutions ──────────────────────────────────────────────────────
/** What the POS terminal should surface when a trade solution is live. */
export interface PosHintsView {
  quickActions: { label: string; action: string }[];
  requiredAtCheckout: string[];
  defaultFulfillment?: string;
  lineBadges?: string[];
  notices?: string[];
}

export interface VerticalSolutionView {
  code: string;
  name: string;
  tagline: string;
  /** Organization.industry values this solution suits. */
  industries: string[];
  /** Markets where the trade profile is common enough to recommend first. */
  strongMarkets?: string[];
  version: string;
  capabilities: string[];
  posHints: PosHintsView;
  defaults: Record<string, unknown>;
  /** StoreSettings keys the install may apply. */
  settingsDelta?: Record<string, unknown>;
  confirmations?: string[];
  sharedCapabilities?: string[];
}

/** Capability two installed solutions both claim. */
export interface SolutionConflictView {
  capability: string;
  codes: string[];
  resolution: string;
}

export interface InstallPlanView {
  solutionCode: string;
  version: string;
  capabilities: string[];
  posHints: PosHintsView;
  defaults: Record<string, unknown>;
  settingsDelta: Record<string, unknown>;
  confirmations: string[];
  added: string[];
  alreadyActive: string[];
}

export interface VerticalInstallationView {
  id: string;
  solutionCode: string;
  version: string;
  status: 'INSTALLED' | 'RETIRED' | string;
  /** Capability flags the solution switched on (stored as JSON). */
  features: string[] | null;
  config: Record<string, unknown> | null;
  posHints: PosHintsView | null;
  /** Settings changed at install time, kept so a retire can roll them back. */
  appliedDelta: Record<string, unknown> | null;
  enabledBy: string | null;
  createdAt: IsoDate;
}

// ─── embedded finance ────────────────────────────────────────────────────────
export interface UnderwritingDecisionView {
  qualifies: boolean;
  score: number;
  band: string;
  suggestedLimit: number;
  ratePercent: number;
  sweepPercent: number;
  terms: { months: number; installment: number; totalInterest: number; totalRepayable: number }[];
  factors: { key: string; label: string; points: number; detail: string }[];
  declineReasons: string[];
  annualRevenueProxy: number;
  /** 0-1: how much of the model this tenant's data actually populated. */
  confidence: number;
}

export interface CreditFacilityView {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'ACTIVE' | 'CLOSED' | 'DEFAULTED' | string;
  requestedAmount: number;
  approvedLimit: number;
  drawnAmount: number;
  outstanding: number;
  rate: number;
  termMonths: number;
  installmentAmount: number;
  sweepPercent: number;
  score: number;
  scoreBand: string | null;
  nextDueDate: IsoDate | null;
  lastSweepAt: IsoDate | null;
  openedAt: IsoDate | null;
  closedAt: IsoDate | null;
  createdAt: IsoDate;
}

export interface LoanRepaymentView {
  id: string;
  facilityId: string;
  period: number;
  dueDate: IsoDate;
  principal: number;
  interest: number;
  total: number;
  paidAmount: number;
  status: 'DUE' | 'PARTIAL' | 'PAID' | 'OVERDUE' | string;
  paidAt: IsoDate | null;
}

// ─── agentic commerce ────────────────────────────────────────────────────────
/** The signed payload an agent presents; exactly what the signature covers. */
export interface MandateView {
  spec: string;
  agentId: string;
  merchantId: string;
  locationId: string | null;
  mandateType: string;
  principalEmail: string | null;
  currency: string;
  ceilingAmount: number;
  items: { sku?: string | null; productId?: string | null; gtin?: string | null; quantity: number; maxUnitPrice?: number | null }[];
  issuedAt: IsoDate;
  expiresAt: IsoDate;
  nonce: string;
  fulfilment: string | null;
  signature?: string;
}

/** The stored mandate row: the payload plus how it ended. */
export interface AgentMandateRowView extends MandateView {
  id: string;
  organizationId: string;
  agentName: string | null;
  amount: number;
  signatureAlg: string;
  status: 'ACTIVE' | 'FULFILLED' | 'REJECTED' | 'EXPIRED' | 'REVOKED' | string;
  rejectReason: string | null;
  orderId: string | null;
  fulfilledAt: IsoDate | null;
  createdAt: IsoDate;
}

export interface AgentDescriptorView {
  '@context': string;
  specification: string;
  merchantName: string;
  merchantId: string;
  countryCode: string | null;
  currency: string;
  endpoints: { catalog: string; checkout: string; mandateVerify: string; order: string };
  mandate: Record<string, unknown>;
  paymentMethods: string[];
  generatedAt: IsoDate;
}

// ─── store mesh ──────────────────────────────────────────────────────────────
export interface MeshFenceView {
  epoch: number;
  leaderDeviceId: string | null;
  committedSequence: number;
  leaseSeconds: number;
  lastCommitAt: IsoDate | null;
  /** Deterministic fencing token: proof of which epoch authorised a write. */
  token: string;
  expiresAt: IsoDate | null;
  stale: boolean;
}

export interface MeshDeviceView {
  id: string;
  name: string;
  type: string;
  status: string;
  lastHeartbeatAt: IsoDate | null;
  softwareVersion?: string | null;
}

export interface MeshLocationView {
  locationId: string;
  locationName: string;
  devices: MeshDeviceView[];
  fence: MeshFenceView;
  status: { leaderId: string | null; quorum: boolean; term: number; liveCount: number; downCount: number; leaseExpiresAt: IsoDate | null; health: 'HEALTHY' | 'DEGRADED' | 'ISOLATED' };
  electedLeader: string | null;
  term: number;
}

export interface MeshStatusView {
  locations: MeshLocationView[];
  health: 'HEALTHY' | 'DEGRADED' | 'ISOLATED';
  livenessWindowMs: number;
  leaseBounds: { min: number; max: number; default: number };
}

/** GET /mesh/locations/:id - one store, with the election result side by side. */
export interface MeshLocationDetailView {
  location: { id: string; name: string };
  devices: MeshDeviceView[];
  fence: {
    id: string;
    epoch: number;
    leaderDeviceId: string | null;
    previousLeaderId: string | null;
    committedSequence: number;
    leaseSeconds: number;
    lastCommitAt: IsoDate | null;
    reason: string | null;
    token: string;
    leaseExpired: boolean;
  };
  election: { leaderId: string | null; quorum: boolean; alive: string[]; unreachable: string[]; reason?: string | null };
  status: MeshLocationView['status'];
  wouldOverwrite: boolean;
}

// ─── franchise ───────────────────────────────────────────────────────────────
export interface FranchiseAgreementView {
  id: string;
  entityCode: string;
  franchiseeName: string;
  locationId: string | null;
  locationName: string | null;
  royaltyModel: 'PERCENT' | 'TIERED' | 'PER_ITEM' | 'FIXED';
  royaltyPercent: number;
  tiers: { upTo: number | null; percent: number }[] | null;
  perItemFee: number;
  fixedMonthly: number;
  minimumMonthly: number;
  marketingFundPercent: number;
  transferMarkupPercent: number;
  exclusions: string[] | null;
  currency: string;
  status: string;
  startDate: IsoDate;
  endDate: IsoDate | null;
}

export interface RoyaltyResultView {
  grossSales: number;
  excluded: { category: string; amount: number }[];
  taxableBase: number;
  unitsSold: number;
  royalty: number;
  marketingFund: number;
  minimumApplied: boolean;
  total: number;
  effectiveRatePercent: number | null;
  calculation: { step: string; detail: string; amount: number }[];
  model: string;
}

export interface RoyaltyAccrualView {
  id: string;
  agreementId: string;
  locationId: string | null;
  entityCode: string | null;
  franchiseeName: string | null;
  /** YYYY-MM label derived from periodStart. */
  period: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  grossSales: number;
  taxableBase: number;
  unitsSold: number;
  royaltyAmount: number;
  marketingFundAmount: number;
  minimumApplied: boolean;
  calculation?: { step: string; detail: string; amount: number }[] | null;
  status: 'CALCULATED' | 'INVOICED' | 'PAID' | 'DISPUTED' | string;
  /** Contracts settle 30 days after the period closes; aging counts from there. */
  dueDate: IsoDate;
  aging: { days: number; bucket: string } | null;
}

export interface ConsolidatedPnlView {
  entities: { entityCode: string; revenue: number; grossProfit: number; ebitda: number; marginPercent: number | null }[];
  totals: { revenue: number; costOfGoods: number; grossProfit: number; labour: number; operatingExpenses: number; ebitda: number; marginPercent: number | null };
  eliminations: { intercompanyRevenue: number; intercompanyCost: number; unrealisedProfit: number };
  royaltiesDue: number;
  topContributor: string | null;
}

// ─── ecosystem ───────────────────────────────────────────────────────────────
export interface CatalogAppView {
  code: string;
  name: string;
  publisher: string;
  categories: string[];
  markets?: string[];
  version: string;
  scopes: string[];
  endpoints: string[];
  events: string[];
  writes: boolean;
  handlesPersonalData: boolean;
  pricing: string;
  description: string;
  availableInMarket: boolean;
  installed: { status: string; scopes: string[]; id: string; installedAt: IsoDate } | null;
  risk: { scope: string; risk: 'LOW' | 'MEDIUM' | 'HIGH' };
  envKey?: string | null;
}

export interface AppInstallationView {
  id: string;
  appCode: string;
  appName: string;
  publisher: string | null;
  scopes: string[];
  config: Record<string, unknown> | null;
  status: string;
  hasToken: boolean;
  risk: { scope: string; risk: string };
  createdAt: IsoDate;
}

export interface CustomFieldView {
  id: string;
  entity: string;
  fieldKey: string;
  label: string;
  dataType: string;
  required: boolean;
  options: string[] | null;
  validation: { min?: number | null; max?: number | null; maxLength?: number | null; pattern?: string | null } | null;
  defaultValue: string | null;
  active: boolean;
  sortOrder: number;
}

// ─── peer benchmarking ───────────────────────────────────────────────────────
export interface BenchmarkMetricView {
  key: string;
  label: string;
  unit: string;
  higherIsBetter: boolean;
  minCohort?: number;
  description?: string;
}

export interface CohortResultView {
  metricKey: string | null;
  publishable: boolean;
  reason: string | null;
  cohortSize: number;
  k: number;
  clipped: number;
  median: number | null;
  p10: number | null;
  p25: number | null;
  p75: number | null;
  p90: number | null;
  noiseApplied: number;
  range: { min: number; max: number } | null;
  self: { value: number; percentile: number; vsMedian: number; verdict: 'AHEAD' | 'BEHIND' | 'IN_LINE' } | null;
}

export interface BenchmarkView {
  metric: BenchmarkMetricView;
  windowDays: number;
  self: number | null;
  cohort: CohortResultView | null;
  headline: string;
  privacy: { cohortSize: number; minimumRequired: number; publishable: boolean; epsilon: number; noiseApplied: number; clipped: number };
  participation: { reporting: number; eligible: number; rate: number; representative: boolean };
}

// ─── RECORD OF PROCESSING ACTIVITIES (RoPA) — GDPR Art. 30 ───────────────────
// A documented register of the processing activities Unified POS performs on
// behalf of each tenant (controller), with purpose, legal basis, data
// categories, retention and recipients. Served by GET /api/compliance/ropa.
export interface ProcessingActivity {
  id: string;
  activity: string;
  purpose: string;
  legalBasis: string;
  dataCategories: string[];
  dataSubjects: string[];
  retention: string;
  recipients: string[];
  crossBorderTransfers: string;
}

export const ROPA_REGISTER: ProcessingActivity[] = [
  {
    id: 'ropa-accounts',
    activity: 'Merchant account & organisation provisioning',
    purpose: 'Create and administer tenant organisations, locations, registers and user accounts.',
    legalBasis: 'Contract (Art. 6(1)(b))',
    dataCategories: ['Contact details', 'Business identity', 'Credentials (hashed)'],
    dataSubjects: ['Merchant owners', 'Employees'],
    retention: 'Life of account + 30 days, then anonymised',
    recipients: ['Hosting provider', 'Support tooling'],
    crossBorderTransfers: 'None by default; configurable per deployment',
  },
  {
    id: 'ropa-pos',
    activity: 'Point-of-sale transaction processing',
    purpose: 'Record sales, tenders, refunds and receipts for the merchant.',
    legalBasis: 'Contract (Art. 6(1)(b))',
    dataCategories: ['Order line items', 'Payment tokens (no PAN)', 'Timestamps'],
    dataSubjects: ['Customers (indirect)', 'Cashiers'],
    retention: 'Configurable via data-retention policy (default: keep)',
    recipients: ['Payment service providers (tokenized)'],
    crossBorderTransfers: 'PSP-dependent',
  },
  {
    id: 'ropa-crm',
    activity: 'Customer relationship & loyalty management',
    purpose: 'Maintain customer profiles, preferences, loyalty balances and marketing consent.',
    legalBasis: 'Consent (Art. 6(1)(a)) / Legitimate interest (Art. 6(1)(f))',
    dataCategories: ['Contact details', 'Purchase history', 'Consent records', 'Loyalty points'],
    dataSubjects: ['End customers'],
    retention: 'Configurable via data-retention policy; purged on DSAR deletion',
    recipients: ['Marketing integrations (only with consent)'],
    crossBorderTransfers: 'Only to consented integrations',
  },
  {
    id: 'ropa-employees',
    activity: 'Workforce management',
    purpose: 'Scheduling, time & attendance, roles, commissions and payroll inputs.',
    legalBasis: 'Contract (Art. 6(1)(b)) / Legal obligation (Art. 6(1)(c))',
    dataCategories: ['Employment records', 'Time entries', 'Compensation'],
    dataSubjects: ['Employees'],
    retention: 'Statutory payroll periods where applicable',
    recipients: ['Payroll / accounting integrations'],
    crossBorderTransfers: 'Integration-dependent',
  },
  {
    id: 'ropa-security',
    activity: 'Security, audit & fraud prevention',
    purpose: 'Authenticate users, enforce RBAC, record audit events, rate-limit and detect abuse.',
    legalBasis: 'Legitimate interest (Art. 6(1)(f)) / Legal obligation (Art. 6(1)(c))',
    dataCategories: ['Auth events', 'Audit log', 'Device / IP metadata', 'MFA status'],
    dataSubjects: ['Users', 'Employees'],
    retention: 'Audit log retained per retention policy; security events 12 months',
    recipients: ['None (internal)'],
    crossBorderTransfers: 'None',
  },
  {
    id: 'ropa-analytics',
    activity: 'Business intelligence & AI decision-support',
    purpose: 'Aggregate reporting, forecasting and copilot recommendations (human-in-the-loop).',
    legalBasis: 'Legitimate interest (Art. 6(1)(f))',
    dataCategories: ['Aggregated sales', 'Inventory metrics', 'Labour metrics'],
    dataSubjects: ['None directly (aggregated)'],
    retention: 'Aggregates only; source data per retention policy',
    recipients: ['None (internal)'],
    crossBorderTransfers: 'None',
  },
  {
    id: 'ropa-dsar',
    activity: 'Data-subject & compliance requests',
    purpose: 'Fulfil access / portability / erasure requests and record consent.',
    legalBasis: 'Legal obligation (Art. 6(1)(c))',
    dataCategories: ['Request metadata', 'Consent payloads'],
    dataSubjects: ['End customers', 'Users'],
    retention: '3 years from request resolution',
    recipients: ['None (internal)'],
    crossBorderTransfers: 'None',
  },
];

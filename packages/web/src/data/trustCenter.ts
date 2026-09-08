// ─── Trust Center content (PCI SAQ-A + SOC 2) ───────────────────────────────
// Documentation scaffold surfaced in the Compliance Center → "Trust center" tab.
// This is guidance and a control map, NOT a completed attestation or legal
// advice: SAQ A must be attested with your acquirer and SOC 2 requires an
// independent auditor. Statuses reflect controls shipped in the product.

export type TrustStatus = 'IMPLEMENTED' | 'PARTIAL' | 'DELEGATED' | 'GAP';

export interface SaqASection {
  part: string;
  title: string;
  detail: string;
  status: TrustStatus;
}

export interface ControlRow {
  id: string;
  requirement: string;
  how: string;
  status: TrustStatus;
  evidence?: string;
}

export const SAQ_A_ELIGIBILITY = {
  form: 'SAQ A',
  version: 'PCI DSS v4.0',
  headline: 'Cardholder data never touches UnifiedPOS servers.',
  rationale: [
    'Card-not-present payments are collected by Stripe Elements / the Payment Element and sent directly to the processor; our servers only ever see a tokenized payment_method id (pm_...).',
    'Card-present payments use a P2PE-validated reader that encrypts track data at the swipe/dip/tap; only a token is returned to the app.',
    'No PAN, track data, or CVV is stored, processed, or transmitted through UnifiedPOS infrastructure — the core eligibility condition for SAQ A.',
  ],
  outOfScope: [
    'If you add custom checkout forms that handle a raw card number, or store card data, you leave SAQ A scope (SAQ D applies). Keep using the tokenized gateway integration to stay in the shortest questionnaire.',
  ],
};

export const SAQ_A_SECTIONS: SaqASection[] = [
  { part: 'Part I', title: 'Before you begin', detail: 'Confirm your merchant level with your acquirer and that all card acceptance uses the third-party, tokenized flow.', status: 'DELEGATED' },
  { part: 'Part II', title: 'Validation elements', detail: 'Payment pages use PSP-hosted / JS-tokenized fields; no electronic storage of cardholder data; your site does not control the content of the payment form.', status: 'IMPLEMENTED' },
  { part: 'Part III', title: 'Qualifying business attestation', detail: 'A company officer attests that all card acceptance is outsourced to the validated third party. This is completed on the SAQ form itself.', status: 'GAP' },
  { part: 'Scans', title: 'ASV / quarterly scans', detail: 'SAQ A merchants generally do not require ASV scans, but confirm with your acquirer. Any public endpoints you add should be scanned.', status: 'PARTIAL' },
];

export const SOC2_TSC: ControlRow[] = [
  { id: 'CC6.1', requirement: 'Logical access security', how: 'Role-based access (OWNER/ADMIN/MANAGER/…), httpOnly session cookies, optional TOTP MFA.', status: 'IMPLEMENTED', evidence: 'Permissions page; MFA in Security & governance tab' },
  { id: 'CC6.6', requirement: 'Protection against external threats', how: 'Rate limiting on auth/payment endpoints, CSRF protection, request validation (Zod).', status: 'IMPLEMENTED', evidence: 'middleware/rateLimiter.ts, middleware/csrf.ts' },
  { id: 'CC7.2', requirement: 'Monitoring & anomaly detection', how: 'Prometheus metrics at /api/metrics, alert thresholds (payment/sync failures, 5xx), optional Sentry error tracking.', status: 'IMPLEMENTED', evidence: 'services/observability.ts; System page' },
  { id: 'CC7.3 / CC7.4', requirement: 'Incident response', how: 'Breach register with regulator / individual notification workflow (GDPR Art. 33-34).', status: 'PARTIAL', evidence: 'Security & governance tab' },
  { id: 'CC8.1', requirement: 'Change management', how: 'CI pipeline with type-check, tests, and a coverage gate; audit log of domain changes.', status: 'IMPLEMENTED', evidence: '.github/workflows/ci.yml; Audit log' },
  { id: 'CC9.2', requirement: 'Vendor risk management', how: 'PSP (Stripe) is PCI DSS Level 1; sub-processor list maintained below.', status: 'PARTIAL', evidence: 'Trust center → sub-processors' },
  { id: 'A1.2', requirement: 'Backup & recovery (Availability)', how: 'PostgreSQL PITR / WAL-archiving guidance with documented RPO/RTO.', status: 'PARTIAL', evidence: 'System → backup-config' },
  { id: 'C1.1 / C1.2', requirement: 'Confidential data protection', how: 'TLS in transit and encryption at rest; retention policy + purge with legal hold.', status: 'IMPLEMENTED', evidence: 'Data retention panel' },
  { id: 'P4 / P5', requirement: 'Data-subject rights (Privacy)', how: 'DSAR export + right-to-erasure requests; consent preferences; RoPA.', status: 'IMPLEMENTED', evidence: 'Your data & requests tab' },
  { id: 'PI1.4', requirement: 'Complete & accurate processing (Integrity)', how: 'Money-path mutations wrapped in DB transactions (order + payment + inventory); idempotency keys on payments; offline-sync dedupe.', status: 'IMPLEMENTED', evidence: 'routes/orders.ts $transaction; middleware/idempotency.ts; routes/sync.ts' },
];

export const SUBPROCESSORS = [
  { name: 'Stripe', role: 'Payment processor — PCI DSS Level 1 service provider' },
  { name: 'Sentry (optional)', role: 'Error tracking — active only when SENTRY_DSN is configured' },
];

export const ATTESTATION_CHECKLIST = [
  'Confirm your merchant level and SAQ type with your acquirer (SAQ A is expected for the tokenized flow).',
  'Verify no raw PAN is ever handled by custom code — keep the tokenized gateway integration.',
  'Complete the SAQ A Attestation of Compliance (Part III) and have a company officer sign it.',
  'For SOC 2: engage an auditor, map the controls above to evidence, and schedule a Type II observation window.',
  'Run quarterly vulnerability scans and an annual penetration test if your acquirer or enterprise customers require it.',
];

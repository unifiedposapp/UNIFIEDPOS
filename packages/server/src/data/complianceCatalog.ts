// ─── COMPLIANCE CATALOG ──────────────────────────────────────────────────────
// Single authoritative source for the in-app Compliance Center checklist.
// Each item maps a real-world regulation to what Unified POS already does
// ("addressedBy"), an honest status, and what still requires action ("gaps").
// This is guidance, not legal advice — statuses reflect shipped app features.

export type ComplianceStatus = 'IMPLEMENTED' | 'PARTIAL' | 'GAP' | 'DELEGATED';

export interface ComplianceItem {
  id: string;
  regulation: string;
  region: string;
  domain: string;
  status: ComplianceStatus;
  summary: string;
  addressedBy: string[];
  gaps: string[];
}

export const COMPLIANCE_DOMAINS: string[] = [
  'DATA_PRIVACY',
  'PAYMENTS_CARD_SECURITY',
  'ACCESSIBILITY',
  'TAX_INVOICING',
  'CONSUMER_PROTECTION',
  'SECURITY_BREACH',
  'DATA_GOVERNANCE',
  'INDUSTRY_SPECIFIC',
  'AI_AUTOMATION',
];

export const DOMAIN_LABELS: Record<string, string> = {
  DATA_PRIVACY: 'Data Privacy',
  PAYMENTS_CARD_SECURITY: 'Payments & Card Security',
  ACCESSIBILITY: 'Accessibility',
  TAX_INVOICING: 'Tax & Invoicing',
  CONSUMER_PROTECTION: 'Consumer Protection',
  SECURITY_BREACH: 'Security & Breach',
  DATA_GOVERNANCE: 'Data Governance',
  INDUSTRY_SPECIFIC: 'Industry-Specific',
  AI_AUTOMATION: 'AI & Automation',
};

export const STATUS_LABELS: Record<ComplianceStatus, string> = {
  IMPLEMENTED: 'Implemented',
  PARTIAL: 'Partial',
  GAP: 'Gap',
  DELEGATED: 'Delegated to provider',
};

export const COMPLIANCE_CHECKLIST: ComplianceItem[] = [
  // ── Data Privacy ──
  {
    id: 'gdpr', regulation: 'GDPR', region: 'EU / EEA', domain: 'DATA_PRIVACY', status: 'PARTIAL',
    summary: 'General Data Protection Regulation — lawful basis, data-subject rights, breach notice, accountability.',
    addressedBy: ['Privacy Policy', 'Granular consent (Compliance Center)', 'Data export & deletion request (DSAR)', 'Audit log', 'Per-tenant data isolation', 'Cookie consent banner', 'Breach-notification workflow', 'Record of Processing Activities (RoPA)'],
    gaps: ['Executed Data Processing Agreement (DPA)', 'EU data residency', 'Designate a DPO / EU representative'],
  },
  {
    id: 'ccpa', regulation: 'CCPA / CPRA', region: 'California, US', domain: 'DATA_PRIVACY', status: 'PARTIAL',
    summary: 'California consumer privacy — right to know, delete, correct, opt-out of sale/share.',
    addressedBy: ['Privacy Policy (rights disclosure)', 'Data export & deletion request', 'No sale of personal data'],
    gaps: ['Verified-request workflow', '"Do Not Sell or Share" opt-out signal', 'Notice at collection', 'Correction right UI'],
  },
  {
    id: 'lgpd', regulation: 'LGPD', region: 'Brazil', domain: 'DATA_PRIVACY', status: 'PARTIAL',
    summary: 'Lei Geral de Proteção de Dados — Brazilian data protection law.',
    addressedBy: ['Global Privacy Policy', 'Consent management', 'Data-subject requests'],
    gaps: ['ANPD-specific notices', 'Encarregado (DPO) designation', 'Portuguese-language policy'],
  },
  {
    id: 'ndpa', regulation: 'DPDP Act 2023', region: 'India', domain: 'DATA_PRIVACY', status: 'PARTIAL',
    summary: 'Digital Personal Data Protection Act — consent, rights, breach notification.',
    addressedBy: ['Privacy Policy', 'Consent management', 'Data-subject rights'],
    gaps: ['Data localization for notified data', 'Data Protection Officer', 'Breach notice to Data Protection Board'],
  },
  {
    id: 'popia', regulation: 'POPIA', region: 'South Africa', domain: 'DATA_PRIVACY', status: 'PARTIAL',
    summary: 'Protection of Personal Information Act.',
    addressedBy: ['Privacy Policy', 'Consent management', 'Data-subject requests'],
    gaps: ['Information Officer registration', 'PAIA manual publication'],
  },
  {
    id: 'pipeda', regulation: 'PIPEDA', region: 'Canada', domain: 'DATA_PRIVACY', status: 'PARTIAL',
    summary: 'Personal Information Protection and Electronic Documents Act.',
    addressedBy: ['Privacy Policy', 'Consent records'],
    gaps: ['Meaningful-consent evidence', 'Breach report to OPC'],
  },
  {
    id: 'pdpa', regulation: 'PDPA / PDPL', region: 'Singapore · UAE · Saudi · Thailand', domain: 'DATA_PRIVACY', status: 'PARTIAL',
    summary: 'Regional personal data protection acts across APAC and the GCC.',
    addressedBy: ['Privacy Policy', 'Consent management', 'Worldwide address & locale support'],
    gaps: ['Local DPO appointment', 'Cross-border transfer approvals (Saudi PDPL, UAE)', 'Localized notices'],
  },
  {
    id: 'privacy-act-au-nz', regulation: 'Privacy Act 2020 (APPs)', region: 'Australia / New Zealand', domain: 'DATA_PRIVACY', status: 'PARTIAL',
    summary: 'Australian Privacy Principles and NZ Privacy Act; Notifiable Data Breaches scheme.',
    addressedBy: ['Privacy Policy', 'Data-subject requests'],
    gaps: ['APP-compliant privacy policy', 'Notifiable Data Breaches (NDB) workflow'],
  },
  {
    id: 'cookie-eprivacy', regulation: 'Cookie / ePrivacy consent', region: 'EU / UK', domain: 'DATA_PRIVACY', status: 'IMPLEMENTED',
    summary: 'Consent for non-essential cookies and similar technologies.',
    addressedBy: ['Cookie consent banner', 'Granular consent stored per organization', 'Cookie Policy'],
    gaps: ['Periodic consent refresh (recommended 12 months)'],
  },
  {
    id: 'data-residency', regulation: 'Data residency & localization', region: 'China PIPL · Russia 152-FZ · India · Indonesia · Saudi', domain: 'DATA_PRIVACY', status: 'GAP',
    summary: 'Certain jurisdictions require personal data to be stored/processed in-country.',
    addressedBy: ['Multi-tenant scoping (organizationId)'],
    gaps: ['In-region hosting / replication', 'Cross-border transfer safeguards (SCCs)', 'Data-residency configuration per tenant'],
  },

  // ── Payments & Card Security ──
  {
    id: 'pci-dss', regulation: 'PCI DSS v4.0', region: 'Global', domain: 'PAYMENTS_CARD_SECURITY', status: 'DELEGATED',
    summary: 'Payment Card Industry Data Security Standard for handling card data.',
    addressedBy: ['Payments via tokenizing PSPs (Stripe · Adyen · Braintree)', 'No PAN/CVV stored in app', 'TLS in transit', 'RBAC', 'Audit log'],
    gaps: ['SAQ-A / SAQ-D attestation', 'Quarterly ASV scans', 'Formal ROC if in scope', 'PSP responsibility matrix'],
  },
  {
    id: 'psd2-sca', regulation: 'PSD2 / SCA', region: 'EU / UK', domain: 'PAYMENTS_CARD_SECURITY', status: 'DELEGATED',
    summary: 'Strong Customer Authentication for electronic payments.',
    addressedBy: ['3-D Secure handled by PSP integrations'],
    gaps: ['Confirm PSP enforces SCA', 'Exemption/low-value logic owned by PSP'],
  },
  {
    id: 'kyc-aml', regulation: 'KYC / AML', region: 'Global', domain: 'PAYMENTS_CARD_SECURITY', status: 'DELEGATED',
    summary: 'Know Your Customer and Anti-Money-Laundering for merchant onboarding and payouts.',
    addressedBy: ['Payouts via PSP', 'Business tax ID capture'],
    gaps: ['Merchant KYC document collection', 'Sanctions / PEP screening', 'Suspicious-activity reporting'],
  },

  // ── Accessibility ──
  {
    id: 'wcag', regulation: 'WCAG 2.1 / 2.2 AA', region: 'Global (EN 301 549 · ADA §508)', domain: 'ACCESSIBILITY', status: 'PARTIAL',
    summary: 'Web Content Accessibility Guidelines for inclusive digital experiences.',
    addressedBy: ['Semantic markup', 'Visible focus rings', 'Labeled inputs', 'Contrast-aware palette', 'Accessibility Statement'],
    gaps: ['Full audit (screen reader + keyboard-only POS grid)', 'Remediation plan', 'Captions/transcripts for media'],
  },
  {
    id: 'eaa-ada', regulation: 'European Accessibility Act / ADA', region: 'EU / US', domain: 'ACCESSIBILITY', status: 'GAP',
    summary: 'Mandatory accessibility for digital services and commerce (EAA in force 2025).',
    addressedBy: ['Accessibility Statement'],
    gaps: ['Conformance testing (VPAT/ACR)', 'Accessible receipts & hardware interfaces'],
  },

  // ── Tax & Invoicing ──
  {
    id: 'vat-gst', regulation: 'VAT / GST / Sales Tax', region: 'Global', domain: 'TAX_INVOICING', status: 'PARTIAL',
    summary: 'Indirect tax calculation, registration and reporting.',
    addressedBy: ['TaxRule engine', 'Business tax ID field', 'Tax integrations (Avalara · TaxJar · Stripe Tax · Sovos)', 'Per-location tax rates'],
    gaps: ['Tax registration numbers per jurisdiction', 'Exempt / reverse-charge handling', 'Filing calendars'],
  },
  {
    id: 'einvoicing', regulation: 'E-invoicing mandates', region: 'EU ViDA · India IRN · Brazil NF-e · Mexico CFDI · Saudi ZATCA', domain: 'TAX_INVOICING', status: 'GAP',
    summary: 'Country-mandated electronic invoicing formats, signatures and clearance.',
    addressedBy: ['Invoicing module', 'Tax integrations'],
    gaps: ['Country e-invoice formats & digital signatures', 'Real-time clearance / CTC', 'QR codes (e.g. ZATCA Fatoora)'],
  },
  {
    id: 'dac7-1099k', regulation: 'DAC7 / 1099-K seller reporting', region: 'EU / US', domain: 'TAX_INVOICING', status: 'GAP',
    summary: 'Marketplace/platform seller income reporting to tax authorities.',
    addressedBy: ['Reporting module', 'Payment settlement records'],
    gaps: ['Seller reporting to tax authorities', '1099-K generation & thresholds'],
  },

  // ── Consumer Protection ──
  {
    id: 'refunds-cooling-off', regulation: 'Refunds & cooling-off', region: 'EU (14-day) · UK CCR · US', domain: 'CONSUMER_PROTECTION', status: 'PARTIAL',
    summary: 'Right to withdraw, refunds and returns for distance/online sales.',
    addressedBy: ['Refund / void / return flows', 'Refund & Return Policy', 'Itemized receipts'],
    gaps: ['Jurisdiction-specific cooling-off windows', 'Pre-contractual disclosures'],
  },
  {
    id: 'pricing-transparency', regulation: 'Pricing & receipt transparency', region: 'EU / UK', domain: 'CONSUMER_PROTECTION', status: 'PARTIAL',
    summary: 'Unit pricing, VAT-inclusive display and clear receipt breakdowns.',
    addressedBy: ['Tax-inclusive pricing options', 'Detailed receipts'],
    gaps: ['Unit-price display', 'Per-country VAT breakdown on receipts'],
  },

  // ── Security & Breach ──
  {
    id: 'infosec', regulation: 'SOC 2 / ISO 27001 controls', region: 'Global', domain: 'SECURITY_BREACH', status: 'PARTIAL',
    summary: 'Information-security program, access control and assurance.',
    addressedBy: ['bcrypt password hashing', 'JWT authentication', 'RBAC / permission matrix', 'Rate limiting (§37)', 'Idempotency (§36)', 'Audit log', 'Tenant isolation', 'MFA / TOTP two-factor (§37)', 'AES-256-GCM encryption-at-rest for integration credentials', 'Centralised secrets with no production fallback'],
    gaps: ['Vulnerability scanning & pen test', 'Incident-response plan', 'SOC 2 audit'],
  },
  {
    id: 'breach-notice', regulation: 'Breach notification', region: 'GDPR 72h · CCPA · US state laws', domain: 'SECURITY_BREACH', status: 'PARTIAL',
    summary: 'Detect, assess and notify regulators and individuals of personal-data breaches.',
    addressedBy: ['Audit log', 'Breach register (BreachIncident)', 'Assess → notify workflow with regulator/individual timestamps', 'Audit-linked breach events'],
    gaps: ['Regulator-specific submission portals', 'Automated 72h countdown alerting'],
  },
  {
    id: 'session-device', regulation: 'Session & credential controls', region: 'Global', domain: 'SECURITY_BREACH', status: 'PARTIAL',
    summary: 'Password policy, session management and account protection.',
    addressedBy: ['JWT sessions', 'Password reset', 'Auth rate limiting', 'Account lockout after repeated failures', 'Password complexity policy'],
    gaps: ['Active-session listing & revocation', 'Device trust', 'Password rotation'],
  },

  // ── Data Governance ──
  {
    id: 'retention', regulation: 'Data retention & legal hold', region: 'Global', domain: 'DATA_GOVERNANCE', status: 'PARTIAL',
    summary: 'Retain data only as long as necessary; support legal hold.',
    addressedBy: ['Audit log with timestamps', 'Configurable retention period per tenant', 'On-demand purge honoring retention', 'Legal hold that blocks purging'],
    gaps: ['Scheduled (cron) automatic purge'],
  },
  {
    id: 'ropa', regulation: 'Records of Processing (RoPA)', region: 'EU', domain: 'DATA_GOVERNANCE', status: 'IMPLEMENTED',
    summary: 'Documented register of processing activities and data flows.',
    addressedBy: ['Data export (DSAR) inventory', 'Processing-activity register (GET /compliance/ropa)', 'Data-flow & recipient mapping per activity'],
    gaps: ['Annual RoPA review cadence'],
  },

  // ── Industry-Specific ──
  {
    id: 'age-restricted', regulation: 'Age-restricted sales', region: 'Alcohol · tobacco · vape · cannabis', domain: 'INDUSTRY_SPECIFIC', status: 'GAP',
    summary: 'Verify legal age before selling restricted goods.',
    addressedBy: ['Product catalog with categories'],
    gaps: ['Age-verification prompt at POS', 'ID-check logging', 'Restricted-hours rules'],
  },
  {
    id: 'food-allergen', regulation: 'Food safety & allergen labeling', region: 'EU · UK (Natasha\'s Law) · US menu labeling', domain: 'INDUSTRY_SPECIFIC', status: 'GAP',
    summary: 'Disclose allergens, ingredients and calories for prepared food.',
    addressedBy: ['Product / modifier information'],
    gaps: ['Allergen attributes', 'Calorie / ingredient labeling', 'Pre-packed food labeling'],
  },
  {
    id: 'hipaa', regulation: 'HIPAA / health data', region: 'US', domain: 'INDUSTRY_SPECIFIC', status: 'GAP',
    summary: 'Protected health information safeguards (only if health data is processed).',
    addressedBy: ['RBAC / audit log'],
    gaps: ['PHI encryption & minimum-necessary access', 'Business Associate Agreement (BAA)', 'Not applicable unless health data is stored'],
  },

  // ── AI & Automation ──
  {
    id: 'eu-ai-act', regulation: 'EU AI Act (transparency)', region: 'EU', domain: 'AI_AUTOMATION', status: 'PARTIAL',
    summary: 'Transparency and oversight obligations for AI systems.',
    addressedBy: ['AI Copilot / Insights are decision-support (human-in-the-loop)'],
    gaps: ['AI usage disclosure to users', 'Human-oversight statement', 'Data-use notice for AI', 'Logging of AI outputs'],
  },
  {
    id: 'automated-decisions', regulation: 'Automated decision-making / profiling', region: 'GDPR Art. 22', domain: 'AI_AUTOMATION', status: 'GAP',
    summary: 'Notice and right to human review where profiling has legal/significant effects.',
    addressedBy: ['Privacy Policy'],
    gaps: ['Explicit profiling notice', 'Right to human review workflow'],
  },
];

export function complianceByDomain(): { domain: string; label: string; items: ComplianceItem[] }[] {
  return COMPLIANCE_DOMAINS.map((domain) => ({
    domain,
    label: DOMAIN_LABELS[domain] || domain,
    items: COMPLIANCE_CHECKLIST.filter((i) => i.domain === domain),
  })).filter((g) => g.items.length > 0);
}

export const COMPLIANCE_STATS = {
  total: COMPLIANCE_CHECKLIST.length,
  implemented: COMPLIANCE_CHECKLIST.filter((i) => i.status === 'IMPLEMENTED').length,
  partial: COMPLIANCE_CHECKLIST.filter((i) => i.status === 'PARTIAL').length,
  gap: COMPLIANCE_CHECKLIST.filter((i) => i.status === 'GAP').length,
  delegated: COMPLIANCE_CHECKLIST.filter((i) => i.status === 'DELEGATED').length,
  domains: COMPLIANCE_DOMAINS.length,
};

// Consent purposes surfaced in the Compliance Center + cookie banner.
export interface ConsentPurpose { key: string; label: string; description: string; essential?: boolean; }

export const CONSENT_PURPOSES: ConsentPurpose[] = [
  { key: 'necessary', label: 'Strictly necessary', description: 'Authentication, security and core POS operations. Always on.', essential: true },
  { key: 'functional', label: 'Functional', description: 'Remembers preferences such as language, theme and saved layouts.' },
  { key: 'analytics', label: 'Analytics & measurement', description: 'Aggregated usage insights to improve the product.' },
  { key: 'marketing', label: 'Marketing & communications', description: 'Product news, offers and promotional emails.' },
  { key: 'thirdPartySharing', label: 'Third-party sharing', description: 'Share data with connected partners (e.g. accounting, delivery).' },
];

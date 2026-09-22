// ─── COUNTRY COMPLIANCE / DATA-PROTECTION PROFILES ───────────────────────────
// The third leg of "configure this country" (after fiscal *sealing* in
// fiscalProfiles.ts and the tax *rate* in taxProfiles.ts): which privacy / data-
// protection law governs customer data, whether records must stay inside the
// border, what the tax-ID field is actually called locally, the e-invoice
// message standard, and the legal lines a receipt is expected to carry.
//
// This is ROUTING / GUIDANCE metadata to help a merchant configure correctly and
// to drive receipts and the compliance centre — it is NOT legal advice, and
// nothing here auto-submits to a regulator. Requirements change; verify against
// official guidance before relying on them.
//
// `receiptLegalLines` are sensible *defaults*: the store can override its own
// footer in Settings; these seed the mandatory-looking lines (VAT/TIN number,
// tax-inclusive wording) a first receipt in that market should show.

export type DataResidency =
  | 'NONE'                       // no localization requirement
  | 'RECOMMENDED'                // strongly expected, not absolute
  | 'PUBLIC_SECTOR_IN_COUNTRY'   // govt / certain data must be in-country
  | 'MANDATORY_IN_COUNTRY';      // broad personal-data localization

export interface ComplianceProfile {
  countryCode: string; // ISO 3166-1 alpha-2
  country: string;
  region: string;
  /** Name of the governing personal-data / privacy law. */
  privacyLaw: string;
  privacyAuthority?: string;
  dataResidency: DataResidency;
  /** Local label for the business tax identifier (printed on receipts). */
  taxIdLabel: string;
  /** Predominant structured e-invoice standard, if mandated. */
  eInvoiceFormat?: string;
  /** Default legal lines to print near the foot of a receipt. */
  receiptLegalLines: string[];
  notes?: string;
}

export const COMPLIANCE_REGION_ORDER: string[] = [
  'North America', 'Latin America & Caribbean', 'Europe', 'Africa',
  'Middle East', 'South Asia', 'East Asia', 'Southeast Asia', 'Oceania',
];

const VAT_INCL = ['Prices include VAT where applicable.'];

export const COMPLIANCE_PROFILES: ComplianceProfile[] = [
  // ── Europe (GDPR family + UK + RU) ──────────────────────────────────────
  { countryCode: 'EU', country: 'European Union', region: 'Europe', privacyLaw: 'GDPR', privacyAuthority: 'EDPB / national DPAs', dataResidency: 'NONE', taxIdLabel: 'VAT ID', eInvoiceFormat: 'EN 16931 (Peppol / UBL / UN/CEFACT)', receiptLegalLines: ['VAT ID: {taxId}', ...VAT_INCL], notes: 'Free movement of personal data within the EEA; transfers outside need adequacy or SCCs.' },
  { countryCode: 'DE', country: 'Germany', region: 'Europe', privacyLaw: 'GDPR + BDSG', privacyAuthority: 'BfDI / state DPAs', dataResidency: 'NONE', taxIdLabel: 'USt-IdNr.', eInvoiceFormat: 'XRechnung / ZUGFeRD (EN 16931)', receiptLegalLines: ['USt-IdNr.: {taxId}', 'Kassensicherheitsgesetz (TSE) compliance applies.'] },
  { countryCode: 'FR', country: 'France', region: 'Europe', privacyLaw: 'RGPD + Loi Informatique et Libertés', privacyAuthority: 'CNIL', dataResidency: 'NONE', taxIdLabel: 'N° TVA intracommunautaire', eInvoiceFormat: 'Factur-X (mandated B2B from 2026–27)', receiptLegalLines: ['TVA: {taxId}', ...VAT_INCL] },
  { countryCode: 'GB', country: 'United Kingdom', region: 'Europe', privacyLaw: 'UK GDPR + Data Protection Act 2018', privacyAuthority: 'ICO', dataResidency: 'NONE', taxIdLabel: 'VAT No.', eInvoiceFormat: 'Making Tax Digital (MTD) compatible records', receiptLegalLines: ['VAT No.: {taxId}', 'Registered address shown on request.'] },
  { countryCode: 'ES', country: 'Spain', region: 'Europe', privacyLaw: 'RGPD + LOPDGDD', privacyAuthority: 'AEPD', dataResidency: 'NONE', taxIdLabel: 'NIF', eInvoiceFormat: 'Veri*factu / FaceS (Facturae)', receiptLegalLines: ['NIF: {taxId}', ...VAT_INCL] },
  { countryCode: 'IT', country: 'Italy', region: 'Europe', privacyLaw: 'GDPR + D.Lgs. 196/2003', privacyAuthority: 'Garante', dataResidency: 'NONE', taxIdLabel: 'P. IVA', eInvoiceFormat: 'FatturaPA (XML, SdI)', receiptLegalLines: ['P. IVA: {taxId}'] },
  { countryCode: 'NL', country: 'Netherlands', region: 'Europe', privacyLaw: 'UAVG (GDPR)', privacyAuthority: 'AP', dataResidency: 'NONE', taxIdLabel: 'BTW-nummer', eInvoiceFormat: 'Peppol NL', receiptLegalLines: ['BTW: {taxId}', ...VAT_INCL] },
  { countryCode: 'PL', country: 'Poland', region: 'Europe', privacyLaw: 'RODO (GDPR)', privacyAuthority: 'UODO', dataResidency: 'NONE', taxIdLabel: 'NIP', eInvoiceFormat: 'KSeF (FA(2) XML)', receiptLegalLines: ['NIP: {taxId}'] },
  { countryCode: 'SE', country: 'Sweden', region: 'Europe', privacyLaw: 'GDPR', privacyAuthority: 'IMY', dataResidency: 'NONE', taxIdLabel: 'Org.nr.', eInvoiceFormat: 'Peppol', receiptLegalLines: ['Org.nr.: {taxId}'] },
  { countryCode: 'CH', country: 'Switzerland', region: 'Europe', privacyLaw: 'nDSG (revDSG)', privacyAuthority: 'FPDT', dataResidency: 'NONE', taxIdLabel: 'UID (MWST)', receiptLegalLines: ['MWST-Nr.: {taxId}'] },
  { countryCode: 'RO', country: 'Romania', region: 'Europe', privacyLaw: 'GDPR', privacyAuthority: 'ANSPDCP', dataResidency: 'NONE', taxIdLabel: 'CUI/CIF', eInvoiceFormat: 'e-Factura (RO e-Invoice XML)', receiptLegalLines: ['CIF: {taxId}'] },
  { countryCode: 'UA', country: 'Ukraine', region: 'Europe', privacyLaw: 'Law on Personal Data Protection (GDPR-aligned draft)', dataResidency: 'PUBLIC_SECTOR_IN_COUNTRY', taxIdLabel: 'РНОКПП / ЄДРПОУ', receiptLegalLines: ['Под. №: {taxId}'] },
  { countryCode: 'RU', country: 'Russia', region: 'Europe', privacyLaw: 'Federal Law 152-FZ', privacyAuthority: 'Roskomnadzor', dataResidency: 'MANDATORY_IN_COUNTRY', taxIdLabel: 'ИНН', eInvoiceFormat: 'FP (ФНС) electronic invoice', notes: '152-FZ requires personal data of Russian citizens be stored/processed in databases located in Russia.', receiptLegalLines: ['ИНН: {taxId}'] },

  // ── North America ────────────────────────────────────────────────────────
  { countryCode: 'US', country: 'United States', region: 'North America', privacyLaw: 'Sectoral (FTC) + state laws (CCPA/CPRA, VCDPA …)', privacyAuthority: 'FTC / state AGs', dataResidency: 'NONE', taxIdLabel: 'EIN / Sales Tax ID', receiptLegalLines: ['Sales tax collected where required by state/local law.'] },
  { countryCode: 'CA', country: 'Canada', region: 'North America', privacyLaw: 'PIPEDA + provincial (Quebec Law 25 …)', privacyAuthority: 'OPC', dataResidency: 'RECOMMENDED', taxIdLabel: 'BN / GST/HST No.', eInvoiceFormat: 'Peppol CA', notes: 'Some public bodies and provinces (BC, Nova Scotia) impose public-sector localization; Quebec Law 25 requires a privacy impact assessment for cross-border transfers.', receiptLegalLines: ['GST/HST No.: {taxId}'] },
  { countryCode: 'MX', country: 'Mexico', region: 'North America', privacyLaw: 'LFPDPPP', privacyAuthority: 'INAI', dataResidency: 'NONE', taxIdLabel: 'RFC', eInvoiceFormat: 'CFDI 4.0 (XML, SAT)', receiptLegalLines: ['RFC: {taxId}', 'Este ticket ampara una operación CFDI.'] },

  // ── Latin America ────────────────────────────────────────────────────────
  { countryCode: 'BR', country: 'Brazil', region: 'Latin America & Caribbean', privacyLaw: 'LGPD', privacyAuthority: 'ANPD', dataResidency: 'NONE', taxIdLabel: 'CNPJ', eInvoiceFormat: 'NFe / NFC-e (XML, SEFAZ)', receiptLegalLines: ['CNPJ: {CNPJ}', 'Documento Fiscal Eletrônico — consulte em {chave}'] },
  { countryCode: 'AR', country: 'Argentina', region: 'Latin America & Caribbean', privacyLaw: 'Ley 25.326', privacyAuthority: 'AAIP', dataResidency: 'NONE', taxIdLabel: 'CUIT', eInvoiceFormat: 'Factura Electrónica (AFIP)', receiptLegalLines: ['CUIT: {taxId}'] },
  { countryCode: 'CO', country: 'Colombia', region: 'Latin America & Caribbean', privacyLaw: 'Ley 1581 de 2012', privacyAuthority: 'SIC', dataResidency: 'NONE', taxIdLabel: 'NIT / RUT', eInvoiceFormat: 'DIAN e-invoice (XML)', receiptLegalLines: ['NIT: {taxId}', 'IVA incluido donde aplica.'] },
  { countryCode: 'CL', country: 'Chile', region: 'Latin America & Caribbean', privacyLaw: 'Ley 19.628 (Ley 21.719 in force 2026)', privacyAuthority: 'CMMLP', dataResidency: 'NONE', taxIdLabel: 'RUT', eInvoiceFormat: 'SII DTE (XML)', receiptLegalLines: ['RUT: {taxId}'] },
  { countryCode: 'PE', country: 'Peru', region: 'Latin America & Caribbean', privacyLaw: 'Ley 29733', privacyAuthority: 'ANPD', dataResidency: 'NONE', taxIdLabel: 'RUC', eInvoiceFormat: 'SUNAT CPE (XML)', receiptLegalLines: ['RUC: {taxId}'] },
  { countryCode: 'CR', country: 'Costa Rica', region: 'Latin America & Caribbean', privacyLaw: 'Ley 8968', privacyAuthority: 'PRODHAB', dataResidency: 'NONE', taxIdLabel: 'NAVE', eInvoiceFormat: 'Comprobante Electrónico (Hacienda XML)', receiptLegalLines: ['Nave: {taxId}'] },

  // ── Africa ───────────────────────────────────────────────────────────────
  { countryCode: 'NG', country: 'Nigeria', region: 'Africa', privacyLaw: 'NDPA 2023 (NDPR)', privacyAuthority: 'NDPC', dataResidency: 'RECOMMENDED', taxIdLabel: 'TIN', receiptLegalLines: ['TIN: {taxId}', 'VAT charged where applicable.'] },
  { countryCode: 'KE', country: 'Kenya', region: 'Africa', privacyLaw: 'Data Protection Act 2019', privacyAuthority: 'ODPC', dataResidency: 'NONE', taxIdLabel: 'KRA PIN', eInvoiceFormat: 'eTIMS invoice control unit', receiptLegalLines: ['KRA PIN: {taxId}', 'eTIMS invoice number: {receiptNumber}'] },
  { countryCode: 'ZA', country: 'South Africa', region: 'Africa', privacyLaw: 'POPIA', privacyAuthority: 'Information Regulator', dataResidency: 'RECOMMENDED', taxIdLabel: 'VAT No.', notes: 'Section 72 permits cross-border transfer but requires safeguards where the recipient\u2019s law is weaker.', receiptLegalLines: ['VAT No.: {taxId}'] },
  { countryCode: 'GH', country: 'Ghana', region: 'Africa', privacyLaw: 'Data Protection Act 843', privacyAuthority: 'Data Protection Commission', dataResidency: 'NONE', taxIdLabel: 'TIN (GRA)', receiptLegalLines: ['TIN: {taxId}'] },
  { countryCode: 'EG', country: 'Egypt', region: 'Africa', privacyLaw: 'Law 151/2020', privacyAuthority: 'ITDA', dataResidency: 'PUBLIC_SECTOR_IN_COUNTRY', taxIdLabel: 'Tax Registration No.', eInvoiceFormat: 'ETA XML (Fatoora)', receiptLegalLines: ['Reg. No.: {taxId}'] },
  { countryCode: 'MA', country: 'Morocco', region: 'Africa', privacyLaw: 'Loi 09-08', privacyAuthority: 'CNDP', dataResidency: 'RECOMMENDED', taxIdLabel: 'ICE / IF', receiptLegalLines: ['ICE: {taxId}'] },
  { countryCode: 'TN', country: 'Tunisia', region: 'Africa', privacyLaw: 'LOIMC Organic Law 2004-63 (aligned to Council 108+)', privacyAuthority: 'INPDP', dataResidency: 'RECOMMENDED', taxIdLabel: 'Matricule TF', receiptLegalLines: ['TF: {taxId}'] },
  { countryCode: 'TZ', country: 'Tanzania', region: 'Africa', privacyLaw: 'Personal Data Protection Act 2022', privacyAuthority: 'Commission for Personal Data Protection', dataResidency: 'RECOMMENDED', taxIdLabel: 'TIN (TRA)', receiptLegalLines: ['TIN: {taxId}'] },
  { countryCode: 'UG', country: 'Uganda', region: 'Africa', privacyLaw: 'Data Protection and Privacy Act 2019', privacyAuthority: 'NDA', dataResidency: 'NONE', taxIdLabel: 'TIN (URA)', receiptLegalLines: ['TIN: {taxId}', 'UBER: includes NSSF/levies where applicable.'] },

  // ── Middle East ──────────────────────────────────────────────────────────
  { countryCode: 'SA', country: 'Saudi Arabia', region: 'Middle East', privacyLaw: 'PDPL', privacyAuthority: 'SDAIA/PMEDU', dataResidency: 'RECOMMENDED', taxIdLabel: 'VAT No. (ZATCA)', eInvoiceFormat: 'ZATCA FATOORA Phase-2 (XML-UBL + QR)', receiptLegalLines: ['VAT No.: {taxId}', 'ZATCA QR present on tax invoice.'] },
  { countryCode: 'AE', country: 'United Arab Emirates', region: 'Middle East', privacyLaw: 'Federal PDPL 2021 (+ DIFC/ADGM regimes)', privacyAuthority: 'UAE Data Office', dataResidency: 'PUBLIC_SECTOR_IN_COUNTRY', taxIdLabel: 'TRN', receiptLegalLines: ['TRN: {taxId}'] },
  { countryCode: 'IL', country: 'Israel', region: 'Middle East', privacyLaw: 'PPL (Amendment 13, GDPR-aligned)', privacyAuthority: 'IL PPA', dataResidency: 'NONE', taxIdLabel: 'Tax ID / VAT No.', receiptLegalLines: ['ע.מ: {taxId}'] },
  { countryCode: 'TR', country: 'Türkiye', region: 'Middle East', privacyLaw: 'KVKK', privacyAuthority: 'Kişisel Verileri Koruma Kurumu', dataResidency: 'PUBLIC_SECTOR_IN_COUNTRY', taxIdLabel: 'VKN / TCKN', eInvoiceFormat: 'e-Fatura / e-Arşiv (GİB)', receiptLegalLines: ['VKN: {taxId}'] },
  { countryCode: 'QA', country: 'Qatar', region: 'Middle East', privacyLaw: 'Law 13/2016 (PDPLA)', dataResidency: 'NONE', taxIdLabel: 'Tax ID', receiptLegalLines: ['Tax ID: {taxId}'] },

  // ── South Asia ───────────────────────────────────────────────────────────
  { countryCode: 'IN', country: 'India', region: 'South Asia', privacyLaw: 'DPDP Act 2023', privacyAuthority: 'Data Protection Board', dataResidency: 'NONE', taxIdLabel: 'GSTIN', eInvoiceFormat: 'GST e-invoice (IRP JSON) + e-way bill', notes: 'DPDP permits cross-border transfer to notified countries; government may restrict. Sectoral (RBI) localization applies to payments data.', receiptLegalLines: ['GSTIN: {taxId}', 'Taxable value and GST shown separately.'] },
  { countryCode: 'PK', country: 'Pakistan', region: 'South Asia', privacyLaw: 'Personal Data Protection Bill (draft)', dataResidency: 'PUBLIC_SECTOR_IN_COUNTRY', taxIdLabel: 'NTN / STRN', receiptLegalLines: ['NTN: {taxId}'] },
  { countryCode: 'BD', country: 'Bangladesh', region: 'South Asia', privacyLaw: 'Digital Security Act / DPA draft', dataResidency: 'RECOMMENDED', taxIdLabel: 'BIN (VAT)', receiptLegalLines: ['BIN: {taxId}'] },

  // ── East Asia ────────────────────────────────────────────────────────────
  { countryCode: 'CN', country: 'China', region: 'East Asia', privacyLaw: 'PIPL + DSL + CSL', privacyAuthority: 'CAC', dataResidency: 'MANDATORY_IN_COUNTRY', taxIdLabel: 'USCC (统一社会信用代码)', eInvoiceFormat: 'Fully digital fapiao (金税四期)', notes: 'PIPL requires in-country storage of personal data and domestic-relevant data; cross-border transfer needs a CAC security assessment, standard contract or certification above thresholds.', receiptLegalLines: ['纳税人识别号: {taxId}', '发票已开具。'] },
  { countryCode: 'JP', country: 'Japan', region: 'East Asia', privacyLaw: 'APPI (Act on Protection of Personal Information)', privacyAuthority: 'PPC', dataResidency: 'NONE', taxIdLabel: 'T Number (インボイス番号)', eInvoiceFormat: 'Qualified Invoice System (インボイス)', receiptLegalLines: ['登録番号: {taxId}', '消費税率について明細参照。'] },
  { countryCode: 'KR', country: 'South Korea', region: 'East Asia', privacyLaw: 'PIPA', privacyAuthority: 'PIPC', dataResidency: 'NONE', taxIdLabel: 'Business No.', eInvoiceFormat: 'e-Tax Invoice (Hometax)', receiptLegalLines: ['사업자번호: {taxId}'] },

  // ── Southeast Asia ───────────────────────────────────────────────────────
  { countryCode: 'SG', country: 'Singapore', region: 'Southeast Asia', privacyLaw: 'PDPA', dataResidency: 'NONE', taxIdLabel: 'GST Reg. No. / UEN', eInvoiceFormat: 'IRAS GeBIZ / Peppol SG', receiptLegalLines: ['GST Reg. No.: {taxId}'] },
  { countryCode: 'ID', country: 'Indonesia', region: 'Southeast Asia', privacyLaw: 'UU PDP 27/2022', privacyAuthority: 'PDP Authority', dataResidency: 'RECOMMENDED', taxIdLabel: 'NPWP', eInvoiceFormat: 'e-Faktur ( faktur pajak )', receiptLegalLines: ['NPWP: {taxId}', 'PPN dihitung sesuai ketentuan.'] },
  { countryCode: 'MY', country: 'Malaysia', region: 'Southeast Asia', privacyLaw: 'PDPA 2010', dataResidency: 'NONE', taxIdLabel: 'SST / TIN', eInvoiceFormat: 'LHDN MyInvois', receiptLegalLines: ['TIN: {taxId}'] },
  { countryCode: 'TH', country: 'Thailand', region: 'Southeast Asia', privacyLaw: 'PDPA 2022', privacyAuthority: 'PDPC', dataResidency: 'NONE', taxIdLabel: 'Tax ID', eInvoiceFormat: 'e-Tax Invoice / e-Withholding Tax', receiptLegalLines: ['เลขประจำตัวผู้เสียภาษี: {taxId}'] },
  { countryCode: 'VN', country: 'Vietnam', region: 'Southeast Asia', privacyLaw: 'Decree 13/2023 (PDPD) + Cybersecurity Law 2018', dataResidency: 'RECOMMENDED', taxIdLabel: 'MST (Tax code)', eInvoiceFormat: 'Hóa đơn điện tử (agency code + QR)', receiptLegalLines: ['MST: {taxId}', 'Hóa đơn điện tử hợp lệ.'] },
  { countryCode: 'PH', country: 'Philippines', region: 'Southeast Asia', privacyLaw: 'Data Privacy Act 2012', privacyAuthority: 'NPC', dataResidency: 'NONE', taxIdLabel: 'TIN / VAT Reg.', eInvoiceFormat: 'BIR ORUS / CAS', receiptLegalLines: ['TIN: {taxId}', 'VAT registered where applicable.'] },

  // ── Oceania ──────────────────────────────────────────────────────────────
  { countryCode: 'AU', country: 'Australia', region: 'Oceania', privacyLaw: 'Privacy Act 1988 (APPs)', privacyAuthority: 'OAIC', dataResidency: 'NONE', taxIdLabel: 'ABN', receiptLegalLines: ['ABN: {taxId}', 'GST registered.'] },
  { countryCode: 'NZ', country: 'New Zealand', region: 'Oceania', privacyLaw: 'Privacy Act 2020', privacyAuthority: 'OPC', dataResidency: 'NONE', taxIdLabel: 'GST No.', receiptLegalLines: ['GST No.: {taxId}'] },
];

// Index by country code. The supranational 'EU' row is a convenience for orgs
// that set their region rather than a member state; it never shadows a real ISO
// member code, so members resolve their own richer profile first.
const BY_COUNTRY: Record<string, ComplianceProfile> = {};
for (const p of COMPLIANCE_PROFILES) {
  const key = p.countryCode.toUpperCase();
  if (!BY_COUNTRY[key]) BY_COUNTRY[key] = p;
}

/** The always-available fallback: neutral, no localization requirement. */
export const DEFAULT_COMPLIANCE_PROFILE: ComplianceProfile = {
  countryCode: 'ZZ',
  country: 'Uncoded jurisdiction',
  region: 'Other',
  privacyLaw: 'Local data-protection law',
  dataResidency: 'NONE',
  taxIdLabel: 'Tax ID',
  receiptLegalLines: [],
};

/** Resolve the compliance profile; unknown codes fall back to the neutral one. */
export function complianceFor(countryCode?: string | null): ComplianceProfile {
  if (!countryCode) return DEFAULT_COMPLIANCE_PROFILE;
  return BY_COUNTRY[countryCode.toUpperCase()] ?? DEFAULT_COMPLIANCE_PROFILE;
}

export function isKnownComplianceCountry(countryCode?: string | null): boolean {
  return !!countryCode && Object.prototype.hasOwnProperty.call(BY_COUNTRY, countryCode.toUpperCase());
}

/**
 * Build the default legal receipt footer for a market, interpolating any known
 * {placeholder} tokens. Returns the lines joined for direct printing; the store
 * can still override its own footer text.
 */
export function receiptFooterFor(countryCode?: string | null, values: Record<string, string> = {}): string {
  const p = complianceFor(countryCode);
  return p.receiptLegalLines
    .map((line) => line.replace(/\{(\w+)\}/g, (m, k) => (values[k] != null ? values[k] : m)))
    .join('\n');
}

export function complianceProfilesByRegion(): { region: string; profiles: ComplianceProfile[] }[] {
  const rest = [...COMPLIANCE_PROFILES];
  const groups = COMPLIANCE_REGION_ORDER.map((region) => {
    const profiles = rest.filter((p) => p.region === region);
    for (const p of profiles) rest.splice(rest.indexOf(p), 1);
    return { region, profiles: [...profiles].sort((a, b) => a.country.localeCompare(b.country)) };
  });
  const leftover = [...COMPLIANCE_PROFILES].filter((p) => !COMPLIANCE_REGION_ORDER.includes(p.region));
  if (leftover.length) groups.push({ region: 'Other', profiles: leftover });
  return groups.filter((g) => g.profiles.length > 0);
}

export interface ComplianceCoverage {
  markets: number;
  regions: number;
  mandatoryResidency: number;
  publicSectorResidency: number;
  eInvoiceMandated: number;
  byResidency: Record<string, number>;
}

export function complianceCoverage(): ComplianceCoverage {
  const byResidency: Record<string, number> = {};
  let mandatory = 0, publicSector = 0, eInv = 0;
  for (const p of COMPLIANCE_PROFILES) {
    byResidency[p.dataResidency] = (byResidency[p.dataResidency] || 0) + 1;
    if (p.dataResidency === 'MANDATORY_IN_COUNTRY') mandatory++;
    if (p.dataResidency === 'PUBLIC_SECTOR_IN_COUNTRY') publicSector++;
    if (p.eInvoiceFormat) eInv++;
  }
  return {
    markets: COMPLIANCE_PROFILES.length,
    regions: new Set(COMPLIANCE_PROFILES.map((p) => p.region)).size,
    mandatoryResidency: mandatory,
    publicSectorResidency: publicSector,
    eInvoiceMandated: eInv,
    byResidency,
  };
}

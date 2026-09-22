// ─── COUNTRY FISCAL REGIMES ──────────────────────────────────────────────────
// A "fiscal profile" is a country's legal cash-register regime: the rules for
// how a sale must be recorded so the tax authority will accept it. In 40+
// markets this is mandatory and requires a signed receipt (a Fiscal Data Medium
// / CTC / e-invoice reference) printed on or attached to every slip, which is
// precisely why merchants cannot rip an incumbent POS out overnight.
//
// The catalogue below is routing metadata only — it tells the sealing engine
// *how* to seal and *whether* to transmit. Nothing here calls a government
// service; the transmission adapter in services/fiscalization.ts is env-gated
// and simulated unless a real bridge is configured.
export type TransmissionMode = 'NONE' | 'SYNC' | 'ASYNC' | 'PORTAL';

export interface FiscalProfile {
  /** Stable profile code, stored on FiscalDocument.profileCode. */
  code: string;
  country: string;
  countryCode: string; // ISO 3166-1 alpha-2
  /** Local name of the regime, as the merchant will recognise it. */
  regime: string;
  /** A signed receipt is legally required for every cash sale. */
  requiresSeal: boolean;
  /** A registered device / certificate must exist before sealing. */
  requiresDevice: boolean;
  transmission: TransmissionMode;
  /** Receipt must carry a scannable QR (ZATCA, India, Malaysia …). */
  requiresQr: boolean;
  /** Records must stay retrievable for N years. */
  retentionYears: number;
  /** Year the mandate took (or takes) effect. */
  mandateYear: number;
  /** VAT/GST field the authority reconciles against. */
  vatField: 'VAT_TOTAL' | 'GST_TOTAL' | 'TAX_TOTAL' | 'NONE';
  notes?: string;
}

export const FISCAL_PROFILES: FiscalProfile[] = [
  { code: 'DE_TSE', country: 'Germany', countryCode: 'DE', regime: 'TSE (Technische Sicherheitseinrichtung)', requiresSeal: true, requiresDevice: true, transmission: 'ASYNC', requiresQr: true, retentionYears: 10, mandateYear: 2020, vatField: 'VAT_TOTAL', notes: 'Cash-register system must export every movement to a Tamper-proof Security Module; revision logs kept 10 years.' },
  { code: 'FR_TSE', country: 'France', countryCode: 'FR', regime: 'Loi anti-fraude TVA (certified system)', requiresSeal: true, requiresDevice: true, transmission: 'ASYNC', requiresQr: false, retentionYears: 6, mandateYear: 2018, vatField: 'VAT_TOTAL', notes: 'Inalterability, archivability and storability of payment data; a mandatory "certified system" attestation.' },
  { code: 'IT_SDI', country: 'Italy', countryCode: 'IT', regime: 'SdI (Sistema di Interscambio) e-invoicing', requiresSeal: true, requiresDevice: false, transmission: 'SYNC', requiresQr: false, retentionYears: 10, mandateYear: 2019, vatField: 'VAT_TOTAL', notes: 'B2B and B2C invoices transmitted in XML to the Exchange System; receipts also subject to daily closure (corrispettivi).' },
  { code: 'ES_VERIFACTU', country: 'Spain', countryCode: 'ES', regime: 'Veri*factu / SII', requiresSeal: true, requiresDevice: false, transmission: 'ASYNC', requiresQr: false, retentionYears: 4, mandateYear: 2026, vatField: 'VAT_TOTAL', notes: 'Chained-signed invoice records with a queue/hash link between consecutive receipts.' },
  { code: 'PL_KSEF', country: 'Poland', countryCode: 'PL', regime: 'KSeF e-invoicing + JPK', requiresSeal: true, requiresDevice: false, transmission: 'SYNC', requiresQr: false, retentionYears: 10, mandateYear: 2026, vatField: 'VAT_TOTAL' },
  { code: 'SA_ZATCA', country: 'Saudi Arabia', countryCode: 'SA', regime: 'ZATCA Phase-2 FATOORA', requiresSeal: true, requiresDevice: true, transmission: 'SYNC', requiresQr: true, retentionYears: 6, mandateYear: 2022, vatField: 'VAT_TOTAL', notes: 'UUID, cryptographic stamp and chained previous-invoice hash inside a TLV QR code.' },
  { code: 'AE_FTA', country: 'United Arab Emirates', countryCode: 'AE', regime: 'FTA certified POS', requiresSeal: false, requiresDevice: false, transmission: 'NONE', requiresQr: false, retentionYears: 5, mandateYear: 2018, vatField: 'VAT_TOTAL', notes: 'Certified system with a storage module; no per-receipt government transmission.' },
  { code: 'NG_EINVOICE', country: 'Nigeria', countryCode: 'NG', regime: 'FIRS e-invoicing (TaxPro Max)', requiresSeal: true, requiresDevice: false, transmission: 'SYNC', requiresQr: false, retentionYears: 6, mandateYear: 2021, vatField: 'VAT_TOTAL' },
  { code: 'KE_ETIMS', country: 'Kenya', countryCode: 'KE', regime: 'KRA eTIMS', requiresSeal: true, requiresDevice: true, transmission: 'SYNC', requiresQr: true, retentionYears: 5, mandateYear: 2023, vatField: 'VAT_TOTAL', notes: 'Each invoice gets a KRA-signed control unit serial and buyer/invoice TLV QR.' },
  { code: 'TZ_EBM', country: 'Tanzania', countryCode: 'TZ', regime: 'TRA EBM (MISRA)', requiresSeal: true, requiresDevice: true, transmission: 'SYNC', requiresQr: true, retentionYears: 5, mandateYear: 2021, vatField: 'VAT_TOTAL' },
  { code: 'BR_NFCE', country: 'Brazil', countryCode: 'BR', regime: 'NFC-e / SAT', requiresSeal: true, requiresDevice: true, transmission: 'SYNC', requiresQr: true, retentionYears: 5, mandateYear: 2018, vatField: 'TAX_TOTAL', notes: 'Authorised electronic consumer receipt with access key and IBGE QR code.' },
  { code: 'MX_CFDI', country: 'Mexico', countryCode: 'MX', regime: 'CFDI 4.0', requiresSeal: true, requiresDevice: true, transmission: 'SYNC', requiresQr: true, retentionYears: 5, mandateYear: 2022, vatField: 'VAT_TOTAL', notes: 'Sealed with the issuer e-folio fiscal (SAT stamp) and a global CSV under the QR.' },
  { code: 'IN_GST_IRP', country: 'India', countryCode: 'IN', regime: 'GST e-invoicing (IRP)', requiresSeal: true, requiresDevice: false, transmission: 'SYNC', requiresQr: true, retentionYears: 8, mandateYear: 2018, vatField: 'GST_TOTAL', notes: 'IRP returns an ARN plus an signed QR containing the invoice digest.' },
  { code: 'ID_PPN', country: 'Indonesia', countryCode: 'ID', regime: 'e-Faktur / PMK 86 e-billing', requiresSeal: true, requiresDevice: false, transmission: 'ASYNC', requiresQr: false, retentionYears: 10, mandateYear: 2018, vatField: 'VAT_TOTAL' },
  { code: 'MY_EINVOICE', country: 'Malaysia', countryCode: 'MY', regime: 'LHDN e-Invoice (MyInvois)', requiresSeal: true, requiresDevice: false, transmission: 'SYNC', requiresQr: true, retentionYears: 7, mandateYear: 2024, vatField: 'VAT_TOTAL' },
  { code: 'TH_TDRI', country: 'Thailand', countryCode: 'TH', regime: 'Revenue Department e-Tax Invoice', requiresSeal: true, requiresDevice: false, transmission: 'ASYNC', requiresQr: true, retentionYears: 5, mandateYear: 2024, vatField: 'VAT_TOTAL' },
  { code: 'RO_EFACTURA', country: 'Romania', countryCode: 'RO', regime: 'e-Factura (RO e-Invoice)', requiresSeal: true, requiresDevice: false, transmission: 'SYNC', requiresQr: false, retentionYears: 10, mandateYear: 2024, vatField: 'VAT_TOTAL' },
  { code: 'BE_GOLDEN', country: 'Belgium', countryCode: 'BE', regime: 'Golden Share / VAT whitelist', requiresSeal: true, requiresDevice: true, transmission: 'ASYNC', requiresQr: false, retentionYears: 7, mandateYear: 2024, vatField: 'VAT_TOTAL', notes: 'Signed daily Z-report submitted to the Ministry of Finance whitelist.' },
  { code: 'PT_SAF_T', country: 'Portugal', countryCode: 'PT', regime: 'ATCUD + SAF-T PT', requiresSeal: true, requiresDevice: false, transmission: 'ASYNC', requiresQr: false, retentionYears: 10, mandateYear: 2021, vatField: 'VAT_TOTAL', notes: 'Every document carries a hash-coded ATCUD + safety box of document numbering.' },
  { code: 'GR_MYDATA', country: 'Greece', countryCode: 'GR', regime: 'myDATA live reporting', requiresSeal: true, requiresDevice: false, transmission: 'SYNC', requiresQr: false, retentionYears: 5, mandateYear: 2021, vatField: 'VAT_TOTAL' },
  { code: 'HU_ONLINE', country: 'Hungary', countryCode: 'HU', regime: 'NAV online SZJA telemetry', requiresSeal: true, requiresDevice: false, transmission: 'SYNC', requiresQr: false, retentionYears: 5, mandateYear: 2018, vatField: 'VAT_TOTAL', notes: 'Every receipt must be reported to NAV within 24h with a QR verification code.' },
  { code: 'CZ_EET', country: 'Czechia', countryCode: 'CZ', regime: 'Trizdani / EET', requiresSeal: false, requiresDevice: false, transmission: 'NONE', requiresQr: false, retentionYears: 5, mandateYear: 2016, vatField: 'VAT_TOTAL', notes: 'EET was abolished in 2023; records switched to on-device accounting.' },
  { code: 'AR_TF', country: 'Argentina', countryCode: 'AR', regime: 'Factura Electrónica (AFIP)', requiresSeal: true, requiresDevice: false, transmission: 'SYNC', requiresQr: true, retentionYears: 10, mandateYear: 2010, vatField: 'VAT_TOTAL' },
  { code: 'CL_TMV', country: 'Chile', countryCode: 'CL', regime: 'SII timbre electrónico', requiresSeal: true, requiresDevice: true, transmission: 'ASYNC', requiresQr: false, retentionYears: 3, mandateYear: 2020, vatField: 'VAT_TOTAL' },
  { code: 'US_SIMPLE', country: 'United States', countryCode: 'US', regime: 'State sales-tax reporting', requiresSeal: false, requiresDevice: false, transmission: 'NONE', requiresQr: false, retentionYears: 7, mandateYear: 0, vatField: 'TAX_TOTAL', notes: 'No national fiscalisation regime; sealed locally so the audit trail still exists.' },
  { code: 'GB_SIMPLE', country: 'United Kingdom', countryCode: 'GB', regime: 'Making Tax Digital (VAT)', requiresSeal: false, requiresDevice: false, transmission: 'PORTAL', requiresQr: false, retentionYears: 6, mandateYear: 2019, vatField: 'VAT_TOTAL', notes: 'Digital records + MTD-compatible VAT return; no per-receipt signature.' },
  { code: 'EG_ETA', country: 'Egypt', countryCode: 'EG', regime: 'ETA e-invoicing (Fatoora)', requiresSeal: true, requiresDevice: false, transmission: 'SYNC', requiresQr: true, retentionYears: 6, mandateYear: 2020, vatField: 'VAT_TOTAL', notes: 'XML invoices submitted to the Egyptian Tax Authority digital platform via SOAP or portal; phased by turnover.' },
  { code: 'JP_QIS', country: 'Japan', countryCode: 'JP', regime: 'Qualified Invoice System (請求書等保存)', requiresSeal: false, requiresDevice: false, transmission: 'PORTAL', requiresQr: false, retentionYears: 7, mandateYear: 2023, vatField: 'TAX_TOTAL', notes: 'Registered invoice method: buyers need a qualified invoice (registration number + tax split) to claim input credit; e-Tax (Tei-gaku) filing optional.' },
  { code: 'VN_EINV', country: 'Vietnam', countryCode: 'VN', regime: 'Hoá đơn điện tử (e-invoice)', requiresSeal: true, requiresDevice: false, transmission: 'SYNC', requiresQr: true, retentionYears: 10, mandateYear: 2022, vatField: 'VAT_TOTAL', notes: 'Mandatory electronic invoices with an agency code and QR/mã CRC; General Department of Taxation reconciliation.' },
  { code: 'PH_ORUS', country: 'Philippines', countryCode: 'PH', regime: 'BIR CAS / e-invoicing (ORUS)', requiresSeal: true, requiresDevice: true, transmission: 'SYNC', requiresQr: false, retentionYears: 10, mandateYear: 2024, vatField: 'VAT_TOTAL', notes: 'Accredited Cash Register Systems for VAT-registered retailers; ORUS/LOI e-invoice submission rolling out.' },
  { code: 'KR_ETAX', country: 'South Korea', countryCode: 'KR', regime: 'e-Tax Invoice (세금계산서)', requiresSeal: true, requiresDevice: false, transmission: 'SYNC', requiresQr: false, retentionYears: 5, mandateYear: 2011, vatField: 'VAT_TOTAL', notes: 'Electronic tax invoices issued and transmitted through Hometax; write-off/verification flow.' },
  { code: 'TR_EARSIV', country: 'Turkey', countryCode: 'TR', regime: 'e-Fatura / e-Arşiv (GİB)', requiresSeal: true, requiresDevice: false, transmission: 'SYNC', requiresQr: false, retentionYears: 10, mandateYear: 2020, vatField: 'VAT_TOTAL', notes: 'Revenue Administration e-invoice and e-archive for B2C above thresholds; Kontroller ID per document.' },
  { code: 'PK_FBR', country: 'Pakistan', countryCode: 'PK', regime: 'FBR Digital Invoicing', requiresSeal: true, requiresDevice: false, transmission: 'SYNC', requiresQr: false, retentionYears: 5, mandateYear: 2024, vatField: 'VAT_TOTAL', notes: 'Sales-tax invoices uploaded to the FBR system with an invoice number and seller/buyer NTN.' },
  { code: 'BD_NBR', country: 'Bangladesh', countryCode: 'BD', regime: 'NBR e-invoice (software-based)', requiresSeal: true, requiresDevice: false, transmission: 'SYNC', requiresQr: true, retentionYears: 5, mandateYear: 2017, vatField: 'VAT_TOTAL', notes: 'Mandatory e-Mushak software for VAT-registered businesses; monthly returns pushed to NBR.' },
  { code: 'GH_EVAT', country: 'Ghana', countryCode: 'GH', regime: 'GRA e-VAT (real-time)', requiresSeal: true, requiresDevice: false, transmission: 'SYNC', requiresQr: false, retentionYears: 6, mandateYear: 2023, vatField: 'VAT_TOTAL', notes: 'Electronic VAT invoicing integrated with the Ghana Revenue Authority for large taxpayers.' },
  { code: 'UG_EFD', country: 'Uganda', countryCode: 'UG', regime: 'URA EFD (Electronic Fiscal Device)', requiresSeal: true, requiresDevice: true, transmission: 'SYNC', requiresQr: false, retentionYears: 5, mandateYear: 2016, vatField: 'VAT_TOTAL', notes: 'Tax Approval Device (TAD) / EFD software records every sale and reconciles to UTRA.' },
  { code: 'RW_ECMS', country: 'Rwanda', countryCode: 'RW', regime: 'RRA ECMS / ebilling', requiresSeal: true, requiresDevice: false, transmission: 'SYNC', requiresQr: false, retentionYears: 5, mandateYear: 2023, vatField: 'VAT_TOTAL', notes: 'Every invoice issued through the government Electronic Client Management System with an RRA ID.' },
  { code: 'MA_TVA', country: 'Morocco', countryCode: 'MA', regime: 'e-Invoicing (TVA)', requiresSeal: true, requiresDevice: false, transmission: 'ASYNC', requiresQr: false, retentionYears: 10, mandateYear: 2025, vatField: 'VAT_TOTAL', notes: 'Phased mandatory e-invoice via approved platforms (PAE), starting with large TVA-registered businesses.' },
];

/**
 * The always-available fallback. Even with no fiscal regime in force we still
 * seal receipts into a hash chain: an immutable trail costs nothing to produce
 * and is the single most persuasive answer to an auditor's "prove nothing is
 * missing" question.
 */
export const DEFAULT_FISCAL_PROFILE: FiscalProfile = {
  code: 'SIMPLE',
  country: 'Uncoded jurisdiction',
  countryCode: 'ZZ',
  regime: 'Local hash-chained records',
  requiresSeal: false,
  requiresDevice: false,
  transmission: 'NONE',
  requiresQr: false,
  retentionYears: 7,
  mandateYear: 0,
  vatField: 'NONE',
};

const BY_CODE: Record<string, FiscalProfile> = Object.fromEntries(FISCAL_PROFILES.map((p) => [p.code, p]));

const PRIMARY_BY_COUNTRY: Record<string, string> = FISCAL_PROFILES.reduce<Record<string, string>>((acc, p) => {
  // First profile wins for a country, so the ordered list above doubles as the
  // precedence table where a market has more than one regime.
  if (!acc[p.countryCode]) acc[p.countryCode] = p.code;
  return acc;
}, {});

export const FISCAL_PROFILE_CODES: string[] = FISCAL_PROFILES.map((p) => p.code);

export function fiscalProfileByCode(code: unknown): FiscalProfile | null {
  return typeof code === 'string' && BY_CODE[code.toUpperCase()] ? BY_CODE[code.toUpperCase()] : null;
}

/** Resolve the regime for a country; unknown countries fall back to SIMPLE. */
export function fiscalProfileFor(countryCode?: string | null): FiscalProfile {
  if (!countryCode) return DEFAULT_FISCAL_PROFILE;
  const code = PRIMARY_BY_COUNTRY[countryCode.toUpperCase()];
  return (code && BY_CODE[code]) || DEFAULT_FISCAL_PROFILE;
}

export function isKnownFiscalCountry(countryCode?: string | null): boolean {
  return !!countryCode && Object.prototype.hasOwnProperty.call(PRIMARY_BY_COUNTRY, countryCode.toUpperCase());
}

/** True where the law demands a signed receipt for cash sales. */
export function requiresFiscalSeal(countryCode?: string | null): boolean {
  return fiscalProfileFor(countryCode).requiresSeal;
}

export interface FiscalCoverage {
  profiles: number;
  countries: number;
  sealMandatory: number;
  qrMandatory: number;
  byTransmission: Record<string, number>;
  earliestMandate: number;
  upcomingMandates: { code: string; country: string; year: number }[];
}

/** Roll-up used by the UI header and the /fiscal/coverage endpoint. */
export function fiscalCoverage(atYear = new Date().getFullYear()): FiscalCoverage {
  const byTransmission: Record<string, number> = {};
  let upcomingMandates: { code: string; country: string; year: number }[] = [];
  let earliest = Infinity;
  for (const p of FISCAL_PROFILES) {
    byTransmission[p.transmission] = (byTransmission[p.transmission] || 0) + 1;
    if (p.mandateYear > 0) {
      earliest = Math.min(earliest, p.mandateYear);
      if (p.mandateYear > atYear) upcomingMandates.push({ code: p.code, country: p.country, year: p.mandateYear });
    }
  }
  return {
    profiles: FISCAL_PROFILES.length,
    countries: new Set(FISCAL_PROFILES.map((p) => p.countryCode)).size,
    sealMandatory: FISCAL_PROFILES.filter((p) => p.requiresSeal).length,
    qrMandatory: FISCAL_PROFILES.filter((p) => p.requiresQr).length,
    byTransmission,
    earliestMandate: Number.isFinite(earliest) ? earliest : 0,
    upcomingMandates: upcomingMandates.sort((a, b) => a.year - b.year),
  };
}

// ─── COUNTRY TAX-RATE PROFILES ───────────────────────────────────────────────
// Where `fiscalProfiles.ts` answers "how must a sale be *sealed*", this module
// answers the other half of "configure this country": "what is the default
// consumption-tax *rate* and does this market even have one?".
//
// An organisation today carries a single numeric `taxRate`. When a merchant
// opens their first store in a new country the correct starting point is the
// local standard VAT/GST rate — this reference supplies it (and the reduced
// slabs) so the POS can pre-fill tax instead of guessing. Rates reflect the
// position as of the July 2026 global VAT survey; reduced-rate scope always
// depends on product classification, so these are sensible defaults, not legal
// advice. Zero-rated / exempt supplies exist in nearly every regime but are not
// itemised — only positive headline rates are captured.
//
// This is routing metadata only: nothing here files a return. Real filing is
// delegated to a TAX_COMPLIANCE integration (Avalara, TaxJar, Stripe Tax …).

export type TaxSystemType =
  | 'VAT'        // Value Added Tax (the overwhelming majority)
  | 'GST'        // Goods & Services Tax (AU/NZ/SG/IN/CA federal …)
  | 'SALES_TAX'  // Single-stage retail sales tax (US, Canada provincial …)
  | 'SST'        // Sales & Service Tax (MY replacement regime)
  | 'TAX_FREE';  // No general consumption tax (HK, Qatar, Kuwait …)

export interface TaxProfile {
  countryCode: string; // ISO 3166-1 alpha-2
  country: string;
  region: string;      // display grouping key (see TAX_REGION_ORDER)
  type: TaxSystemType;
  /** Human name of the regime as the local authority calls it. */
  localName: string;
  /** Headline standard rate in percent (0 for TAX_FREE / no national rate). */
  standardRate: number;
  /** Other positive rates that apply to broad categories (reduced slabs). */
  reducedRates: number[];
  /** Whether zero-rating / exemptions apply to basics (food, medicine …). */
  zeroOrExempt: boolean;
  currency: string;    // ISO 4217, for context when pre-filling
  notes?: string;
}

// Canonical region ordering for the UI, roughly west→east.
export const TAX_REGION_ORDER: string[] = [
  'North America',
  'Latin America & Caribbean',
  'Europe',
  'Africa',
  'Middle East',
  'South Asia',
  'East Asia',
  'Southeast Asia',
  'Oceania',
];

export const TAX_PROFILES: TaxProfile[] = [
  // ── North America ──────────────────────────────────────────────────────────
  { countryCode: 'US', country: 'United States', region: 'North America', type: 'SALES_TAX', localName: 'State & local sales tax', standardRate: 0, reducedRates: [], zeroOrExempt: true, currency: 'USD', notes: 'No federal rate; 0–10.25% combined at state/county/city level (national avg ≈ 7%). Many states exempt groceries and prescription drugs.' },
  { countryCode: 'CA', country: 'Canada', region: 'North America', type: 'GST', localName: 'GST / HST / PST', standardRate: 5, reducedRates: [13, 14, 15], zeroOrExempt: true, currency: 'CAD', notes: '5% federal GST; combined HST 13–15% in participating provinces; Quebec, Alberta, BC, Saskatchewan run separate PST rules.' },
  { countryCode: 'MX', country: 'Mexico', region: 'North America', type: 'VAT', localName: 'IVA (Impuesto al Valor Agregado)', standardRate: 16, reducedRates: [0], zeroOrExempt: true, currency: 'MXN', notes: '16% standard; 0% on food, medicine and books. CFDI 4.0 fiscalisation applies.' },

  // ── Latin America & Caribbean ──────────────────────────────────────────────
  { countryCode: 'BR', country: 'Brazil', region: 'Latin America & Caribbean', type: 'VAT', localName: 'ICMS → CBS/IBS (tax reform)', standardRate: 17, reducedRates: [12, 7], zeroOrExempt: true, currency: 'BRL', notes: 'State ICMS (typically 17–19%) is being replaced by a dual VAT (CBS federal + IBS subnational) phased in from 2026. NFC-e/SAT fiscalisation.' },
  { countryCode: 'AR', country: 'Argentina', region: 'Latin America & Caribbean', type: 'VAT', localName: 'IVA', standardRate: 21, reducedRates: [10.5, 2.5], zeroOrExempt: true, currency: 'ARS', notes: '21% general, 10.5% reduced, 2.5% on essentials; Factura Electrónica (AFIP).' },
  { countryCode: 'CL', country: 'Chile', region: 'Latin America & Caribbean', type: 'VAT', localName: 'IVA', standardRate: 19, reducedRates: [], zeroOrExempt: false, currency: 'CLP', notes: 'Flat 19%; SII electronic tax (timbre electrónico).' },
  { countryCode: 'CO', country: 'Colombia', region: 'Latin America & Caribbean', type: 'VAT', localName: 'IVA', standardRate: 19, reducedRates: [5], zeroOrExempt: true, currency: 'COP', notes: '19% standard, 5% reduced; certain goods exempt.' },
  { countryCode: 'PE', country: 'Peru', region: 'Latin America & Caribbean', type: 'VAT', localName: 'IGV', standardRate: 18, reducedRates: [], zeroOrExempt: true, currency: 'PEN', notes: '16% IGV + 2% IPGM = 18% effective.' },
  { countryCode: 'CR', country: 'Costa Rica', region: 'Latin America & Caribbean', type: 'VAT', localName: 'IVA', standardRate: 13, reducedRates: [4, 2, 1], zeroOrExempt: true, currency: 'CRC' },
  { countryCode: 'DO', country: 'Dominican Republic', region: 'Latin America & Caribbean', type: 'VAT', localName: 'ITBIS', standardRate: 19, reducedRates: [16, 9], zeroOrExempt: true, currency: 'DOP' },
  { countryCode: 'EC', country: 'Ecuador', region: 'Latin America & Caribbean', type: 'VAT', localName: 'IVA', standardRate: 15, reducedRates: [5, 0], zeroOrExempt: true, currency: 'USD', notes: 'Rate raised to 15% in 2024; USD-economised.' },
  { countryCode: 'GT', country: 'Guatemala', region: 'Latin America & Caribbean', type: 'VAT', localName: 'IVA', standardRate: 12, reducedRates: [], zeroOrExempt: true, currency: 'GTQ' },
  { countryCode: 'PA', country: 'Panama', region: 'Latin America & Caribbean', type: 'VAT', localName: 'ITBMS', standardRate: 7, reducedRates: [], zeroOrExempt: true, currency: 'USD' },
  { countryCode: 'PY', country: 'Paraguay', region: 'Latin America & Caribbean', type: 'VAT', localName: 'IVA', standardRate: 10, reducedRates: [5, 0], zeroOrExempt: true, currency: 'PYG' },
  { countryCode: 'UY', country: 'Uruguay', region: 'Latin America & Caribbean', type: 'VAT', localName: 'IVA', standardRate: 22, reducedRates: [10], zeroOrExempt: true, currency: 'UYU' },
  { countryCode: 'BO', country: 'Bolivia', region: 'Latin America & Caribbean', type: 'VAT', localName: 'IVA', standardRate: 13, reducedRates: [], zeroOrExempt: false, currency: 'BOB' },
  { countryCode: 'TT', country: 'Trinidad & Tobago', region: 'Latin America & Caribbean', type: 'VAT', localName: 'VAT', standardRate: 12.5, reducedRates: [], zeroOrExempt: true, currency: 'TTD' },
  { countryCode: 'JM', country: 'Jamaica', region: 'Latin America & Caribbean', type: 'VAT', localName: 'GCT', standardRate: 15, reducedRates: [3], zeroOrExempt: true, currency: 'JMD' },

  // ── Europe ─────────────────────────────────────────────────────────────────
  { countryCode: 'GB', country: 'United Kingdom', region: 'Europe', type: 'VAT', localName: 'VAT', standardRate: 20, reducedRates: [5], zeroOrExempt: true, currency: 'GBP', notes: '20% standard, 5% reduced (some energy/childcare), 0% on most food, children\u2019s clothes, books. Making Tax Digital.' },
  { countryCode: 'DE', country: 'Germany', region: 'Europe', type: 'VAT', localName: 'Mehrwertsteuer (MwSt)', standardRate: 19, reducedRates: [7], zeroOrExempt: true, currency: 'EUR', notes: '19% standard, 7% reduced (food, books, restaurant meals). TSE cash-register sealing.' },
  { countryCode: 'FR', country: 'France', region: 'Europe', type: 'VAT', localName: 'Taxe sur la valeur ajoutée (TVA)', standardRate: 20, reducedRates: [10, 5.5, 2.1], zeroOrExempt: true, currency: 'EUR', notes: '20% standard; 10% restaurants/transport, 5.5% essentials, 2.1% medicines/media. Anti-fraud TVA certified system.' },
  { countryCode: 'IT', country: 'Italy', region: 'Europe', type: 'VAT', localName: 'Imposta sul Valore Aggiunto (IVA)', standardRate: 22, reducedRates: [10, 5, 4], zeroOrExempt: true, currency: 'EUR', notes: 'SdI e-invoicing mandatory for B2B/B2C and daily corrispettivi.' },
  { countryCode: 'ES', country: 'Spain', region: 'Europe', type: 'VAT', localName: 'IVA', standardRate: 21, reducedRates: [10, 4], zeroOrExempt: true, currency: 'EUR', notes: 'Veri*factu chained-signed billing from 2026.' },
  { countryCode: 'NL', country: 'Netherlands', region: 'Europe', type: 'VAT', localName: 'Omzetbelasting (BTW)', standardRate: 21, reducedRates: [9, 0], zeroOrExempt: true, currency: 'EUR', notes: '9% on food, water, books, medicines, accommodation moved back to 21% from 2026.' },
  { countryCode: 'PL', country: 'Poland', region: 'Europe', type: 'VAT', localName: 'Podatek od towarów i usług', standardRate: 23, reducedRates: [8, 5], zeroOrExempt: true, currency: 'PLN', notes: 'KSeF mandatory e-invoicing from 2026.' },
  { countryCode: 'SE', country: 'Sweden', region: 'Europe', type: 'VAT', localName: 'Moms', standardRate: 25, reducedRates: [12, 6], zeroOrExempt: true, currency: 'SEK', notes: '25% standard, 12% food/hotel, 6% culture/transport.' },
  { countryCode: 'BE', country: 'Belgium', region: 'Europe', type: 'VAT', localName: 'TVA / BTW', standardRate: 21, reducedRates: [12, 6], zeroOrExempt: true, currency: 'EUR', notes: 'Hotels/takeaway/leisure moved 6%→12% from 1 Mar 2026. Golden-Sheet whitelist regime.' },
  { countryCode: 'AT', country: 'Austria', region: 'Europe', type: 'VAT', localName: 'Umsatzsteuer', standardRate: 20, reducedRates: [13, 10, 5], zeroOrExempt: true, currency: 'EUR', notes: 'Food cut to 5% from 1 Jul 2026.' },
  { countryCode: 'CH', country: 'Switzerland', region: 'Europe', type: 'VAT', localName: 'MWST / TVA', standardRate: 8.1, reducedRates: [2.6, 3.8], zeroOrExempt: true, currency: 'CHF', notes: 'Standard 8.1%, reduced 2.6%, lodging 3.8%.' },
  { countryCode: 'PT', country: 'Portugal', region: 'Europe', type: 'VAT', localName: 'IVA', standardRate: 23, reducedRates: [13, 6], zeroOrExempt: true, currency: 'EUR', notes: 'ATCUD + SAF-T PT; regional rates lower in Azores/Madeira.' },
  { countryCode: 'GR', country: 'Greece', region: 'Europe', type: 'VAT', localName: 'ΦΠΑ', standardRate: 24, reducedRates: [13, 6], zeroOrExempt: true, currency: 'EUR', notes: 'myDATA live reporting.' },
  { countryCode: 'CZ', country: 'Czechia', region: 'Europe', type: 'VAT', localName: 'DPH', standardRate: 21, reducedRates: [12], zeroOrExempt: true, currency: 'CZK', notes: 'Single 12% reduced from 2026; restaurant/non-alc drinks at 12%.' },
  { countryCode: 'RO', country: 'Romania', region: 'Europe', type: 'VAT', localName: 'TVA', standardRate: 21, reducedRates: [11, 5], zeroOrExempt: true, currency: 'RON', notes: 'Standard returned to 21% (from 19%) in 2025; e-Factura mandatory.' },
  { countryCode: 'HU', country: 'Hungary', region: 'Europe', type: 'VAT', localName: 'ÁFA', standardRate: 27, reducedRates: [18, 5], zeroOrExempt: true, currency: 'HUF', notes: 'Highest standard VAT in the world; NAV online_szja telemetry.' },
  { countryCode: 'DK', country: 'Denmark', region: 'Europe', type: 'VAT', localName: 'Moms', standardRate: 25, reducedRates: [], zeroOrExempt: false, currency: 'DKK', notes: 'Flat 25%, no reduced rate.' },
  { countryCode: 'FI', country: 'Finland', region: 'Europe', type: 'VAT', localName: 'ALV / Moms', standardRate: 25.5, reducedRates: [13.5, 10], zeroOrExempt: true, currency: 'EUR', notes: 'Standard raised to 25.5% (2024); reduced cut to 13.5% from 2026.' },
  { countryCode: 'IE', country: 'Ireland', region: 'Europe', type: 'VAT', localName: 'Cáin Bhalla Luachaí', standardRate: 23, reducedRates: [13.5, 9, 4.8], zeroOrExempt: true, currency: 'EUR', notes: 'Hospitality/restaurant cut to 9% from 1 Jul 2026.' },
  { countryCode: 'NO', country: 'Norway', region: 'Europe', type: 'VAT', localName: 'Merverdiavgift (MVA)', standardRate: 25, reducedRates: [15, 12], zeroOrExempt: true, currency: 'NOK' },
  { countryCode: 'SK', country: 'Slovakia', region: 'Europe', type: 'VAT', localName: 'DPH', standardRate: 23, reducedRates: [19, 5], zeroOrExempt: true, currency: 'EUR' },
  { countryCode: 'SI', country: 'Slovenia', region: 'Europe', type: 'VAT', localName: 'DDV', standardRate: 22, reducedRates: [9.5, 5], zeroOrExempt: true, currency: 'EUR' },
  { countryCode: 'HR', country: 'Croatia', region: 'Europe', type: 'VAT', localName: 'PDV', standardRate: 25, reducedRates: [13, 5], zeroOrExempt: true, currency: 'EUR' },
  { countryCode: 'BG', country: 'Bulgaria', region: 'Europe', type: 'VAT', localName: 'ДДС', standardRate: 20, reducedRates: [9], zeroOrExempt: true, currency: 'BGN', notes: 'Planned euro adoption will keep 20% standard.' },
  { countryCode: 'LT', country: 'Lithuania', region: 'Europe', type: 'VAT', localName: 'PVM', standardRate: 21, reducedRates: [12, 5], zeroOrExempt: true, currency: 'EUR', notes: 'Accommodation/culture reduced raised 9%→12% from 2026.' },
  { countryCode: 'LV', country: 'Latvia', region: 'Europe', type: 'VAT', localName: 'PVN', standardRate: 21, reducedRates: [12, 5], zeroOrExempt: true, currency: 'EUR' },
  { countryCode: 'EE', country: 'Estonia', region: 'Europe', type: 'VAT', localName: 'Käibemaks', standardRate: 24, reducedRates: [13, 9], zeroOrExempt: true, currency: 'EUR', notes: 'Standard raised to 24% in 2025.' },
  { countryCode: 'LU', country: 'Luxembourg', region: 'Europe', type: 'VAT', localName: 'TVA', standardRate: 17, reducedRates: [14, 8, 3], zeroOrExempt: true, currency: 'EUR', notes: 'Lowest standard rate in the EU.' },
  { countryCode: 'MT', country: 'Malta', region: 'Europe', type: 'VAT', localName: 'VAT / TVX', standardRate: 18, reducedRates: [12, 7, 5], zeroOrExempt: true, currency: 'EUR' },
  { countryCode: 'RS', country: 'Serbia', region: 'Europe', type: 'VAT', localName: 'PDV', standardRate: 20, reducedRates: [10], zeroOrExempt: true, currency: 'RSD' },
  { countryCode: 'UA', country: 'Ukraine', region: 'Europe', type: 'VAT', localName: 'ПДВ', standardRate: 20, reducedRates: [7, 14], zeroOrExempt: true, currency: 'UAH' },
  { countryCode: 'GE', country: 'Georgia', region: 'Europe', type: 'VAT', localName: 'ღფმ', standardRate: 18, reducedRates: [], zeroOrExempt: true, currency: 'GEL' },

  // ── Africa ─────────────────────────────────────────────────────────────────
  { countryCode: 'NG', country: 'Nigeria', region: 'Africa', type: 'VAT', localName: 'VAT', standardRate: 7.5, reducedRates: [], zeroOrExempt: true, currency: 'NGN', notes: 'Lowest VAT in Africa; many essentials exempt. FIRS e-invoicing.' },
  { countryCode: 'KE', country: 'Kenya', region: 'Africa', type: 'VAT', localName: 'VAT', standardRate: 16, reducedRates: [8], zeroOrExempt: true, currency: 'KES', notes: 'KRA eTIMS with signed control-unit serial per invoice.' },
  { countryCode: 'ZA', country: 'South Africa', region: 'Africa', type: 'VAT', localName: 'VAT', standardRate: 15, reducedRates: [], zeroOrExempt: true, currency: 'ZAR', notes: '15% since 2018; zero-rating on basic foodstuffs.' },
  { countryCode: 'TZ', country: 'Tanzania', region: 'Africa', type: 'VAT', localName: 'VAT', standardRate: 18, reducedRates: [10], zeroOrExempt: true, currency: 'TZS', notes: 'TRA EBM (MISRA) electronic fiscal devices.' },
  { countryCode: 'GH', country: 'Ghana', region: 'Africa', type: 'VAT', localName: 'VAT', standardRate: 21.9, reducedRates: [], zeroOrExempt: true, currency: 'GHS', notes: 'Effective standard burden restructured (VAT + levies) from 1 Jan 2026; ~20%.' },
  { countryCode: 'UG', country: 'Uganda', region: 'Africa', type: 'VAT', localName: 'VAT', standardRate: 18, reducedRates: [], zeroOrExempt: true, currency: 'UGX', notes: 'URA EFD (Electronic Fiscal Device) regime.' },
  { countryCode: 'EG', country: 'Egypt', region: 'Africa', type: 'VAT', localName: 'Value Added Tax', standardRate: 14, reducedRates: [5], zeroOrExempt: true, currency: 'EGP', notes: 'Mandatory e-invoicing (ETA) rolling out by turnover band.' },
  { countryCode: 'MA', country: 'Morocco', region: 'Africa', type: 'VAT', localName: 'TVA', standardRate: 20, reducedRates: [14, 10, 7], zeroOrExempt: true, currency: 'MAD' },
  { countryCode: 'DZ', country: 'Algeria', region: 'Africa', type: 'VAT', localName: 'TVA', standardRate: 19, reducedRates: [9], zeroOrExempt: true, currency: 'DZD' },
  { countryCode: 'TN', country: 'Tunisia', region: 'Africa', type: 'VAT', localName: 'TVA', standardRate: 19, reducedRates: [13, 7], zeroOrExempt: true, currency: 'TND' },
  { countryCode: 'ET', country: 'Ethiopia', region: 'Africa', type: 'VAT', localName: 'VAT', standardRate: 15, reducedRates: [], zeroOrExempt: true, currency: 'ETB' },
  { countryCode: 'RW', country: 'Rwanda', region: 'Africa', type: 'VAT', localName: 'VAT', standardRate: 18, reducedRates: [], zeroOrExempt: true, currency: 'RWF', notes: 'RRA ebilling/ECMS software mandatory.' },
  { countryCode: 'ZM', country: 'Zambia', region: 'Africa', type: 'VAT', localName: 'VAT', standardRate: 16, reducedRates: [], zeroOrExempt: true, currency: 'ZMW' },
  { countryCode: 'ZW', country: 'Zimbabwe', region: 'Africa', type: 'VAT', localName: 'VAT', standardRate: 15.5, reducedRates: [], zeroOrExempt: true, currency: 'USD', notes: 'Raised from 15% on 1 Jan 2026; ZIG/USD-economised.' },
  { countryCode: 'MW', country: 'Malawi', region: 'Africa', type: 'VAT', localName: 'VAT', standardRate: 17.5, reducedRates: [], zeroOrExempt: true, currency: 'MWK', notes: 'Raised from 16.5% on 1 Jan 2026.' },
  { countryCode: 'SN', country: 'Senegal', region: 'Africa', type: 'VAT', localName: 'TVA', standardRate: 18, reducedRates: [10], zeroOrExempt: true, currency: 'XOF', notes: 'WAEMU common external tariff + 18% TVA.' },
  { countryCode: 'CI', country: 'Ivory Coast', region: 'Africa', type: 'VAT', localName: 'TVA', standardRate: 18, reducedRates: [9], zeroOrExempt: true, currency: 'XOF' },
  { countryCode: 'CM', country: 'Cameroon', region: 'Africa', type: 'VAT', localName: 'TVA', standardRate: 19.25, reducedRates: [], zeroOrExempt: true, currency: 'XAF' },
  { countryCode: 'AO', country: 'Angola', region: 'Africa', type: 'VAT', localName: 'IVA', standardRate: 14, reducedRates: [7, 5], zeroOrExempt: true, currency: 'AOA' },
  { countryCode: 'MZ', country: 'Mozambique', region: 'Africa', type: 'VAT', localName: 'IVA', standardRate: 17, reducedRates: [5], zeroOrExempt: true, currency: 'MZN' },
  { countryCode: 'ML', country: 'Mali', region: 'Africa', type: 'VAT', localName: 'TVA', standardRate: 18, reducedRates: [], zeroOrExempt: true, currency: 'XOF' },

  // ── Middle East ────────────────────────────────────────────────────────────
  { countryCode: 'SA', country: 'Saudi Arabia', region: 'Middle East', type: 'VAT', localName: 'ضريبة القيمة المضافة', standardRate: 15, reducedRates: [], zeroOrExempt: true, currency: 'SAR', notes: 'ZATCA FATOORA Phase-2 QR on every invoice.' },
  { countryCode: 'AE', country: 'United Arab Emirates', region: 'Middle East', type: 'VAT', localName: 'ضريبة القيمة المضافة', standardRate: 5, reducedRates: [], zeroOrExempt: true, currency: 'AED', notes: 'FTA certified POS; low 5% rate; extensive zero-rating.' },
  { countryCode: 'IL', country: 'Israel', region: 'Middle East', type: 'VAT', localName: 'מע\u0027מ (MAS)', standardRate: 18, reducedRates: [], zeroOrExempt: false, currency: 'ILS', notes: 'Raised from 17% in 2025.' },
  { countryCode: 'JO', country: 'Jordan', region: 'Middle East', type: 'VAT', localName: ' ضريبة المبيعات', standardRate: 16, reducedRates: [4], zeroOrExempt: true, currency: 'JOD' },
  { countryCode: 'BH', country: 'Bahrain', region: 'Middle East', type: 'VAT', localName: 'VAT', standardRate: 10, reducedRates: [], zeroOrExempt: true, currency: 'BHD' },
  { countryCode: 'OM', country: 'Oman', region: 'Middle East', type: 'VAT', localName: 'VAT', standardRate: 5, reducedRates: [], zeroOrExempt: true, currency: 'OMR' },
  { countryCode: 'QA', country: 'Qatar', region: 'Middle East', type: 'TAX_FREE', localName: 'No VAT (planned)', standardRate: 0, reducedRates: [], zeroOrExempt: false, currency: 'QAR', notes: 'GCC VAT framework agreed but Qatar has no rate in force as of 2026.' },
  { countryCode: 'KW', country: 'Kuwait', region: 'Middle East', type: 'TAX_FREE', localName: 'No VAT (planned)', standardRate: 0, reducedRates: [], zeroOrExempt: false, currency: 'KWD', notes: 'Awaiting GCC harmonised VAT.' },
  { countryCode: 'IQ', country: 'Iraq', region: 'Middle East', type: 'VAT', localName: 'VAT', standardRate: 0, reducedRates: [], zeroOrExempt: false, currency: 'IQD', notes: 'Sales tax law approved; rate to be set by regional ordinance (KRG applies ~5%).' },
  { countryCode: 'LB', country: 'Lebanon', region: 'Middle East', type: 'VAT', localName: 'TVA', standardRate: 11, reducedRates: [], zeroOrExempt: true, currency: 'LBP' },

  // ── South Asia ─────────────────────────────────────────────────────────────
  { countryCode: 'IN', country: 'India', region: 'South Asia', type: 'GST', localName: 'GST', standardRate: 18, reducedRates: [5, 12, 28], zeroOrExempt: true, currency: 'INR', notes: 'Multi-slab GST (0/5/12/18/28%); CGST+SGST intra-state, IGST inter-state; e-invoice (IRP) ARN + QR above turnover thresholds.' },
  { countryCode: 'PK', country: 'Pakistan', region: 'South Asia', type: 'GST', localName: 'GST / Sales Tax', standardRate: 18, reducedRates: [], zeroOrExempt: true, currency: 'PKR', notes: 'Federal GST on services + provincial sales tax on goods (Punjab ~18%).' },
  { countryCode: 'BD', country: 'Bangladesh', region: 'South Asia', type: 'VAT', localName: 'VAT (Muty)', standardRate: 15, reducedRates: [7.5, 5], zeroOrExempt: true, currency: 'BDT', notes: 'Standard 15%; NBR e-invoice (software-based) mandate expanding.' },
  { countryCode: 'LK', country: 'Sri Lanka', region: 'South Asia', type: 'VAT', localName: 'VAT', standardRate: 18, reducedRates: [], zeroOrExempt: true, currency: 'LKR' },
  { countryCode: 'NP', country: 'Nepal', region: 'South Asia', type: 'VAT', localName: 'VAT', standardRate: 13, reducedRates: [], zeroOrExempt: true, currency: 'NPR' },
  { countryCode: 'BT', country: 'Bhutan', region: 'South Asia', type: 'GST', localName: 'GST', standardRate: 5, reducedRates: [], zeroOrExempt: true, currency: 'BTN', notes: 'New GST regime at 5% from 1 Jan 2026 (replaced BSD).' },
  { countryCode: 'MV', country: 'Maldives', region: 'South Asia', type: 'GST', localName: 'TGS (Tourism GST)', standardRate: 8, reducedRates: [0], zeroOrExempt: true, currency: 'MVR', notes: '8% general; 16% on tourist resorts; 0% on essentials.' },
  { countryCode: 'AF', country: 'Afghanistan', region: 'South Asia', type: 'VAT', localName: 'BTAS', standardRate: 10, reducedRates: [], zeroOrExempt: true, currency: 'AFN' },

  // ── East Asia ──────────────────────────────────────────────────────────────
  { countryCode: 'JP', country: 'Japan', region: 'East Asia', type: 'VAT', localName: '消費税 (Shōhizei / JCT)', standardRate: 10, reducedRates: [8], zeroOrExempt: true, currency: 'JPY', notes: '10% (7.8% national + 2.2% local); 8% reduced on food & non-alcoholic drinks. Qualified Invoice System (QIS) for input-tax credit.' },
  { countryCode: 'CN', country: 'China', region: 'East Asia', type: 'VAT', localName: '增值税 (Zēngzhíshuì)', standardRate: 13, reducedRates: [9, 6], zeroOrExempt: true, currency: 'CNY', notes: '13% goods, 9% utilities/transport, 6% services; fully digital fapiao (金税/Golden Tax).' },
  { countryCode: 'KR', country: 'South Korea', region: 'East Asia', type: 'VAT', localName: '부가가치세 (VAT)', standardRate: 10, reducedRates: [], zeroOrExempt: true, currency: 'KRW', notes: '10%; e-Tax Invoice (세금계산서) mandatory for many businesses.' },
  { countryCode: 'TW', country: 'Taiwan', region: 'East Asia', type: 'VAT', localName: 'Business Revenue Tax (営業稅)', standardRate: 5, reducedRates: [], zeroOrExempt: true, currency: 'TWD', notes: 'Uniform 5%; electronic uniform invoice (e-invoice) cloud.' },
  { countryCode: 'MN', country: 'Mongolia', region: 'East Asia', type: 'VAT', localName: 'NVAT', standardRate: 10, reducedRates: [], zeroOrExempt: true, currency: 'MNT' },

  // ── Southeast Asia ─────────────────────────────────────────────────────────
  { countryCode: 'ID', country: 'Indonesia', region: 'Southeast Asia', type: 'VAT', localName: 'PPN (Pajak Pertambahan Nilai)', standardRate: 11, reducedRates: [], zeroOrExempt: true, currency: 'IDR', notes: '11% since 2022; 12% applied only to luxury goods; e-Faktur / PMK 86 e-billing.' },
  { countryCode: 'TH', country: 'Thailand', region: 'Southeast Asia', type: 'VAT', localName: 'ภาษีมูลค่าเพิ่ม (VAT)', standardRate: 7, reducedRates: [], zeroOrExempt: true, currency: 'THB', notes: 'Held at 7% by royal decree (statutory 10%); scheduled to rise to 10% on 1 Oct 2026. e-Tax Invoice.' },
  { countryCode: 'VN', country: 'Vietnam', region: 'Southeast Asia', type: 'VAT', localName: 'Thuế giá trị gia tăng', standardRate: 10, reducedRates: [8, 5], zeroOrExempt: true, currency: 'VND', notes: 'Standard 10%; 8% reduction extended through 2026; e-invoice (Biên lai điện tử) mandatory.' },
  { countryCode: 'PH', country: 'Philippines', region: 'Southeast Asia', type: 'VAT', localName: 'VAT', standardRate: 12, reducedRates: [], zeroOrExempt: true, currency: 'PHP', notes: '12% on sale of goods/services; BIR e-invoicing / ORUS rollout.' },
  { countryCode: 'MY', country: 'Malaysia', region: 'Southeast Asia', type: 'SST', localName: 'SST (Sales & Service Tax)', standardRate: 10, reducedRates: [5, 6, 8], zeroOrExempt: true, currency: 'MYR', notes: 'VAT/SST abolished 2018; SST re-introduced 2025: 5–10% sales + 6–8% service tax. LHDN e-Invoice (MyInvois) phased 2024–2026.' },
  { countryCode: 'SG', country: 'Singapore', region: 'Southeast Asia', type: 'GST', localName: 'GST', standardRate: 9, reducedRates: [], zeroOrExempt: true, currency: 'SGD', notes: '9% since 2024 (raised from 8%); 0% on exports. IRAS e-invoicing (GeBIZ).' },
  { countryCode: 'KH', country: 'Cambodia', region: 'Southeast Asia', type: 'VAT', localName: 'Tax on Goods & Services', standardRate: 10, reducedRates: [], zeroOrExempt: true, currency: 'KHR', notes: 'General Department of Taxation e-filing + QR invoice.' },
  { countryCode: 'LA', country: 'Laos', region: 'Southeast Asia', type: 'VAT', localName: 'VAT', standardRate: 10, reducedRates: [5, 3], zeroOrExempt: true, currency: 'LAK' },
  { countryCode: 'MM', country: 'Myanmar', region: 'Southeast Asia', type: 'VAT', localName: 'GST/VAT', standardRate: 5, reducedRates: [], zeroOrExempt: true, currency: 'MMK' },
  { countryCode: 'BN', country: 'Brunei', region: 'Southeast Asia', type: 'TAX_FREE', localName: 'No GST/VAT', standardRate: 0, reducedRates: [], zeroOrExempt: false, currency: 'BND', notes: 'No consumption tax; a VAT was proposed for 2025 but shelved.' },

  // ── Oceania ────────────────────────────────────────────────────────────────
  { countryCode: 'AU', country: 'Australia', region: 'Oceania', type: 'GST', localName: 'GST', standardRate: 10, reducedRates: [], zeroOrExempt: true, currency: 'AUD', notes: '10% GST; extensive registration thresholds; BAS reporting.' },
  { countryCode: 'NZ', country: 'New Zealand', region: 'Oceania', type: 'GST', localName: 'GST', standardRate: 15, reducedRates: [], zeroOrExempt: true, currency: 'NZD', notes: 'Broad-based 15%; near-universal coverage with limited exemptions.' },
  { countryCode: 'FJ', country: 'Fiji', region: 'Oceania', type: 'VAT', localName: 'VAT', standardRate: 15, reducedRates: [], zeroOrExempt: true, currency: 'FJD' },
  { countryCode: 'PG', country: 'Papua New Guinea', region: 'Oceania', type: 'GST', localName: 'GST', standardRate: 10, reducedRates: [], zeroOrExempt: true, currency: 'PGK' },
];

// Country-code index (upper-cased). A couple of markets appear in two regions;
// first entry wins, mirroring the fiscal precedence behaviour.
const BY_COUNTRY: Record<string, TaxProfile> = {};
for (const p of TAX_PROFILES) {
  const key = p.countryCode.toUpperCase();
  if (!BY_COUNTRY[key]) BY_COUNTRY[key] = p;
}

/** Resolve the tax profile for a country code; returns null when unknown. */
export function taxProfileFor(countryCode?: string | null): TaxProfile | null {
  if (!countryCode) return null;
  return BY_COUNTRY[countryCode.toUpperCase()] ?? null;
}

/**
 * A safe starting `taxRate` (%) for a country. Unknown or tax-free jurisdictions
 * yield 0 so a new org can never be seeded with a wrong non-zero default.
 */
export function suggestedTaxRateFor(countryCode?: string | null): number {
  const p = taxProfileFor(countryCode);
  return p ? p.standardRate : 0;
}

export function isKnownTaxCountry(countryCode?: string | null): boolean {
  return !!countryCode && Object.prototype.hasOwnProperty.call(BY_COUNTRY, countryCode.toUpperCase());
}

/** Profiles grouped by region, preserving TAX_REGION_ORDER (unknown regions last). */
export function taxProfilesByRegion(): { region: string; profiles: TaxProfile[] }[] {
  const rest = [...TAX_PROFILES];
  const groups = TAX_REGION_ORDER.map((region) => {
    const profiles = rest.filter((p) => p.region === region);
    for (const p of profiles) rest.splice(rest.indexOf(p), 1);
    return { region, profiles: [...profiles].sort((a, b) => a.country.localeCompare(b.country)) };
  });
  const leftover = [...TAX_PROFILES].filter((p) => !TAX_REGION_ORDER.includes(p.region));
  if (leftover.length) groups.push({ region: 'Other', profiles: leftover });
  return groups.filter((g) => g.profiles.length > 0);
}

export interface TaxCoverage {
  countries: number;
  regions: number;
  withConsumptionTax: number;
  vatSystems: number;
  gstSystems: number;
  salesTaxSystems: number;
  taxFree: number;
  highestRate: { country: string; rate: number };
  lowestPositiveRate: { country: string; rate: number };
}

/** Roll-up for the /tax-profiles coverage banner and the config UI. */
export function taxCoverage(): TaxCoverage {
  const seen = new Set<string>();
  let withTax = 0, vat = 0, gst = 0, sales = 0, taxFree = 0;
  let highest: { country: string; rate: number } = { country: '', rate: -1 };
  let lowest: { country: string; rate: number } = { country: '', rate: Infinity };
  for (const p of TAX_PROFILES) {
    const key = p.countryCode.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (p.type === 'VAT') vat++;
    else if (p.type === 'GST') gst++;
    else if (p.type === 'SALES_TAX') sales++;
    if (p.type === 'TAX_FREE' || p.standardRate === 0) taxFree++;
    else withTax++;
    if (p.standardRate > highest.rate) highest = { country: p.country, rate: p.standardRate };
    if (p.standardRate > 0 && p.standardRate < lowest.rate) lowest = { country: p.country, rate: p.standardRate };
  }
  return {
    countries: seen.size,
    regions: new Set(TAX_PROFILES.map((p) => p.region)).size,
    withConsumptionTax: withTax,
    vatSystems: vat,
    gstSystems: gst,
    salesTaxSystems: sales,
    taxFree,
    highestRate: highest,
    lowestPositiveRate: Number.isFinite(lowest.rate) ? lowest : { country: '', rate: 0 },
  };
}

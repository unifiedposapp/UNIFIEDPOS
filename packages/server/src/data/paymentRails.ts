// ─── DOMESTIC PAYMENT RAILS BY MARKET ────────────────────────────────────────
// A "rail" is the country's own clearing network (SEPA, ACH, Faster Payments,
// PIX, UPI, NIP, Real Time Gross Settlement …), each with its own identifier
// format, settlement cycle and cap. Routing a sale down the wrong rail is how
// merchants lose 48 hours of float and a percentage point of margin, so the
// table below is the single source of truth for what a country can actually
// receive — and for validating the account details before money moves.
export type IdentifierKind =
  | 'IBAN'
  | 'BBAN'
  | 'SORT_CODE_ACCOUNT'
  | 'ROUTING_ACCOUNT'
  | 'CLABE'
  | 'VPA'
  | 'IFSC_ACCOUNT'
  | 'BSB_ACCOUNT'
  | 'PIX_KEY'
  | 'NUBAN'
  | 'MSN_WALLET'
  | 'CVM_TILL'
  | 'SWIFT_BIC'
  | 'FREEFORM';

export interface RailDef {
  code: string;
  name: string;
  /** ISO alpha-2 markets where this rail is available for domestic receipt. */
  countries: string[];
  currencies: string[];
  identifierKind: IdentifierKind;
  /** T+n business days until the money is irrevocably settled. */
  settlementDays: number;
  instant: boolean;
  /** Per-transaction ceiling in the rail's own unit, when the rail imposes one. */
  maxAmount?: number | null;
  reversible: boolean;
  notes?: string;
}

export const RAILS: RailDef[] = [
  { code: 'SEPA', name: 'SEPA Credit Transfer', countries: ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'PT', 'IE', 'FI', 'LU'], currencies: ['EUR'], identifierKind: 'IBAN', settlementDays: 1, instant: false, maxAmount: 100000, reversible: false, notes: 'IBAN + BIC; SCT Inst settles in under 10 seconds where the bank supports it.' },
  { code: 'SEPA_INST', name: 'SEPA Instant (TIPS)', countries: ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'PT', 'IE'], currencies: ['EUR'], identifierKind: 'IBAN', settlementDays: 0, instant: true, maxAmount: 100000, reversible: false },
  { code: 'ACH', name: 'ACH / NACHA', countries: ['US'], currencies: ['USD'], identifierKind: 'ROUTING_ACCOUNT', settlementDays: 2, instant: false, maxAmount: null, reversible: true, notes: 'Recoverable for 60 days after settlement — return risk belongs in the ledger.' },
  { code: 'SAME_FED', name: 'FedNow / RTP', countries: ['US'], currencies: ['USD'], identifierKind: 'ROUTING_ACCOUNT', settlementDays: 0, instant: true, maxAmount: 100000, reversible: false },
  { code: 'FPS', name: 'Faster Payments Service', countries: ['GB'], currencies: ['GBP'], identifierKind: 'SORT_CODE_ACCOUNT', settlementDays: 0, instant: true, maxAmount: 250000, reversible: false },
  { code: 'CHAPS', name: 'CHAPS RTGS', countries: ['GB'], currencies: ['GBP'], identifierKind: 'SORT_CODE_ACCOUNT', settlementDays: 0, instant: false, maxAmount: null, reversible: false },
  { code: 'OPEN_BANKING', name: 'Open Banking Payment Initiation', countries: ['GB', 'EU', 'SE', 'DK', 'PL'], currencies: ['GBP', 'EUR', 'SEK', 'DKK', 'PLN'], identifierKind: 'IBAN', settlementDays: 0, instant: true, maxAmount: 100000, reversible: false },
  { code: 'PIX', name: 'PIX (Banco Central do Brasil)', countries: ['BR'], currencies: ['BRL'], identifierKind: 'PIX_KEY', settlementDays: 0, instant: true, maxAmount: 10000, reversible: false, notes: 'Key is a CPF, CNPJ, e-mail, phone number or random alphanumeric.' },
  { code: 'UPI', name: 'UPI (NPCI)', countries: ['IN'], currencies: ['INR'], identifierKind: 'VPA', settlementDays: 0, instant: true, maxAmount: 100000, reversible: false },
  { code: 'IMPS_NEFT', name: 'IMPS / NEFT', countries: ['IN'], currencies: ['INR'], identifierKind: 'IFSC_ACCOUNT', settlementDays: 0, instant: false, maxAmount: null, reversible: false },
  { code: 'NIP', name: 'NBP Express (NIP / BLIK)', countries: ['PL'], currencies: ['PLN'], identifierKind: 'IBAN', settlementDays: 0, instant: true, maxAmount: 10000, reversible: false },
  { code: 'BECS', name: 'BECS Direct Entry', countries: ['AU'], currencies: ['AUD'], identifierKind: 'BSB_ACCOUNT', settlementDays: 1, instant: false, maxAmount: null, reversible: true },
  { code: 'NPP', name: 'New Payments Platform (PayID)', countries: ['AU'], currencies: ['AUD'], identifierKind: 'BSB_ACCOUNT', settlementDays: 0, instant: true, maxAmount: 100000, reversible: false },
  { code: 'RTGS_CA', name: 'Lynx / Tracer RTGS', countries: ['CA'], currencies: ['CAD'], identifierKind: 'ROUTING_ACCOUNT', settlementDays: 0, instant: false, maxAmount: null, reversible: false },
  { code: 'CLABE', name: 'SPEI (CLABE)', countries: ['MX'], currencies: ['MXN'], identifierKind: 'CLABE', settlementDays: 0, instant: true, maxAmount: null, reversible: false },
  { code: 'NUBAN', name: 'NIP / NUBAN (Nigeria)', countries: ['NG'], currencies: ['NGN'], identifierKind: 'NUBAN', settlementDays: 0, instant: true, maxAmount: 5000000, reversible: false, notes: '10- or 11-digit bank verification number with a modulus-11 check digit.' },
  { code: 'CVM', name: 'Card Verification / CVM merchant till', countries: ['NG', 'KE', 'TZ', 'GH'], currencies: ['NGN', 'KES', 'TZS', 'GHS'], identifierKind: 'CVM_TILL', settlementDays: 1, instant: false, maxAmount: null, reversible: true },
  { code: 'MPESA', name: 'M-PESA Daraja / Paybill', countries: ['KE', 'TZ'], currencies: ['KES', 'TZS'], identifierKind: 'CVM_TILL', settlementDays: 0, instant: true, maxAmount: 150000, reversible: false },
  { code: 'MOMO', name: 'Mobile Money (MTN / Airtel / Telecel)', countries: ['GH', 'UG', 'RW', 'ZM', 'CI', 'CM'], currencies: ['GHS', 'UGX', 'RWF', 'ZMW', 'XOF', 'XAF'], identifierKind: 'MSN_WALLET', settlementDays: 0, instant: true, maxAmount: 20000, reversible: false },
  { code: 'PAYNOW', name: 'PayNow', countries: ['SG'], currencies: ['SGD'], identifierKind: 'MSN_WALLET', settlementDays: 0, instant: true, maxAmount: 200000, reversible: false },
  { code: 'PROMPT_PAY', name: 'PromptPay', countries: ['TH'], currencies: ['THB'], identifierKind: 'MSN_WALLET', settlementDays: 0, instant: true, maxAmount: 100000, reversible: false },
  { code: 'DUITNOW', name: 'DuitNow', countries: ['MY'], currencies: ['MYR'], identifierKind: 'MSN_WALLET', settlementDays: 0, instant: true, maxAmount: 50000, reversible: false },
  { code: 'SWIFT', name: 'SWIFT MT103 (cross-border)', countries: ['*'], currencies: ['USD', 'EUR', 'GBP', 'CHF', 'JPY', 'AED', 'SAR', 'CNY'], identifierKind: 'SWIFT_BIC', settlementDays: 2, instant: false, maxAmount: null, reversible: false, notes: 'Fallback rail: slower, correspondent-bank fees, but works everywhere.' },
  { code: 'PESALINK', name: 'PesaLink', countries: ['KE'], currencies: ['KES'], identifierKind: 'FREEFORM', settlementDays: 0, instant: true, maxAmount: 1500000, reversible: false },
];

const RAIL_BY_CODE: Record<string, RailDef> = Object.fromEntries(RAILS.map((r) => [r.code, r]));

export const RAIL_CODES: string[] = RAILS.map((r) => r.code);

export function railByCode(code: unknown): RailDef | null {
  return typeof code === 'string' && RAIL_BY_CODE[code.toUpperCase()] ? RAIL_BY_CODE[code.toUpperCase()] : null;
}

/**
 * Rails available in a market, fastest-settling first. SWIFT is always present
 * as the cross-border fallback so a store can receive something even in a
 * market we have no domestic rail for yet.
 */
export function railsForCountry(countryCode?: string | null): RailDef[] {
  if (!countryCode) return RAILS.filter((r) => r.code === 'SWIFT');
  const code = countryCode.toUpperCase();
  const domestic = RAILS.filter((r) => r.countries.includes(code) || r.countries.includes('*'));
  const withSwift = domestic.some((r) => r.code === 'SWIFT') ? domestic : [...domestic, RAIL_BY_CODE.SWIFT];
  return withSwift.sort((a, b) => Number(b.instant) - Number(a.instant) || a.settlementDays - b.settlementDays);
}

export function defaultRailForCountry(countryCode?: string | null): RailDef {
  const list = railsForCountry(countryCode);
  return list[0] || RAIL_BY_CODE.SWIFT;
}

export function supportsCurrency(countryCode: string | null | undefined, currency: string): boolean {
  const cur = String(currency || '').toUpperCase();
  if (!cur) return false;
  return railsForCountry(countryCode).some((r) => r.currencies.map((c) => c.toUpperCase()).includes(cur));
}

export interface RailCoverage {
  rails: number;
  countries: number;
  instant: number;
  byKind: Record<string, number>;
  /** Settlement float in days for each rail, useful for treasury projections. */
  maxSettlementDays: number;
}

export function railCoverage(): RailCoverage {
  const countries = new Set<string>();
  const byKind: Record<string, number> = {};
  for (const r of RAILS) {
    byKind[r.identifierKind] = (byKind[r.identifierKind] || 0) + 1;
    for (const c of r.countries) if (c !== '*') countries.add(c);
  }
  return {
    rails: RAILS.length,
    countries: countries.size,
    instant: RAILS.filter((r) => r.instant).length,
    byKind,
    maxSettlementDays: RAILS.reduce((max, r) => Math.max(max, r.settlementDays), 0),
  };
}

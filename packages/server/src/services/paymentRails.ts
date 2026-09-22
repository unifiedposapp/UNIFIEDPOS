// ─── PAYMENT RAIL VALIDATION + SETTLEMENT MATH ───────────────────────────────
// Every domestic rail publishes an identifier with its own built-in checksum
// (IBAN mod-97, ABA 3-7-1, CLABE mod-10, NUBAN mod-11, CPF/CNPJ double check
// digit, IFSC/BSB shape). Accepting a typo'd account number is how a payout
// vanishes into someone else's bank, so validation happens here, as pure
// functions, before anything is persisted.
export interface ValidationResult {
  valid: boolean;
  /** Canonical form worth storing (uppercased, stripped of separators). */
  normalized: string;
  /** Stable machine code: MISSING, BAD_FORMAT, CHECK_DIGIT, LENGTH, UNKNOWN_KIND */
  reason?: string;
  detail?: string;
}

const OK = (normalized: string): ValidationResult => ({ valid: true, normalized });
const BAD = (reason: string, normalized = '', detail?: string): ValidationResult => ({ valid: false, normalized, reason, detail });

export function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D+/g, '');
}

export function stripSpacesUpper(value: unknown): string {
  return String(value ?? '').toUpperCase().replace(/[\s\-_.]+/g, '');
}

/** ISO 13616 mod-97: move the 4-char header to the end, letters→digits, remainder must be 1. */
export function validateIban(value: unknown): ValidationResult {
  const raw = String(value ?? '').toUpperCase().replace(/[\s\-_.]/g, '');
  if (!raw) return BAD('MISSING');
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(raw)) return BAD('BAD_FORMAT', raw, 'expected 2 letters, 2 check digits, then BBAN');
  const rearranged = raw.slice(4) + raw.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const expansion = code >= 65 && code <= 90 ? String(code - 55) : ch;
    for (const digit of expansion) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1 ? OK(raw) : BAD('CHECK_DIGIT', raw, 'mod-97 check failed');
}

export function ibanCountry(iban: unknown): string | null {
  const raw = String(iban ?? '').toUpperCase().replace(/[\s\-_.]/g, '');
  return /^[A-Z]{2}/.test(raw) ? raw.slice(0, 2) : null;
}

/** ISO 9362 BIC: 8 or 11 characters, no 0/1 in the location position. */
export function validateBic(value: unknown): ValidationResult {
  const raw = stripSpacesUpper(value);
  if (!raw) return BAD('MISSING');
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(raw) ? OK(raw) : BAD('BAD_FORMAT', raw, 'BIC must be 8 or 11 characters');
}

/** US ACH routing number — the classic 3·d1+7·d2+1·d3 checksum. */
export function validateUsRouting(value: unknown): ValidationResult {
  const d = digitsOnly(value);
  if (!d) return BAD('MISSING');
  if (d.length !== 9) return BAD('LENGTH', d, 'routing number must be 9 digits');
  if (!/^(0|1|2|3|6|7|8)$/.test(d[0])) return BAD('BAD_FORMAT', d, 'first digit must be a Federal Reserve region');
  const sum = 3 * +d[0] + 7 * +d[1] + 1 * +d[2] + 3 * +d[3] + 7 * +d[4] + 1 * +d[5] + 3 * +d[6] + 7 * +d[7] + 1 * +d[8];
  return sum % 10 === 0 ? OK(d) : BAD('CHECK_DIGIT', d, 'routing checksum failed');
}

/** "ROUTING:ACCOUNT" — both halves validated. */
export function validateRoutingAccount(value: unknown): ValidationResult {
  const raw = String(value ?? '').trim();
  if (!raw) return BAD('MISSING');
  const parts = raw.split(/[:|/]+/).map((p) => digitsOnly(p)).filter(Boolean);
  if (parts.length < 2) return BAD('BAD_FORMAT', raw, 'expected routing:account');
  const routing = validateUsRouting(parts[0]);
  if (!routing.valid) return routing;
  const account = parts[1];
  if (account.length < 4 || account.length > 17) return BAD('LENGTH', account, 'account number must be 4-17 digits');
  return OK(`${routing.normalized}:${account}`);
}

export function validateSortCodeAccount(value: unknown): ValidationResult {
  const raw = String(value ?? '').trim();
  if (!raw) return BAD('MISSING');
  const parts = raw.split(/[:|/-]+/).map((p) => p.trim()).filter(Boolean);
  const sc = parts[0] ? digitsOnly(parts[0]) : '';
  const account = parts[1] ? digitsOnly(parts[1]) : '';
  if (!/^\d{6}$/.test(sc)) return BAD('BAD_FORMAT', raw, 'sort code must be 6 digits');
  if (!/^\d{6,10}$/.test(account)) return BAD('LENGTH', raw, 'account number must be 6-10 digits');
  if (/^0{6}$/.test(sc)) return BAD('BAD_FORMAT', raw, 'sort code cannot be all zeros');
  return OK(`${sc}:${account}`);
}

/** Mexican CLABE: 18 digits, weighted mod-10 over the first 17. */
export function validateClabe(value: unknown): ValidationResult {
  const d = digitsOnly(value);
  if (!d) return BAD('MISSING');
  if (d.length !== 18) return BAD('LENGTH', d, 'CLABE must be 18 digits');
  const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(d[i]) * weights[i];
  const check = (10 - (sum % 10)) % 10;
  return check === Number(d[17]) ? OK(d) : BAD('CHECK_DIGIT', d, 'CLABE check digit failed');
}

/** Brazilian CPF (11 digits, two check digits). */
export function validateCpf(value: unknown): ValidationResult {
  const d = digitsOnly(value);
  if (!d) return BAD('MISSING');
  if (d.length !== 11) return BAD('LENGTH', d, 'CPF must be 11 digits');
  if (/^(\d)\1{10}$/.test(d)) return BAD('BAD_FORMAT', d, 'repeated-digit CPF is invalid');
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const rem = (sum * 10) % 11;
    return rem === 10 ? 0 : rem;
  };
  if (calc(9) !== Number(d[9]) || calc(10) !== Number(d[10])) return BAD('CHECK_DIGIT', d, 'CPF check digits failed');
  return OK(d);
}

/** Brazilian CNPJ (14 digits, two check digits with 5-4-3-2-9-8 weights). */
export function validateCnpj(value: unknown): ValidationResult {
  const d = digitsOnly(value);
  if (!d) return BAD('MISSING');
  if (d.length !== 14) return BAD('LENGTH', d, 'CNPJ must be 14 digits');
  if (/^(\d)\1{13}$/.test(d)) return BAD('BAD_FORMAT', d, 'repeated-digit CNPJ is invalid');
  const check = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * weights[i];
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };
  if (check(12) !== Number(d[12]) || check(13) !== Number(d[13])) return BAD('CHECK_DIGIT', d, 'CNPJ check digits failed');
  return OK(d);
}

/** UPI virtual payment address: handle@bank. */
export function validateUpiVpa(value: unknown): ValidationResult {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return BAD('MISSING');
  if (!/^[a-z0-9][a-z0-9._-]{1,63}@[a-z]{2,64}$/.test(raw)) return BAD('BAD_FORMAT', raw, 'expected address@bank');
  return OK(raw);
}

export function validateIfscAccount(value: unknown): ValidationResult {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw) return BAD('MISSING');
  const parts = raw.split(/[:|/\s]+/).filter(Boolean);
  const ifsc = parts[0] || '';
  const account = parts[1] ? digitsOnly(parts[1]) : '';
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return BAD('BAD_FORMAT', raw, 'IFSC is 4 letters, a zero, then 6 characters');
  if (!/^\d{6,17}$/.test(account)) return BAD('LENGTH', raw, 'account number must be 6-17 digits');
  return OK(`${ifsc}:${account}`);
}

export function validateBsbAccount(value: unknown): ValidationResult {
  const raw = String(value ?? '').trim();
  if (!raw) return BAD('MISSING');
  const parts = raw.split(/[:|\s-]+/).map((p) => digitsOnly(p)).filter(Boolean);
  const bsb = parts[0] || '';
  const account = parts[1] ? digitsOnly(parts[1]) : '';
  if (!/^\d{6}$/.test(bsb)) return BAD('BAD_FORMAT', raw, 'BSB must be 6 digits');
  if (!/^\d{6,10}$/.test(account)) return BAD('LENGTH', raw, 'account number must be 6-10 digits');
  return OK(`${bsb}:${account}`);
}

/** Nigerian NUBAN: 9 body digits + 1 modulus-11 check digit (leading 1 tolerated). */
export function validateNuban(value: unknown): ValidationResult {
  const d = digitsOnly(value);
  if (!d) return BAD('MISSING');
  if (d.length !== 10 && d.length !== 11) return BAD('LENGTH', d, 'NUBAN must be 10 or 11 digits');
  const body = d.length === 11 ? d.slice(1) : d;
  if (body.length !== 10) return BAD('LENGTH', d);
  const weights = [3, 7, 3, 9, 11, 5, 25, 7, 4];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(body[i]) * weights[i];
  const check = (sum % 11) % 10;
  return check === Number(body[9]) ? OK(d) : BAD('CHECK_DIGIT', d, 'NUBAN check digit failed');
}

export function validateE164(value: unknown): ValidationResult {
  // Humans format numbers - brackets, spaces, dots, dashes - none of which are
  // part of the address. Only the leading `+` carries meaning.
  const raw = String(value ?? '').trim().replace(/[()\s.\-]/g, '');
  if (!raw) return BAD('MISSING');
  const plusless = raw.startsWith('+') ? raw.slice(1) : raw;
  if (!/^\d{6,15}$/.test(plusless)) return BAD('BAD_FORMAT', raw, 'must be 6-15 digits');
  return OK(`+${plusless}`);
}

/** Mobile-money / bank short code: 1-2 letters then 5-7 digits (411 / AB12345). */
export function validateTillNumber(value: unknown): ValidationResult {
  const raw = String(value ?? '').toUpperCase().replace(/[\s\-_.]/g, '');
  if (!raw) return BAD('MISSING');
  return /^[A-Z]{0,2}\d{4,8}$/.test(raw) ? OK(raw) : BAD('BAD_FORMAT', raw, 'till/paybill is up to 2 letters plus 4-8 digits');
}

const PIX_RANDOM = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

/** PIX keys are typed; validating "the right thing" avoids 400s deep in Banco Central. */
export function validatePixKey(value: unknown, keyType?: string | null): ValidationResult {
  const raw = String(value ?? '').trim();
  if (!raw) return BAD('MISSING');
  const type = String(keyType || '').toUpperCase();
  if (type === 'CPF') return validateCpf(raw);
  if (type === 'CNPJ') return validateCnpj(raw);
  if (type === 'PHONE') {
    // PIX phone keys are E.164 with the country code, while merchants type the
    // national form ("11 99887-7665"). Handing Banco Central a bare national
    // number is a guaranteed rejection, so lift it into +55 here.
    const digits = digitsOnly(raw);
    const national = /^\d{10,11}$/.test(digits) && !digits.startsWith('55');
    if (national) return validateE164(`+55${digits}`);
    return validateE164(digits.startsWith('55') ? `+${digits}` : raw);
  }
  if (type === 'EMAIL') {
    const email = raw.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? OK(email) : BAD('BAD_FORMAT', email, 'not an e-mail address');
  }
  if (type === 'RANDOM') return PIX_RANDOM.test(raw) ? OK(raw.toLowerCase()) : BAD('BAD_FORMAT', raw.toLowerCase(), 'random PIX key is a version-4 UUID');
  // Untyped: accept whichever key kind matches, which is what a merchant typing
  // an address into a single field actually needs.
  const attempts = [validateCpf(raw), validateCnpj(raw), validateE164(raw), validatePixKey(raw, 'EMAIL'), validatePixKey(raw, 'RANDOM')];
  const matched = attempts.find((a) => a.valid);
  return matched || BAD('BAD_FORMAT', raw, 'not a CPF, CNPJ, phone, e-mail or random PIX key');
}

const KIND_VALIDATOR: Record<string, (v: unknown, extra?: string | null) => ValidationResult> = {
  IBAN: validateIban,
  BBAN: (v) => (/^[A-Z0-9]{8,30}$/.test(stripSpacesUpper(v)) ? OK(stripSpacesUpper(v)) : BAD('BAD_FORMAT', String(v))),
  SORT_CODE_ACCOUNT: validateSortCodeAccount,
  ROUTING_ACCOUNT: validateRoutingAccount,
  CLABE: validateClabe,
  VPA: validateUpiVpa,
  IFSC_ACCOUNT: validateIfscAccount,
  BSB_ACCOUNT: validateBsbAccount,
  PIX_KEY: validatePixKey,
  NUBAN: validateNuban,
  MSN_WALLET: validateE164,
  CVM_TILL: validateTillNumber,
  SWIFT_BIC: (v) => {
    // A SWIFT destination accepts either a plain BIC or BIC:ACCOUNT.
    const raw = String(v ?? '').trim().toUpperCase();
    const bic = raw.split(/[:|/]+/)[0];
    const check = validateBic(bic);
    return check.valid && (!raw.includes(':') || digitsOnly(raw.split(':')[1]).length >= 4)
      ? OK(raw.replace(/\s+/g, ''))
      : check;
  },
  FREEFORM: (v) => (String(v ?? '').trim().length >= 3 ? OK(String(v).trim()) : BAD('LENGTH', String(v))),
};

export function validateRailIdentifier(kind: string | null | undefined, identifier: unknown, keyType?: string | null): ValidationResult {
  const validator = KIND_VALIDATOR[String(kind || 'FREEFORM').toUpperCase()];
  if (!validator) return BAD('UNKNOWN_KIND', String(identifier ?? ''), `no validator for identifier kind ${kind}`);
  return String(kind).toUpperCase() === 'PIX_KEY' ? validator(identifier, keyType) : validator(identifier);
}

export function isKnownIdentifierKind(kind: unknown): boolean {
  return typeof kind === 'string' && !!KIND_VALIDATOR[kind.toUpperCase()];
}

// ─── settlement timing + fees ────────────────────────────────────────────────
/** T+n settlement date, skipping weekends. Pure: the clock comes in as `from`. */
export function addBusinessDays(from: Date, days: number): Date {
  const at = new Date(from);
  let left = Math.max(0, Math.trunc(Number(days) || 0));
  while (left > 0) {
    at.setDate(at.getDate() + 1);
    const day = at.getDay();
    if (day !== 0 && day !== 6) left--;
  }
  return at;
}

export interface FeeModel {
  percent: number;
  fixed: number;
}

export function railFee(gross: number, fee: FeeModel): number {
  const g = Number(gross) || 0;
  return Math.round((g * (Number(fee?.percent) || 0)) / 100 * 100) / 100 + (Number(fee?.fixed) || 0);
}

export function withinRailLimit(rail: { maxAmount?: number | null }, amount: number): boolean {
  const cap = Number(rail?.maxAmount);
  if (!cap || !Number.isFinite(cap) || cap <= 0) return true;
  return (Number(amount) || 0) <= cap;
}

/**
 * Pick the cheapest workable rail for a payment: an instant rail is preferred
 * when the amount is under its cap, otherwise fall back to the slower domestic
 * rail, then SWIFT.
 */
export function chooseRail<T extends { code: string; instant: boolean; settlementDays: number; currencies: string[]; maxAmount?: number | null }>(
  rails: T[],
  amount: number,
  currency?: string | null
): T | null {
  const cur = String(currency || '').toUpperCase();
  const usable = rails.filter((r) => withinRailLimit(r, amount) && (!cur || !r.currencies?.length || r.currencies.map((c) => c.toUpperCase()).includes(cur)));
  if (!usable.length) return null;
  return usable.sort((a, b) => Number(b.instant) - Number(a.instant) || a.settlementDays - b.settlementDays)[0];
}

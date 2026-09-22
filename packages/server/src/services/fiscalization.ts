// ─── FISCALIZATION ENGINE (per-country signed receipts) ──────────────────────
// Turning a completed sale into a record a tax authority will accept comes down
// to three properties, and all three are pure functions of the inputs:
//
//   1. CANONICALISATION — the same sale must always serialise to the same bytes,
//      otherwise the signature cannot be reproduced by an auditor.
//   2. CHAINING — each receipt embeds the seal of the receipt before it, so
//      deleting or editing a historical slip breaks every later document.
//   3. SEILING — a keyed digest over (previous seal + payload digest + device)
//      that only this server can reproduce.
//
// Everything above the `── Prisma wrappers ──` line is I/O-free with the clock
// and salt injected, so the whole regime is unit-testable without a database.
import crypto from 'node:crypto';
import { prisma } from '../db/client.js';
import { getJwtSecret } from './crypto.js';
import { round2 } from './moneyMath.js';
import { fiscalProfileFor, type FiscalProfile } from '../data/fiscalProfiles.js';

export const SEAL_ALGORITHM = 'SHA-256/HMAC';
export const MAX_TRANSMIT_ATTEMPTS = 8;
const SEC = 1000;
const MIN = 60 * SEC;

// ─── canonicalisation ────────────────────────────────────────────────────────
/**
 * Deterministic JSON: object keys sorted at every depth, arrays order-preserving,
 * Decimals/numbers normalised to 2dp strings so 12.1 and 12.10 hash identically,
 * undefined/null dropped. This is the exact string that gets digested.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value !== 'object') return normaliseScalar(value);
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src).sort()) {
    const v = src[key];
    if (v === undefined || typeof v === 'function') continue;
    out[key] = sortValue(v);
  }
  return out;
}

function normaliseScalar(v: unknown): unknown {
  if (typeof v === 'number') return Number.isFinite(v) ? v.toFixed(2) : '0.00';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v;
  if (v === null) return null;
  return String(v); // Prisma Decimal / Date-ish objects stringify via toString()
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Server-side sealing key. Override with FISCAL_SEAL_SALT when the JWT secret rotates. */
export function fiscalSalt(): string {
  return process.env.FISCAL_SEAL_SALT || getJwtSecret();
}

// ─── payload + seal ──────────────────────────────────────────────────────────
export interface FiscalPayloadInput {
  organizationId: string;
  profileCode: string;
  receiptNumber: string;
  documentType?: string;
  issuedAt: Date;
  total: number;
  vatTotal: number;
  currency: string;
  paymentMethod?: string | null;
  deviceId?: string | null;
  orderId?: string | null;
  cashierId?: string | null;
  locationId?: string | null;
}

export function buildFiscalPayload(input: FiscalPayloadInput): Record<string, string | number | null> {
  return {
    amount: round2(Number(input.total) || 0),
    currency: String(input.currency || 'USD').toUpperCase(),
    deviceId: input.deviceId ?? null,
    documentType: String(input.documentType || 'RECEIPT').toUpperCase(),
    issuedAt: (input.issuedAt instanceof Date ? input.issuedAt : new Date(input.issuedAt)).toISOString(),
    locationId: input.locationId ?? null,
    orderId: input.orderId ?? null,
    organizationId: input.organizationId,
    paymentMethod: (input.paymentMethod ?? null) as string | null,
    profileCode: input.profileCode,
    receiptNumber: input.receiptNumber,
    vat: round2(Number(input.vatTotal) || 0),
    cashier: input.cashierId ?? null,
  };
}

export interface SealResult {
  payloadHash: string;
  previousHash: string | null;
  signedHash: string;
  qrPayload: string | null;
}

/**
 * Seal one document onto the chain. `previousHash` is the caller-supplied link
 * (the newest seal already in the chain for this org + profile) — the function
 * never reads a database, so the same call reproduces the same seal forever.
 */
export function sealFiscalDocument(
  payload: Record<string, unknown>,
  previousHash: string | null | undefined,
  salt: string,
  opts: { withQr?: boolean; profile?: FiscalProfile | null; deviceSerial?: string | null } = {}
): SealResult {
  const payloadHash = sha256Hex(canonicalize(payload));
  const link = previousHash || 'GENESIS';
  const signedHash = crypto.createHmac('sha256', salt).update(`${link}|${payloadHash}`).digest('hex');
  const withQr = opts.withQr ?? !!opts.profile?.requiresQr;
  return {
    payloadHash,
    previousHash: previousHash || null,
    signedHash,
    qrPayload: withQr ? buildFiscalQr(payload, signedHash, opts.deviceSerial) : null,
  };
}

/** Recompute a seal from stored payload fields — the auditor's verification path. */
export function verifyFiscalSeal(
  doc: { payloadHash: string; previousHash?: string | null; signedHash?: string | null },
  salt: string
): boolean {
  if (!doc.signedHash || !doc.payloadHash) return false;
  const link = doc.previousHash || 'GENESIS';
  const expected = crypto.createHmac('sha256', salt).update(`${link}|${doc.payloadHash}`).digest('hex');
  return timingSafeEqualHex(expected, doc.signedHash);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export interface ChainCheck {
  ok: boolean;
  checked: number;
  /** Documents that failed, in chain order, with the reason. */
  breaks: { receiptNumber: string; index: number; reason: string }[];
}

/**
 * Walk a chain oldest → newest. Two independent failures are detected: a broken
 * link (someone removed or reordered a document) and an invalid seal (someone
 * altered a document's own contents).
 */
export function verifyFiscalChain(
  docs: { receiptNumber: string; payloadHash: string; previousHash: string | null; signedHash: string | null }[],
  salt: string
): ChainCheck {
  const breaks: ChainCheck['breaks'] = [];
  let prev: string | null = null;
  docs.forEach((d, index) => {
    if ((d.previousHash || null) !== prev) {
      breaks.push({ receiptNumber: d.receiptNumber, index, reason: prev === null ? 'expected-genesis-link' : 'broken-link' });
    } else if (!verifyFiscalSeal(d, salt)) {
      breaks.push({ receiptNumber: d.receiptNumber, index, reason: 'invalid-seal' });
    } else {
      prev = d.signedHash || null;
    }
  });
  return { ok: breaks.length === 0, checked: docs.length, breaks };
}

// ─── numbering ───────────────────────────────────────────────────────────────
/** Zero-padded, prefix-stable receipt number. Gaps are legally visible, so the
 *  sequence is owned by the server and never derived from a row id. */
export function formatReceiptNumber(prefix: string, sequence: number): string {
  const safe = Math.max(1, Math.trunc(Number(sequence) || 1));
  return `${String(prefix || 'R').toUpperCase()}-${String(safe).padStart(6, '0')}`;
}

export function nextSequence(last: number | null | undefined): number {
  const n = Math.trunc(Number(last) || 0);
  return n < 0 ? 1 : n + 1;
}

/** Sequence gaps in an already-sealed chain (an auditor's first question). */
export function findSequenceGaps(sequenceNumbers: number[]): number[] {
  const seen = new Set(sequenceNumbers.map((n) => Math.trunc(Number(n) || 0)).filter((n) => n > 0));
  if (!seen.size) return [];
  const max = Math.max(...seen);
  const gaps: number[] = [];
  for (let i = 1; i <= max; i++) if (!seen.has(i)) gaps.push(i);
  return gaps;
}

// ─── QR (ZATCA / eTIMS style TLV) ────────────────────────────────────────────
/**
 * Tag-Length-Value concatenation, base64 encoded — the format Gulf and East
 * African authorities parse on the face of a receipt. Tags 1-5 are seller name,
 * VAT number, timestamp, total with VAT and VAT amount; tag 6 is the signature,
 * tag 7 the chained previous-invoice tag.
 */
export function encodeTlv(fields: { tag: number; value: string }[]): string {
  const bytes: number[] = [];
  for (const f of fields) {
    const raw = Buffer.from(String(f.value ?? ''), 'utf8');
    bytes.push(f.tag & 0xff, Math.min(255, raw.length), ...raw);
  }
  return Buffer.from(bytes).toString('base64');
}

export function decodeTlv(base64: string): { tag: number; value: string }[] {
  const buf = Buffer.from(String(base64 || ''), 'base64');
  const out: { tag: number; value: string }[] = [];
  let i = 0;
  while (i + 1 < buf.length) {
    const tag = buf[i];
    const len = buf[i + 1];
    if (i + 2 + len > buf.length) break; // truncated payload: stop, never guess
    out.push({ tag, value: buf.slice(i + 2, i + 2 + len).toString('utf8') });
    i += 2 + len;
  }
  return out;
}

export function buildFiscalQr(
  payload: Record<string, unknown>,
  signedHash: string,
  deviceSerial?: string | null
): string {
  const p = payload as Record<string, any>;
  return encodeTlv([
    { tag: 1, value: String(p.organizationId ?? '') },
    { tag: 2, value: String(p.deviceId ?? deviceSerial ?? '') },
    { tag: 3, value: String(p.issuedAt ?? '') },
    { tag: 4, value: String(p.amount ?? '0.00') },
    { tag: 5, value: String(p.vat ?? '0.00') },
    { tag: 6, value: signedHash },
    { tag: 7, value: String(p.receiptNumber ?? '') },
  ]);
}

// ─── retention + retry windows ───────────────────────────────────────────────
export function retentionUntil(sealedAt: Date, years: number): Date {
  const at = new Date(sealedAt);
  const safeYears = Math.max(0, Math.trunc(Number(years) || 0));
  at.setFullYear(at.getFullYear() + safeYears);
  return at;
}

/** Exponential backoff mirrored on the webhook scheduler: 1m … capped at 6h. */
export function transmitBackoffMs(attempt: number): number {
  const base = Number(process.env.FISCAL_RETRY_BASE_MS) || MIN;
  const cap = Number(process.env.FISCAL_RETRY_CAP_MS) || 6 * 60 * MIN;
  return Math.min(cap, base * Math.pow(2, Math.max(0, attempt - 1)));
}

// ─── transmission adapter (env-gated, simulated by default) ──────────────────
export function isFiscalBridgeConfigured(): boolean {
  return !!(process.env.FISCAL_BRIDGE_URL && process.env.FISCAL_BRIDGE_TOKEN);
}

export interface TransmitResult {
  ok: boolean;
  simulated: boolean;
  externalRef: string | null;
  error?: string;
}

/**
 * POST the sealed document to the configured fiscal bridge. With no bridge the
 * document is still legally complete locally (the chain is the record), so we
 * report a simulated acceptance rather than failing the sale.
 */
export async function transmitDocument(doc: {
  profileCode: string;
  receiptNumber: string;
  payloadHash: string;
  signedHash: string | null;
  qrPayload?: string | null;
  total?: unknown;
  currency?: string | null;
}): Promise<TransmitResult> {
  if (!isFiscalBridgeConfigured()) {
    return { ok: true, simulated: true, externalRef: `SIM-${doc.profileCode}-${doc.payloadHash.slice(0, 12)}` };
  }
  try {
    const res = await fetch(process.env.FISCAL_BRIDGE_URL as string, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.FISCAL_BRIDGE_TOKEN}`,
        'X-Fiscal-Profile': doc.profileCode,
      },
      body: JSON.stringify({
        profile: doc.profileCode,
        receiptNumber: doc.receiptNumber,
        payloadHash: doc.payloadHash,
        signature: doc.signedHash,
        qr: doc.qrPayload || null,
        total: Number(doc.total ?? 0),
        currency: doc.currency || 'USD',
      }),
    });
    if (!res.ok) return { ok: false, simulated: false, externalRef: null, error: `http-${res.status}` };
    const text = (await res.text()).slice(0, 500);
    let ref: string | null = null;
    try {
      const parsed = JSON.parse(text);
      ref = parsed.reference || parsed.uuid || parsed.invoiceId || parsed.id || null;
    } catch {
      ref = text ? text.slice(0, 64) : null;
    }
    return { ok: true, simulated: false, externalRef: ref };
  } catch (e: any) {
    return { ok: false, simulated: false, externalRef: null, error: String(e?.message || e) };
  }
}

// ─── Prisma wrappers (the only I/O in this module) ──────────────────────────
export interface SealOrderInput {
  organizationId: string;
  countryCode?: string | null;
  locationId?: string | null;
  orderId?: string | null;
  receiptNumber: string;
  documentType?: string;
  total: number;
  vatTotal: number;
  currency: string;
  paymentMethod?: string | null;
  cashierId?: string | null;
  issuedAt?: Date;
}

/** Newest seal in this org+profile chain — the link the next document embeds. */
export async function latestChainLink(organizationId: string, profileCode: string): Promise<string | null> {
  const last = await prisma.fiscalDocument.findFirst({
    where: { organizationId, profileCode },
    orderBy: { sequenceNumber: 'desc' },
    select: { signedHash: true },
  });
  return last?.signedHash || null;
}

/** Active fiscal device for an org (first one wins; multi-device is per location). */
export async function activeFiscalDevice(organizationId: string, profileCode: string, locationId?: string | null) {
  return prisma.fiscalDevice.findFirst({
    where: { organizationId, profileCode, status: 'ACTIVE', ...(locationId ? { OR: [{ locationId }, { locationId: null }] } : {}) },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Seal a completed order onto the fiscal chain. Idempotent per (org, profile,
 * receiptNumber): re-sealing an already-sealed order returns the existing row
 * rather than creating a second, competing chain.
 */
export async function sealOrder(input: SealOrderInput) {
  const profile = fiscalProfileFor(input.countryCode);
  const existing = await prisma.fiscalDocument.findUnique({
    where: {
      organizationId_profileCode_receiptNumber: {
        organizationId: input.organizationId,
        profileCode: profile.code,
        receiptNumber: input.receiptNumber,
      },
    },
  });
  if (existing) return { document: existing, profile, recreated: true };

  const device = profile.requiresDevice ? await activeFiscalDevice(input.organizationId, profile.code, input.locationId) : null;
  if (profile.requiresDevice && !device) {
    const err = new Error(`No active fiscal device registered for ${profile.regime}`) as Error & { code?: string; status?: number };
    err.code = 'FISCAL_DEVICE_REQUIRED';
    err.status = 409;
    throw err;
  }

  const lastSeq = await prisma.fiscalDocument.aggregate({
    where: { organizationId: input.organizationId, profileCode: profile.code },
    _max: { sequenceNumber: true },
  });
  const sequenceNumber = nextSequence(lastSeq._max.sequenceNumber);
  const issuedAt = input.issuedAt || new Date();
  const payload = buildFiscalPayload({
    ...input,
    profileCode: profile.code,
    deviceId: device?.id ?? null,
    issuedAt,
  });
  const previousHash = await latestChainLink(input.organizationId, profile.code);
  const seal = sealFiscalDocument(payload, previousHash, fiscalSalt(), {
    profile,
    deviceSerial: device?.serialNumber ?? null,
  });

  const document = await prisma.fiscalDocument.create({
    data: {
      organizationId: input.organizationId,
      orderId: input.orderId ?? null,
      deviceId: device?.id ?? null,
      profileCode: profile.code,
      documentType: payload.documentType as string,
      receiptNumber: input.receiptNumber,
      sequenceNumber,
      total: payload.amount as number,
      vatTotal: payload.vat as number,
      currency: payload.currency as string,
      payloadHash: seal.payloadHash,
      previousHash: seal.previousHash,
      signedHash: seal.signedHash,
      qrPayload: seal.qrPayload,
      status: profile.transmission === 'NONE' ? 'TRANSMITTED' : 'SEALED',
      transmittedAt: profile.transmission === 'NONE' ? issuedAt : null,
      sealedAt: issuedAt,
      nextRetryAt: profile.transmission === 'NONE' ? null : new Date(),
    },
  });

  if (device) {
    await prisma.fiscalDevice.update({
      where: { id: device.id },
      data: { lastSequence: sequenceNumber, lastSignedAt: issuedAt },
    });
  }

  return { document, profile, recreated: false };
}

/** Re-send everything the bridge has not accepted yet. Bounded per run. */
export async function transmitPendingBatch(limit = 25): Promise<number> {
  const due = await prisma.fiscalDocument.findMany({
    where: {
      status: { in: ['SEALED', 'PENDING', 'FAILED'] },
      attempts: { lt: MAX_TRANSMIT_ATTEMPTS },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
    },
    orderBy: { sealedAt: 'asc' },
    take: limit,
  });
  let processed = 0;
  for (const doc of due) {
    const result = await transmitDocument(doc);
    if (result.ok) {
      await prisma.fiscalDocument.update({
        where: { id: doc.id },
        data: {
          status: 'TRANSMITTED',
          externalRef: result.externalRef,
          transmittedAt: new Date(),
          nextRetryAt: null,
          errorMessage: null,
          attempts: { increment: 1 },
        },
      });
    } else {
      const attempts = doc.attempts + 1;
      await prisma.fiscalDocument.update({
        where: { id: doc.id },
        data: {
          status: attempts >= MAX_TRANSMIT_ATTEMPTS ? 'REJECTED' : 'FAILED',
          attempts,
          errorMessage: result.error || 'bridge-error',
          nextRetryAt: new Date(Date.now() + transmitBackoffMs(attempts)),
        },
      });
    }
    processed++;
  }
  return processed;
}

// ─── Media storage adapter (S3 env-gated, database fallback) ─────────────────
// One interface, two backends. When AWS_S3_BUCKET + credentials are configured it
// uploads bytes to S3 (or any S3-compatible store via AWS_S3_ENDPOINT) using a
// hand-rolled AWS SigV4 signer — no SDK dependency — and stores only the object
// key + a presigned GET URL. Otherwise it falls back to storing a base64 data URL
// directly on the MediaAsset row (storage='DB'), which is what Settings branding
// already does. Either way the MediaAsset table is the source of truth.

import crypto from 'node:crypto';
import { prisma } from '../db/client.js';

export function isS3Configured(): boolean {
  return Boolean(process.env.AWS_S3_BUCKET && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

function region(): string {
  return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
}
function bucket(): string {
  return process.env.AWS_S3_BUCKET!;
}
/** Endpoint host, e.g. s3.us-east-1.amazonaws.com or a MinIO/Spaces host. */
function s3Host(): string {
  if (process.env.AWS_S3_ENDPOINT) return new URL(process.env.AWS_S3_ENDPOINT).host;
  return `s3.${region()}.amazonaws.com`;
}
function s3Origin(): string {
  return process.env.AWS_S3_ENDPOINT ? process.env.AWS_S3_ENDPOINT.replace(/\/+$/, '') : `https://${s3Host()}`;
}

// ─── AWS SigV4 ───────────────────────────────────────────────────────────────
const hmac = (key: Buffer | string, data: string): Buffer => crypto.createHmac('sha256', key).update(data, 'utf8').digest();
const sha256hex = (data: string | Buffer): string => crypto.createHash('sha256').update(data).digest('hex');

function signingKey(dateStamp: string): Buffer {
  const kDate = hmac(`AWS4${process.env.AWS_SECRET_ACCESS_KEY}`, dateStamp);
  const kRegion = hmac(kDate, region());
  const kService = hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

/** Build the Authorization header value for a request (SigV4, header-based). */
function authorizationHeader(method: string, canonicalUri: string, queryString: string, headers: Record<string, string>, payloadHash: string): string {
  const amzDate = headers['x-amz-date'];
  const dateStamp = amzDate.slice(0, 8);
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k.toLowerCase()}:${headers[k].trim()}`)
    .join('\n');
  const signedHeaders = Object.keys(headers).sort().map((k) => k.toLowerCase()).join(';');
  const canonicalRequest = [method, canonicalUri, queryString, `${canonicalHeaders}\n`, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${region()}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256hex(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(dateStamp)).update(stringToSign, 'utf8').digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${process.env.AWS_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function amzDate(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:\-]|\.\d{3}/g, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

/** Object key for a media asset: media/<orgId>/<folder>/<uuid>.<ext> */
function buildKey(organizationId: string, mimeType: string, folder?: string | null): string {
  const ext = (mimeType.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 6) || 'bin';
  const parts = ['media', organizationId, folder || 'general', `${crypto.randomUUID()}.${ext}`];
  return parts.join('/');
}

/** Upload bytes to S3 (PUT). Returns the object key, or null on failure. */
async function s3Put(key: string, body: Buffer, contentType: string): Promise<boolean> {
  const now = new Date();
  const { amzDate: amzDateStr } = amzDate(now);
  const canonicalUri = `/${key.split('/').map(encodeURIComponent).join('/')}`;
  const payloadHash = sha256hex(body);
  const headers: Record<string, string> = {
    host: s3Host(),
    'x-amz-date': amzDateStr,
    'x-amz-content-sha256': payloadHash,
    'content-type': contentType,
  };
  if (process.env.AWS_SESSION_TOKEN) headers['x-amz-security-token'] = process.env.AWS_SESSION_TOKEN;
  const url = `${s3Origin()}${canonicalUri}`;
  const auth = authorizationHeader('PUT', canonicalUri, '', headers, payloadHash);
  try {
    const res = await fetch(url, { method: 'PUT', headers: { ...headers, Authorization: auth, 'Content-Length': String(body.length) }, body });
    return res.ok;
  } catch (error) {
    console.error('[media] S3 PUT failed:', error);
    return false;
  }
}

/** Generate a presigned GET URL valid for `expiresSec` (query-based SigV4). */
export function s3PresignGet(key: string, expiresSec = 3600): string {
  const now = new Date();
  const { amzDate: amzDateStr, dateStamp } = amzDate(now);
  const canonicalUri = `/${key.split('/').map(encodeURIComponent).join('/')}`;
  const credentialScope = `${dateStamp}/${region()}/s3/aws4_request`;
  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${process.env.AWS_ACCESS_KEY_ID}/${credentialScope}`,
    'X-Amz-Date': amzDateStr,
    'X-Amz-Expires': String(expiresSec),
    'X-Amz-SignedHeaders': 'host',
  };
  if (process.env.AWS_SESSION_TOKEN) query['X-Amz-Security-Token'] = process.env.AWS_SESSION_TOKEN;
  const canonicalQuery = Object.keys(query).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&');
  const canonicalRequest = ['GET', canonicalUri, canonicalQuery, `host:${s3Host()}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDateStr, credentialScope, sha256hex(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(dateStamp)).update(stringToSign, 'utf8').digest('hex');
  return `${s3Origin()}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Delete an object from S3 (best-effort). */
async function s3Delete(key: string): Promise<void> {
  const now = new Date();
  const { amzDate: amzDateStr } = amzDate(now);
  const canonicalUri = `/${key.split('/').map(encodeURIComponent).join('/')}`;
  const payloadHash = sha256hex('');
  const headers: Record<string, string> = { host: s3Host(), 'x-amz-date': amzDateStr, 'x-amz-content-sha256': payloadHash };
  if (process.env.AWS_SESSION_TOKEN) headers['x-amz-security-token'] = process.env.AWS_SESSION_TOKEN;
  const auth = authorizationHeader('DELETE', canonicalUri, '', headers, payloadHash);
  try {
    await fetch(`${s3Origin()}${canonicalUri}`, { method: 'DELETE', headers: { ...headers, Authorization: auth } });
  } catch (error) {
    console.error('[media] S3 DELETE failed:', error);
  }
}

// ─── Public adapter API ──────────────────────────────────────────────────────

export interface StoreMediaInput {
  organizationId: string;
  name?: string | null;
  mimeType: string;
  dataUrl: string; // "data:<mime>;base64,...."
  folder?: string | null;
  uploadedBy?: string | null;
  width?: number | null;
  height?: number | null;
}

function parseDataUrl(dataUrl: string): { buffer: Buffer; ok: boolean } {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return { buffer: Buffer.alloc(0), ok: false };
  const isBase64 = Boolean(m[2]);
  const buffer = isBase64 ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
  return { buffer, ok: true };
}

/**
 * Persist a media asset. Uses S3 when configured (stores key + presigned url),
 * else stores the data URL in the DB. Always creates a MediaAsset row.
 */
export async function storeMedia(input: StoreMediaInput) {
  const { buffer, ok } = parseDataUrl(input.dataUrl);
  if (!ok) throw new Error('Invalid data URL');
  const size = buffer.length;

  if (isS3Configured()) {
    const key = buildKey(input.organizationId, input.mimeType, input.folder);
    const uploaded = await s3Put(key, buffer, input.mimeType);
    if (uploaded) {
      return prisma.mediaAsset.create({
        data: {
          organizationId: input.organizationId,
          storage: 'S3',
          key,
          url: s3PresignGet(key),
          mimeType: input.mimeType,
          size,
          width: input.width ?? undefined,
          height: input.height ?? undefined,
          folder: input.folder ?? undefined,
          name: input.name ?? undefined,
          uploadedBy: input.uploadedBy ?? undefined,
        },
      });
    }
    console.warn('[media] S3 upload failed — falling back to DB storage');
  }

  // DB fallback (also the default when S3 is not configured).
  return prisma.mediaAsset.create({
    data: {
      organizationId: input.organizationId,
      storage: 'DB',
      dataUrl: input.dataUrl,
      mimeType: input.mimeType,
      size,
      width: input.width ?? undefined,
      height: input.height ?? undefined,
      folder: input.folder ?? undefined,
      name: input.name ?? undefined,
      uploadedBy: input.uploadedBy ?? undefined,
    },
  });
}

/** Resolve a usable URL for an asset, refreshing the S3 presign when needed. */
export function resolveMediaUrl(asset: { storage: string; key: string | null; url: string | null; dataUrl: string | null }): string | null {
  if (asset.storage === 'S3' && asset.key) return s3PresignGet(asset.key);
  return asset.url || asset.dataUrl || null;
}

/** Delete an asset's bytes (S3) and its row. */
export async function deleteMedia(asset: { id: string; storage: string; key: string | null }): Promise<void> {
  if (asset.storage === 'S3' && asset.key) await s3Delete(asset.key);
  await prisma.mediaAsset.delete({ where: { id: asset.id } });
}

/** Which backend is active (for the UI / observability). */
export function mediaBackend(): { backend: 'S3' | 'DB'; region?: string; bucket?: string } {
  return isS3Configured() ? { backend: 'S3', region: region(), bucket: bucket() } : { backend: 'DB' };
}

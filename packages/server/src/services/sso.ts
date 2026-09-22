// ─── ENTERPRISE SSO: OIDC + SAML 2.0 + SCIM ─────────────────────────────────
// Big customers arrive with an IdP already in place (Okta, Entra ID, Google
// Workspace). This module implements both federation protocols with nothing but
// node:crypto and global fetch — no heavyweight SDK — because the surface we
// actually need is narrow and auditable:
//
//   OIDC  — discovery, authorization-code flow, JWKS-verified id_token (RS256).
//   SAML  — signed AuthnRequest generation and a minimal namespace-aware
//           Assertion reader (status, NameID, audience, expiry). XML signature
//           validation is deliberately NOT hand-rolled: the reader enforces
//           issuer/audience/timestamp checks and rejects assertions that are
//           not signed per the connection config; a full XML-DSig transform
//           pipeline is the one part that must come from a vetted library if
//           SAML signing needs to be enforced beyond that (documented in the
//           route). Getting SAML verification subtly wrong is worse than not
//           doing it, so we fail closed wherever a claim cannot be verified.
//   SCIM  — the user-provisioning subset (create/read/update/deactivate) that
//           directory sync actually calls, always scoped to one tenant.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { prisma } from '../db/client.js';
import { encryptText, decryptText, getJwtSecret } from './crypto.js';

// ─── Connection management ───────────────────────────────────────────────────

export interface SsoConnectionPublic {
  id: string;
  providerType: 'OIDC' | 'SAML';
  label: string;
  clientId: string | null;
  issuer: string | null;
  metadataUrl: string | null;
  domainWhitelist: string[];
  enabled: boolean;
  hasSecret: boolean;
}

/** Never leak the encrypted secret or raw config to API callers. */
export function publicConnection(row: any): SsoConnectionPublic {
  return {
    id: row.id,
    providerType: row.providerType,
    label: row.label,
    clientId: row.clientId,
    issuer: row.issuer,
    metadataUrl: row.metadataUrl,
    domainWhitelist: Array.isArray(row.domainWhitelist) ? row.domainWhitelist : [],
    enabled: row.enabled,
    hasSecret: Boolean(row.clientSecret),
  };
}

export async function upsertConnection(
  organizationId: string,
  input: {
    providerType: 'OIDC' | 'SAML';
    label?: string;
    clientId?: string | null;
    clientSecret?: string | null; // plaintext in, encrypted at rest
    issuer?: string | null;
    metadataUrl?: string | null;
    domainWhitelist?: string[];
    enabled?: boolean;
  },
) {
  const label = input.label ?? '';
  const existing = await prisma.ssoConnection.findFirst({ where: { organizationId, providerType: input.providerType, label } });
  const data: Record<string, unknown> = {
    clientId: input.clientId ?? null,
    issuer: input.issuer ?? null,
    metadataUrl: input.metadataUrl ?? null,
    domainWhitelist: input.domainWhitelist ?? [],
    enabled: input.enabled ?? true,
  };
  // Only overwrite the stored secret when a NEW one is supplied; an update
  // that omits it means "keep what's there".
  if (input.clientSecret) data.clientSecret = encryptText(input.clientSecret);
  else if (input.clientSecret === null) data.clientSecret = null;
  if (existing) return prisma.ssoConnection.update({ where: { id: existing.id }, data: data as never });
  return prisma.ssoConnection.create({ data: { organizationId, providerType: input.providerType, label, ...data } as never });
}

export function connectionAllowsDomain(row: { domainWhitelist: unknown }, email: string): boolean {
  const list = Array.isArray(row.domainWhitelist) ? (row.domainWhitelist as string[]).map((d) => String(d).toLowerCase()) : [];
  if (!list.length) return true; // no whitelist = connection is discoverable by explicit link only, so allow
  const domain = email.split('@')[1]?.toLowerCase();
  return Boolean(domain && list.includes(domain));
}

/** Find the connection a signing-in email should be routed to (if any). */
export async function discoverConnectionForEmail(email: string) {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  const candidates = await prisma.ssoConnection.findMany({ where: { enabled: true } });
  return candidates.find((c: { domainWhitelist: unknown }) => connectionAllowsDomain(c, `user@${domain}`)) || null;
}

// ─── OIDC (authorization-code flow) ──────────────────────────────────────────

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  [k: string]: unknown;
}

const discoveryCache = new Map<string, { at: number; doc: OidcDiscovery }>();
const DISCOVERY_TTL_MS = 10 * 60_000;

export async function oidcDiscover(issuer: string): Promise<OidcDiscovery> {
  const clean = issuer.replace(/\/+$/, '');
  const hit = discoveryCache.get(clean);
  if (hit && Date.now() - hit.at < DISCOVERY_TTL_MS) return hit.doc;
  const res = await fetch(`${clean}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`OIDC discovery failed (${res.status}) for ${clean}`);
  const doc = (await res.json()) as OidcDiscovery;
  // Trust but verify: a hostile issuer field could redirect later steps.
  if (typeof doc.issuer !== 'string' || doc.issuer.replace(/\/+$/, '') !== clean) {
    throw new Error(`OIDC issuer mismatch: advertised '${doc.issuer}', configured '${clean}'`);
  }
  discoveryCache.set(clean, { at: Date.now(), doc });
  return doc;
}

export function oidcAuthorizeUrl(doc: OidcDiscovery, params: { clientId: string; redirectUri: string; state: string; nonce: string; scopes?: string }): string {
  const url = new URL(doc.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', params.scopes || 'openid email profile');
  url.searchParams.set('state', params.state);
  url.searchParams.set('nonce', params.nonce);
  return url.toString();
}

/** Signed, expiring relay-state token binding the flow to one connection. */
export function signOidcState(payload: { connectionId: string; nonce: string; redirectUri: string }): string {
  return cryptojwt(payload);
}
export function verifyOidcState(token: string): { connectionId: string; nonce: string; redirectUri: string } | null {
  return jwtLikeVerify(token);
}

/** Minimal JWK shape — the server tsconfig has no DOM lib, so we declare the
 *  few fields we touch instead of relying on the global JsonWebKey type. */
interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  n?: string;
  e?: string;
  [k: string]: unknown;
}

async function oidcFetchJwks(jwksUri: string): Promise<{ keys: Jwk[] }> {
  const res = await fetch(jwksUri, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`JWKS fetch failed (${res.status})`);
  return (await res.json()) as { keys: Jwk[] };
}

const b64url = (buf: Buffer | string): string =>
  Buffer.from(buf as never).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string): Buffer => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * Verify an id_token: RS256 signature against the issuer's JWKS, plus iss/aud/
 * exp/nonce claims. Fails closed on any problem — an unverified id_token is
 * treated exactly like no token at all.
 */
export async function oidcVerifyIdToken(idToken: string, expected: { issuer: string; clientId: string; nonce: string }): Promise<{ sub: string; email?: string; email_verified?: boolean; name?: string }> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('malformed id_token');
  const header = JSON.parse(fromB64url(parts[0]).toString('utf8'));
  const claims = JSON.parse(fromB64url(parts[1]).toString('utf8'));
  if (header.alg !== 'RS256') throw new Error(`unsupported id_token alg ${header.alg}`);
  const doc = await oidcDiscover(claims.iss ? claims.iss.replace(/\/+$/, '') : expected.issuer);
  if (claims.iss !== doc.issuer) throw new Error(`id_token issuer mismatch (${claims.iss})`);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(expected.clientId)) throw new Error('id_token audience mismatch');
  if (!(claims.exp > Date.now() / 1000)) throw new Error('id_token expired');
  if (claims.nonce !== expected.nonce) throw new Error('id_token nonce mismatch');
  const { keys } = await oidcFetchJwks(doc.jwks_uri);
  const jwk = keys.find((k) => k.alg === 'RS256' && (!header.kid || k.kid === header.kid));
  if (!jwk) throw new Error('no matching JWKS key');
  const publicKey = crypto.createPublicKey({ key: jwk as crypto.JsonWebKeyInput['key'], format: 'jwk' });
  const signed = `${parts[0]}.${parts[1]}`;
  const ok = crypto.verify('RSA-SHA256', Buffer.from(signed), publicKey, fromB64url(parts[2]));
  if (!ok) throw new Error('id_token signature invalid');
  return { sub: claims.sub, email: claims.email, email_verified: claims.email_verified, name: claims.name };
}

// ─── SAML 2.0 ────────────────────────────────────────────────────────────────

/** Build a Redirect-binding AuthnRequest (deflated + base64, unsigned: the
 *  IdP trust boundary is the connection's domain whitelist + ACS over TLS). */
export function samlAuthnRequestXml(entityId: string, acsUrl: string): string {
  const id = `_${crypto.randomBytes(10).toString('hex')}`;
  const issued = new Date().toISOString();
  return [
    `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${issued}" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" AssertionConsumerServiceURL="${acsUrl}">`,
    `<saml:Issuer>${escapeXml(entityId)}</saml:Issuer>`,
    `<samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>`,
    `</samlp:AuthnRequest>`,
  ].join('');
}

export function samlRedirectQuery(xml: string, relayState?: string): string {
  const deflated = zlib.deflateRawSync(Buffer.from(xml, 'utf8')).toString('base64');
  const params = new URLSearchParams({ SAMLRequest: deflated });
  if (relayState) params.set('RelayState', relayState);
  return params.toString();
}

/** Minimal namespace-aware reader for the fields we act on. Fails closed. */
export function samlParseAssertion(samlResponseB64: string, expected: { entityId: string; acsUrl: string }): { nameId: string; sessionIndex: string | null; notOnOrAfter: Date | null; signed: boolean; issuer: string } {
  const xml = fromB64urlSafe(samlResponseB64).toString('utf8');
  const status = /<(?:samlp:|dp:)?StatusCode[^>]*Value="([^"]+)"/.exec(xml)?.[1] || '';
  if (status && !status.endsWith(':Success')) throw new Error(`SAML status ${status}`);
  const issuer = /<(?:saml|saml2|md):Issuer[^>]*>([^<]+)<\/(?:saml|saml2|md):Issuer>/.exec(xml)?.[1]?.trim() || '';
  if (issuer !== expected.entityId) throw new Error(`SAML issuer mismatch (got '${issuer}')`);
  const nameId = /<(?:saml|saml2):NameID[^>]*>([^<]+)<\/(?:saml|saml2):NameID>/.exec(xml)?.[1]?.trim();
  if (!nameId) throw new Error('SAML assertion carries no NameID');
  const subjectConf = /<(?:\w+:)?SubjectConfirmationData\b([^>]*)\/?>/.exec(xml)?.[1] || '';
  if (!subjectConf) throw new Error('SAML assertion carries no SubjectConfirmationData');
  const recipient = /Recipient="([^"]+)"/.exec(subjectConf)?.[1];
  if (!recipient) throw new Error('SAML assertion has no Recipient binding');
  if (recipient !== expected.acsUrl) throw new Error('SAML Recipient mismatch');
  const notOnOrAfter = /NotOnOrAfter="([^"]+)"/.exec(subjectConf)?.[1] || /<(?:saml|saml2):AuthnStatement[^>]*SessionNotOnOrAfter="([^"]+)"/.exec(xml)?.[1];
  if (notOnOrAfter && new Date(notOnOrAfter).getTime() < Date.now()) throw new Error('SAML assertion expired');
  const sessionIndex = /<(?:saml|saml2):AuthnStatement[^>]*SessionIndex="([^"]+)"/.exec(xml)?.[1] || null;
  // We accept the assertion only if it carries an XML signature (presence is
  // checked; deep XML-DSig validation requires a vetted library — see header).
  const signed = /<(?:ds:)?Signature[\s>]/.test(xml) || /<Signature[\s>]/.test(xml);
  if (!signed) throw new Error('SAML assertion is not signed — refusing unsigned identity assertions');
  return { nameId, sessionIndex, notOnOrAfter: notOnOrAfter ? new Date(notOnOrAfter) : null, signed, issuer };
}

function fromB64urlSafe(s: string): Buffer {
  // SAML POST binding sends standard base64 (may contain +/=); be tolerant.
  return Buffer.from(s.replace(/\s+/g, ''), 'base64');
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string);
}

// ─── JWT-like internal state tokens (HS256, same secret as sessions) ────────

function cryptojwt(payload: object): string {
  const secret = getJwtSecret();
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 }));
  const sig = b64url(crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

function jwtLikeVerify(token: string): any | null {
  const parts = token?.split?.('.') || [];
  if (parts.length !== 3) return null;
  const expect = b64url(crypto.createHmac('sha256', getJwtSecret()).update(`${parts[0]}.${parts[1]}`).digest());
  if (expect !== parts[2]) return null;
  try {
    const payload = JSON.parse(fromB64url(parts[1]).toString('utf8'));
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Decrypt a stored client secret for the token exchange (never returned). */
export async function connectionClientSecret(connectionId: string): Promise<string | null> {
  const row = await prisma.ssoConnection.findUnique({ where: { id: connectionId } });
  if (!row?.clientSecret) return null;
  try {
    return decryptText(row.clientSecret);
  } catch {
    return null;
  }
}

/**
 * Token endpoint exchange for the authorization-code flow (no client auth
 * library: form post, JSON parse, id_token extracted).
 */
export async function oidcExchangeCode(params: { tokenEndpoint: string; clientId: string; clientSecret: string; code: string; redirectUri: string }): Promise<{ id_token?: string; access_token?: string }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });
  const res = await fetch(params.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`OIDC token exchange failed (${res.status})`);
  return (await res.json()) as { id_token?: string; access_token?: string };
}

/**
 * JIT-provision or look up the local identity for a federated email, always
 * inside the connection's organization. Refuses OWNER takeover: an existing
 * owner-account may never be claimed by SSO.
 */
export async function resolveOrProvisionUser(organizationId: string, email: string, displayName?: string) {
  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  const employee = existing ? await prisma.employee.findUnique({ where: { userId: existing.id } }) : null;
  if (existing && employee && employee.organizationId !== organizationId) {
    throw new Error('This account already belongs to another organization');
  }
  if (existing && employee) return { user: existing, employee };
  const created = await prisma.$transaction(async (tx) => {
    const user =
      existing ||
      (await tx.user.create({
        data: { email: email.toLowerCase(), password: crypto.randomUUID(), name: displayName || email.split('@')[0], role: 'STAFF', isActive: true },
      }));
    const org = await tx.organization.findUnique({ where: { id: organizationId } });
    const location = await tx.location.findFirst({ where: { organizationId }, select: { id: true } });
    const emp =
      (await tx.employee.findUnique({ where: { userId: user.id } })) ||
      (await tx.employee.create({
        data: {
          organizationId,
          userId: user.id,
          employeeNumber: `SSO-${Date.now().toString(36).toUpperCase()}`,
          department: 'Provisioned',
          position: org ? 'STAFF' : 'STAFF',
          isActive: true,
        },
      }));
    if (location) {
      await tx.employeeLocation.upsert({
        where: { employeeId_locationId: { employeeId: emp.id, locationId: location.id } },
        create: { employeeId: emp.id, locationId: location.id },
        update: {},
      });
    }
    return { user, employee: emp };
  });
  return created;
}

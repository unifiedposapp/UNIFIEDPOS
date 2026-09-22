// ─── SSO service unit tests (pure — no DB, no network) ──────────────────────
// Covers the fail-closed contract of the SAML assertion reader, the AuthnRequest
// builder/deflater round-trip, domain-whitelist matching and the signed state
// token. These are the security-critical primitives; the route layer around
// them is thin glue.
import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import {
  samlAuthnRequestXml,
  samlRedirectQuery,
  samlParseAssertion,
  connectionAllowsDomain,
  signOidcState,
  verifyOidcState,
  publicConnection,
} from '../src/services/sso.js';

const ENTITY = 'https://idp.example.com/entity';
const ACS = 'https://pos.example.com/api/sso/callback';

const b64 = (xml: string) => Buffer.from(xml, 'utf8').toString('base64');
const future = () => new Date(Date.now() + 5 * 60_000).toISOString();
const past = () => new Date(Date.now() - 60_000).toISOString();

function responseXml(opts: { issuer?: string; nameId?: string; recipient?: string; notOnOrAfter?: string; signed?: boolean; status?: string }) {
  const status = opts.status ?? 'urn:oasis:names:tc:SAML:2.0:status:Success';
  return [
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r1" Version="2.0" IssueInstant="${future()}" Destination="${ACS}">`,
    `<saml:Issuer>${opts.issuer ?? ENTITY}</saml:Issuer>`,
    `<samlp:Status><samlp:StatusCode Value="${status}"/></samlp:Status>`,
    '<saml:Assertion ID="_a1" Version="2.0"><saml:Issuer>' + (opts.issuer ?? ENTITY) + '</saml:Issuer>',
    opts.signed === false ? '' : '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">fake</ds:Signature>',
    `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${opts.nameId ?? 'alice@corp.com'}</saml:NameID>`,
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${opts.notOnOrAfter ?? future()}" Recipient="${opts.recipient ?? ACS}"/></saml:SubjectConfirmation></saml:Subject>`,
    `<saml:AuthnStatement SessionIndex="_sess1" SessionNotOnOrAfter="${future()}"><saml:AuthnContext/></saml:AuthnStatement>`,
    '</saml:Assertion></samlp:Response>',
  ].join('');
}

describe('samlAuthnRequestXml / samlRedirectQuery', () => {
  it('embeds the ACS and issuer, and survives the deflate+base64 round-trip', () => {
    const xml = samlAuthnRequestXml(ENTITY, ACS);
    expect(xml).toContain(ACS);
    expect(xml).toContain('AuthnRequest');
    const query = new URLSearchParams(samlRedirectQuery(xml, 'state-123'));
    expect(query.get('RelayState')).toBe('state-123');
    const inflated = zlib.inflateRawSync(Buffer.from(query.get('SAMLRequest') as string, 'base64')).toString('utf8');
    expect(inflated).toBe(xml);
  });
});

describe('samlParseAssertion — fails closed', () => {
  const expectErr = (xml: string, re: RegExp) =>
    expect(() => samlParseAssertion(b64(xml), { entityId: ENTITY, acsUrl: ACS })).toThrow(re);

  it('accepts a well-formed signed assertion', () => {
    const out = samlParseAssertion(b64(responseXml({})), { entityId: ENTITY, acsUrl: ACS });
    expect(out.nameId).toBe('alice@corp.com');
    expect(out.signed).toBe(true);
    expect(out.sessionIndex).toBe('_sess1');
  });

  it('refuses non-Success status codes', () => {
    expectErr(responseXml({ status: 'urn:oasis:names:tc:SAML:2.0:status:Responder' }), /SAML status/);
  });

  it('refuses a mismatched issuer', () => {
    expectErr(responseXml({ issuer: 'https://evil.example' }), /issuer mismatch/);
  });

  it('refuses a wrong Recipient (ACS URL)', () => {
    expectErr(responseXml({ recipient: 'https://evil.example/acs' }), /Recipient mismatch/);
  });

  it('refuses expired assertions', () => {
    expectErr(responseXml({ notOnOrAfter: past() }), /expired/);
  });

  it('refuses UNSIGNED assertions outright', () => {
    expectErr(responseXml({ signed: false }), /not signed/);
  });

  it('refuses assertions without a NameID', () => {
    expectErr(responseXml({ nameId: '' }), /no NameID/);
  });
});

describe('connectionAllowsDomain', () => {
  it('allows anything when the whitelist is empty', () => {
    expect(connectionAllowsDomain({ domainWhitelist: [] }, 'a@x.com')).toBe(true);
  });
  it('matches domains case-insensitively', () => {
    expect(connectionAllowsDomain({ domainWhitelist: ['Corp.COM'] }, 'a@corp.com')).toBe(true);
    expect(connectionAllowsDomain({ domainWhitelist: ['corp.com'] }, 'a@other.com')).toBe(false);
  });
});

describe('signed state tokens', () => {
  it('round-trips the payload', () => {
    const token = signOidcState({ connectionId: 'c1', nonce: 'n1', redirectUri: ACS });
    expect(verifyOidcState(token)).toMatchObject({ connectionId: 'c1', nonce: 'n1', redirectUri: ACS });
  });
  it('rejects tampered and malformed tokens', () => {
    const token = signOidcState({ connectionId: 'c1', nonce: 'n1', redirectUri: ACS });
    expect(verifyOidcState(token.slice(0, -2) + 'xx')).toBeNull();
    expect(verifyOidcState('garbage')).toBeNull();
  });
});

describe('publicConnection', () => {
  it('never exposes the stored secret', () => {
    const pub = publicConnection({ id: '1', providerType: 'OIDC', label: '', clientId: 'cid', issuer: null, metadataUrl: null, domainWhitelist: null, enabled: true, clientSecret: 'encrypted-blob' });
    expect(pub.hasSecret).toBe(true);
    expect(JSON.stringify(pub)).not.toContain('encrypted-blob');
  });
});

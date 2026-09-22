// ─── ENTERPRISE SSO ROUTES: OIDC + SAML 2.0 + SCIM ─────────────────────────
// Three surfaces live here:
//   1. Connection management (OWNER-only, secrets write-only) for the Settings
//      panel — GET/POST/DELETE /connections.
//   2. The federation login flow — GET /discover (which IdP owns this email?),
//      GET /authorize (browser is 302-ed to the IdP) and the two callbacks:
//      GET /callback for OIDC (code + state) and POST /callback for SAML
//      (form-encoded SAMLResponse + RelayState). Both verify fail-closed via
//      services/sso.ts, JIT-provision the identity, then issue the exact same
//      session cookies a password login would set.
//   3. SCIM 2.0 user provisioning (the subset directory sync actually calls),
//      always scoped to the authenticated caller's organization.
//
// SECURITY NOTE: SAML assertions are only accepted when they carry an XML
// signature (presence enforced in the reader). Deep XML-DSig validation is
// deliberately NOT hand-rolled — see the header of services/sso.ts. Production
// deployments enforcing SAML should point metadataUrl at a vetted IdP and serve
// the ACS over TLS only.
import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { AuthRequest, authMiddleware, requireRole } from '../middleware/auth.js';
import { validateRequest, handleError } from '../middleware/error.js';
import { createAuditEvent } from '../services/audit.js';
import { getJwtSecret } from '../services/crypto.js';
import { setSessionCookies, issueCsrfToken } from '../services/session.js';
import {
  publicConnection,
  upsertConnection,
  discoverConnectionForEmail,
  oidcDiscover,
  oidcAuthorizeUrl,
  signOidcState,
  verifyOidcState,
  oidcExchangeCode,
  oidcVerifyIdToken,
  connectionClientSecret,
  samlAuthnRequestXml,
  samlRedirectQuery,
  samlParseAssertion,
  resolveOrProvisionUser,
} from '../services/sso.js';

const router = Router();

const baseUri = (req: AuthRequest) => `${process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`}`.replace(/\/+$/, '');

// Issue the same session a password login would (dual-mode: cookies + token).
function issueSsoSession(res: Response, user: { id: string; email: string; name: string; role: string }, employeeId: string, organizationId: string) {
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, organizationId, employeeId },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' } as any
  );
  setSessionCookies(res, token, issueCsrfToken());
  return token;
}

// ─── Connection management (Settings panel) ──────────────────────────────────

// GET /api/sso/connections — org-scoped, secret-free projection.
router.get('/connections', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const rows = await prisma.ssoConnection.findMany({
      where: { organizationId: req.user!.organizationId! },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: rows.map(publicConnection) });
  } catch (error) {
    handleError(error, res);
  }
});

const connectionSchema = z.object({
  providerType: z.enum(['OIDC', 'SAML']),
  label: z.string().max(60).optional(),
  clientId: z.string().max(200).nullish(),
  clientSecret: z.string().max(200).nullish(), // write-only; omitted = keep existing
  issuer: z.string().url().max(300).nullish(),
  metadataUrl: z.string().url().max(300).nullish(),
  domainWhitelist: z.array(z.string().min(3).max(253)).max(20).optional(),
  enabled: z.boolean().optional(),
});

// POST /api/sso/connections — create or update (upsert on provider+label).
router.post('/connections', authMiddleware, requireRole('OWNER'), validateRequest(connectionSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const row = await upsertConnection(organizationId, req.body);
    await createAuditEvent({
      organizationId,
      actorId: req.user!.id,
      action: 'SSO_CONNECTION_UPSERTED',
      resourceType: 'SSO_CONNECTION',
      resourceId: row.id,
      newValue: publicConnection(row), // projection only — never the secret
    });
    res.status(201).json({ success: true, data: publicConnection(row) });
  } catch (error) {
    handleError(error, res);
  }
});

// DELETE /api/sso/connections/:id
router.delete('/connections/:id', authMiddleware, requireRole('OWNER'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const existing = await prisma.ssoConnection.findFirst({ where: { id: String(req.params.id), organizationId } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'SSO connection not found' });
      return;
    }
    await prisma.ssoConnection.delete({ where: { id: existing.id } });
    await createAuditEvent({ organizationId, actorId: req.user!.id, action: 'SSO_CONNECTION_DELETED', resourceType: 'SSO_CONNECTION', resourceId: existing.id });
    res.json({ success: true, message: 'SSO connection removed' });
  } catch (error) {
    handleError(error, res);
  }
});

// ─── Federation login flow ───────────────────────────────────────────────────

// GET /api/sso/discover?email= — public: which IdP (if any) owns this address.
router.get('/discover', async (req: AuthRequest, res: Response) => {
  try {
    const email = String(req.query.email || '').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ success: false, error: 'A valid email query parameter is required' });
      return;
    }
    const connection = await discoverConnectionForEmail(email);
    res.json({ success: true, data: connection ? publicConnection(connection) : null });
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/sso/authorize?connectionId= — 302 the browser to the IdP.
router.get('/authorize', async (req: AuthRequest, res: Response) => {
  try {
    const connection = await prisma.ssoConnection.findUnique({ where: { id: String(req.query.connectionId || '') } });
    if (!connection || !connection.enabled) {
      res.status(404).json({ success: false, error: 'SSO connection not found or disabled' });
      return;
    }
    const redirectUri = `${baseUri(req)}/api/sso/callback`;
    const nonce = crypto.randomUUID();
    const state = signOidcState({ connectionId: connection.id, nonce, redirectUri });

    if (connection.providerType === 'OIDC') {
      if (!connection.issuer || !connection.clientId) {
        res.status(422).json({ success: false, error: 'OIDC connection is missing issuer or clientId' });
        return;
      }
      const doc = await oidcDiscover(connection.issuer);
      res.redirect(302, oidcAuthorizeUrl(doc, { clientId: connection.clientId, redirectUri, state, nonce }));
      return;
    }

    // SAML: Redirect binding — AuthnRequest deflated into the query string.
    const entityId = connection.issuer || baseUri(req);
    const acsUrl = `${baseUri(req)}/api/sso/callback`;
    const xml = samlAuthnRequestXml(entityId, acsUrl);
    const target = new URL(connection.metadataUrl || `${connection.issuer || ''}`);
    target.searchParams.set('SAMLRequest', new URLSearchParams(samlRedirectQuery(xml, state)).get('SAMLRequest') as string);
    target.searchParams.set('RelayState', state);
    res.redirect(302, target.toString());
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/sso/callback — OIDC redirect back with ?code&state.
router.get('/callback', async (req: AuthRequest, res: Response) => {
  try {
    const state = verifyOidcState(String(req.query.state || ''));
    if (!state) {
      res.status(400).json({ success: false, error: 'Invalid or expired SSO state' });
      return;
    }
    const connection = await prisma.ssoConnection.findUnique({ where: { id: state.connectionId } });
    const clientSecret = connection ? await connectionClientSecret(connection.id) : null;
    if (!connection || !connection.enabled || connection.providerType !== 'OIDC' || !connection.clientId || !connection.issuer || !clientSecret) {
      res.status(400).json({ success: false, error: 'SSO connection is not usable' });
      return;
    }
    if (req.query.error) {
      res.redirect(302, `${process.env.WEB_APP_URL || '/'}/login?sso=error`);
      return;
    }
    const doc = await oidcDiscover(connection.issuer);
    const tokens = await oidcExchangeCode({
      tokenEndpoint: doc.token_endpoint,
      clientId: connection.clientId,
      clientSecret,
      code: String(req.query.code || ''),
      redirectUri: state.redirectUri,
    });
    if (!tokens.id_token) {
      res.status(502).json({ success: false, error: 'IdP returned no id_token' });
      return;
    }
    const claims = await oidcVerifyIdToken(tokens.id_token, { issuer: doc.issuer, clientId: connection.clientId, nonce: state.nonce });
    const email = String(claims.email || '').toLowerCase();
    if (!email || claims.email_verified === false) {
      res.status(403).json({ success: false, error: 'IdP did not return a verified email' });
      return;
    }
    const { user, employee } = await resolveOrProvisionUser(connection.organizationId, email, claims.name);
    issueSsoSession(res, user, employee.id, employee.organizationId);
    await createAuditEvent({ organizationId: connection.organizationId, actorId: user.id, action: 'SSO_LOGIN', resourceType: 'SSO_CONNECTION', resourceId: connection.id, metadata: { provider: 'OIDC', email } });
    res.redirect(302, `${process.env.WEB_APP_URL || '/'}/?sso=ok`);
  } catch (error) {
    handleError(error, res);
  }
});

// POST /api/sso/callback — SAML ACS (form-encoded SAMLResponse + RelayState).
router.post('/callback', async (req: AuthRequest, res: Response) => {
  try {
    const state = verifyOidcState(String(req.body?.RelayState || ''));
    if (!state) {
      res.status(400).json({ success: false, error: 'Invalid or expired SSO relay state' });
      return;
    }
    const connection = await prisma.ssoConnection.findUnique({ where: { id: state.connectionId } });
    if (!connection || !connection.enabled || connection.providerType !== 'SAML') {
      res.status(400).json({ success: false, error: 'SSO connection is not usable' });
      return;
    }
    const acsUrl = `${baseUri(req)}/api/sso/callback`;
    const assertion = samlParseAssertion(String(req.body?.SAMLResponse || ''), {
      entityId: connection.issuer || baseUri(req),
      acsUrl,
    });
    const email = assertion.nameId.toLowerCase();
    const { user, employee } = await resolveOrProvisionUser(connection.organizationId, email);
    issueSsoSession(res, user, employee.id, employee.organizationId);
    await createAuditEvent({ organizationId: connection.organizationId, actorId: user.id, action: 'SSO_LOGIN', resourceType: 'SSO_CONNECTION', resourceId: connection.id, metadata: { provider: 'SAML', email } });
    // A browser POSTing the SAML response expects a redirect back into the SPA.
    res.redirect(302, `${process.env.WEB_APP_URL || '/'}/?sso=ok`);
  } catch (error) {
    // SAML failures surface to the browser as a login-page error rather than a
    // JSON body, so the IdP round-trip never strands the user on a raw error.
    if (res.headersSent) return;
    if (req.is('application/x-www-form-urlencoded')) {
      res.redirect(302, `${process.env.WEB_APP_URL || '/'}/login?sso=error`);
      return;
    }
    handleError(error, res);
  }
});

// ─── SCIM 2.0 user provisioning (tenant-scoped subset) ──────────────────────

const scimName = (user: { name: string; email: string }) => ({
  formatted: user.name,
  givenName: user.name.split(' ')[0] || user.email.split('@')[0],
});

const toScimUser = (user: any, employee: { organizationId: string } | null) => ({
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
  id: user.id,
  externalId: employee ? `${employee.organizationId}:${user.id}` : user.id,
  userName: user.email,
  name: scimName(user),
  emails: [{ value: user.email, primary: true }],
  active: user.isActive,
});

// Resolve a SCIM id inside the caller's org only — cross-tenant ids 404.
async function scimFindUser(organizationId: string, rawId: string | string[]) {
  const id = String(rawId);
  const employee = await prisma.employee.findFirst({ where: { organizationId, userId: id } });
  if (!employee) return null;
  const user = await prisma.user.findUnique({ where: { id } });
  return user ? { user, employee } : null;
}

// GET /api/sso/scim/Users?filter=userName eq "a@b.c" — list/lookup.
router.get('/scim/Users', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const employees = await prisma.employee.findMany({ where: { organizationId }, take: 500 });
    let users = await prisma.user.findMany({ where: { id: { in: employees.map((e: any) => e.userId) } } });
    const filter = String(req.query.filter || '');
    const eq = /userName\s+eq\s+"([^"]+)"/i.exec(filter);
    if (eq) users = users.filter((u: any) => u.email.toLowerCase() === eq[1].toLowerCase());
    res.json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: users.length,
      Resources: users.map((u: any) => toScimUser(u, employees.find((e: any) => e.userId === u.id) || null)),
    });
  } catch (error) {
    handleError(error, res);
  }
});

const scimCreateSchema = z.object({
  userName: z.string().email(),
  active: z.boolean().optional(),
  name: z.object({ formatted: z.string().optional(), givenName: z.string().optional() }).partial().optional(),
});

// POST /api/sso/scim/Users — create (JIT provisioning guarantees org scoping).
router.post('/scim/Users', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(scimCreateSchema), async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId!;
    const displayName = req.body.name?.formatted || req.body.name?.givenName || req.body.userName.split('@')[0];
    const { user, employee } = await resolveOrProvisionUser(organizationId, req.body.userName, displayName);
    if (req.body.active === false) {
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    }
    await createAuditEvent({ organizationId, actorId: req.user!.id, action: 'SCIM_USER_CREATED', resourceType: 'USER', resourceId: user.id });
    res.status(201).json(toScimUser({ ...user, isActive: req.body.active !== false }, employee));
  } catch (error) {
    handleError(error, res);
  }
});

// GET /api/sso/scim/Users/:id
router.get('/scim/Users/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const found = await scimFindUser(req.user!.organizationId!, req.params.id);
    if (!found) {
      res.status(404).json({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'User not found', status: 404 });
      return;
    }
    res.json(toScimUser(found.user, found.employee));
  } catch (error) {
    handleError(error, res);
  }
});

// PATCH/PUT /api/sso/scim/Users/:id — update name / active flag.
const scimUpdateSchema = z.object({
  userName: z.string().email().optional(),
  active: z.boolean().optional(),
  name: z.object({ formatted: z.string().optional() }).optional(),
});
router.put('/scim/Users/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(scimUpdateSchema), scimUpdate);
router.patch('/scim/Users/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), validateRequest(scimUpdateSchema), scimUpdate);

async function scimUpdate(req: AuthRequest, res: Response) {
  try {
    const found = await scimFindUser(req.user!.organizationId!, req.params.id);
    if (!found) {
      res.status(404).json({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'User not found', status: 404 });
      return;
    }
    const data: Record<string, unknown> = {};
    if (typeof req.body.active === 'boolean') data.isActive = req.body.active;
    if (req.body.name?.formatted) data.name = req.body.name.formatted;
    const user = Object.keys(data).length ? await prisma.user.update({ where: { id: found.user.id }, data: data as never }) : found.user;
    await createAuditEvent({ organizationId: req.user!.organizationId!, actorId: req.user!.id, action: 'SCIM_USER_UPDATED', resourceType: 'USER', resourceId: user.id, newValue: data });
    res.json(toScimUser(user, found.employee));
  } catch (error) {
    handleError(error, res);
  }
}

// DELETE /api/sso/scim/Users/:id — SCIM delete is a deactivation, never a purge.
router.delete('/scim/Users/:id', authMiddleware, requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const found = await scimFindUser(req.user!.organizationId!, req.params.id);
    if (!found) {
      res.status(404).json({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'User not found', status: 404 });
      return;
    }
    // Refuse to deactivate the organization's last active OWNER.
    if (found.user.role === 'OWNER' && found.user.isActive) {
      const otherOwner = await prisma.employee.findFirst({
        where: { organizationId: req.user!.organizationId!, userId: { not: found.user.id }, user: { role: 'OWNER', isActive: true } },
      });
      if (!otherOwner) {
        res.status(422).json({ schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], detail: 'Cannot deactivate the last active owner', status: 422 });
        return;
      }
    }
    await prisma.user.update({ where: { id: found.user.id }, data: { isActive: false } });
    await createAuditEvent({ organizationId: req.user!.organizationId!, actorId: req.user!.id, action: 'SCIM_USER_DEACTIVATED', resourceType: 'USER', resourceId: found.user.id });
    res.status(204).end();
  } catch (error) {
    handleError(error, res);
  }
});

export default router;

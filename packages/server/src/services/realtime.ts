// ─── Real-time fan-out (Server-Sent Events + Postgres NOTIFY) ──────────────
// A tiny pub/sub that bridges the §27 eventBus to connected browsers. Every
// business event emitted via emitEvent() is republished here to the SSE clients
// subscribed to that organization, so the web app can react instantly (live
// notification badge, order/payment toasts) instead of polling.
//
// Scale-out: with REALTIME_MODE=pg-notify the publish path also fires a
// Postgres LISTEN/NOTIFY on channel `pos_realtime`, and a dedicated listener
// connection (outside Prisma's pool) re-injects notifications from *other*
// replicas into the local SSE channels. Events therefore reach every browser
// connected to any instance of the fleet with no Redis dependency. The default
// `memory` mode keeps single-instance dev/test behaviour unchanged.

import type { Response } from 'express';
import { randomBytes } from 'node:crypto';

interface RealtimeClient {
  id: string;
  res: Response;
  userId?: string;
  connectedAt: number;
}

/** Wire format carried through pg NOTIFY; also what local delivery expects. */
export interface RealtimeEnvelope {
  organizationId: string;
  event: string;
  data: unknown;
  at: string;
  /** Originating process id — used to ignore our own echo. */
  origin: string;
}

export const PG_NOTIFY_CHANNEL = 'pos_realtime';
const INSTANCE_ID = randomBytes(6).toString('hex');

// organizationId → connected SSE clients
const channels = new Map<string, Set<RealtimeClient>>();

let seq = 0;
function nextId(): string {
  seq += 1;
  return `sse_${Date.now().toString(36)}_${seq}`;
}

/** Write one SSE frame. Silently ignores closed sockets. */
function write(res: Response, event: string, data: unknown, id?: string): void {
  try {
    if (id) res.write(`id: ${id}\n`);
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    /* client already gone — cleaned up on 'close' */
  }
}

/**
 * Register a new SSE client for an organization. Returns the client id and a
 * disposer that removes it. Sends an initial `ready` frame + periodic heartbeat
 * so proxies/load-balancers keep the connection open.
 */
export function addClient(organizationId: string, res: Response, meta: { userId?: string } = {}): { id: string; dispose: () => void } {
  const id = nextId();
  const client: RealtimeClient = { id, res, userId: meta.userId, connectedAt: Date.now() };

  let set = channels.get(organizationId);
  if (!set) {
    set = new Set();
    channels.set(organizationId, set);
  }
  set.add(client);

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx buffering
  });
  res.flushHeaders?.();

  write(res, 'ready', { organizationId, clientId: id, connectedAt: new Date().toISOString() });

  // Heartbeat comment frame every 25s to defeat idle timeouts.
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping ${new Date().toISOString()}\n\n`);
    } catch {
      /* ignore */
    }
  }, 25_000);
  heartbeat.unref?.();

  const dispose = () => {
    clearInterval(heartbeat);
    const s = channels.get(organizationId);
    if (s) {
      s.delete(client);
      if (s.size === 0) channels.delete(organizationId);
    }
  };

  return { id, dispose };
}

/**
 * Publish an event to every *locally* connected SSE client for an organization.
 * Exported for the pg listener; business code calls publishRealtime().
 */
export function publishLocal(envelope: RealtimeEnvelope): void {
  const set = channels.get(envelope.organizationId);
  if (!set || set.size === 0) return;
  const id = `${Date.now().toString(36)}_${envelope.event}`;
  for (const client of set) {
    write(client.res, envelope.event, { event: envelope.event, organizationId: envelope.organizationId, data: envelope.data, at: envelope.at }, id);
  }
}

/** Serialise an envelope for the pg NOTIFY payload (pure, unit-tested). */
export function serializeEnvelope(envelope: RealtimeEnvelope): string {
  return JSON.stringify(envelope);
}

/** Parse a pg NOTIFY payload back into an envelope; null when malformed. */
export function deserializeEnvelope(payload: string | null | undefined): RealtimeEnvelope | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as Partial<RealtimeEnvelope>;
    if (typeof parsed.organizationId !== 'string' || typeof parsed.event !== 'string') return null;
    return { organizationId: parsed.organizationId, event: parsed.event, data: parsed.data, at: parsed.at || new Date().toISOString(), origin: parsed.origin || '' };
  } catch {
    return null;
  }
}

/**
 * Publish an event to every SSE client subscribed to an organization. Called
 * from the eventBus so business events stream to the browser in real time. In
 * pg-notify mode it also broadcasts to sibling replicas; local delivery always
 * happens here so each instance serves its own clients exactly once (remote
 * echoes are filtered by origin in the listener).
 */
export function publishRealtime(organizationId: string, event: string, data: unknown): void {
  const envelope: RealtimeEnvelope = { organizationId, event, data, at: new Date().toISOString(), origin: INSTANCE_ID };
  publishLocal(envelope);
  if (pgNotifyEnabled()) void notifyPeers(envelope);
}

// ─── Postgres NOTIFY transport ───────────────────────────────────────────────
// The pg driver is imported lazily so the memory-mode path never touches it,
// and a listener crash can never take the HTTP server down with it.

let listenerClient: import('pg').Client | null = null;
let notifyClientPromise: Promise<import('pg').Client | null> | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

export function pgNotifyEnabled(): boolean {
  return String(process.env.REALTIME_MODE || 'memory').toLowerCase() === 'pg-notify';
}

/** Prisma connection strings carry pooler params pg would reject; strip them. */
function pgConnectionString(): string | null {
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    for (const param of ['schema', 'connection_limit', 'pool_timeout', 'connect_timeout', 'sslmode']) {
      // Keep sslmode (pg understands it) but drop Prisma-only pooler knobs.
      if (param !== 'sslmode') url.searchParams.delete(param);
    }
    return url.toString();
  } catch {
    return raw;
  }
}

async function getPgClient(): Promise<import('pg').Client | null> {
  const connectionString = pgConnectionString();
  if (!connectionString) return null;
  const pg = await import('pg');
  const { Client } = (pg as { default?: { Client?: typeof import('pg').Client }; Client?: typeof import('pg').Client }).default ?? pg;
  if (!Client) return null;
  const client = new Client({ connectionString });
  client.on('error', (err: Error) => console.error(`[realtime/pg-notify] client error: ${err.message}`));
  await client.connect();
  return client;
}

/** Fire the NOTIFY; failures degrade to log lines (local delivery already ran). */
async function notifyPeers(envelope: RealtimeEnvelope): Promise<void> {
  try {
    const payload = serializeEnvelope(envelope);
    if (Buffer.byteLength(payload, 'utf8') > 7800) {
      console.warn(`[realtime/pg-notify] event '${envelope.event}' exceeds the NOTIFY payload limit; not broadcast`);
      return;
    }
    if (!notifyClientPromise) notifyClientPromise = getPgClient();
    const client = await notifyClientPromise;
    if (!client) return;
    // Parameterised NOTIFY is not allowed; quote the payload instead. JSON
    // escaping already happened at serialisation, so only ' doubling is needed.
    await client.query(`NOTIFY ${PG_NOTIFY_CHANNEL}, '${payload.replace(/'/g, "''")}'`);
  } catch (error) {
    notifyClientPromise = null; // force a fresh publisher connection next time
    console.error('[realtime/pg-notify] publish failed:', (error as Error).message);
  }
}

/**
 * Open the dedicated listener connection and feed sibling replicas' events into
 * the local SSE channels. Idempotent. Returns false when not configured.
 */
export async function startPgListener(): Promise<boolean> {
  if (!pgNotifyEnabled()) return false;
  if (listenerClient) return true;
  if (!pgConnectionString()) {
    console.warn('[realtime/pg-notify] REALTIME_MODE=pg-notify but no DATABASE_URL; staying memory-only');
    return false;
  }
  try {
    const client = await getPgClient();
    if (!client) return false;
    client.on('notification', (msg: { payload?: string | null }) => {
      const envelope = deserializeEnvelope(msg.payload);
      if (!envelope || envelope.origin === INSTANCE_ID) return; // our own echo
      publishLocal(envelope);
    });
    client.on('error', (err: Error) => {
      console.error(`[realtime/pg-notify] listener error: ${err.message}; reconnecting in 5s`);
      void client.end().catch(() => undefined);
      listenerClient = null;
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          void startPgListener();
        }, 5000);
        reconnectTimer.unref?.();
      }
    });
    await client.query(`LISTEN ${PG_NOTIFY_CHANNEL}`);
    listenerClient = client;
    console.log(`[realtime/pg-notify] listening on '${PG_NOTIFY_CHANNEL}' (instance ${INSTANCE_ID})`);
    return true;
  } catch (error) {
    console.error('[realtime/pg-notify] failed to start listener:', (error as Error).message);
    listenerClient = null;
    return false;
  }
}

/** Stop the listener (graceful shutdown). */
export async function stopPgListener(): Promise<void> {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const client = listenerClient;
  listenerClient = null;
  notifyClientPromise = null;
  await client?.end().catch(() => undefined);
}

/** This process' transport id (exported for tests/observability). */
export function realtimeInstanceId(): string {
  return INSTANCE_ID;
}

/** Total number of connected SSE clients (across all organizations). */
export function realtimeClientCount(): number {
  let n = 0;
  for (const set of channels.values()) n += set.size;
  return n;
}

/** Per-organization subscriber counts (for observability). */
export function realtimeChannelStats(): { organizationId: string; clients: number }[] {
  return [...channels.entries()].map(([organizationId, set]) => ({ organizationId, clients: set.size }));
}

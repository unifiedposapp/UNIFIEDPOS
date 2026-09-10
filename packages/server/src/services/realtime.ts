// ─── Real-time fan-out (Server-Sent Events) ──────────────────────────────────
// A tiny in-process pub/sub that bridges the §27 eventBus to connected browsers.
// Every business event emitted via emitEvent() is republished here to the SSE
// clients subscribed to that organization, so the web app can react instantly
// (live notification badge, order/payment toasts) instead of polling.
//
// Scale-out note: like the scheduler, this is single-instance in-memory. When
// running multiple instances behind a load balancer, put a shared transport
// (Redis pub/sub) in front of publishRealtime(); the client/route contract is
// unchanged. Sticky sessions also work since each client stays on one instance.

import type { Response } from 'express';

interface RealtimeClient {
  id: string;
  res: Response;
  userId?: string;
  connectedAt: number;
}

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
 * Publish an event to every SSE client subscribed to an organization.
 * Called from the eventBus so business events stream to the browser in real time.
 */
export function publishRealtime(organizationId: string, event: string, data: unknown): void {
  const set = channels.get(organizationId);
  if (!set || set.size === 0) return;
  const id = `${Date.now().toString(36)}_${event}`;
  for (const client of set) {
    write(client.res, event, { event, organizationId, data, at: new Date().toISOString() }, id);
  }
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

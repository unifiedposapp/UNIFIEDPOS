// ─── Real-time subscription hook (Server-Sent Events) ────────────────────────
// Opens a single EventSource per app session to /api/realtime/stream and lets
// components subscribe to §27 business events (order.created, payment.completed,
// inventory.low_stock, …). Replaces the old fixed-interval polling: the badge and
// toasts now update the instant the server emits an event.
//
// EventSource cannot send an Authorization header, so the JWT is passed as a
// query param (the server also accepts the httpOnly session cookie). The stream
// auto-reconnects (native EventSource behaviour) and is torn down on logout.

import { useEffect, useRef, useState, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export interface RealtimeEvent {
  event: string;
  organizationId: string;
  data: any;
  at: string;
}

type Listener = (payload: RealtimeEvent) => void;

// Module-level shared connection so multiple components/hooks reuse ONE stream.
let sharedSource: EventSource | null = null;
let sharedToken: string | null = null;
const listeners = new Set<Listener>();
let refCount = 0;

function openStream(token: string) {
  if (sharedSource && sharedToken === token) return;
  if (sharedSource) {
    sharedSource.close();
    sharedSource = null;
  }
  sharedToken = token;
  const url = `${API_BASE}/realtime/stream?token=${encodeURIComponent(token)}`;
  try {
    sharedSource = new EventSource(url, { withCredentials: true });
  } catch {
    sharedSource = null;
    return;
  }

  // The server sends each business event with its own `event:` name. EventSource
  // only routes named events to addEventListener(name), so we attach a wildcard
  // via `onmessage` for the default plus a small set of known high-signal events.
  const dispatch = (name: string) => (ev: MessageEvent) => {
    let payload: RealtimeEvent;
    try {
      payload = JSON.parse(ev.data) as RealtimeEvent;
    } catch {
      return;
    }
    if (!payload.event) payload.event = name;
    listeners.forEach((l) => {
      try {
        l(payload);
      } catch {
        /* a bad listener must not break the stream */
      }
    });
  };

  // `message` catches events sent without an explicit name; named listeners below
  // catch the domain events the server emits.
  sharedSource.onmessage = dispatch('message');
  [
    'order.created', 'order.completed', 'order.updated', 'order.cancelled',
    'payment.completed', 'payment.failed', 'payment.refunded', 'payment_link.paid',
    'inventory.low_stock', 'inventory.out_of_stock', 'inventory.changed',
    'customer.created', 'customer.updated', 'loyalty.points_earned',
    'fraud.flagged', 'catering.created', 'catering.updated',
    'device.online', 'device.offline', 'register.closed',
  ].forEach((name) => sharedSource?.addEventListener(name, dispatch(name) as any));

  sharedSource.onerror = () => {
    // Native reconnect handles transient drops; nothing to do here.
  };
}

function closeStream() {
  if (sharedSource) {
    sharedSource.close();
    sharedSource = null;
  }
  sharedToken = null;
}

/**
 * Subscribe to real-time business events.
 * @param onEvent  called for every streamed event
 * @param filter   optional predicate to narrow which events you receive
 */
export function useRealtime(onEvent: Listener, filter?: (e: RealtimeEvent) => boolean) {
  const saved = useRef<Listener>(onEvent);
  saved.current = onEvent;

  useEffect(() => {
    const token = localStorage.getItem('pos_token');
    if (!token) return;

    const listener: Listener = (payload) => {
      if (filter && !filter(payload)) return;
      saved.current(payload);
    };
    listeners.add(listener);
    refCount += 1;
    openStream(token);

    return () => {
      listeners.delete(listener);
      refCount -= 1;
      if (refCount <= 0) {
        refCount = 0;
        closeStream();
      }
    };
    // filter is captured via closure; intentionally not a dependency to avoid
    // re-opening the stream on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Connection state for a status indicator. */
export function useRealtimeStatus(): 'connecting' | 'open' | 'closed' {
  const [state, setState] = useState<'connecting' | 'open' | 'closed'>('closed');
  const cb = useCallback(() => {
    setState(sharedSource?.readyState === 1 ? 'open' : sharedSource?.readyState === 0 ? 'connecting' : 'closed');
  }, []);
  useEffect(() => {
    cb();
    const i = setInterval(cb, 2000);
    return () => clearInterval(i);
  }, [cb]);
  return state;
}

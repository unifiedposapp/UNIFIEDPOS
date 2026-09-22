import { describe, it, expect } from 'vitest';
import {
  serializeEnvelope,
  deserializeEnvelope,
  pgNotifyEnabled,
  realtimeInstanceId,
  type RealtimeEnvelope,
} from '../src/services/realtime';

// ─── Realtime envelope (pure, no DB) ────────────────────────────────────────
// The pg-notify transport must survive a JSON round trip through the NOTIFY
// payload untouched — including unicode, nested payloads and the origin tag
// replicas use to ignore their own echo — or cross-instance fan-out would
// silently corrupt the events streaming into browsers.

const base: RealtimeEnvelope = {
  organizationId: 'org_123',
  event: 'order.created',
  data: { orderId: 'o_1', total: 42.5, items: [{ sku: 'X', qty: 2 }], note: 'café — 東京 — ✅' },
  at: new Date('2026-09-21T10:00:00.000Z').toISOString(),
  origin: 'deadbeefcafe',
};

describe('realtime pg-notify envelope', () => {
  it('round-trips through serialize/deserialize unchanged', () => {
    const wire = serializeEnvelope(base);
    expect(deserializeEnvelope(wire)).toEqual(base);
  });

  it('survives single quotes and SQL-hostile content in the payload', () => {
    const tricky = { ...base, data: { msg: "O'Brien said \"'; DROP TABLE users; --\"" } };
    const restored = deserializeEnvelope(serializeEnvelope(tricky));
    expect(restored).toEqual(tricky);
  });

  it('rejects malformed or missing payloads instead of throwing', () => {
    expect(deserializeEnvelope(null)).toBeNull();
    expect(deserializeEnvelope('')).toBeNull();
    expect(deserializeEnvelope('not json')).toBeNull();
    expect(deserializeEnvelope('{"event":"x"}')).toBeNull(); // no organizationId
    expect(deserializeEnvelope('{"organizationId":"o"}')).toBeNull(); // no event
  });

  it('fills in a timestamp when the sender omitted one', () => {
    const partial = serializeEnvelope({ organizationId: 'o', event: 'e', data: 1 } as unknown as RealtimeEnvelope);
    const restored = deserializeEnvelope(partial);
    expect(restored?.at).toBeTruthy();
    expect(Number.isNaN(Date.parse(restored!.at))).toBe(false);
  });

  it('REALTIME_MODE gates the transport, defaulting to memory', () => {
    const saved = process.env.REALTIME_MODE;
    try {
      delete process.env.REALTIME_MODE;
      expect(pgNotifyEnabled()).toBe(false);
      process.env.REALTIME_MODE = 'pg-notify';
      expect(pgNotifyEnabled()).toBe(true);
      process.env.REALTIME_MODE = 'memory';
      expect(pgNotifyEnabled()).toBe(false);
    } finally {
      if (saved == null) delete process.env.REALTIME_MODE;
      else process.env.REALTIME_MODE = saved;
    }
  });

  it('assigns each process a distinct opaque instance id', () => {
    expect(realtimeInstanceId()).toMatch(/^[0-9a-f]{12}$/);
  });
});

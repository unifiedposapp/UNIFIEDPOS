/**
 * Offline sale queue (POS register).
 *
 * The invariant that matters: a sale written to the queue is never lost, never
 * posted twice, and never silently dropped when the server rejects it. These
 * tests drive the queue against a stubbed `fetch` so each branch — accepted,
 * transport failure, permanent rejection, expired session — is pinned down.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { posOffline, newClientOrderId } from '../src/services/posOffline';

/** Minimal in-memory Web Storage, since the suite runs in a node environment. */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

function okResponse(status = 201) {
  return { ok: true, status, json: async () => ({}) } as any;
}

function errorResponse(status: number, message?: string) {
  return { ok: false, status, json: async () => (message ? { message } : {}) } as any;
}

const salePayload = (orderNumber: string) => ({
  orderNumber,
  channel: 'POS',
  items: [{ productId: 'p1', quantity: 1, unitPrice: 10 }],
  payments: [{ method: 'CASH', amount: 10 }],
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('offline sale queue', () => {
  it('mints a distinct id per queued sale', () => {
    expect(newClientOrderId()).not.toBe(newClientOrderId());
  });

  it('persists a sale before anything is sent', () => {
    const sale = posOffline.enqueue(salePayload('A-1'));

    expect(posOffline.count()).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(posOffline.list()[0]).toMatchObject({
      clientOrderId: sale.clientOrderId,
      attempts: 0,
      payload: salePayload('A-1'),
    });
  });

  it('replays with the client id as an idempotency key and then clears the queue', async () => {
    const sale = posOffline.enqueue(salePayload('A-1'));
    fetchMock.mockResolvedValue(okResponse());

    const result = await posOffline.flush();

    expect(result).toEqual({ accepted: 1, rejected: 0, remaining: 0 });
    expect(posOffline.count()).toBe(0);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/orders');
    expect(init.method).toBe('POST');
    expect(init.headers['Idempotency-Key']).toBe(sale.clientOrderId);
    expect(JSON.parse(init.body)).toEqual(salePayload('A-1'));
  });

  it('keeps the sale when the transport fails and records the attempt', async () => {
    posOffline.enqueue(salePayload('A-1'));
    fetchMock.mockRejectedValue(new Error('Network down'));

    const result = await posOffline.flush();

    expect(result).toEqual({ accepted: 0, rejected: 0, remaining: 1 });
    const [kept] = posOffline.list();
    expect(kept.attempts).toBe(1);
    expect(kept.lastError).toBe('Network down');
  });

  it('keeps the sale across a 5xx so a later flush can retry it', async () => {
    posOffline.enqueue(salePayload('A-1'));
    fetchMock.mockResolvedValue(errorResponse(503, 'Upstream unavailable'));

    const result = await posOffline.flush();

    expect(result.remaining).toBe(1);
    expect(posOffline.rejected()).toHaveLength(0);
    expect(posOffline.list()[0].lastError).toBe('Upstream unavailable');
  });

  it('stops at a 401 rather than burning through the queue', async () => {
    posOffline.enqueue(salePayload('A-1'));
    posOffline.enqueue(salePayload('A-2'));
    fetchMock.mockResolvedValue(errorResponse(401, 'Token expired'));

    const result = await posOffline.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ accepted: 0, rejected: 0, remaining: 2 });
    expect(posOffline.list().map((s) => s.payload.orderNumber)).toEqual(['A-1', 'A-2']);
  });

  it('parks a server rejection for a human instead of retrying it forever', async () => {
    posOffline.enqueue(salePayload('A-1'));
    fetchMock.mockResolvedValue(errorResponse(422, 'Unknown product'));

    const result = await posOffline.flush();

    expect(result).toEqual({ accepted: 0, rejected: 1, remaining: 0 });
    const [parked] = posOffline.rejected();
    expect(parked).toMatchObject({ status: 422, reason: 'Unknown product' });
    expect(parked.payload.orderNumber).toBe('A-1');

    posOffline.clearRejected();
    expect(posOffline.rejected()).toEqual([]);
  });

  it('does not resurrect sales accepted earlier in the same flush', async () => {
    // Regression: a failure used to write back the array captured at the start
    // of the flush, re-queueing the sale that had just been accepted. The replay
    // was only safe while the server still held the idempotency record.
    const first = posOffline.enqueue(salePayload('A-1'));
    const second = posOffline.enqueue(salePayload('A-2'));

    let call = 0;
    fetchMock.mockImplementation(async () => {
      call += 1;
      if (call === 1) return okResponse();
      throw new Error('Network down');
    });

    const result = await posOffline.flush();

    expect(result).toEqual({ accepted: 1, rejected: 0, remaining: 1 });
    const remaining = posOffline.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].clientOrderId).toBe(second.clientOrderId);
    expect(remaining[0].clientOrderId).not.toBe(first.clientOrderId);
  });

  it('flushes oldest first so a refund cannot overtake its sale', async () => {
    posOffline.enqueue(salePayload('FIRST'));
    posOffline.enqueue(salePayload('SECOND'));
    fetchMock.mockResolvedValue(okResponse());

    await posOffline.flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).orderNumber).toBe('FIRST');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).orderNumber).toBe('SECOND');
  });

  it('does nothing when the queue is empty', async () => {
    expect(await posOffline.flush()).toEqual({ accepted: 0, rejected: 0, remaining: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

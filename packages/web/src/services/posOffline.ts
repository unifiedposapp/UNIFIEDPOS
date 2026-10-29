/**
 * Offline POS sale queue (§26 offline-first).
 *
 * Why this exists: `offlineService` has been able to queue operations since the
 * beginning, but the register never used it — a network blip mid-payment lost the
 * sale. A till that cannot take money when the Wi-Fi drops is not usable in a
 * basement, a market stall or a stadium.
 *
 * The contract:
 *   1. A sale is written to localStorage BEFORE the network call is attempted, so
 *      a crash, a reload or a dead battery cannot lose a paid transaction.
 *   2. Every queued sale carries a `clientOrderId`, which is replayed as the
 *      `Idempotency-Key` header. The server's idempotency middleware then makes a
 *      duplicate replay a no-op instead of a second sale.
 *   3. A flush that fails for a network reason keeps the sale; a flush the SERVER
 *      rejects (4xx) is parked in `rejected` so a human can look at it, because a
 *      silently retried bad sale would fail forever.
 */

const STORAGE_KEY = 'pos_offline_sales_v1';
const REJECTED_KEY = 'pos_offline_rejected_v1';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export interface OfflineSale {
  clientOrderId: string;
  createdAt: string;
  /** The exact POST /orders body the register tried to send. */
  payload: any;
  attempts: number;
  lastError?: string;
}

export interface RejectedSale extends OfflineSale {
  rejectedAt: string;
  status?: number;
  reason: string;
}

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function write(key: string, rows: unknown[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(rows));
  } catch (err) {
    // Quota exhausted: better to surface than to pretend the sale is safe.
    console.error('Offline sale queue could not be persisted:', err);
  }
}

/**
 * Record a failed replay attempt against the CURRENT queue.
 *
 * Re-writing the array captured at the top of the flush would resurrect sales
 * that earlier iterations already accepted (their `remove` calls would be
 * undone), so every replay would re-post them. The idempotency key makes that
 * harmless while the server still remembers it — and a duplicate sale once it
 * no longer does. Update in place instead.
 */
function markAttempt(clientOrderId: string, message: string): void {
  write(
    STORAGE_KEY,
    read<OfflineSale>(STORAGE_KEY).map((s) =>
      s.clientOrderId === clientOrderId ? { ...s, attempts: s.attempts + 1, lastError: message } : s,
    ),
  );
}

export function newClientOrderId(): string {
  const c = crypto as Crypto & { randomUUID?: () => string };
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  return `off_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export const posOffline = {
  list(): OfflineSale[] {
    return read<OfflineSale>(STORAGE_KEY);
  },

  rejected(): RejectedSale[] {
    return read<RejectedSale>(REJECTED_KEY);
  },

  count(): number {
    return read<OfflineSale>(STORAGE_KEY).length;
  },

  /** Queue a sale. Returns the record so the caller can show the reference. */
  enqueue(payload: any): OfflineSale {
    const sale: OfflineSale = {
      clientOrderId: newClientOrderId(),
      createdAt: new Date().toISOString(),
      payload,
      attempts: 0,
    };
    const all = read<OfflineSale>(STORAGE_KEY);
    all.push(sale);
    write(STORAGE_KEY, all);
    return sale;
  },

  remove(clientOrderId: string): void {
    write(
      STORAGE_KEY,
      read<OfflineSale>(STORAGE_KEY).filter((s) => s.clientOrderId !== clientOrderId),
    );
  },

  clearRejected(): void {
    write(REJECTED_KEY, []);
  },

  /**
   * Replay everything queued, oldest first.
   *
   * Ordering matters: a refund queued behind its sale must not land first, so the
   * loop is strictly sequential and stops at the first transport failure (later
   * sales are almost always invalid without the earlier ones).
   */
  async flush(): Promise<{ accepted: number; rejected: number; remaining: number }> {
    const queued = read<OfflineSale>(STORAGE_KEY);
    if (queued.length === 0) return { accepted: 0, rejected: 0, remaining: 0 };

    const token = localStorage.getItem('pos_token');
    const rejectedRows = read<RejectedSale>(REJECTED_KEY);
    let accepted = 0;
    let rejected = 0;

    for (const sale of queued) {
      try {
        const response = await fetch(`${API_BASE}/orders`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            // The replay key: the server returns the original result for a repeat.
            'Idempotency-Key': sale.clientOrderId,
          },
          credentials: 'include',
          body: JSON.stringify(sale.payload),
        });

        if (response.ok) {
          posOffline.remove(sale.clientOrderId);
          accepted++;
          continue;
        }

        const body = await response.json().catch(() => ({}));

        // 401 → the session expired; keep the sale and stop (re-login, then flush).
        // 5xx → the server is unwell; keep the sale and stop.
        if (response.status === 401 || response.status >= 500) {
          markAttempt(sale.clientOrderId, body?.message || `HTTP ${response.status}`);
          break;
        }

        // Any other 4xx is a permanent rejection: park it for a human.
        rejectedRows.push({
          ...sale,
          rejectedAt: new Date().toISOString(),
          status: response.status,
          reason: body?.message || `HTTP ${response.status}`,
        });
        posOffline.remove(sale.clientOrderId);
        rejected++;
      } catch (err: any) {
        markAttempt(sale.clientOrderId, err?.message || 'Network unavailable');
        break;
      }
    }

    write(REJECTED_KEY, rejectedRows);
    return { accepted, rejected, remaining: posOffline.count() };
  },

  /** Flush now if the browser thinks it is online; safe to call on every mount. */
  async flushIfOnline(): Promise<{ accepted: number; rejected: number; remaining: number } | null> {
    if (!navigator.onLine || posOffline.count() === 0) return null;
    return posOffline.flush();
  },
};

export default posOffline;

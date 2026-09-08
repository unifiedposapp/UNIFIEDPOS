// Offline-first sync service
// Stores operations in IndexedDB when offline, syncs when back online

const DB_NAME = 'pos_offline_db';
const DB_VERSION = 1;
const SYNC_QUEUE = 'sync_queue';
const CACHE_STORE = 'cache_store';

interface SyncOperation {
  id?: number;
  timestamp: number;
  method: string;
  endpoint: string;
  body: any;
  retryCount: number;
  // Offline Transaction Protocol fields (§26). Present only for protocol ops.
  protocol?: {
    transactionId: string;
    deviceId: string;
    sequenceNo: number;
    type: string;
    deviceTimestamp: string;
    payload: any;
  };
}

class OfflineService {
  private db: IDBDatabase | null = null;
  private syncInterval: ReturnType<typeof setInterval> | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(SYNC_QUEUE)) {
          db.createObjectStore(SYNC_QUEUE, { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(CACHE_STORE)) {
          db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  async enqueue(operation: Omit<SyncOperation, 'id' | 'retryCount'>): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(SYNC_QUEUE, 'readwrite');
      const store = tx.objectStore(SYNC_QUEUE);
      store.add({ ...operation, retryCount: 0 });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getQueue(): Promise<SyncOperation[]> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(SYNC_QUEUE, 'readonly');
      const store = tx.objectStore(SYNC_QUEUE);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async removeFromQueue(id: number): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(SYNC_QUEUE, 'readwrite');
      const store = tx.objectStore(SYNC_QUEUE);
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async cacheData(key: string, data: any): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(CACHE_STORE, 'readwrite');
      const store = tx.objectStore(CACHE_STORE);
      store.put({ key, data, timestamp: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getCachedData(key: string, maxAgeMs: number = 300000): Promise<any | null> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(CACHE_STORE, 'readonly');
      const store = tx.objectStore(CACHE_STORE);
      const request = store.get(key);
      request.onsuccess = () => {
        const result = request.result;
        if (!result) return resolve(null);
        if (Date.now() - result.timestamp > maxAgeMs) return resolve(null);
        resolve(result.data);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async syncPending(): Promise<{ synced: number; failed: number }> {
    const queue = await this.getQueue();
    let synced = 0;
    let failed = 0;

    for (const op of queue) {
      try {
        const token = localStorage.getItem('pos_token');
        const response = await fetch(`/api${op.endpoint}`, {
          method: op.method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(op.body),
        });

        if (response.ok) {
          await this.removeFromQueue(op.id!);
          synced++;
        } else {
          // If 4xx error, don't retry
          if (response.status >= 400 && response.status < 500) {
            await this.removeFromQueue(op.id!);
          }
          failed++;
        }
      } catch {
        failed++;
      }
    }

    return { synced, failed };
  }

  startAutoSync(intervalMs: number = 30000): void {
    if (this.syncInterval) return;
    this.syncInterval = setInterval(async () => {
      if (navigator.onLine) {
        await this.syncPending();
      }
    }, intervalMs);
  }

  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  isOnline(): boolean {
    return navigator.onLine;
  }

  getQueueLength(): Promise<number> {
    return this.getQueue().then(q => q.length);
  }

  // ── Offline Transaction Protocol (§26) ────────────────────────
  // A stable per-browser device id and a monotonically increasing local
  // sequence number give every offline transaction an immutable identity so
  // the server can dedupe retries.
  getDeviceId(): string {
    let id = localStorage.getItem('pos_device_id');
    if (!id) {
      id = (crypto as any).randomUUID ? crypto.randomUUID() : `dev_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      localStorage.setItem('pos_device_id', id);
    }
    return id;
  }

  private nextSequence(): number {
    const current = Number(localStorage.getItem('pos_seq') || '0') + 1;
    localStorage.setItem('pos_seq', String(current));
    return current;
  }

  // Queue a business transaction locally with full protocol metadata.
  async enqueueTransaction(type: string, payload: any): Promise<void> {
    const protocol = {
      transactionId: (crypto as any).randomUUID ? crypto.randomUUID() : `tx_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      deviceId: this.getDeviceId(),
      sequenceNo: this.nextSequence(),
      type,
      deviceTimestamp: new Date().toISOString(),
      payload,
    };
    await this.enqueue({
      timestamp: Date.now(),
      method: 'POST',
      endpoint: '/sync/transactions',
      body: { transactions: [protocol] },
      protocol,
    });
    // Offline: ask the service worker to flush the queue once connectivity
    // returns — even if this tab is closed by then (Background Sync API).
    if (!navigator.onLine) void this.requestBackgroundSync();
  }

  // Register a Background Sync with the service worker. Best-effort: silently
  // no-ops when the SW or the Sync API is unavailable (e.g. dev, older Safari).
  async requestBackgroundSync(tag = 'pos-sync-flush'): Promise<void> {
    try {
      if (!('serviceWorker' in navigator)) return;
      const reg = await navigator.serviceWorker.ready;
      const sync = (reg as any).sync;
      if (sync && typeof sync.register === 'function') await sync.register(tag);
    } catch (err) {
      console.warn('Background Sync registration failed:', err);
    }
  }

  // Flush queued protocol transactions in one batch to /api/sync/transactions.
  async flushTransactions(): Promise<{ accepted: number; duplicates: number; failed: number }> {
    const queue = await this.getQueue();
    const protocolOps = queue.filter((op) => op.protocol);
    if (protocolOps.length === 0) return { accepted: 0, duplicates: 0, failed: 0 };

    const token = localStorage.getItem('pos_token');
    const response = await fetch('/api/sync/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ transactions: protocolOps.map((op) => op.protocol) }),
    });

    if (!response.ok) throw new Error('Sync failed');
    const json = await response.json();
    // Every transaction was durably recorded server-side; clear the local queue.
    for (const op of protocolOps) await this.removeFromQueue(op.id!);
    return json.data || { accepted: 0, duplicates: 0, failed: 0 };
  }
}

export const offlineService = new OfflineService();

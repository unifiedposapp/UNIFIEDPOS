/* Unified POS service worker — app-shell caching + offline fallback +
 * Background Sync for the offline transaction queue (§25/§26).
 *
 * Strategy:
 *   • Navigation requests  → network-first, fall back to the cached app shell.
 *   • /api GET requests    → network-first, fall back to a stale cache, else a
 *                            JSON 503 so the SPA can show an offline state.
 *   • Same-origin assets   → stale-while-revalidate.
 *   • Cross-origin (fonts) → stale-while-revalidate in their own cache.
 *   • Non-GET (mutations)  → never intercepted (they must hit the network).
 *
 * Background Sync: when the app registers the 'pos-sync-flush' tag while
 * offline, the browser fires the `sync` event once connectivity returns — even
 * if the tab is closed. The SW then drains the IndexedDB queue and POSTs it to
 * /api/sync/transactions using the httpOnly session cookie (credentials:include);
 * localStorage is unavailable in a worker, so we rely on the cookie session.
 */

const VERSION = 'v1';
const SHELL_CACHE = `pos-shell-${VERSION}`;
const STATIC_CACHE = `pos-static-${VERSION}`;
const API_CACHE = `pos-api-${VERSION}`;
const CROSS_CACHE = `pos-cross-${VERSION}`;

const SHELL_ASSETS = ['/', '/index.html', '/logo.png', '/icon.svg', '/manifest.webmanifest'];

const OFFLINE_API_BODY = JSON.stringify({
  success: false,
  offline: true,
  message: 'You are offline. This request was not sent.',
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const keep = [SHELL_CACHE, STATIC_CACHE, API_CACHE, CROSS_CACHE];
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept mutations

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, CROSS_CACHE));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(apiNetworkFirst(req));
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(navigationNetworkFirst(req));
    return;
  }
  event.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
});

async function navigationNetworkFirst(req) {
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(SHELL_CACHE);
    cache.put('/index.html', fresh.clone());
    return fresh;
  } catch {
    const cached = await caches.match('/index.html');
    return cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function apiNetworkFirst(req) {
  try {
    const fresh = await fetch(req);
    if (fresh.ok) {
      const cache = await caches.open(API_CACHE);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached; // serve stale data rather than nothing
    return new Response(OFFLINE_API_BODY, {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((fresh) => {
      if (fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    })
    .catch(() => cached);
  return cached || network;
}

// Let the page force an update without a hard refresh.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ─── Background Sync (§26) ───────────────────────────────────────────────────
const DB_NAME = 'pos_offline_db';
const DB_VERSION = 1;
const SYNC_QUEUE = 'sync_queue';

self.addEventListener('sync', (event) => {
  if (event.tag === 'pos-sync-flush') {
    event.waitUntil(flushOfflineQueue());
  }
});

function openQueueDb() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

function getAllOps(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_QUEUE, 'readonly');
    const reqAll = tx.objectStore(SYNC_QUEUE).getAll();
    reqAll.onsuccess = () => resolve(reqAll.result || []);
    reqAll.onerror = () => reject(reqAll.error);
  });
}

function removeOp(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_QUEUE, 'readwrite');
    tx.objectStore(SYNC_QUEUE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Drain protocol transactions from IndexedDB and push them to the server. */
async function flushOfflineQueue() {
  const db = await openQueueDb();
  const ops = (await getAllOps(db)).filter((op) => op && op.protocol);
  if (ops.length === 0) return;

  const res = await fetch('/api/sync/transactions', {
    method: 'POST',
    credentials: 'include', // send the httpOnly pos_session cookie
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactions: ops.map((op) => op.protocol) }),
  });

  if (!res.ok) {
    // Throw so the browser keeps the sync registration and retries later.
    throw new Error(`Background sync failed (${res.status})`);
  }
  for (const op of ops) {
    if (op.id != null) await removeOp(db, op.id);
  }
}

// ─── Web Push (VAPID) ────────────────────────────────────────────────────────
// The server POSTs an RFC 8291-encrypted payload; the browser decrypts it and
// fires `push`. We show a Notification and focus/open the target URL on click.
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: 'UnifiedPOS', body: event.data.text() };
    }
  }
  const title = data.title || 'UnifiedPOS';
  const options = {
    body: data.body || '',
    icon: '/logo.png',
    badge: '/icon-maskable.svg',
    tag: data.tag || 'pos-notification',
    data: { url: data.url || '/notifications', payload: data.data || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/notifications';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    })
  );
});

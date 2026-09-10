// ─── Web Push client helper ──────────────────────────────────────────────────
// Registers the service worker, asks for notification permission, subscribes via
// PushManager using the server's VAPID public key, and sends the subscription to
// /api/push/subscribe. Fully env-gated: if the server reports push is disabled
// (no VAPID keys) this resolves with { enabled:false } and does nothing.

import { api } from '../api/client';

/** Convert a base64url string to a Uint8Array (PushManager wants raw bytes). */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export interface PushEnableResult {
  enabled: boolean;
  subscribed: boolean;
  reason?: string;
  permission?: NotificationPermission;
}

export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Enable web push for this browser: permission → SW → subscribe → register. */
export async function enableWebPush(): Promise<PushEnableResult> {
  if (!isPushSupported()) return { enabled: false, subscribed: false, reason: 'unsupported' };

  const config = await api.getPushConfig();
  const publicKey = config?.data?.applicationServerKey || config?.data?.publicKey;
  if (!config?.data?.enabled || !publicKey) {
    return { enabled: false, subscribed: false, reason: 'server-disabled' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { enabled: true, subscribed: false, reason: 'denied', permission };

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
    });
  }

  const json = subscription.toJSON() as { endpoint: string; keys?: { p256dh: string; auth: string } };
  await api.subscribePush({ endpoint: json.endpoint, keys: json.keys!, userAgent: navigator.userAgent });
  return { enabled: true, subscribed: true, permission };
}

/** Unsubscribe this browser and tell the server to forget it. */
export async function disableWebPush(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return true;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  try {
    await api.unsubscribePush(endpoint);
  } catch {
    /* best effort */
  }
  return true;
}

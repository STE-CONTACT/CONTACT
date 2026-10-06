// Notifications push (Web Push) : service worker + abonnement de l'appareil.
import { post } from './api.js';
import { state } from './state.js';

let pushActive = false;
export const pushStatus = () => pushActive;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && window.isSecureContext;

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const sub = reg.pushManager && await reg.pushManager.getSubscription();
    pushActive = Boolean(sub);
    if (sub) await post('/api/push/subscribe', sub.toJSON(), { background: true });
  } catch { /* push indisponible */ }
}

/** Active les notifications push sur cet appareil. */
export async function enablePush() {
  if (!pushSupported()) throw new Error('Notifications push non disponibles sur ce navigateur (HTTPS requis).');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Autorisation de notification refusée par le navigateur.');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const key = state.settings.vapid_public_key;
  if (!key) throw new Error('Push non configuré sur le serveur.');
  const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (key.length % 4)) % 4));
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
  await post('/api/push/subscribe', sub.toJSON());
  pushActive = true;
}

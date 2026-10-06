// Accès à l'API : en-tête anti-CSRF, gestion uniforme des erreurs et de la session expirée.
export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
export const on = (type, fn) => { const h = (e) => fn(e.detail); bus.addEventListener(type, h); return () => bus.removeEventListener(type, h); };

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(method, url, body, { background = false, raw = false } = {}) {
  const headers = { 'X-Requested-With': 'fetch' };
  if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
  if (background) headers['X-Background'] = '1';
  let res;
  try {
    res = await fetch(url, { method, headers, body: body != null ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Connexion au serveur impossible. Vérifiez le réseau.');
  }
  if (raw) return res;
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const message = (data && data.error) || `Erreur ${res.status}`;
    if (res.status === 401 && !url.startsWith('/api/auth/login')) emit('unauthorized', message);
    if (res.status === 403 && message.includes('changer votre mot de passe')) emit('must-change-password');
    throw new ApiError(res.status, message);
  }
  return data;
}

export const get = (url, opts) => api('GET', url, null, opts);
export const post = (url, body = {}, opts) => api('POST', url, body, opts);
export const put = (url, body = {}, opts) => api('PUT', url, body, opts);
export const del = (url, opts) => api('DELETE', url, null, opts);

export function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

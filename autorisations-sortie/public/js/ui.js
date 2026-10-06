// Utilitaires d'interface : échappement, formats de date (fuseau entreprise), statuts, modales, toasts.
import { state, serverNow } from './state.js';

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ------------------------------------------------------------------ icônes (SVG inline)
const P = {
  dashboard: '<path d="M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z"/>',
  plus: '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/>',
  list: '<path d="M3 13h2v-2H3zm0 4h2v-2H3zm0-8h2V7H3zm4 4h14v-2H7zm0 4h14v-2H7zM7 7v2h14V7z"/>',
  team: '<path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>',
  history: '<path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/>',
  clock: '<path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>',
  search: '<path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>',
  exit: '<path d="M10.09 15.59 11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5a2 2 0 0 0-2 2v4h2V5h14v14H5v-4H3v4a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/>',
  enter: '<path d="M11 7 9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5-5-5zm9 12h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-8v2h8v14z"/>',
  user: '<path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>',
  users: '<path d="M16.67 13.13C18.04 14.06 19 15.32 19 17v3h4v-3c0-2.18-3.57-3.47-6.33-3.87zM15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4c-.47 0-.91.1-1.33.24a5.98 5.98 0 0 1 0 7.52c.42.14.86.24 1.33.24zm-6 0c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0-6c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm0 7c-2.67 0-8 1.34-8 4v3h16v-3c0-2.66-5.33-4-8-4zm6 5H3v-.99C3.2 16.29 6.3 15 9 15s5.8 1.29 6 2v1z"/>',
  badge: '<path d="M20 7h-5V4c0-1.1-.9-2-2-2h-2c-1.1 0-2 .9-2 2v3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zM9 12c.83 0 1.5.67 1.5 1.5S9.83 15 9 15s-1.5-.67-1.5-1.5S8.17 12 9 12zm3 6H6v-.43c0-.6.36-1.15.92-1.39A5.04 5.04 0 0 1 9 15.75c.71 0 1.39.15 2.08.43.56.24.92.79.92 1.39V18zm1-9h-2V4h2v5zm5 7.5h-4V15h4v1.5zm0-3h-4V12h4v1.5z"/>',
  building: '<path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/>',
  schedule: '<path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/>',
  shield: '<path d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/>',
  bell: '<path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>',
  settings: '<path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>',
  journal: '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>',
  gate: '<path d="M12 2 2 7v2h20V7L12 2zM4 11v8H2v2h20v-2h-2v-8h-2v8h-3v-8h-2v8h-2v-8H9v8H6v-8H4z"/>',
  qr: '<path d="M3 11h8V3H3v8zm2-6h4v4H5V5zM3 21h8v-8H3v8zm2-6h4v4H5v-4zM13 3v8h8V3h-8zm6 6h-4V5h4v4zm0 10h2v2h-2zm-6-6h2v2h-2zm2 2h2v2h-2zm-2 2h2v2h-2zm2 2h2v2h-2zm2-2h2v2h-2zm0-4h2v2h-2zm2 2h2v2h-2z"/>',
  check: '<path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>',
  close: '<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>',
  menu: '<path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>',
  logout: '<path d="m17 7-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>',
  warning: '<path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>',
  download: '<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>',
  key: '<path d="M12.65 10A5.99 5.99 0 0 0 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6a5.99 5.99 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>',
  hourglass: '<path d="M6 2v6h.01L6 8.01 10 12l-4 4 .01.01H6V22h12v-5.99h-.01L18 16l-4-4 4-3.99-.01-.01H18V2H6zm10 14.5V20H8v-3.5l4-4 4 4zm-4-5-4-4V4h8v3.5l-4 4z"/>',
  print: '<path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/>',
  upload: '<path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/>',
  edit: '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>',
  trash: '<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>',
  refresh: '<path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>',
  attach: '<path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/>',
};
export const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${P[name] || ''}</svg>`;
export const LOGO = '<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-3.06 16L7.4 14.46l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41L10.94 18zM13 9V3.5L18.5 9H13z"/></svg>';

// ------------------------------------------------------------------ dates (fuseau de l'entreprise)
const tz = () => (state.settings && state.settings.fuseau_horaire) || undefined;
const cache = new Map();
function fmt(opts) {
  const key = JSON.stringify([tz(), opts]);
  if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat('fr-FR', { timeZone: tz(), ...opts }));
  return cache.get(key);
}
export const fmtTime = (iso) => (iso ? fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)) : '');
export const fmtDate = (iso) => (iso ? fmt({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso)) : '');
export const fmtDateTime = (iso) => (iso ? `${fmtDate(iso)} ${fmtTime(iso)}` : '');
export const fmtDayShort = (iso) => (iso ? fmt({ weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(iso)) : '');
/** 'YYYY-MM-DD' → 'JJ/MM/AAAA' */
export const dmy = (d) => (d ? d.split('-').reverse().join('/') : '');
export function localDateStr(date = serverNow()) {
  const p = Object.fromEntries(fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function localTimeStr(date = serverNow(), seconds = false) {
  return fmt(seconds ? { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' } : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
export const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export function duration(min) {
  if (min == null || Number.isNaN(min)) return '';
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? (r ? `${h} h ${String(r).padStart(2, '0')} min` : `${h} h`) : `${r} min`;
}
export const minutesSince = (iso) => Math.round((serverNow() - new Date(iso)) / 60000);

// ------------------------------------------------------------------ statuts
export const STATUTS = {
  BROUILLON: 'Brouillon', EN_ATTENTE: 'En attente', VALIDEE: 'Validée', REFUSEE: 'Refusée', ANNULEE: 'Annulée',
  SORTIE_EFFECTUEE: 'Sortie effectuée', RETOUR_EFFECTUE: 'Retour effectué', EXPIREE: 'Expirée',
};
export function statusBadge(statut, { large = false, a = null } = {}) {
  if (a && statut === 'SORTIE_EFFECTUEE' && a.en_retard) return `<span class="status st-RETARD ${large ? 'status-lg' : ''}">Retour en retard</span>`;
  return `<span class="status st-${esc(statut)} ${large ? 'status-lg' : ''}">${esc(STATUTS[statut] || statut)}</span>`;
}
export const typeLabel = (t) => (state.settings && state.settings.types_sortie[t]) || t;

// ------------------------------------------------------------------ opérateur
export function initials(prenom, nom) { return `${(prenom || '?')[0] || ''}${(nom || '')[0] || ''}`.toUpperCase(); }
export function avatar(empId, hasPhoto, prenom, nom, size = '') {
  return `<div class="avatar ${size}">${hasPhoto ? `<img src="/api/employees/${Number(empId)}/photo" alt="" loading="lazy">` : esc(initials(prenom, nom))}</div>`;
}
export function posteLabel(nom, debut, fin) {
  if (!nom && !debut) return '—';
  return `${esc(nom || '')}${debut ? ` (${esc(debut)}–${esc(fin)})` : ''}`;
}
/** Créneau d'une autorisation : « 05/10 23:30 → 06/10 01:00 » */
export function windowLabel(a, { withDate = true } = {}) {
  const d1 = withDate ? `${dmy(a.date_sortie).slice(0, 5)} ` : '';
  const d2 = a.retour_lendemain ? `${dmy(a.date_retour).slice(0, 5)} ` : (withDate ? '' : '');
  return `${d1}${esc(a.heure_sortie_prevue)} → ${d2}${esc(a.heure_retour_prevue)}`;
}

// ------------------------------------------------------------------ toasts
export function toast(message, type = 'info', { title = null, timeout = 4500, onClick = null } = {}) {
  const root = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${title ? `<strong>${esc(title)}</strong>` : ''}${esc(message)}`;
  el.addEventListener('click', () => { if (onClick) onClick(); el.remove(); });
  root.appendChild(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
  return el;
}
export const toastError = (e) => toast(e && e.message ? e.message : String(e), 'error', { timeout: 7000 });

// ------------------------------------------------------------------ modales
export function modal({ title, body, actions = [], wide = false, onOpen = null, dismissable = true }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h2>${esc(title)}</h2>${dismissable ? `<button class="btn btn-ghost btn-icon" data-close aria-label="Fermer">${icon('close')}</button>` : ''}</div>
      <div class="modal-body"></div>
      ${actions.length ? `<div class="modal-foot">${actions.map((a, i) => `<button class="btn ${a.class || ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}
    </div>`;
    const bodyEl = backdrop.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    const close = (value) => { backdrop.remove(); document.removeEventListener('keydown', onKey); resolve(value); };
    const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(null); };
    document.addEventListener('keydown', onKey);
    if (dismissable) {
      backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(null); });
      backdrop.querySelector('[data-close]').addEventListener('click', () => close(null));
    }
    backdrop.querySelectorAll('.modal-foot [data-i]').forEach((b) => b.addEventListener('click', async () => {
      const a = actions[Number(b.dataset.i)];
      if (a.onClick) {
        b.disabled = true;
        try {
          const r = await a.onClick(bodyEl);
          if (r !== false) close(r === undefined ? a.value ?? true : r);
        } catch (e) { toastError(e); } finally { b.disabled = false; }
      } else close(a.value ?? null);
    }));
    root.appendChild(backdrop);
    const focus = bodyEl.querySelector('[autofocus], input, textarea, select');
    if (focus) setTimeout(() => focus.focus(), 30);
    if (onOpen) onOpen(bodyEl, close);
  });
}

export function confirmDialog(title, message, { confirmLabel = 'Confirmer', danger = false } = {}) {
  return modal({
    title, body: `<p>${esc(message)}</p>`,
    actions: [{ label: 'Annuler', value: false }, { label: confirmLabel, class: danger ? 'btn-danger' : 'btn-primary', value: true }],
  });
}

/** Saisie d'un texte (motif, commentaire...). Retourne la chaîne ou null si annulé. */
export function promptDialog(title, { label = '', placeholder = '', required = false, confirmLabel = 'Valider', danger = false, suggestions = [] } = {}) {
  return modal({
    title,
    body: `<div class="field"><label>${esc(label)}</label><textarea id="pd-text" placeholder="${esc(placeholder)}" maxlength="500" autofocus></textarea></div>
      ${suggestions.length ? `<div class="chips">${suggestions.map((s) => `<button type="button" class="chip" data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}`,
    onOpen: (b) => b.querySelectorAll('[data-s]').forEach((c) => c.addEventListener('click', () => { b.querySelector('#pd-text').value = c.dataset.s; })),
    actions: [
      { label: 'Annuler', value: null },
      {
        label: confirmLabel, class: danger ? 'btn-danger' : 'btn-primary',
        onClick: (b) => {
          const v = b.querySelector('#pd-text').value.trim();
          if (required && !v) { toast('Ce champ est obligatoire', 'warning'); return false; }
          return v;
        },
      },
    ],
  });
}

// ------------------------------------------------------------------ divers
export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Lecture du fichier impossible'));
    r.readAsDataURL(file);
  });
}

export function pager(total, page, size) {
  const pages = Math.max(1, Math.ceil(total / size));
  return `<div class="pager"><span>${total} résultat${total > 1 ? 's' : ''} — page ${page} / ${pages}</span>
    <div class="row"><button class="btn btn-sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ Précédent</button>
    <button class="btn btn-sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Suivant ›</button></div></div>`;
}

export function selectOptions(items, selected, { empty = null, value = 'id', label = 'nom' } = {}) {
  const lab = typeof label === 'function' ? label : (x) => x[label];
  return `${empty !== null ? `<option value="">${esc(empty)}</option>` : ''}${items.map((x) => `<option value="${esc(x[value])}" ${String(x[value]) === String(selected ?? '') ? 'selected' : ''}>${esc(lab(x))}</option>`).join('')}`;
}

/** Bip sonore (poste de garde) sans fichier audio. */
let audioCtx = null;
export function beep(kind = 'ok') {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = kind === 'ok' ? [880, 1320] : kind === 'alert' ? [660, 880, 660] : [330, 220];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime + i * 0.16);
      g.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + i * 0.16 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + i * 0.16 + 0.15);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(audioCtx.currentTime + i * 0.16); o.stop(audioCtx.currentTime + i * 0.16 + 0.16);
    });
  } catch { /* audio indisponible */ }
}

/** Navigation interne (routeur par hash). */
export function navigate(path) {
  if (location.hash !== `#${path}`) location.hash = path;
  else window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Libellés des actions du journal d'audit. */
export const ACTIONS = {
  DEMANDE_CREEE: 'Demande créée', DEMANDE_SOUMISE: 'Demande envoyée au RH', BROUILLON_MODIFIE: 'Brouillon modifié',
  AUTORISATION_VALIDEE: 'Autorisation validée', AUTORISATION_REFUSEE: 'Autorisation refusée', DEMANDE_ANNULEE: 'Demande annulée',
  NOTIFICATION_ENVOYEE: 'Notification envoyée', SORTIE_CONFIRMEE: 'Sortie confirmée', RETOUR_CONFIRME: 'Retour confirmé',
  AUTORISATION_EXPIREE: 'Autorisation expirée', RETOUR_EN_RETARD: 'Retour en retard signalé', CONTROLE_POSTE_GARDE: 'Contrôle au poste de garde',
  CONNEXION: 'Connexion', CONNEXION_ECHEC: 'Échec de connexion', COMPTE_VERROUILLE: 'Compte verrouillé', DECONNEXION: 'Déconnexion',
  MOT_DE_PASSE_CHANGE: 'Mot de passe changé', MOT_DE_PASSE_REINITIALISE: 'Mot de passe réinitialisé', COMPTE_DEVERROUILLE: 'Compte déverrouillé',
  UTILISATEUR_CREE: 'Utilisateur créé', UTILISATEUR_MODIFIE: 'Utilisateur modifié', UTILISATEUR_SUPPRIME: 'Utilisateur supprimé', UTILISATEUR_DESACTIVE: 'Utilisateur désactivé',
  OPERATEUR_CREE: 'Opérateur créé', OPERATEUR_MODIFIE: 'Opérateur modifié', OPERATEUR_SUPPRIME: 'Opérateur supprimé', OPERATEUR_DESACTIVE: 'Opérateur désactivé',
  OPERATEUR_PHOTO: 'Photo opérateur', OPERATEUR_QR_REGENERE: 'QR code régénéré', OPERATEURS_IMPORTES: 'Import opérateurs',
  EQUIPE_CREEE: 'Équipe créée', EQUIPE_MODIFIEE: 'Équipe modifiée', EQUIPE_SUPPRIME: 'Équipe supprimée', EQUIPE_DESACTIVE: 'Équipe désactivée',
  SERVICE_CREE: 'Service créé', SERVICE_MODIFIE: 'Service modifié', SERVICE_SUPPRIME: 'Service supprimé', SERVICE_DESACTIVE: 'Service désactivé',
  POSTE_CREE: 'Poste créé', POSTE_MODIFIE: 'Poste modifié', POSTE_SUPPRIME: 'Poste supprimé', POSTE_DESACTIVE: 'Poste désactivé',
  POSTE_GARDE_CHOISI: 'Poste de garde sélectionné', PARAMETRES_MODIFIES: 'Paramètres modifiés', SAUVEGARDE_CREEE: 'Sauvegarde créée',
  SAUVEGARDE_AUTO: 'Sauvegarde automatique', SAUVEGARDE_TELECHARGEE: 'Sauvegarde téléchargée', AUDIT_VERIFIE: 'Vérification du journal',
  EXPORT_HISTORIQUE: 'Export historique', INITIALISATION: 'Initialisation',
};
export const actionLabel = (a) => ACTIONS[a] || a;

// Point d'entrée : connexion, mise en page selon le rôle, routage, temps réel, inactivité.
import { get, post, put, on, emit } from './api.js';
import { state, isRole, APP_VERSION } from './state.js';
import { esc, icon, LOGO, toast, toastError, $, localTimeStr, fmtDateTime, beep, navigate } from './ui.js';
import { registerServiceWorker, pushStatus } from './push.js';
import * as dashboard from './views/dashboard.js';
import * as authz from './views/authorizations.js';
import * as historyView from './views/history.js';
import * as gate from './views/gate.js';
import * as admin from './views/admin.js';
import * as misc from './views/misc.js';

const app = document.getElementById('app');

// ------------------------------------------------------------------ routes
const ROUTES = [
  { path: '/dashboard', title: 'Tableau de bord', roles: ['admin', 'rh', 'chef'], view: dashboard.render },
  { path: '/nouvelle', title: 'Nouvelle autorisation de sortie', roles: ['chef', 'admin'], view: authz.renderNew },
  { path: '/mes-demandes', title: 'Mes demandes', roles: ['chef', 'admin'], view: (el) => authz.renderList(el, { mode: 'mine' }) },
  { path: '/equipe', title: 'Mon équipe', roles: ['chef'], view: authz.renderTeam },
  { path: '/en-attente', title: 'Demandes en attente', roles: ['rh', 'admin'], view: (el) => authz.renderList(el, { mode: 'pending' }) },
  { path: '/autorisations', title: 'Autorisations', roles: ['rh', 'admin', 'chef'], view: (el) => authz.renderList(el, { mode: 'all' }) },
  { path: '/autorisations/:id', title: 'Autorisation', roles: ['rh', 'admin', 'chef'], view: (el, p) => authz.renderDetail(el, Number(p.id)) },
  { path: '/rapport', title: 'Rapport Excel de suivi', roles: ['admin', 'rh', 'chef'], view: historyView.renderReport },
  { path: '/historique', title: 'Historique des autorisations', roles: ['admin', 'rh', 'chef'], view: (el) => historyView.render(el, { advanced: false }) },
  { path: '/recherche', title: 'Recherche', roles: ['admin', 'rh'], view: (el) => historyView.render(el, { advanced: true }) },
  { path: '/exterieur', title: "Opérateurs actuellement à l'extérieur", roles: ['admin', 'rh', 'chef'], view: gate.renderOutsidePage },
  { path: '/garde', title: 'Poste de garde', roles: ['gardien', 'admin'], view: gate.renderMain },
  { path: '/garde/validees', title: 'Autorisations validées', roles: ['gardien', 'admin'], view: (el) => gate.renderTab(el, 'validees') },
  { path: '/garde/sorties', title: 'Sorties en cours', roles: ['gardien', 'admin'], view: (el) => gate.renderTab(el, 'sorties') },
  { path: '/garde/retours', title: 'Retours', roles: ['gardien', 'admin'], view: (el) => gate.renderTab(el, 'retours') },
  { path: '/garde/historique', title: 'Historique des contrôles', roles: ['gardien', 'admin'], view: gate.renderHistory },
  { path: '/admin/utilisateurs', title: 'Utilisateurs', roles: ['admin'], view: admin.renderUsers },
  { path: '/admin/operateurs', title: 'Opérateurs', roles: ['admin'], view: admin.renderEmployees },
  { path: '/admin/matricules', title: 'Matricules & QR codes', roles: ['admin'], view: admin.renderMatricules },
  { path: '/admin/equipes', title: 'Équipes', roles: ['admin'], view: admin.renderTeams },
  { path: '/admin/services', title: 'Services', roles: ['admin'], view: admin.renderServices },
  { path: '/admin/horaires', title: 'Horaires & postes', roles: ['admin'], view: admin.renderShifts },
  { path: '/admin/audit', title: "Journal d'audit", roles: ['admin'], view: admin.renderAudit },
  { path: '/admin/parametres', title: 'Paramètres', roles: ['admin'], view: admin.renderSettings },
  { path: '/notifications', title: 'Notifications', roles: ['admin', 'rh', 'chef', 'gardien'], view: misc.renderNotifications },
  { path: '/compte', title: 'Mon compte', roles: ['admin', 'rh', 'chef', 'gardien'], view: misc.renderAccount },
];

const MENUS = {
  admin: [
    { section: 'Pilotage' },
    { path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { path: '/en-attente', label: 'Demandes en attente', icon: 'hourglass', count: 'pending', rhOnly: true },
    { path: '/autorisations', label: 'Autorisations', icon: 'list' },
    { path: '/exterieur', label: "À l'extérieur", icon: 'exit' },
    { path: '/historique', label: 'Historique', icon: 'history' },
    { path: '/rapport', label: 'Rapport Excel', icon: 'download' },
    { path: '/garde', label: 'Poste de garde', icon: 'gate' },
    { section: 'Référentiels' },
    { path: '/admin/utilisateurs', label: 'Utilisateurs', icon: 'users' },
    { path: '/admin/operateurs', label: 'Opérateurs', icon: 'team' },
    { path: '/admin/matricules', label: 'Matricules', icon: 'badge' },
    { path: '/admin/equipes', label: 'Équipes', icon: 'team' },
    { path: '/admin/services', label: 'Services', icon: 'building' },
    { path: '/admin/horaires', label: 'Horaires', icon: 'schedule' },
    { section: 'Système' },
    { path: '/admin/audit', label: "Journal d'audit", icon: 'shield' },
    { path: '/notifications', label: 'Notifications', icon: 'bell' },
    { path: '/admin/parametres', label: 'Paramètres', icon: 'settings' },
  ],
  chef: [
    { path: '/mes-demandes', label: 'Mes demandes', icon: 'list', short: 'Demandes' },
    { path: '/nouvelle', label: 'Nouvelle autorisation', icon: 'plus', short: 'Nouvelle', primary: true },
    { path: '/equipe', label: 'Mon équipe', icon: 'team', short: 'Équipe' },
    { path: '/exterieur', label: "À l'extérieur", icon: 'exit', short: 'Dehors' },
    { path: '/historique', label: 'Historique', icon: 'history' },
    { path: '/dashboard', label: 'Statistiques', icon: 'dashboard' },
  ],
  rh: [
    { path: '/en-attente', label: 'À valider', icon: 'hourglass', count: 'pending', rhOnly: true },
    { path: '/historique', label: 'Historique', icon: 'history' },
    { path: '/rapport', label: 'Rapport Excel', icon: 'download', short: 'Excel' },
    { path: '/exterieur', label: "À l'extérieur", icon: 'exit', short: 'Dehors' },
    { path: '/dashboard', label: 'Statistiques', icon: 'dashboard' },
    { path: '/autorisations', label: 'Autorisations', icon: 'list' },
  ],
  gardien: [
    { path: '/garde', label: 'Contrôle' },
    { path: '/garde/historique', label: 'Historique' },
  ],
};

function match(hash) {
  const path = (hash.replace(/^#/, '') || '/').split('?')[0];
  for (const r of ROUTES) {
    const keys = [];
    const re = new RegExp(`^${r.path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    const m = re.exec(path);
    if (m) return { route: r, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

const defaultPath = () => ({ gardien: '/garde', chef: '/mes-demandes', rh: state.settings.validation_rh_requise ? '/en-attente' : '/historique' }[state.user.role] || '/dashboard');


// ------------------------------------------------------------------ démarrage
let cleanup = null;
let counts = { pending: 0, validated: 0, outside: 0 };

async function boot() {
  try {
    const me = await get('/api/auth/me');
    setSession(me);
    startSession();
  } catch {
    renderLogin();
  }
}

function setSession(data) {
  state.user = data.user;
  state.settings = data.settings;
  state.idleMinutes = data.idle_minutes;
  state.serverOffsetMs = new Date(data.server_time) - Date.now();
}

// ------------------------------------------------------------------ connexion
async function renderLogin(message = '') {
  stopSession();
  let entreprise = '';
  let versionMismatch = false;
  try {
    const pub = await get('/api/auth/public');
    entreprise = pub.entreprise_nom;
    versionMismatch = pub.version !== APP_VERSION;
  } catch { /* hors ligne */ }
  app.innerHTML = `<div class="login-page"><form class="login-card" autocomplete="on">
    <div class="brand"><div class="logo">${LOGO}</div><div><h1>Autorisations de sortie</h1><p>${esc(entreprise)}</p></div></div>
    ${versionMismatch ? '<div class="error"><strong>Ancien serveur encore en marche.</strong> Fermez toutes les fenêtres noires de l\'application, puis relancez DEMARRER-DEMO.bat.</div>' : ''}
    ${message ? `<div class="error">${esc(message)}</div>` : ''}
    <div class="field"><label for="u">Identifiant</label><input id="u" name="username" type="text" autocomplete="username" autocapitalize="none" required autofocus></div>
    <div class="field"><label for="p">Mot de passe</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
    <button class="btn btn-primary btn-block btn-lg" type="submit">Se connecter</button>
    <div class="login-foot">Accès réservé au personnel autorisé. Toutes les actions sont journalisées.</div>
  </form></div>`;
  const form = app.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      const data = await post('/api/auth/login', { username: form.username.value, password: form.password.value });
      setSession(data);
      startSession();
    } catch (err) {
      renderLogin(err.message);
    }
  });
}

async function logout(reason = 'manual') {
  try { await post('/api/auth/logout', { reason }); } catch { /* ignore */ }
  state.user = null;
  history.replaceState(null, '', '/');
  renderLogin(reason === 'idle' ? 'Vous avez été déconnecté après une période d\'inactivité.' : '');
}

// ------------------------------------------------------------------ session active
let events = null;
let idleTimer = null;
let clockTimer = null;
let lastActivity = Date.now();
let lastServerTouch = Date.now();
const offs = [];

function startSession() {
  if (state.user.must_change_password) { renderForcedPassword(); return; }
  renderLayout();
  window.onhashchange = route;
  if (!location.hash || location.hash === '#/' || location.hash === '#') location.hash = defaultPath(); else route();
  connectEvents();
  startIdleWatch();
  refreshCounts();
  refreshUnread();
  registerServiceWorker();
  offs.push(on('authorization', () => { refreshCounts(); }));
  offs.push(on('counts-changed', refreshCounts));
}

function stopSession() {
  if (events) { events.close(); events = null; }
  clearInterval(idleTimer); clearInterval(clockTimer);
  window.onhashchange = null;
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  while (offs.length) offs.pop()();
}

on('unauthorized', (msg) => { if (state.user) { state.user = null; renderLogin(msg); } });
on('must-change-password', () => { if (state.user) { state.user.must_change_password = true; renderForcedPassword(); } });

function renderForcedPassword() {
  app.innerHTML = `<div class="login-page"><form class="login-card">
    <div class="brand"><div class="logo">${LOGO}</div><div><h1>Nouveau mot de passe</h1><p>Bonjour ${esc(state.user.prenom)}, veuillez définir votre mot de passe personnel.</p></div></div>
    <div class="field"><label>Mot de passe actuel (temporaire)</label><input name="current" type="password" autocomplete="current-password" required autofocus></div>
    <div class="field"><label>Nouveau mot de passe</label><input name="password" type="password" autocomplete="new-password" required>
      <div class="hint">10 caractères minimum, avec majuscule, minuscule, chiffre et caractère spécial.</div></div>
    <div class="field"><label>Confirmer</label><input name="confirm" type="password" autocomplete="new-password" required></div>
    <button class="btn btn-primary btn-block btn-lg" type="submit">Enregistrer</button>
    <button class="btn btn-ghost btn-block mt" type="button" data-logout>Se déconnecter</button>
  </form></div>`;
  const form = app.querySelector('form');
  form.querySelector('[data-logout]').addEventListener('click', () => logout());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.password.value !== form.confirm.value) { toast('Les mots de passe ne correspondent pas', 'error'); return; }
    try {
      const data = await post('/api/auth/change-password', { current: form.current.value, password: form.password.value });
      setSession(data);
      toast('Mot de passe enregistré', 'success');
      startSession();
    } catch (err) { toastError(err); }
  });
}

// ------------------------------------------------------------------ mise en page
function renderLayout() {
  const u = state.user;
  if (u.role === 'gardien') {
    app.innerHTML = `<div class="gate-layout">
      <header class="gate-header">
        <span class="title">${icon('gate', 'no')} POSTE DE GARDE</span>
        <select id="poste-select" aria-label="Poste de garde" ${state.settings.postes_garde.length < 2 ? 'hidden' : ''}>${state.settings.postes_garde.map((p) => `<option ${p === u.poste_garde ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
        <span class="clock" id="clock"></span>
        <a class="btn btn-ghost btn-icon bell" href="#/notifications" id="bell" aria-label="Notifications">${icon('bell')}<span class="badge hidden" id="bell-count"></span></a>
        <button class="btn btn-ghost" id="logout-btn">${icon('logout')} <span>${esc(u.prenom)}</span></button>
      </header>
      <nav class="gate-tabs" id="nav"></nav>
      <main class="gate-content" id="view"></main>
    </div>`;
    const sel = $('#poste-select');
    if (!u.poste_garde) state.user.poste_garde = sel.value;
    sel.addEventListener('change', async () => {
      try { await put('/api/auth/poste-garde', { poste_garde: sel.value }); state.user.poste_garde = sel.value; toast(`Poste : ${sel.value}`, 'success'); } catch (e) { toastError(e); }
    });
  } else {
    app.innerHTML = `<div class="layout">
      <aside class="sidebar" id="sidebar">
        <div class="brand"><div class="logo">${LOGO}</div><div><strong>Autorisations de sortie</strong><span>${esc(state.settings.entreprise_nom)}</span></div></div>
        <nav id="nav"></nav>
        <div class="user"><strong>${esc(u.prenom)} ${esc(u.nom)}</strong>${esc(state.settings.roles[u.role])}
          <div class="row mt" style="gap:6px"><a class="btn btn-sm" href="#/compte">${icon('key')} Compte</a><button class="btn btn-sm" id="logout-btn">${icon('logout')} Quitter</button></div></div>
      </aside>
      <div class="overlay" id="overlay"></div>
      <div class="main">
        <header class="topbar">
          <button class="btn btn-ghost btn-icon menu-toggle" id="menu-toggle" aria-label="Menu">${icon('menu')}</button>
          <div class="title" id="page-title"></div>
          ${isRole('chef', 'admin') ? `<a class="btn btn-primary btn-sm" href="#/nouvelle">${icon('plus')}<span class="hide-sm">Nouvelle</span></a>` : ''}
          <span class="clock" id="clock" title="Heure de l'entreprise"></span>
          <button class="btn btn-ghost btn-icon bell" id="bell" aria-label="Notifications">${icon('bell')}<span class="badge hidden" id="bell-count"></span></button>
        </header>
        <main class="content" id="view"></main>
      </div>
      <nav class="bottom-nav" id="bottom-nav"></nav>
    </div>`;
    const sidebar = $('#sidebar'); const overlay = $('#overlay');
    const toggle = (open) => { sidebar.classList.toggle('open', open); overlay.classList.toggle('open', open); };
    $('#menu-toggle').addEventListener('click', () => toggle(!sidebar.classList.contains('open')));
    overlay.addEventListener('click', () => toggle(false));
    $('#nav').addEventListener('click', (e) => { if (e.target.closest('a')) toggle(false); });
    $('#bell').addEventListener('click', toggleNotifPanel);
  }
  $('#logout-btn').addEventListener('click', () => logout());
  renderNav();
  const tick = () => { const c = $('#clock'); if (c) c.textContent = localTimeStr(); };
  tick();
  clockTimer = setInterval(tick, 1000);
}

function renderNav() {
  const nav = $('#nav');
  if (!nav) return;
  const current = (location.hash.replace(/^#/, '') || '').split('?')[0];
  const items = (MENUS[state.user.role] || []).filter((i) => !i.rhOnly || state.settings.validation_rh_requise);
  if (state.user.role === 'gardien') {
    nav.innerHTML = items.map((i) => `<a href="#${i.path}" class="${current === i.path ? 'active' : ''}">${esc(i.label)}${i.count && counts[i.count] ? `<span class="count">${counts[i.count]}</span>` : ''}</a>`).join('');
    return;
  }
  const bottom = $('#bottom-nav');
  if (bottom) {
    const main = items.filter((i) => !i.section).slice(0, 4);
    bottom.innerHTML = main.map((i) => `<a href="#${i.path}" class="${current === i.path ? 'active' : ''} ${i.primary ? 'primary' : ''}">${icon(i.icon)}<span>${esc(i.short || i.label)}</span>${i.count && counts[i.count] ? `<span class="count">${counts[i.count]}</span>` : ''}</a>`).join('');
  }
  nav.innerHTML = items.map((i) => (i.section
    ? `<div class="nav-section">${esc(i.section)}</div>`
    : `<a href="#${i.path}" class="${current === i.path || (i.path !== '/garde' && current.startsWith(`${i.path}/`)) ? 'active' : ''}">${icon(i.icon)}<span>${esc(i.label)}</span>${i.count && counts[i.count] ? `<span class="count">${counts[i.count]}</span>` : ''}</a>`)).join('');
}

async function refreshCounts() {
  try {
    if (isRole('rh', 'admin')) counts.pending = (await get('/api/authorizations?statut=EN_ATTENTE&size=1', { background: true })).total;
    if (isRole('gardien')) {
      const b = await get('/api/gate/board', { background: true });
      counts.validated = b.validated.length; counts.outside = b.outside.length;
    }
    renderNav();
  } catch { /* silencieux */ }
}

async function route() {
  if (!state.user) return;
  const m = match(location.hash);
  if (!m || !m.route.roles.includes(state.user.role)) { location.hash = defaultPath(); return; }
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const view = $('#view');
  const title = $('#page-title');
  if (title) title.textContent = m.route.title;
  document.title = `${m.route.title} — Autorisations de sortie`;
  renderNav();
  closeNotifPanel();
  view.innerHTML = '<div class="empty">Chargement…</div>';
  window.scrollTo(0, 0);
  try {
    const r = await m.route.view(view, m.params);
    cleanup = typeof r === 'function' ? r : null;
  } catch (e) {
    view.innerHTML = `<div class="error-box">${esc(e.message || e)}</div>`;
  }
}

// ------------------------------------------------------------------ temps réel (SSE)
function connectEvents() {
  if (events) events.close();
  events = new EventSource('/api/events');
  events.addEventListener('notification', (e) => {
    const n = JSON.parse(e.data);
    state.unread++;
    updateBell();
    onNotification(n);
  });
  events.addEventListener('authorization', (e) => emit('authorization', JSON.parse(e.data)));
  events.addEventListener('logout', () => { events.close(); get('/api/auth/me').catch(() => {}); });
  events.addEventListener('hello', (e) => {
    const d = JSON.parse(e.data);
    state.serverOffsetMs = new Date(d.server_time) - Date.now();
    // Reconnexion : rafraîchit la vue courante pour récupérer d'éventuels changements manqués
    emit('authorization', { reconnect: true });
  });
}

function onNotification(n) {
  const isGuard = isRole('gardien');
  const important = ['AUTORISATION_VALIDEE', 'AUTORISATION_ANNULEE', 'RETOUR_EN_RETARD', 'DEMANDE_CREEE'].includes(n.type);
  const kind = n.type === 'AUTORISATION_VALIDEE' ? 'success' : ['AUTORISATION_REFUSEE', 'AUTORISATION_ANNULEE', 'RETOUR_EN_RETARD'].includes(n.type) ? 'error' : 'info';
  const open = () => { if (n.entity_type === 'authorization' && n.entity_id) navigate(isGuard ? '/garde/validees' : `/autorisations/${n.entity_id}`); };
  toast(n.message, kind, { title: n.titre, timeout: isGuard ? 12000 : 8000, onClick: open });
  if (isGuard && important) {
    beep(kind === 'success' ? 'ok' : 'alert');
    gate.flash(n);
  } else if (important) beep('ok');
  // Notification système si l'onglet est en arrière-plan (sans abonnement push)
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted' && !pushStatus()) {
    try { const sys = new Notification(n.titre, { body: n.message, icon: '/icon.svg', tag: `n-${n.id}` }); sys.onclick = () => { window.focus(); open(); }; } catch { /* ignore */ }
  }
}

async function refreshUnread() {
  try { const r = await get('/api/notifications?limit=1', { background: true }); state.unread = r.unread; updateBell(); } catch { /* ignore */ }
}
export function updateBell() {
  const b = $('#bell-count');
  if (!b) return;
  b.textContent = state.unread > 99 ? '99+' : String(state.unread);
  b.classList.toggle('hidden', !state.unread);
}
on('unread-changed', refreshUnread);

let panel = null;
function closeNotifPanel() { if (panel) { panel.remove(); panel = null; } }
async function toggleNotifPanel(e) {
  e.stopPropagation();
  if (panel) { closeNotifPanel(); return; }
  panel = document.createElement('div');
  panel.className = 'notif-panel';
  panel.innerHTML = '<div class="empty">Chargement…</div>';
  document.querySelector('.topbar').appendChild(panel);
  try {
    const r = await get('/api/notifications?limit=15');
    panel.innerHTML = `<div class="head"><strong>Notifications</strong><div class="row" style="gap:6px"><button class="btn btn-sm" data-all>Tout marquer lu</button><a class="btn btn-sm" href="#/notifications">Tout voir</a></div></div>
      ${r.items.length ? `<ul class="notif-list">${r.items.map((n) => `<li class="${n.lu ? '' : 'unread'}" data-id="${n.id}" data-entity="${n.entity_type === 'authorization' ? n.entity_id : ''}"><span class="dot"></span><div><strong>${esc(n.titre)}</strong><div>${esc(n.message)}</div><small>${fmtDateTime(n.created_at)}</small></div></li>`).join('')}</ul>` : '<div class="empty">Aucune notification</div>'}`;
    panel.querySelector('[data-all]').addEventListener('click', async () => { await post('/api/notifications/read-all'); state.unread = 0; updateBell(); closeNotifPanel(); });
    panel.querySelectorAll('li[data-id]').forEach((li) => li.addEventListener('click', async () => {
      await post(`/api/notifications/${li.dataset.id}/read`).catch(() => {});
      refreshUnread();
      closeNotifPanel();
      if (li.dataset.entity) navigate(`/autorisations/${li.dataset.entity}`);
    }));
  } catch (err) { panel.innerHTML = `<div class="error-box">${esc(err.message)}</div>`; }
}
document.addEventListener('click', (e) => { if (panel && !panel.contains(e.target) && !e.target.closest('#bell')) closeNotifPanel(); });

// ------------------------------------------------------------------ déconnexion automatique (inactivité)
let warning = null;
function startIdleWatch() {
  lastActivity = Date.now();
  lastServerTouch = Date.now();
  const activity = () => {
    lastActivity = Date.now();
    if (warning) { warning.remove(); warning = null; }
    // Maintient la session serveur active pendant que l'utilisateur travaille.
    if (Date.now() - lastServerTouch > 60000) { lastServerTouch = Date.now(); get('/api/auth/me').catch(() => {}); }
  };
  ['click', 'keydown', 'touchstart', 'mousemove', 'scroll'].forEach((ev) => window.addEventListener(ev, activity, { passive: true }));
  idleTimer = setInterval(() => {
    if (!state.user) return;
    const idleMs = Date.now() - lastActivity;
    const limit = state.idleMinutes * 60000;
    if (idleMs >= limit) { logout('idle'); return; }
    if (idleMs >= limit - 60000 && !warning) {
      warning = toast('Sans activité, vous serez déconnecté dans une minute. Touchez l\'écran pour rester connecté.', 'warning', { title: 'Inactivité', timeout: 60000 });
    }
  }, 5000);
}

boot();

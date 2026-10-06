// POSTE DE GARDE (tablette) : vérification instantanée, sortie et retour en un clic.
import { get, post, qs, on } from '../api.js';
import { state, serverNow } from '../state.js';
import { esc, icon, avatar, posteLabel, fmtTime, fmtDateTime, dmy, duration, minutesSince, toast, toastError, beep, debounce, statusBadge, windowLabel } from '../ui.js';
import { scanQr } from '../qr.js';

const poste = () => state.user.poste_garde || state.settings.postes_garde[0];
const ICON_OK = icon('check');
const ICON_KO = icon('close');
const ICON_OUT = icon('exit');

// ------------------------------------------------------------------ cartes
function guardCard(a, kind) {
  const now = serverNow();
  const early = kind === 'validated' && new Date(a.debut_at).getTime() - state.settings.tolerance_sortie_avant_min * 60000 > now.getTime();
  const late = kind === 'outside' && a.en_retard;
  const cls = kind === 'outside' ? (late ? 'late' : 'out') : kind === 'returned' ? 'done' : early ? 'soon' : '';
  return `<div class="gate-card ${cls}">
    <div class="top"><div class="emp">${avatar(a.employee_id, a.emp_photo, a.emp_prenom, a.emp_nom)}
      <div><div class="who"><span class="mat">MAT. ${esc(a.matricule)}</span></div><div class="who">${esc(a.emp_prenom)} ${esc(a.emp_nom)}</div>
      <div class="sub">${esc(a.service || '')} — ${esc(a.equipe || '')}</div></div></div>
      ${kind === 'outside' ? (late ? '<span class="status st-RETARD">Retour en retard</span>' : '<span class="status st-EXTERIEUR">À l\'extérieur</span>')
        : kind === 'returned' ? '<span class="status st-RETOUR_EFFECTUE">Rentré</span>' : '<span class="status st-VALIDEE">Validée</span>'}
    </div>
    <div class="times">
      ${kind === 'validated' ? `<div><span>Sortie prévue</span><strong>${esc(a.heure_sortie_prevue)}</strong></div><div><span>Retour prévu</span><strong>${esc(a.heure_retour_prevue)}</strong></div>${a.date_sortie !== localToday() ? `<div><span>Date</span><strong>${esc(dmy(a.date_sortie).slice(0, 5))}</strong></div>` : ''}` : ''}
      ${kind === 'outside' ? `<div><span>Sortie</span><strong>${fmtTime(a.heure_sortie_reelle)}</strong></div><div><span>Retour prévu</span><strong>${esc(a.heure_retour_prevue)}</strong></div><div><span>Depuis</span><strong>${duration(minutesSince(a.heure_sortie_reelle))}</strong></div>` : ''}
      ${kind === 'returned' ? `<div><span>Sortie</span><strong>${fmtTime(a.heure_sortie_reelle)}</strong></div><div><span>Retour</span><strong>${fmtTime(a.heure_retour_reel)}</strong></div><div><span>Durée</span><strong>${esc(a.duree_reelle)}</strong></div>` : ''}
    </div>
    ${kind === 'validated' ? (early ? `<button class="btn btn-lg btn-block" disabled>Sortie à partir de ${esc(fmtTime(new Date(new Date(a.debut_at).getTime() - state.settings.tolerance_sortie_avant_min * 60000).toISOString()))}</button>`
      : `<button class="btn btn-success btn-lg btn-block" data-exit="${a.id}">${ICON_OUT} AUTORISER LA SORTIE</button>`) : ''}
    ${kind === 'outside' ? `<button class="btn btn-primary btn-lg btn-block" data-return="${a.id}">${icon('enter')} CONFIRMER LE RETOUR</button>` : ''}
  </div>`;
}
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: state.settings.fuseau_horaire }).format(serverNow());

// ------------------------------------------------------------------ actions
async function doExit(id) {
  const a = await post(`/api/gate/${id}/exit`, { poste_garde: poste() });
  beep('ok');
  toast(`Sortie enregistrée à ${fmtTime(a.heure_sortie_reelle)} — ${a.emp_prenom} ${a.emp_nom}`, 'success', { title: 'SORTIE EFFECTUÉE' });
  return a;
}
async function doReturn(id) {
  const a = await post(`/api/gate/${id}/return`, { poste_garde: poste() });
  beep('ok');
  toast(`Retour à ${fmtTime(a.heure_retour_reel)} — durée ${a.duree_reelle}`, 'success', { title: 'RETOUR CONFIRMÉ' });
  return a;
}

function bindActions(root, after) {
  root.addEventListener('click', async (e) => {
    const ex = e.target.closest('[data-exit]'); const re = e.target.closest('[data-return]');
    const btn = ex || re;
    if (!btn) return;
    btn.disabled = true;
    try {
      const a = ex ? await doExit(Number(ex.dataset.exit)) : await doReturn(Number(re.dataset.return));
      after(a, ex ? 'exit' : 'return');
    } catch (err) { beep('ko'); toastError(err); btn.disabled = false; after(null); }
  });
}

// ------------------------------------------------------------------ verdict
function verdictHtml(r) {
  if (r.verdict === 'INCONNU') {
    return `<div class="verdict ko"><div class="verdict-head"><span class="icon">${ICON_KO}</span>MATRICULE INCONNU</div><p>Aucun opérateur ne correspond à cette saisie. Vérifiez le matricule ou le badge.</p></div>`;
  }
  if (r.verdict === 'PLUSIEURS') {
    return `<div class="verdict wait"><div class="verdict-head">Plusieurs opérateurs correspondent</div><div class="result-list">${r.candidates.map((c) => `<button class="result-item" data-pick="${esc(c.matricule)}">${avatar(c.id, c.photo, c.prenom, c.nom)}<div class="grow"><div class="name"><span class="mat">${esc(c.matricule)}</span> ${esc(c.prenom)} ${esc(c.nom)}</div><div class="meta">${esc(c.service || '')} — ${esc(c.equipe || '')}</div></div></button>`).join('')}</div></div>`;
  }
  const e = r.employee; const a = r.authorization;
  const who = `${avatar(e.id, e.photo, e.prenom, e.nom, 'avatar-xl')}<div><div class="who"><span class="mat">MAT. ${esc(e.matricule)}</span></div><div class="who">${esc(e.prenom)} ${esc(e.nom)}</div>
    <div class="muted">${esc(e.service || '')} — ${esc(e.equipe || '')} · Poste ${posteLabel(e.poste_nom, e.poste_debut, e.poste_fin)}</div>`;
  const times = a ? `<div class="verdict-times"><div><span>Sortie prévue</span><strong>${esc(a.heure_sortie_prevue)}</strong></div><div><span>Retour prévu</span><strong>${esc(a.heure_retour_prevue)}${a.retour_lendemain ? ' <small>(J+1)</small>' : ''}</strong></div><div><span>Date</span><strong>${esc(dmy(a.date_sortie).slice(0, 5))}</strong></div>${a.heure_sortie_reelle ? `<div><span>Sortie réelle</span><strong>${fmtTime(a.heure_sortie_reelle)}</strong></div>` : ''}</div><div class="muted">Autorisation ${esc(a.numero)}</div>` : '';
  switch (r.verdict) {
    case 'VALIDEE':
      return `<div class="verdict ok"><div class="verdict-head"><span class="icon">${ICON_OK}</span>AUTORISATION VALIDÉE</div><div class="verdict-body">${who}${times}
        <div class="verdict-actions"><button class="btn btn-success btn-xl" data-exit="${a.id}">${ICON_OUT} AUTORISER LA SORTIE</button></div></div></div></div>`;
    case 'VALIDEE_A_VENIR':
      return `<div class="verdict wait"><div class="verdict-head"><span class="icon">${icon('clock')}</span>VALIDÉE — PAS ENCORE L'HEURE</div><div class="verdict-body">${who}${times}
        <p><strong>La sortie est prévue à ${esc(a.heure_sortie_prevue)}${a.date_sortie !== localToday() ? ` le ${esc(dmy(a.date_sortie))}` : ''}.</strong> Elle pourra être autorisée ${state.settings.tolerance_sortie_avant_min} min avant.</p></div></div></div>`;
    case 'A_L_EXTERIEUR':
      return `<div class="verdict ${a.en_retard ? 'late' : 'out'}"><div class="verdict-head"><span class="icon">${icon('enter')}</span>${a.en_retard ? 'RETOUR EN RETARD' : 'OPÉRATEUR À L\'EXTÉRIEUR'}</div><div class="verdict-body">${who}${times}
        <p>Sorti depuis <strong>${duration(minutesSince(a.heure_sortie_reelle))}</strong>${a.en_retard ? ` — retard de <strong>${duration(a.retard_min)}</strong>` : ''}.</p>
        <div class="verdict-actions"><button class="btn btn-primary btn-xl" data-return="${a.id}">${icon('enter')} CONFIRMER LE RETOUR</button></div></div></div></div>`;
    default: {
      const d = r.derniere_demande;
      const reason = d ? {
        EN_ATTENTE: `Une demande (${d.numero}) est EN ATTENTE de validation RH. La sortie n'est pas encore autorisée.`,
        REFUSEE: `La dernière demande (${d.numero}) a été REFUSÉE.`,
        EXPIREE: `La dernière autorisation (${d.numero}) est EXPIRÉE.`,
        ANNULEE: `La dernière autorisation (${d.numero}) a été ANNULÉE.`,
      }[d.statut] : (r.info || 'Aucune autorisation pour cet opérateur.');
      return `<div class="verdict ko"><div class="verdict-head"><span class="icon">${ICON_KO}</span>AUCUNE AUTORISATION VALIDE</div><div class="verdict-body">${who}
        <p><strong>${esc(reason)}</strong></p><p>Refuser la sortie ou appliquer la procédure de l'entreprise.</p></div></div></div>`;
    }
  }
}

// ------------------------------------------------------------------ écran principal
export async function renderMain(el) {
  el.innerHTML = `
    <form class="gate-search" id="g-form" autocomplete="off">
      <input id="g-q" type="search" inputmode="search" placeholder="Matricule ou nom…" aria-label="Matricule" autofocus>
      <button class="btn btn-primary btn-xl" type="submit">${icon('search')} VÉRIFIER</button>
      <button class="btn btn-xl" type="button" id="g-scan">${icon('qr')} SCANNER</button>
    </form>
    <div id="g-verdict"></div>
    <div id="g-board"></div>`;
  const input = el.querySelector('#g-q');
  const verdictEl = el.querySelector('#g-verdict');
  const boardEl = el.querySelector('#g-board');
  let clearTimer = null;

  const lookup = async (params) => {
    clearTimeout(clearTimer);
    verdictEl.innerHTML = '<div class="empty">Vérification…</div>';
    try {
      const r = await get(`/api/gate/lookup${qs({ ...params, poste: poste() })}`);
      verdictEl.innerHTML = verdictHtml(r);
      beep(['VALIDEE', 'A_L_EXTERIEUR'].includes(r.verdict) ? 'ok' : r.verdict === 'PLUSIEURS' ? 'alert' : 'ko');
      verdictEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { verdictEl.innerHTML = `<div class="error-box">${esc(e.message)}</div>`; }
  };
  el.querySelector('#g-form').addEventListener('submit', (e) => { e.preventDefault(); const q = input.value.trim(); if (q) lookup({ q }); });
  el.querySelector('#g-scan').addEventListener('click', async () => {
    const text = await scanQr();
    if (text) { input.value = ''; lookup({ qr: text }); }
  });
  verdictEl.addEventListener('click', (e) => { const p = e.target.closest('[data-pick]'); if (p) { input.value = p.dataset.pick; lookup({ q: p.dataset.pick }); } });

  const afterAction = (a, kind) => {
    loadBoard();
    if (!a) return;
    verdictEl.innerHTML = kind === 'exit'
      ? `<div class="verdict out"><div class="verdict-head"><span class="icon">${ICON_OK}</span>SORTIE EFFECTUÉE — ${fmtTime(a.heure_sortie_reelle)}</div><p><span class="mat">MAT. ${esc(a.matricule)}</span> <strong>${esc(a.emp_prenom)} ${esc(a.emp_nom)}</strong> — retour prévu à <strong>${esc(a.heure_retour_prevue)}</strong>. Enregistré par ${esc(a.gardien_sortie)} (${esc(a.poste_garde_sortie || '')}).</p></div>`
      : `<div class="verdict ok"><div class="verdict-head"><span class="icon">${ICON_OK}</span>RETOUR CONFIRMÉ — ${fmtTime(a.heure_retour_reel)}</div><p><span class="mat">MAT. ${esc(a.matricule)}</span> <strong>${esc(a.emp_prenom)} ${esc(a.emp_nom)}</strong> — sortie ${fmtTime(a.heure_sortie_reelle)}, retour ${fmtTime(a.heure_retour_reel)}, durée <strong>${esc(a.duree_reelle)}</strong>${a.en_retard ? ' <span class="tag tag-red">en retard</span>' : ''}.</p></div>`;
    input.value = '';
    clearTimer = setTimeout(() => { verdictEl.innerHTML = ''; }, 20000);
    input.focus();
  };
  bindActions(verdictEl, afterAction);
  bindActions(boardEl, afterAction);

  const loadBoard = async () => {
    try {
      const b = await get('/api/gate/board', { background: true });
      boardEl.innerHTML = `
        <div class="gate-section-title">${icon('check', 'no')} Autorisations validées <span class="n">${b.validated.length}</span></div>
        ${b.validated.length ? `<div class="gate-cards">${b.validated.map((a) => guardCard(a, 'validated')).join('')}</div>` : '<div class="empty card">Aucune autorisation validée en attente de sortie</div>'}
        <div class="gate-section-title">À l'extérieur <span class="n">${b.outside.length}</span></div>
        ${b.outside.length ? `<div class="gate-cards">${b.outside.map((a) => guardCard(a, 'outside')).join('')}</div>` : '<div class="empty card">Aucun opérateur à l\'extérieur</div>'}`;
    } catch (e) { boardEl.innerHTML = `<div class="error-box">${esc(e.message)}</div>`; }
  };
  await loadBoard();
  const reload = debounce(loadBoard, 300);
  const off = on('authorization', reload);
  const timer = setInterval(loadBoard, 30000);
  return () => { off(); clearInterval(timer); clearTimeout(clearTimer); };
}

// ------------------------------------------------------------------ onglets
export async function renderTab(el, tab) {
  const load = async () => {
    const b = await get('/api/gate/board', { background: true });
    const list = tab === 'validees' ? b.validated : tab === 'sorties' ? b.outside : b.returns;
    const kind = tab === 'validees' ? 'validated' : tab === 'sorties' ? 'outside' : 'returned';
    const title = { validees: 'Autorisations validées', sorties: 'Sorties en cours', retours: 'Retours des dernières heures' }[tab];
    el.innerHTML = `<div class="gate-section-title" style="margin-top:4px">${title} <span class="n">${list.length}</span></div>
      ${list.length ? `<div class="gate-cards">${list.map((a) => guardCard(a, kind)).join('')}</div>` : '<div class="empty card">Rien à afficher</div>'}`;
  };
  bindActions(el, () => load());
  await load();
  const off = on('authorization', debounce(load, 300));
  const timer = setInterval(load, 30000);
  return () => { off(); clearInterval(timer); };
}

// ------------------------------------------------------------------ historique des contrôles
export async function renderHistory(el) {
  let periode = 'aujourdhui'; let q = '';
  el.innerHTML = `<div class="row mb"><div class="chips" id="gh-p">${[['aujourdhui', "Aujourd'hui"], ['hier', 'Hier'], ['semaine', 'Cette semaine'], ['mois', 'Ce mois']].map(([v, l]) => `<button class="chip ${v === periode ? 'active' : ''}" data-p="${v}">${l}</button>`).join('')}</div>
    <input type="search" id="gh-q" placeholder="Matricule ou nom" style="max-width:260px"></div><div id="gh-body"></div>`;
  const body = el.querySelector('#gh-body');
  const RES = { VALIDEE: ['st-VALIDEE', 'Validée'], VALIDEE_A_VENIR: ['st-EN_ATTENTE', 'Validée (à venir)'], A_L_EXTERIEUR: ['st-EXTERIEUR', "À l'extérieur"], AUCUNE: ['st-REFUSEE', 'Aucune autorisation'], INCONNU: ['st-REFUSEE', 'Inconnu'], PLUSIEURS: ['st-BROUILLON', 'Plusieurs résultats'] };
  const load = async () => {
    try {
      const r = await get(`/api/gate/history${qs({ periode, q })}`);
      body.innerHTML = `<div class="card"><h2>Mouvements (sorties / retours) — ${r.total_movements}</h2>
        ${r.movements.length ? `<div class="table-wrap"><table class="table responsive"><thead><tr><th>Opérateur</th><th>Créneau prévu</th><th>Sortie réelle</th><th>Retour réel</th><th>Durée</th><th>Gardien</th><th>Statut</th></tr></thead><tbody>
        ${r.movements.map((a) => `<tr class="${a.en_retard ? 'late' : ''}"><td class="main-cell"><span class="mat">${esc(a.matricule)}</span> <strong>${esc(a.emp_prenom)} ${esc(a.emp_nom)}</strong> <span class="muted">${esc(a.equipe || '')}</span></td>
          <td data-label="Prévu">${windowLabel(a)}</td><td data-label="Sortie">${fmtDateTime(a.heure_sortie_reelle)}</td><td data-label="Retour">${a.heure_retour_reel ? fmtDateTime(a.heure_retour_reel) : '—'}</td>
          <td data-label="Durée">${esc(a.duree_reelle || '')}</td><td data-label="Gardien">${esc(a.gardien_sortie || '')}${a.gardien_retour && a.gardien_retour !== a.gardien_sortie ? ` / ${esc(a.gardien_retour)}` : ''}</td>
          <td data-label="Statut">${statusBadge(a.statut, { a })}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Aucun mouvement</div>'}</div>
        <div class="card"><h2>Contrôles effectués — ${r.checks.length}</h2>
        ${r.checks.length ? `<div class="table-wrap"><table class="table responsive"><thead><tr><th>Date / heure</th><th>Saisie</th><th>Opérateur</th><th>Méthode</th><th>Résultat</th><th>Gardien</th><th>Poste</th></tr></thead><tbody>
        ${r.checks.map((c) => `<tr><td data-label="Heure" class="nowrap">${fmtDateTime(c.created_at)}</td><td data-label="Saisie" class="mono">${esc(c.saisie && c.saisie.startsWith('SORTIE:') ? 'Badge QR' : c.saisie || '')}</td>
          <td data-label="Opérateur">${c.matricule ? `<span class="mat">${esc(c.matricule)}</span> ${esc(c.prenom)} ${esc(c.nom)}` : '—'}</td><td data-label="Méthode">${c.methode === 'qr' ? 'QR code' : 'Recherche'}</td>
          <td data-label="Résultat"><span class="status ${(RES[c.resultat] || ['st-BROUILLON'])[0]}">${esc((RES[c.resultat] || [0, c.resultat])[1])}</span></td>
          <td data-label="Gardien">${esc(c.gardien || '')}</td><td data-label="Poste">${esc(c.poste_garde || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Aucun contrôle</div>'}</div>`;
    } catch (e) { body.innerHTML = `<div class="error-box">${esc(e.message)}</div>`; }
  };
  el.querySelector('#gh-p').addEventListener('click', (e) => {
    const c = e.target.closest('[data-p]'); if (!c) return;
    periode = c.dataset.p; el.querySelectorAll('#gh-p .chip').forEach((x) => x.classList.toggle('active', x === c)); load();
  });
  el.querySelector('#gh-q').addEventListener('input', debounce((e) => { q = e.target.value; load(); }, 300));
  await load();
}

// ------------------------------------------------------------------ opérateurs à l'extérieur (RH, chef, admin)
export async function renderOutsidePage(el) {
  const load = async () => {
    const list = await get('/api/outside');
    const late = list.filter((a) => a.en_retard).length;
    el.innerHTML = `<div class="page-head"><div><h1>Opérateurs actuellement à l'extérieur</h1><p>${list.length} opérateur(s) dehors${late ? ` dont <strong style="color:var(--red)">${late} en retard</strong>` : ''}. Actualisation automatique.</p></div></div>
      <div class="card">${list.length ? `<div class="table-wrap"><table class="table responsive"><thead><tr><th>Opérateur</th><th>Équipe</th><th>Heure de sortie</th><th>Retour prévu</th><th>Durée depuis la sortie</th><th>Statut</th></tr></thead><tbody>
      ${list.map((a) => `<tr class="clickable ${a.en_retard ? 'late' : ''}" data-id="${a.id}">
        <td class="main-cell"><div class="emp">${avatar(a.employee_id, a.emp_photo, a.emp_prenom, a.emp_nom)}<div><div class="name"><span class="mat">${esc(a.matricule)}</span> ${esc(a.emp_prenom)} ${esc(a.emp_nom)}</div><div class="meta">${esc(a.service || '')}</div></div></div></td>
        <td data-label="Équipe">${esc(a.equipe || '—')}</td><td data-label="Sortie">${fmtTime(a.heure_sortie_reelle)}</td>
        <td data-label="Retour prévu">${esc(a.heure_retour_prevue)}${a.retour_lendemain ? ' <small>(J+1)</small>' : ''}</td>
        <td data-label="Durée"><strong>${duration(minutesSince(a.heure_sortie_reelle))}</strong></td>
        <td data-label="Statut">${a.en_retard ? `<span class="status st-RETARD">Retour en retard</span> <small>+${duration(a.retard_min)}</small>` : '<span class="status st-EXTERIEUR">À l\'extérieur</span>'}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Aucun opérateur à l\'extérieur actuellement.</div>'}</div>`;
    el.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => { location.hash = `/autorisations/${tr.dataset.id}`; }));
  };
  await load();
  const off = on('authorization', debounce(() => load().catch(() => {}), 300));
  const timer = setInterval(() => load().catch(() => {}), 30000);
  return () => { off(); clearInterval(timer); };
}

// ------------------------------------------------------------------ bandeau d'alerte (gardien)
export function flash(n) {
  const existing = document.querySelector('.flash-banner');
  if (existing) existing.remove();
  const b = document.createElement('div');
  const red = ['AUTORISATION_ANNULEE', 'RETOUR_EN_RETARD'].includes(n.type);
  b.className = `flash-banner ${red ? 'red' : ''}`;
  b.textContent = `${red ? '⚠' : '🟢'} ${n.titre} — ${n.message}`;
  b.addEventListener('click', () => b.remove());
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 15000);
}

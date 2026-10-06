// POSTE DE GARDE — version simple : taper le matricule → AUTORISÉ ou NON AUTORISÉ → un seul bouton.
import { get, post, qs, on } from '../api.js';
import { state, serverNow } from '../state.js';
import { esc, icon, avatar, fmtTime, fmtDateTime, dmy, duration, minutesSince, toastError, beep, debounce, statusBadge } from '../ui.js';
import { scanQr } from '../qr.js';

const poste = () => state.user.poste_garde || state.settings.postes_garde[0];
const tolMs = () => state.settings.tolerance_sortie_avant_min * 60000;
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: state.settings.fuseau_horaire }).format(serverNow());
const dayLabel = (d) => (d && d !== localToday() ? ` le ${dmy(d).slice(0, 5)}` : '');

/** Texte court des horaires prévus : « 23:30 → 01:00 » ou « 23:30 — sans retour ». */
function horaires(a) {
  return a.avec_retour === false
    ? `Sortie ${esc(a.heure_sortie_prevue)}${dayLabel(a.date_sortie)} — <strong>SANS RETOUR</strong>`
    : `Sortie ${esc(a.heure_sortie_prevue)}${dayLabel(a.date_sortie)} → retour ${esc(a.heure_retour_prevue)}${a.retour_lendemain ? ' (lendemain)' : ''}`;
}

function person(e, big = false) {
  return `<div class="g-person">${avatar(e.employee_id ?? e.id, e.photo ?? e.emp_photo, e.prenom ?? e.emp_prenom, e.nom ?? e.emp_nom, big ? 'avatar-xl' : '')}
    <div><div class="g-name">${esc(e.prenom ?? e.emp_prenom)} ${esc(e.nom ?? e.emp_nom)}</div>
    <div class="g-sub"><span class="mat">MAT. ${esc(e.matricule)}</span> ${esc(e.equipe || '')}</div></div></div>`;
}

// ------------------------------------------------------------------ résultat du contrôle
function verdictHtml(r) {
  if (r.verdict === 'PLUSIEURS') {
    return `<div class="g-verdict g-wait"><div class="g-title">Choisir la personne</div><div class="result-list">${r.candidates.map((c) => `<button class="result-item" data-pick="${esc(c.matricule)}">${person(c)}</button>`).join('')}</div></div>`;
  }
  if (r.verdict === 'INCONNU') {
    return `<div class="g-verdict g-ko"><div class="g-title">✖ MATRICULE INCONNU</div><p>Vérifiez le numéro.</p></div>`;
  }
  const e = r.employee; const a = r.authorization;
  switch (r.verdict) {
    case 'VALIDEE':
      return `<div class="g-verdict g-ok"><div class="g-title">✔ AUTORISÉ</div>${person(e, true)}<p class="g-hours">${horaires(a)}</p>
        <button class="btn btn-success g-action" data-exit="${a.id}">VALIDER LA SORTIE</button></div>`;
    case 'VALIDEE_A_VENIR':
      return `<div class="g-verdict g-wait"><div class="g-title">⏳ PAS ENCORE L'HEURE</div>${person(e, true)}<p class="g-hours">${horaires(a)}</p>
        <p>Sortie possible à partir de <strong>${fmtTime(new Date(new Date(a.debut_at).getTime() - tolMs()).toISOString())}</strong>.</p></div>`;
    case 'A_L_EXTERIEUR':
      return `<div class="g-verdict ${a.en_retard ? 'g-ko' : 'g-out'}"><div class="g-title">${a.en_retard ? '⚠ DEHORS — EN RETARD' : '↩ DEHORS'}</div>${person(e, true)}
        <p class="g-hours">Sorti à ${fmtTime(a.heure_sortie_reelle)} · retour prévu ${esc(a.heure_retour_prevue)}</p>
        <button class="btn btn-primary g-action" data-return="${a.id}">CONFIRMER LE RETOUR</button></div>`;
    default: {
      const d = r.derniere_demande;
      const reason = d ? { EN_ATTENTE: 'Demande pas encore validée par le RH.', REFUSEE: 'Demande refusée.', EXPIREE: 'Autorisation expirée.', ANNULEE: 'Autorisation annulée.' }[d.statut] : (r.info || 'Aucune autorisation.');
      return `<div class="g-verdict g-ko"><div class="g-title">✖ NON AUTORISÉ</div>${person(e, true)}<p class="g-hours">${esc(reason)}</p><p>Ne pas laisser sortir — appliquer la procédure.</p></div>`;
    }
  }
}

function doneHtml(a, kind) {
  if (kind === 'return') return `<div class="g-verdict g-ok"><div class="g-title">✔ RETOUR ENREGISTRÉ — ${fmtTime(a.heure_retour_reel)}</div>${person(a)}<p class="g-hours">Durée de sortie : ${esc(a.duree_reelle)}</p></div>`;
  return `<div class="g-verdict g-ok"><div class="g-title">✔ SORTIE ENREGISTRÉE — ${fmtTime(a.heure_sortie_reelle)}</div>${person(a)}
    <p class="g-hours">${a.avec_retour === false ? 'Sans retour (quitte le poste).' : `Retour prévu à ${esc(a.heure_retour_prevue)}.`}</p></div>`;
}

// ------------------------------------------------------------------ écran unique
export async function renderMain(el) {
  const scanner = state.settings.scanner_qr_actif;
  el.innerHTML = `
    <form class="g-search" id="g-form" autocomplete="off">
      <input id="g-q" type="text" inputmode="numeric" placeholder="N° matricule" aria-label="Matricule" autofocus>
      <button class="btn btn-primary g-btn" type="submit">VÉRIFIER</button>
      ${scanner ? `<button class="btn g-btn" type="button" id="g-scan">${icon('qr')}</button>` : ''}
    </form>
    <div id="g-verdict"></div>
    <div id="g-board"></div>`;
  const input = el.querySelector('#g-q');
  const verdictEl = el.querySelector('#g-verdict');
  const boardEl = el.querySelector('#g-board');
  let clearTimer = null;
  const reset = (ms) => { clearTimeout(clearTimer); clearTimer = setTimeout(() => { verdictEl.innerHTML = ''; }, ms); };

  const lookup = async (params) => {
    clearTimeout(clearTimer);
    verdictEl.innerHTML = '<div class="empty">Vérification…</div>';
    try {
      const r = await get(`/api/gate/lookup${qs({ ...params, poste: poste() })}`);
      verdictEl.innerHTML = verdictHtml(r);
      beep(['VALIDEE', 'A_L_EXTERIEUR'].includes(r.verdict) ? 'ok' : r.verdict === 'PLUSIEURS' ? 'alert' : 'ko');
      input.select();
      reset(60000);
    } catch (e) { verdictEl.innerHTML = `<div class="error-box">${esc(e.message)}</div>`; }
  };
  el.querySelector('#g-form').addEventListener('submit', (e) => { e.preventDefault(); const q = input.value.trim(); if (q) lookup({ q }); });
  const scanBtn = el.querySelector('#g-scan');
  if (scanBtn) scanBtn.addEventListener('click', async () => { const t = await scanQr(); if (t) lookup({ qr: t }); });
  verdictEl.addEventListener('click', (e) => { const p = e.target.closest('[data-pick]'); if (p) { input.value = p.dataset.pick; lookup({ q: p.dataset.pick }); } });

  // Boutons SORTIE / RETOUR (résultat et listes)
  el.addEventListener('click', async (e) => {
    const ex = e.target.closest('[data-exit]'); const re = e.target.closest('[data-return]');
    const btn = ex || re;
    if (!btn) return;
    btn.disabled = true;
    try {
      const a = ex
        ? await post(`/api/gate/${ex.dataset.exit}/exit`, { poste_garde: poste() })
        : await post(`/api/gate/${re.dataset.return}/return`, { poste_garde: poste() });
      beep('ok');
      verdictEl.innerHTML = doneHtml(a, ex ? 'exit' : 'return');
      input.value = '';
      reset(8000);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      loadBoard();
    } catch (err) { beep('ko'); toastError(err); btn.disabled = false; loadBoard(); }
  });

  const loadBoard = async () => {
    try {
      const b = await get('/api/gate/board', { background: true });
      const now = serverNow().getTime();
      const row = (a, action) => `<div class="g-row ${a.en_retard ? 'late' : ''}">${person(a)}
        <div class="g-row-info">${action === 'return' ? `Sorti ${fmtTime(a.heure_sortie_reelle)} · retour ${esc(a.heure_retour_prevue)}${a.en_retard ? ' <span class="status st-RETARD">retard</span>' : ''}` : horaires(a)}</div>
        ${action === 'exit' ? (new Date(a.debut_at).getTime() - tolMs() > now
          ? `<span class="g-later">à ${fmtTime(new Date(new Date(a.debut_at).getTime() - tolMs()).toISOString())}</span>`
          : `<button class="btn btn-success g-row-btn" data-exit="${a.id}">SORTIE</button>`)
          : `<button class="btn btn-primary g-row-btn" data-return="${a.id}">RETOUR</button>`}</div>`;
      boardEl.innerHTML = `
        <h2 class="g-h">🟢 Autorisés à sortir <span class="n">${b.validated.length}</span></h2>
        ${b.validated.length ? b.validated.map((a) => row(a, 'exit')).join('') : '<div class="g-empty">Personne pour le moment</div>'}
        <h2 class="g-h">↩ Dehors (doivent revenir) <span class="n">${b.outside.length}</span></h2>
        ${b.outside.length ? b.outside.map((a) => row(a, 'return')).join('') : '<div class="g-empty">Personne dehors</div>'}`;
    } catch (e) { boardEl.innerHTML = `<div class="error-box">${esc(e.message)}</div>`; }
  };
  await loadBoard();
  const off = on('authorization', debounce(loadBoard, 300));
  const timer = setInterval(loadBoard, 30000);
  return () => { off(); clearInterval(timer); clearTimeout(clearTimer); };
}

// ------------------------------------------------------------------ historique (sorties / retours du jour)
export async function renderHistory(el) {
  let periode = 'aujourdhui';
  el.innerHTML = `<div class="chips mb" id="gh-p">${[['aujourdhui', "Aujourd'hui"], ['hier', 'Hier'], ['semaine', 'Cette semaine']].map(([v, l]) => `<button class="chip ${v === periode ? 'active' : ''}" data-p="${v}">${l}</button>`).join('')}</div><div id="gh-body"></div>`;
  const body = el.querySelector('#gh-body');
  const load = async () => {
    try {
      const r = await get(`/api/gate/history${qs({ periode })}`);
      body.innerHTML = r.movements.length ? r.movements.map((a) => `<div class="g-row">${person(a)}
        <div class="g-row-info">Sortie ${fmtDateTime(a.heure_sortie_reelle)}${a.avec_retour === false ? ' — sans retour' : a.heure_retour_reel ? ` · retour ${fmtTime(a.heure_retour_reel)} (${esc(a.duree_reelle)})` : ' · <strong>pas encore rentré</strong>'}</div>
        ${statusBadge(a.statut, { a })}</div>`).join('') : '<div class="g-empty">Aucun mouvement</div>';
    } catch (e) { body.innerHTML = `<div class="error-box">${esc(e.message)}</div>`; }
  };
  el.querySelector('#gh-p').addEventListener('click', (e) => {
    const c = e.target.closest('[data-p]'); if (!c) return;
    periode = c.dataset.p; el.querySelectorAll('#gh-p .chip').forEach((x) => x.classList.toggle('active', x === c)); load();
  });
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


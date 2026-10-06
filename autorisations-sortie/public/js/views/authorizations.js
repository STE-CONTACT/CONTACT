// Autorisations : création (chef d'équipe), listes, détail, validation/refus (RH), annulation.
import { get, post, qs, on } from '../api.js';
import { state, isRole, serverNow } from '../state.js';
import {
  esc, icon, statusBadge, windowLabel, avatar, posteLabel, fmtDateTime, dmy, toast, toastError, modal,
  promptDialog, debounce, localDateStr, localTimeStr, addDays, toMin, duration, fileToBase64, pager, actionLabel, navigate,
} from '../ui.js';

const MOTIFS = {
  PERSONNELLE: ['Démarche administrative', 'Raison familiale', 'Affaire personnelle'],
  URGENCE: ['Urgence familiale', 'Urgence médicale', 'Urgence domicile'],
  PROFESSIONNELLE: ['Livraison / fournisseur', 'Formation externe', 'Mission pour la société'],
  RENDEZ_VOUS: ['Rendez-vous médical', 'Rendez-vous administratif', 'Rendez-vous banque'],
  AUTRE: [],
};

// ================================================================== NOUVELLE AUTORISATION
export async function renderNew(el) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  let employee = null;
  if (params.get('employee')) {
    try { employee = await get(`/api/employees/${Number(params.get('employee'))}`); } catch (e) { toastError(e); }
  }
  if (employee) renderForm(el, employee); else renderStep1(el);
}

function steps(n) {
  return `<div class="steps"><div class="s ${n === 1 ? 'active' : 'done'}">1. Opérateur</div><div class="s ${n === 2 ? 'active' : ''}">2. Autorisation</div><div class="s">3. Envoi au RH</div></div>`;
}

function renderStep1(el) {
  el.innerHTML = `${steps(1)}
    <div class="card">
      <div class="field"><label for="emp-q">Rechercher un opérateur — matricule, nom ou prénom</label>
        <input id="emp-q" type="search" placeholder="Ex. 4587 ou BEN ALI" autocomplete="off" autofocus></div>
      <div id="emp-results" class="result-list"></div>
    </div>`;
  const input = el.querySelector('#emp-q');
  const results = el.querySelector('#emp-results');
  let current = [];
  const search = async () => {
    const q = input.value.trim();
    try {
      current = await get(`/api/employees${qs({ q, actif: '1', limit: q ? 30 : 200 })}`);
      results.innerHTML = current.length ? current.map((e, i) => `<button type="button" class="result-item" data-i="${i}">
        ${avatar(e.id, e.photo, e.prenom, e.nom)}
        <div class="grow"><div class="name"><span class="mat">${esc(e.matricule)}</span> ${esc(e.nom)} ${esc(e.prenom)}</div>
        <div class="meta">${esc(e.service || '—')} · ${esc(e.equipe || '—')} · ${posteLabel(e.poste_nom, e.poste_debut, e.poste_fin)}</div></div>
        ${icon('plus')}</button>`).join('') : `<div class="empty">Aucun opérateur trouvé${isRole('chef') ? ' dans vos équipes' : ''}.</div>`;
    } catch (e) { results.innerHTML = `<div class="error-box">${esc(e.message)}</div>`; }
  };
  input.addEventListener('input', debounce(search, 200));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && current.length) { e.preventDefault(); renderForm(el, current[0]); } });
  results.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) renderForm(el, current[Number(b.dataset.i)]); });
  search();
}

function employeeCard(e) {
  return `<div class="emp-card">
    ${avatar(e.id, e.photo, e.prenom, e.nom, 'avatar-lg')}
    <div class="kv">
      <div><span>Matricule</span><strong class="mono">${esc(e.matricule)}</strong></div>
      <div><span>Nom</span><strong>${esc(e.nom)}</strong></div>
      <div><span>Prénom</span><strong>${esc(e.prenom)}</strong></div>
      <div><span>Service</span><strong>${esc(e.service || '—')}</strong></div>
      <div><span>Équipe</span><strong>${esc(e.equipe || '—')}</strong></div>
      <div><span>Poste</span><strong>${posteLabel(e.poste_nom, e.poste_debut, e.poste_fin)}</strong></div>
    </div></div>`;
}

function roundedNow(addMin = 0) {
  const now = serverNow();
  const t = toMin(localTimeStr(now)) + addMin;
  const r = Math.ceil(t / 5) * 5;
  return { time: `${String(Math.floor(r / 60) % 24).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`, nextDay: r >= 1440 };
}

function renderForm(el, emp) {
  const s = state.settings;
  const start = roundedNow(5);
  const end = roundedNow(65);
  const today = localDateStr();
  let type = 'PERSONNELLE';
  el.innerHTML = `${steps(2)}
    <div class="card"><div class="card-head"><h2>Opérateur</h2><button class="btn btn-sm" data-change>Changer</button></div>${employeeCard(emp)}</div>
    <form class="card" id="auth-form" novalidate>
      <h2>Autorisation de sortie</h2>
      <div class="form-grid">
        <div class="field"><label for="f-date">Date de sortie</label><input id="f-date" type="date" value="${start.nextDay ? addDays(today, 1) : today}" required></div>
        <div class="field"><label for="f-hs">Heure de sortie prévue</label><input id="f-hs" type="time" value="${start.time}" required></div>
        <div class="field"><label for="f-hr">Heure de retour prévue</label><input id="f-hr" type="time" value="${end.time}" required></div>
      </div>
      <div class="field"><div id="preview"></div></div>
      <div class="field"><label>Type de sortie</label><div class="segmented" id="types">${Object.entries(s.types_sortie).map(([k, v]) => `<button type="button" data-type="${k}" class="${k === type ? 'active' : ''}">${esc(v)}</button>`).join('')}</div></div>
      <div class="field"><label for="f-motif">Motif <span class="muted">(obligatoire)</span></label>
        <input id="f-motif" type="text" maxlength="500" required placeholder="Motif de la sortie">
        <div class="chips mt" id="motifs"></div></div>
      <div class="field"><label for="f-comment">Commentaire <span class="muted">(facultatif)</span></label><textarea id="f-comment" maxlength="1000" rows="2"></textarea></div>
      ${s.pieces_jointes_actives ? `<div class="field"><label for="f-file">Pièce jointe <span class="muted">(facultatif — PDF ou photo, 5 Mo max.)</span></label><input id="f-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp"></div>` : ''}
      <div class="row mt" style="justify-content:flex-end">
        <button type="button" class="btn" data-draft>Enregistrer en brouillon</button>
        <button type="submit" class="btn btn-primary btn-lg">${icon('check')} Envoyer la demande</button>
      </div>
    </form>`;
  const f = (id) => el.querySelector(id);
  const renderMotifs = () => {
    f('#motifs').innerHTML = (MOTIFS[type] || []).map((m) => `<button type="button" class="chip" data-m="${esc(m)}">${esc(m)}</button>`).join('');
  };
  renderMotifs();
  let adjusted = false;
  const preview = () => {
    const date = f('#f-date').value; const hs = f('#f-hs').value; const hr = f('#f-hr').value;
    if (!date || !hs || !hr) { f('#preview').innerHTML = ''; return; }
    if (hs === hr) { f('#preview').innerHTML = '<div class="error-box">L\'heure de retour doit être différente de l\'heure de sortie.</div>'; return; }
    const nextDay = toMin(hr) < toMin(hs);
    // Sortie après minuit saisie le soir : si le créneau du jour est déjà passé, on propose le lendemain.
    const nowDate = localDateStr(); const nowMin = toMin(localTimeStr());
    const endPassed = date === nowDate && !nextDay && toMin(hr) <= nowMin;
    if (endPassed && !adjusted && nowMin - toMin(hs) > 120) {
      f('#f-date').value = addDays(nowDate, 1); adjusted = true; preview(); return;
    }
    const dur = nextDay ? 1440 - toMin(hs) + toMin(hr) : toMin(hr) - toMin(hs);
    const dateRetour = nextDay ? addDays(date, 1) : date;
    const fmtDay = (d) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
    const warnings = [];
    if (adjusted) warnings.push(`Date positionnée au lendemain (${dmy(f('#f-date').value)}) car la sortie est prévue après minuit.`);
    if (dur > s.duree_max_heures * 60) warnings.push(`Durée supérieure au maximum autorisé (${s.duree_max_heures} h).`);
    if (date === nowDate && !nextDay && toMin(hr) <= nowMin) warnings.push('Le retour prévu est déjà passé : vérifiez la date.');
    if (emp.poste_debut && emp.poste_fin && !withinShift(emp.poste_debut, emp.poste_fin, hs, dur)) warnings.push(`Information : ce créneau dépasse le poste de l'opérateur (${emp.poste_debut}–${emp.poste_fin}). La demande reste possible.`);
    f('#preview').innerHTML = `<div class="window-preview"><div><div class="muted">Sortie</div><div class="big">${esc(fmtDay(date))} ${esc(hs)}</div></div>
      <div class="big">→</div><div><div class="muted">Retour</div><div class="big">${esc(fmtDay(dateRetour))} ${esc(hr)}</div></div>
      <div><div class="muted">Durée</div><div class="big">${duration(dur)}</div></div></div>
      ${warnings.map((w) => `<div class="warn-box mt">${esc(w)}</div>`).join('')}`;
  };
  ['#f-date', '#f-hs', '#f-hr'].forEach((id) => f(id).addEventListener('change', () => { if (id === '#f-date') adjusted = false; preview(); }));
  ['#f-hs', '#f-hr'].forEach((id) => f(id).addEventListener('input', preview));
  preview();
  f('#types').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]'); if (!b) return;
    type = b.dataset.type;
    f('#types').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    renderMotifs();
  });
  f('#motifs').addEventListener('click', (e) => { const c = e.target.closest('[data-m]'); if (c) { f('#f-motif').value = c.dataset.m; } });
  el.querySelector('[data-change]').addEventListener('click', () => renderStep1(el));

  const send = async (submit) => {
    const motif = f('#f-motif').value.trim();
    if (!motif) { toast('Le motif est obligatoire', 'warning'); f('#f-motif').focus(); return; }
    const body = {
      employee_id: emp.id, date_sortie: f('#f-date').value, heure_sortie_prevue: f('#f-hs').value, heure_retour_prevue: f('#f-hr').value,
      type_sortie: type, motif, commentaire: f('#f-comment').value, submit,
    };
    const file = f('#f-file') && f('#f-file').files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { toast('Pièce jointe trop volumineuse (5 Mo max.)', 'warning'); return; }
      body.piece_jointe = { name: file.name, type: file.type, data: await fileToBase64(file) };
    }
    const buttons = el.querySelectorAll('button');
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const a = await post('/api/authorizations', body);
      toast(submit ? `Demande ${a.numero} envoyée au RH` : `Brouillon ${a.numero} enregistré`, 'success');
      navigate(`/autorisations/${a.id}`);
    } catch (e) { toastError(e); buttons.forEach((b) => { b.disabled = false; }); }
  };
  f('#auth-form').addEventListener('submit', (e) => { e.preventDefault(); send(true); });
  el.querySelector('[data-draft]').addEventListener('click', () => send(false));
  setTimeout(() => f('#f-motif').focus(), 50);
}

/** Vérifie (à titre indicatif) si un créneau tient dans le poste de l'opérateur, y compris les postes de nuit. */
function withinShift(pd, pf, hs, dur) {
  const start = toMin(pd); let end = toMin(pf); if (end <= start) end += 1440;
  let s = toMin(hs);
  if (s < start && s + 1440 < end) s += 1440;
  return s >= start && s + dur <= end;
}

// ================================================================== DÉCISION RAPIDE (RH)
export async function quickDecision(id, kind) {
  try {
    if (kind === 'approve') {
      const comment = await modal({
        title: "Valider l'autorisation",
        body: '<div class="field"><label>Commentaire <span class="muted">(facultatif)</span></label><textarea id="c" maxlength="1000" rows="2"></textarea></div><div class="info-box">Le gardien sera notifié immédiatement.</div>',
        actions: [{ label: 'Annuler', value: null }, { label: 'Valider', class: 'btn-success', onClick: (b) => b.querySelector('#c').value }],
      });
      if (comment === null) return false;
      const a = await post(`/api/authorizations/${id}/approve`, { commentaire: comment });
      toast(`${a.numero} validée — le poste de garde est notifié`, 'success');
    } else {
      const motif = await promptDialog("Refuser l'autorisation", {
        label: 'Motif du refus', required: state.settings.motif_refus_obligatoire, confirmLabel: 'Refuser', danger: true,
        suggestions: ['Sortie non justifiée', 'Effectif insuffisant sur le poste', 'Justificatif manquant', 'Créneau incompatible avec la production'],
      });
      if (motif === null) return false;
      const a = await post(`/api/authorizations/${id}/reject`, { motif_refus: motif });
      toast(`${a.numero} refusée — le chef d'équipe est notifié`, 'warning');
    }
    return true;
  } catch (e) { toastError(e); return false; }
}

// ================================================================== LISTES
const STATUS_FILTERS = [
  ['', 'Tous'], ['EN_ATTENTE', 'En attente'], ['VALIDEE', 'Validées'], ['SORTIE_EFFECTUEE', 'Sortis'], ['RETOUR_EFFECTUE', 'Rentrés'],
  ['REFUSEE', 'Refusées'], ['EXPIREE', 'Expirées'], ['ANNULEE', 'Annulées'], ['BROUILLON', 'Brouillons'],
];

export async function renderList(el, { mode }) {
  const f = { page: 1, size: 25, statut: mode === 'pending' ? 'EN_ATTENTE' : '', q: '', periode: '', mine: mode === 'mine' ? '1' : '', sort: mode === 'pending' ? 'asc' : '' };
  const heading = { mine: ['Mes demandes', 'Demandes que vous avez créées et leur statut en temps réel.'], pending: ['Demandes en attente', 'Ouvrir → Vérifier → Valider / Refuser. Traitement possible 24 h/24.'], all: ['Autorisations', isRole('chef') ? 'Autorisations de vos équipes.' : 'Toutes les autorisations.'] }[mode];
  el.innerHTML = `<div class="page-head"><div><h1>${heading[0]}</h1><p>${heading[1]}</p></div>
      ${isRole('chef', 'admin') && mode !== 'pending' ? `<a class="btn btn-primary" href="#/nouvelle">${icon('plus')} Nouvelle autorisation</a>` : ''}</div>
    <div class="card">
      <div class="row mb">
        <input type="search" id="l-q" placeholder="Matricule, nom, prénom ou n°" style="max-width:320px">
        ${mode !== 'pending' ? `<select id="l-periode" style="max-width:200px"><option value="">Toutes dates</option><option value="aujourdhui">Aujourd'hui</option><option value="hier">Hier</option><option value="semaine">Cette semaine</option><option value="mois">Ce mois</option></select>` : ''}
      </div>
      ${mode !== 'pending' ? `<div class="chips mb" id="l-status">${STATUS_FILTERS.map(([v, l]) => `<button class="chip ${v === f.statut ? 'active' : ''}" data-s="${v}">${l}</button>`).join('')}</div>` : ''}
      <div id="l-body"></div>
    </div>`;
  const body = el.querySelector('#l-body');
  const load = async () => {
    try {
      const r = await get(`/api/authorizations${qs(f)}`);
      body.innerHTML = r.items.length ? `${authorizationTable(r.items, { decision: mode === 'pending' && isRole('rh', 'admin') })}${pager(r.total, r.page, r.size)}` : '<div class="empty">Aucune autorisation</div>';
    } catch (e) { body.innerHTML = `<div class="error-box">${esc(e.message)}</div>`; }
  };
  bindTable(body, load);
  body.addEventListener('click', (e) => { const p = e.target.closest('[data-page]'); if (p) { f.page = Number(p.dataset.page); load(); } });
  el.querySelector('#l-q').addEventListener('input', debounce((e) => { f.q = e.target.value; f.page = 1; load(); }, 250));
  const per = el.querySelector('#l-periode');
  if (per) per.addEventListener('change', () => { f.periode = per.value; f.page = 1; load(); });
  const chips = el.querySelector('#l-status');
  if (chips) chips.addEventListener('click', (e) => {
    const c = e.target.closest('[data-s]'); if (!c) return;
    f.statut = c.dataset.s; f.page = 1;
    chips.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === c));
    load();
  });
  await load();
  return on('authorization', debounce(load, 400));
}

export function authorizationTable(items, { decision = false } = {}) {
  return `<div class="table-wrap"><table class="table responsive"><thead><tr>
    <th>N°</th><th>Opérateur</th><th>Équipe</th><th>Créneau</th><th>Type</th><th>Statut</th><th>Chef d'équipe</th>${decision ? '<th></th>' : ''}</tr></thead><tbody>
    ${items.map((a) => `<tr class="clickable ${a.en_retard && a.statut === 'SORTIE_EFFECTUEE' ? 'late' : ''}" data-id="${a.id}">
      <td data-label="N°" class="mono nowrap hide-sm">${esc(a.numero)}</td>
      <td data-label="Opérateur" class="main-cell"><div class="emp">${avatar(a.employee_id, a.emp_photo, a.emp_prenom, a.emp_nom)}<div><div class="name"><span class="mat">${esc(a.matricule)}</span> ${esc(a.emp_nom)} ${esc(a.emp_prenom)}</div><div class="meta">${esc(a.service || '')}${a.equipe ? ` · ${esc(a.equipe)}` : ''}</div></div></div></td>
      <td data-label="Équipe" class="hide-sm">${esc(a.equipe || '—')}</td>
      <td data-label="Créneau" class="nowrap">${windowLabel(a)}</td>
      <td data-label="Type">${esc(a.type_sortie_label)}</td>
      <td data-label="Statut">${statusBadge(a.statut, { a })}</td>
      <td data-label="Chef" class="hide-sm">${esc(a.createur || '')}</td>
      ${decision ? `<td class="nowrap"><button class="btn btn-success btn-sm" data-ok="${a.id}">${icon('check')} Valider</button> <button class="btn btn-danger btn-sm" data-ko="${a.id}">Refuser</button></td>` : ''}
    </tr>`).join('')}</tbody></table></div>`;
}

export function bindTable(container, reload) {
  container.addEventListener('click', async (e) => {
    const ok = e.target.closest('[data-ok]'); const ko = e.target.closest('[data-ko]');
    if (ok) { e.stopPropagation(); if (await quickDecision(Number(ok.dataset.ok), 'approve')) reload(); return; }
    if (ko) { e.stopPropagation(); if (await quickDecision(Number(ko.dataset.ko), 'reject')) reload(); return; }
    const tr = e.target.closest('tr[data-id]');
    if (tr) navigate(`/autorisations/${tr.dataset.id}`);
  });
}

// ================================================================== DÉTAIL
export async function renderDetail(el, id) {
  const load = async () => {
    const a = await get(`/api/authorizations/${id}`);
    const u = state.user;
    const canDecide = isRole('rh', 'admin') && a.statut === 'EN_ATTENTE' && (a.created_by !== u.id || u.role === 'admin');
    const canSubmit = a.statut === 'BROUILLON' && (a.created_by === u.id || u.role === 'admin');
    const canCancel = ['BROUILLON', 'EN_ATTENTE', 'VALIDEE'].includes(a.statut) && (isRole('chef', 'admin') || (isRole('rh') && a.statut !== 'BROUILLON'));
    el.innerHTML = `
      <div class="page-head"><div><h1>Autorisation ${esc(a.numero)}</h1><p>Créée le ${fmtDateTime(a.created_at)} par ${esc(a.createur)}${a.cree_hors_horaires_rh ? ' <span class="tag">hors horaires RH</span>' : ''}</p></div>
        <div>${statusBadge(a.statut, { large: true, a })}</div></div>
      ${canDecide ? `<div class="card" style="border-left:5px solid var(--orange)"><div class="row"><div class="grow"><strong>Décision RH requise.</strong> Vérifiez les informations puis validez ou refusez.</div>
        <button class="btn btn-success btn-lg" data-approve>${icon('check')} VALIDER</button><button class="btn btn-danger btn-lg" data-reject>${icon('close')} REFUSER</button></div></div>` : ''}
      <div class="grid grid-2 mt">
        <div>
          <div class="card"><h2>Opérateur</h2>${employeeCard({ id: a.employee_id, photo: a.emp_photo, prenom: a.emp_prenom, nom: a.emp_nom, matricule: a.matricule, service: a.service, equipe: a.equipe, poste_nom: a.poste_nom, poste_debut: a.poste_debut, poste_fin: a.poste_fin })}</div>
          <div class="card"><h2>Sortie demandée</h2>
            <div class="kv">
              <div><span>Date</span><strong>${esc(dmy(a.date_sortie))}</strong></div>
              <div><span>Sortie prévue</span><strong>${esc(a.heure_sortie_prevue)}</strong></div>
              <div><span>Retour prévu</span><strong>${esc(a.heure_retour_prevue)}${a.retour_lendemain ? ` <span class="tag">le ${esc(dmy(a.date_retour))}</span>` : ''}</strong></div>
              <div><span>Durée prévue</span><strong>${esc(a.duree_prevue)}</strong></div>
              <div><span>Type</span><strong>${esc(a.type_sortie_label)}</strong></div>
              <div><span>Valable jusqu'au</span><strong>${fmtDateTime(a.fin_at)}</strong></div>
            </div>
            <div class="mt"><span class="muted">Motif</span><div><strong>${esc(a.motif)}</strong></div></div>
            ${a.commentaire ? `<div class="mt"><span class="muted">Commentaire du chef d'équipe</span><div>${esc(a.commentaire)}</div></div>` : ''}
            ${a.has_piece_jointe ? `<div class="mt"><a class="btn btn-sm" href="/api/authorizations/${a.id}/attachment" target="_blank" rel="noopener">${icon('attach')} ${esc(a.piece_jointe_nom)}</a></div>` : ''}
            ${a.dans_poste === false ? '<div class="info-box mt">Le créneau dépasse le poste habituel de l\'opérateur (information).</div>' : ''}
          </div>
          <div class="card"><h2>Décision</h2>
            ${a.approved_at ? `<p>${statusBadge('VALIDEE')} par <strong>${esc(a.valideur)}</strong> le ${fmtDateTime(a.approved_at)}</p>` : ''}
            ${a.rejected_at ? `<p>${statusBadge('REFUSEE')} par <strong>${esc(a.refuseur)}</strong> le ${fmtDateTime(a.rejected_at)}</p><div class="error-box">Autorisation refusée${a.motif_refus ? ` — motif : ${esc(a.motif_refus)}` : ''}</div>` : ''}
            ${a.cancelled_at ? `<p>${statusBadge('ANNULEE')} par <strong>${esc(a.annuleur)}</strong> le ${fmtDateTime(a.cancelled_at)}${a.motif_annulation ? ` — ${esc(a.motif_annulation)}` : ''}</p>` : ''}
            ${a.expired_at ? `<p>${statusBadge('EXPIREE')} le ${fmtDateTime(a.expired_at)} (période dépassée)</p>` : ''}
            ${a.commentaire_rh ? `<div class="mt"><span class="muted">Commentaire RH</span><div>${esc(a.commentaire_rh)}</div></div>` : ''}
            ${!a.approved_at && !a.rejected_at && !a.cancelled_at && !a.expired_at ? '<p class="muted">En attente de décision.</p>' : ''}
          </div>
          <div class="card"><h2>Poste de garde</h2>
            ${a.heure_sortie_reelle ? `<div class="kv">
              <div><span>Sortie réelle</span><strong>${fmtDateTime(a.heure_sortie_reelle)}</strong></div>
              <div><span>Gardien</span><strong>${esc(a.gardien_sortie)}</strong></div>
              <div><span>Poste de garde</span><strong>${esc(a.poste_garde_sortie || '')}</strong></div>
              <div><span>Retour réel</span><strong>${a.heure_retour_reel ? fmtDateTime(a.heure_retour_reel) : '<span class="status st-EXTERIEUR">À l\'extérieur</span>'}</strong></div>
              ${a.heure_retour_reel ? `<div><span>Gardien (retour)</span><strong>${esc(a.gardien_retour)}</strong></div><div><span>Poste (retour)</span><strong>${esc(a.poste_garde_retour || '')}</strong></div>` : ''}
              <div><span>Durée réelle</span><strong>${esc(a.duree_reelle)}${a.en_retard ? ' <span class="tag tag-red">retard</span>' : ''}</strong></div>
            </div>` : '<p class="muted">Aucun passage enregistré.</p>'}
          </div>
          ${canSubmit || canCancel ? `<div class="row mt">${canSubmit ? `<button class="btn btn-primary" data-submit>${icon('check')} Envoyer au RH</button>` : ''}${canCancel ? `<button class="btn btn-danger" data-cancel>${icon('close')} Annuler la demande</button>` : ''}</div>` : ''}
        </div>
        <div class="card"><h2>Historique complet</h2>
          <ul class="timeline">${a.timeline.map((t) => {
            const cls = /VALIDEE|RETOUR_CONFIRME/.test(t.action) ? 't-ok' : /REFUSEE|ANNULEE|EXPIREE|RETARD/.test(t.action) ? 't-ko' : /SORTIE|CONTROLE/.test(t.action) ? 't-gate' : t.role === 'systeme' ? 't-sys' : '';
            return `<li class="${cls}"><div class="when">${esc(dmy(t.date))} ${esc(t.heure.slice(0, 5))}</div><div class="what">${esc(actionLabel(t.action))}</div>
              <div class="who">${esc(t.username)}${t.role && t.role !== 'systeme' ? ` · ${esc(state.settings.roles[t.role] || t.role)}` : ''}${detailOf(t)}</div></li>`;
          }).join('')}</ul>
          <small class="muted">Journal infalsifiable : chaque action est enregistrée et ne peut être supprimée.</small>
        </div>
      </div>`;
    const btn = (sel, fn) => { const b = el.querySelector(sel); if (b) b.addEventListener('click', fn); };
    btn('[data-approve]', async () => { if (await quickDecision(a.id, 'approve')) load(); });
    btn('[data-reject]', async () => { if (await quickDecision(a.id, 'reject')) load(); });
    btn('[data-submit]', async () => { try { await post(`/api/authorizations/${a.id}/submit`); toast('Demande envoyée au RH', 'success'); load(); } catch (e) { toastError(e); } });
    btn('[data-cancel]', async () => {
      const motif = await promptDialog('Annuler la demande', { label: "Motif de l'annulation (facultatif)", confirmLabel: 'Annuler la demande', danger: true });
      if (motif === null) return;
      try { await post(`/api/authorizations/${a.id}/cancel`, { motif }); toast('Demande annulée', 'success'); load(); } catch (e) { toastError(e); }
    });
  };
  await load();
  return on('authorization', (d) => { if (!d || d.reconnect || d.id === id) load().catch(() => {}); });
}

function detailOf(t) {
  if (!t.nouvelle_valeur) return '';
  try {
    const v = JSON.parse(t.nouvelle_valeur);
    const parts = [];
    if (v.motif_refus) parts.push(`motif : ${v.motif_refus}`);
    if (v.commentaire_rh) parts.push(`commentaire : ${v.commentaire_rh}`);
    if (v.motif_annulation) parts.push(v.motif_annulation);
    if (v.poste_garde) parts.push(v.poste_garde);
    if (v.duree) parts.push(`durée ${v.duree}`);
    if (v.verdict) parts.push(`résultat : ${v.verdict.replace(/_/g, ' ').toLowerCase()}`);
    if (v.destinataires) parts.push(`${v.destinataires} destinataire(s) : ${(v.roles || []).map((r) => state.settings.roles[r] || r).join(', ')}`);
    return parts.length ? ` — ${esc(parts.join(' · '))}` : '';
  } catch { return ''; }
}

// ================================================================== MON ÉQUIPE (chef)
export async function renderTeam(el) {
  const [teams, emps, outside] = await Promise.all([get('/api/teams?mine=1'), get('/api/employees?actif=1'), get('/api/outside')]);
  const outIds = new Set(outside.map((a) => a.employee_id));
  el.innerHTML = `<div class="page-head"><div><h1>Mon équipe</h1><p>${teams.map((t) => `${esc(t.nom)} — ${esc(t.poste_nom || '')} ${t.heure_debut ? `(${esc(t.heure_debut)}–${esc(t.heure_fin)})` : ''}`).join(' · ') || 'Aucune équipe associée'}</p></div></div>
    <div class="card"><div class="row mb"><input type="search" id="t-q" placeholder="Filtrer par matricule ou nom" style="max-width:320px"><span class="muted" id="t-count"></span></div>
    <div class="table-wrap"><table class="table responsive"><thead><tr><th>Opérateur</th><th>Service</th><th>Équipe</th><th>Poste</th><th>Situation</th><th></th></tr></thead><tbody id="t-body"></tbody></table></div></div>`;
  const draw = (q = '') => {
    const ql = q.toLowerCase();
    const list = emps.filter((e) => !ql || `${e.matricule} ${e.nom} ${e.prenom}`.toLowerCase().includes(ql));
    el.querySelector('#t-count').textContent = `${list.length} opérateur(s)`;
    el.querySelector('#t-body').innerHTML = list.map((e) => `<tr>
      <td class="main-cell"><div class="emp">${avatar(e.id, e.photo, e.prenom, e.nom)}<div><div class="name"><span class="mat">${esc(e.matricule)}</span> ${esc(e.nom)} ${esc(e.prenom)}</div></div></div></td>
      <td data-label="Service">${esc(e.service || '—')}</td><td data-label="Équipe">${esc(e.equipe || '—')}</td>
      <td data-label="Poste">${posteLabel(e.poste_nom, e.poste_debut, e.poste_fin)}</td>
      <td data-label="Situation">${outIds.has(e.id) ? '<span class="status st-EXTERIEUR">À l\'extérieur</span>' : '<span class="muted">Sur site</span>'}</td>
      <td class="right"><a class="btn btn-sm btn-primary" href="#/nouvelle?employee=${e.id}">${icon('plus')} Autorisation</a></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Aucun opérateur</td></tr>';
  };
  el.querySelector('#t-q').addEventListener('input', (e) => draw(e.target.value));
  draw();
}


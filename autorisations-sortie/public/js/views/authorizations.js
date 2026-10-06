// Autorisations : création (chef d'équipe), listes, détail, validation/refus (RH), annulation.
import { get, post, qs, on } from '../api.js';
import { state, isRole, serverNow } from '../state.js';
import {
  esc, icon, statusBadge, windowLabel, avatar, posteLabel, fmtDateTime, dmy, toast, toastError, modal,
  promptDialog, debounce, localDateStr, localTimeStr, addDays, toMin, duration, fileToBase64, pager, actionLabel, navigate,
} from '../ui.js';

// ================================================================== NOUVELLE AUTORISATION
export async function renderNew(el) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  let employee = null;
  if (params.get('employee')) {
    try { employee = await get(`/api/employees/${Number(params.get('employee'))}`); } catch (e) { toastError(e); }
  }
  if (employee) renderForm(el, employee); else renderStep1(el);
}

function renderStep1(el) {
  el.innerHTML = `
    <div class="card">
      <div class="field"><label for="emp-q">Qui sort ? Matricule ou nom</label>
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
        <div class="meta">${esc(e.equipe || '—')} · ${posteLabel(e.poste_nom, e.poste_debut, e.poste_fin)}</div></div>
        ${icon('plus')}</button>`).join('') : `<div class="empty">Aucun opérateur trouvé${isRole('chef') ? ' dans vos affectations' : ''}.</div>`;
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
      <div><span>Affectation</span><strong>${esc(e.equipe || '—')}</strong></div>
      <div><span>Poste</span><strong>${posteLabel(e.poste_nom, e.poste_debut, e.poste_fin)}</strong></div>
    </div></div>`;
}

function roundedNow(addMin = 0) {
  const now = serverNow();
  const t = toMin(localTimeStr(now)) + addMin;
  const r = Math.ceil(t / 5) * 5;
  return { time: `${String(Math.floor(r / 60) % 24).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`, nextDay: r >= 1440 };
}

const MOTIF_CHIPS = [
  { label: 'Personnel', type: 'PERSONNELLE' },
  { label: 'Rendez-vous médical', type: 'RENDEZ_VOUS' },
  { label: 'Maladie', type: 'URGENCE' },
  { label: 'Urgence familiale', type: 'URGENCE' },
  { label: 'Mission professionnelle', type: 'PROFESSIONNELLE' },
  { label: 'Autre', type: 'AUTRE' },
];

function renderForm(el, emp) {
  const s = state.settings;
  const start = roundedNow(5);
  const end = roundedNow(65);
  const today = localDateStr();
  let type = 'PERSONNELLE';
  let avecRetour = true;
  el.innerHTML = `
    <div class="card f-emp">${avatar(emp.id, emp.photo, emp.prenom, emp.nom)}
      <div class="grow"><div class="name"><span class="mat">${esc(emp.matricule)}</span> ${esc(emp.prenom)} ${esc(emp.nom)}</div>
      <div class="meta">${esc(emp.equipe || '')} · ${posteLabel(emp.poste_nom, emp.poste_debut, emp.poste_fin)}</div></div>
      <button class="btn btn-sm" data-change type="button">Changer</button></div>
    <form class="card" id="auth-form" novalidate>
      <label>L'opérateur revient-il ?</label>
      <div class="f-choice" id="retour-choice">
        <button type="button" data-r="1" class="active">↩ AVEC RETOUR<small>sort puis revient</small></button>
        <button type="button" data-r="0">✖ SANS RETOUR<small>quitte son poste</small></button>
      </div>
      <div class="f-times">
        <div class="field"><label for="f-hs">Heure de sortie</label><input id="f-hs" type="time" value="${start.time}" required></div>
        <div class="field" id="f-hr-field"><label for="f-hr">Heure de retour</label><input id="f-hr" type="time" value="${end.time}" required></div>
      </div>
      <div id="preview" class="mb"></div>
      <label>Motif</label>
      <div class="chips f-motifs" id="motifs">${MOTIF_CHIPS.map((m, i) => `<button type="button" class="chip" data-i="${i}">${esc(m.label)}</button>`).join('')}</div>
      <div class="field mt"><input id="f-motif" type="text" maxlength="500" placeholder="Motif (choisir ci-dessus ou écrire)"></div>
      <details class="mb"><summary class="muted" style="cursor:pointer">Plus d'options (date, commentaire${s.pieces_jointes_actives ? ', pièce jointe' : ''})</summary>
        <div class="field mt"><label for="f-date">Date de sortie</label><input id="f-date" type="date" value="${start.nextDay ? addDays(today, 1) : today}"></div>
        <div class="field"><label for="f-comment">Commentaire</label><textarea id="f-comment" maxlength="1000" rows="2"></textarea></div>
        ${s.pieces_jointes_actives ? '<div class="field"><label for="f-file">Pièce jointe (PDF ou photo, 5 Mo max.)</label><input id="f-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp"></div>' : ''}
      </details>
      <button type="submit" class="btn btn-${s.validation_rh_requise ? 'primary' : 'success'} btn-lg btn-block">${icon('check')} ${s.validation_rh_requise ? 'ENVOYER AU RH' : 'AUTORISER LA SORTIE'}</button>
      ${s.validation_rh_requise ? '' : '<p class="muted center" style="margin:8px 0 0">Le gardien est prévenu immédiatement.</p>'}
    </form>`;
  const f = (id) => el.querySelector(id);
  let adjusted = false;
  const fmtDay = (d) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
  const preview = () => {
    const date = f('#f-date').value; const hs = f('#f-hs').value; const hr = f('#f-hr').value;
    if (!date || !hs || (avecRetour && !hr)) { f('#preview').innerHTML = ''; return; }
    const nowDate = localDateStr(); const nowMin = toMin(localTimeStr());
    // Sortie après minuit saisie le soir : le créneau du jour est passé → lendemain automatiquement.
    if (!adjusted && date === nowDate && nowMin - toMin(hs) > 120) { f('#f-date').value = addDays(nowDate, 1); adjusted = true; preview(); return; }
    const warn = [];
    if (adjusted) warn.push(`Date mise au lendemain (${dmy(f('#f-date').value)}) : sortie après minuit.`);
    let line;
    if (!avecRetour) {
      line = `<strong>${esc(fmtDay(date))} à ${esc(hs)}</strong> — ne revient pas${emp.poste_fin ? ` (valable jusqu'à la fin du poste, ${esc(emp.poste_fin)})` : ''}`;
    } else {
      if (hs === hr) { f('#preview').innerHTML = '<div class="error-box">Le retour doit être différent de la sortie.</div>'; return; }
      const nextDay = toMin(hr) < toMin(hs);
      const dur = nextDay ? 1440 - toMin(hs) + toMin(hr) : toMin(hr) - toMin(hs);
      if (dur > s.duree_max_heures * 60) warn.push(`Durée supérieure au maximum (${s.duree_max_heures} h).`);
      line = `<strong>${esc(fmtDay(date))} ${esc(hs)} → ${nextDay ? `${esc(fmtDay(addDays(date, 1)))} ` : ''}${esc(hr)}</strong> · ${duration(dur)}`;
    }
    f('#preview').innerHTML = `<div class="info-box">${line}</div>${warn.map((w) => `<div class="warn-box mt">${esc(w)}</div>`).join('')}`;
  };
  ['#f-date', '#f-hs', '#f-hr'].forEach((id) => { f(id).addEventListener('change', () => { if (id === '#f-date') adjusted = true; preview(); }); f(id).addEventListener('input', preview); });
  preview();
  f('#retour-choice').addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    avecRetour = b.dataset.r === '1';
    f('#retour-choice').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    f('#f-hr-field').hidden = !avecRetour;
    preview();
  });
  f('#motifs').addEventListener('click', (e) => {
    const c = e.target.closest('[data-i]'); if (!c) return;
    const m = MOTIF_CHIPS[Number(c.dataset.i)];
    type = m.type;
    f('#motifs').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === c));
    f('#f-motif').value = m.type === 'AUTRE' ? '' : m.label;
    if (m.type === 'AUTRE') f('#f-motif').focus();
  });
  el.querySelector('[data-change]').addEventListener('click', () => renderStep1(el));

  f('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const motif = f('#f-motif').value.trim();
    if (!motif) { toast('Choisissez ou écrivez le motif', 'warning'); f('#f-motif').focus(); return; }
    const body = {
      employee_id: emp.id, date_sortie: f('#f-date').value, heure_sortie_prevue: f('#f-hs').value,
      avec_retour: avecRetour, heure_retour_prevue: avecRetour ? f('#f-hr').value : null,
      type_sortie: type, motif, commentaire: f('#f-comment').value, submit: true,
    };
    const file = f('#f-file') && f('#f-file').files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { toast('Pièce jointe trop volumineuse (5 Mo max.)', 'warning'); return; }
      body.piece_jointe = { name: file.name, type: file.type, data: await fileToBase64(file) };
    }
    const btn = f('#auth-form').querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const a = await post('/api/authorizations', body);
      toast(a.statut === 'VALIDEE' ? `Sortie autorisée (${a.numero}) — le gardien est prévenu` : `Demande envoyée au RH (${a.numero})`, 'success');
      navigate('/mes-demandes');
    } catch (err) { toastError(err); btn.disabled = false; }
  });
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
  ['', 'Tous'], ['EN_ATTENTE', 'En attente'], ['VALIDEE', 'Validées'], ['SORTIE_EFFECTUEE', 'Dehors'], ['RETOUR_EFFECTUE', 'Rentrés'], ['SORTIE_DEFINITIVE', 'Sans retour'],
  ['REFUSEE', 'Refusées'], ['EXPIREE', 'Expirées'], ['ANNULEE', 'Annulées'], ['BROUILLON', 'Brouillons'],
];

export async function renderList(el, { mode }) {
  const f = { page: 1, size: 25, statut: mode === 'pending' ? 'EN_ATTENTE' : '', q: '', periode: '', mine: mode === 'mine' ? '1' : '', sort: mode === 'pending' ? 'asc' : '' };
  const heading = { mine: ['Mes autorisations', 'Autorisations que vous avez données et leur suivi en temps réel.'], pending: ['Demandes en attente', 'Ouvrir → Vérifier → Valider / Refuser. Traitement possible 24 h/24.'], all: ['Autorisations', isRole('chef') ? 'Autorisations de vos équipes.' : 'Toutes les autorisations.'] }[mode];
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
    <th>N°</th><th>Opérateur</th><th>Affectation</th><th>Créneau</th><th>Type</th><th>Statut</th><th>Chef d'équipe</th>${decision ? '<th></th>' : ''}</tr></thead><tbody>
    ${items.map((a) => `<tr class="clickable ${a.en_retard && a.statut === 'SORTIE_EFFECTUEE' ? 'late' : ''}" data-id="${a.id}">
      <td data-label="N°" class="mono nowrap hide-sm">${esc(a.numero)}</td>
      <td data-label="Opérateur" class="main-cell"><div class="emp">${avatar(a.employee_id, a.emp_photo, a.emp_prenom, a.emp_nom)}<div><div class="name"><span class="mat">${esc(a.matricule)}</span> ${esc(a.emp_nom)} ${esc(a.emp_prenom)}</div><div class="meta">${esc(a.service || '')}${a.equipe ? ` · ${esc(a.equipe)}` : ''}</div></div></div></td>
      <td data-label="Affectation" class="hide-sm">${esc(a.equipe || '—')}</td>
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
              <div><span>Retour prévu</span><strong>${a.avec_retour ? `${esc(a.heure_retour_prevue)}${a.retour_lendemain ? ` <span class="tag">le ${esc(dmy(a.date_retour))}</span>` : ''}` : '<span class="status st-SORTIE_DEFINITIVE">Sans retour</span>'}</strong></div>
              ${a.avec_retour ? `<div><span>Durée prévue</span><strong>${esc(a.duree_prevue)}</strong></div>` : ''}
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
              ${a.avec_retour ? `<div><span>Retour réel</span><strong>${a.heure_retour_reel ? fmtDateTime(a.heure_retour_reel) : '<span class="status st-EXTERIEUR">À l\'extérieur</span>'}</strong></div>` : '<div><span>Retour</span><strong>Sans retour</strong></div>'}
              ${a.heure_retour_reel ? `<div><span>Gardien (retour)</span><strong>${esc(a.gardien_retour)}</strong></div><div><span>Poste (retour)</span><strong>${esc(a.poste_garde_retour || '')}</strong></div>` : ''}
              <div ${a.avec_retour ? '' : 'hidden'}><span>Durée réelle</span><strong>${esc(a.duree_reelle)}${a.en_retard ? ' <span class="tag tag-red">retard</span>' : ''}</strong></div>
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
  el.innerHTML = `<div class="page-head"><div><h1>Mon personnel</h1><p>${teams.map((t) => `${esc(t.nom)} — ${esc(t.poste_nom || '')} ${t.heure_debut ? `(${esc(t.heure_debut)}–${esc(t.heure_fin)})` : ''}`).join(' · ') || 'Aucune affectation associée'}</p></div></div>
    <div class="card"><div class="row mb"><input type="search" id="t-q" placeholder="Filtrer par matricule ou nom" style="max-width:320px"><span class="muted" id="t-count"></span></div>
    <div class="table-wrap"><table class="table responsive"><thead><tr><th>Opérateur</th><th>Service</th><th>Affectation</th><th>Poste</th><th>Situation</th><th></th></tr></thead><tbody id="t-body"></tbody></table></div></div>`;
  const draw = (q = '') => {
    const ql = q.toLowerCase();
    const list = emps.filter((e) => !ql || `${e.matricule} ${e.nom} ${e.prenom}`.toLowerCase().includes(ql));
    el.querySelector('#t-count').textContent = `${list.length} opérateur(s)`;
    el.querySelector('#t-body').innerHTML = list.map((e) => `<tr>
      <td class="main-cell"><div class="emp">${avatar(e.id, e.photo, e.prenom, e.nom)}<div><div class="name"><span class="mat">${esc(e.matricule)}</span> ${esc(e.nom)} ${esc(e.prenom)}</div></div></div></td>
      <td data-label="Service">${esc(e.service || '—')}</td><td data-label="Affectation">${esc(e.equipe || '—')}</td>
      <td data-label="Poste">${posteLabel(e.poste_nom, e.poste_debut, e.poste_fin)}</td>
      <td data-label="Situation">${outIds.has(e.id) ? '<span class="status st-EXTERIEUR">À l\'extérieur</span>' : '<span class="muted">Sur site</span>'}</td>
      <td class="right"><a class="btn btn-sm btn-primary" href="#/nouvelle?employee=${e.id}">${icon('plus')} Autorisation</a></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Aucun opérateur</td></tr>';
  };
  el.querySelector('#t-q').addEventListener('input', (e) => draw(e.target.value));
  draw();
}


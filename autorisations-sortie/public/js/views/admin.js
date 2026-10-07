// Administration : utilisateurs, opérateurs, matricules/QR, affectations, services, horaires, journal d'audit, paramètres.
import { get, post, put, del, qs } from '../api.js';
import { state } from '../state.js';
import {
  esc, icon, avatar, posteLabel, fmtDateTime, toast, toastError, modal, confirmDialog, selectOptions, debounce, fileToBase64, pager, actionLabel, dmy,
} from '../ui.js';

// ------------------------------------------------------------------ formulaire générique
function fieldHtml(f, v) {
  const val = v ?? f.default ?? '';
  const id = `ff-${f.name}`;
  if (f.type === 'checkbox') return `<div class="field"><label class="check"><input type="checkbox" id="${id}" name="${f.name}" ${val ? 'checked' : ''}> ${esc(f.label)}</label>${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
  const input = f.type === 'select'
    ? `<select id="${id}" name="${f.name}">${selectOptions(f.options, val, { empty: f.empty ?? null, label: f.optionLabel || 'nom', value: f.optionValue || 'id' })}</select>`
    : f.type === 'textarea'
      ? `<textarea id="${id}" name="${f.name}" rows="6">${esc(val)}</textarea>`
      : `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(val)}" ${f.required ? 'required' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ''}>`;
  return `<div class="field"><label for="${id}">${esc(f.label)}${f.required ? '' : ' <span class="muted">(facultatif)</span>'}</label>${input}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
}

function formModal(title, fields, values = {}, onSubmit, { wide = false } = {}) {
  return modal({
    title, wide,
    body: `<div class="form-grid">${fields.map((f) => fieldHtml(f, values[f.name])).join('')}</div>`,
    actions: [{ label: 'Annuler', value: null }, {
      label: 'Enregistrer', class: 'btn-primary',
      onClick: async (b) => {
        const data = {};
        for (const f of fields) {
          const elx = b.querySelector(`[name="${f.name}"]`);
          if (!elx) continue;
          data[f.name] = f.type === 'checkbox' ? elx.checked : elx.value.trim();
          if (f.required && !data[f.name]) { toast(`« ${f.label} » est obligatoire`, 'warning'); elx.focus(); return false; }
        }
        return onSubmit(data);
      },
    }],
  });
}

const DUREES = [[0, 'Jamais — toujours connecté'], [20, '20 minutes'], [60, '1 heure'], [480, '8 heures'], [1440, '24 heures'], [10080, '7 jours'], [43200, '30 jours']];
function dureeOptions(current) {
  const list = DUREES.some(([v]) => v === current) ? DUREES : [[current, `${current} minutes`], ...DUREES];
  return list.map(([v, l]) => `<option value="${v}" ${v === current ? 'selected' : ''}>${l}</option>`).join('');
}

function pageHead(title, desc, btn = '') {
  return `<div class="page-head"><div><h1>${esc(title)}</h1>${desc ? `<p>${desc}</p>` : ''}</div>${btn}</div>`;
}

const yesNo = (v) => (v ? '<span class="status st-VALIDEE">Actif</span>' : '<span class="status st-ANNULEE">Inactif</span>');

async function removeItem(url, label) {
  if (!await confirmDialog('Supprimer', `Supprimer ${label} ? Si des données historiques y sont liées, l'élément sera désactivé au lieu d'être supprimé.`, { confirmLabel: 'Supprimer', danger: true })) return false;
  const r = await del(url);
  toast(r.deleted ? 'Supprimé' : r.message, r.deleted ? 'success' : 'warning', { timeout: 7000 });
  return true;
}

function showPassword(user, pwd) {
  return modal({
    title: 'Mot de passe temporaire',
    body: `<p>Communiquez ce mot de passe à <strong>${esc(user)}</strong>. Il devra le changer à sa première connexion.</p>
      <div class="card center"><span class="mono" style="font-size:1.4rem;font-weight:800;user-select:all">${esc(pwd)}</span></div>
      <p class="muted">Ce mot de passe ne sera plus affiché.</p>`,
    actions: [{ label: 'Fermer', class: 'btn-primary', value: true }],
  });
}

// ================================================================== UTILISATEURS
export async function renderUsers(el) {
  const teams = await get('/api/teams');
  const roles = Object.entries(state.settings.roles).map(([id, nom]) => ({ id, nom }));
  const postes = state.settings.postes_garde.map((p) => ({ id: p, nom: p }));
  const fields = (isNew) => [
    { name: 'nom', label: 'Nom', required: true }, { name: 'prenom', label: 'Prénom', required: true },
    { name: 'username', label: 'Identifiant de connexion', required: true, autocomplete: 'off', hint: 'Lettres minuscules, chiffres, . _ -' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'role', label: 'Rôle', type: 'select', options: roles, required: true },
    { name: 'team_id', label: "Équipe (chef d'équipe)", type: 'select', options: teams, empty: '—' },
    { name: 'poste_garde', label: 'Poste de garde (gardien)', type: 'select', options: postes, empty: '—' },
    ...(isNew ? [{ name: 'password', label: 'Mot de passe initial', type: 'password', autocomplete: 'new-password', hint: 'Laisser vide pour générer un mot de passe temporaire.' }] : []),
    { name: 'droit_toutes_equipes', label: 'Droit spécial : autoriser le personnel de toutes les affectations', type: 'checkbox' },
    { name: 'actif', label: 'Compte actif', type: 'checkbox', default: true },
  ];
  const load = async () => {
    const users = await get('/api/users');
    el.innerHTML = `${pageHead('Utilisateurs', 'Comptes et rôles : administrateur, chef d\'équipe, RH / responsable, gardien.', `<button class="btn btn-primary" data-new>${icon('plus')} Nouvel utilisateur</button>`)}
      <div class="card"><div class="table-wrap"><table class="table responsive"><thead><tr><th>Nom</th><th>Identifiant</th><th>Rôle</th><th>Affectation / poste</th><th>Dernière connexion</th><th>État</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr><td class="main-cell"><strong>${esc(u.prenom)} ${esc(u.nom)}</strong>${u.droit_toutes_equipes ? ' <span class="tag">toutes affectations</span>' : ''}</td>
        <td data-label="Identifiant" class="mono">${esc(u.username)}</td><td data-label="Rôle">${esc(state.settings.roles[u.role])}</td>
        <td data-label="Affectation">${esc(u.equipe || u.poste_garde || '—')}</td><td data-label="Connexion">${u.last_login_at ? fmtDateTime(u.last_login_at) : '—'}</td>
        <td data-label="État">${yesNo(u.actif)}${u.locked ? ' <span class="tag tag-red">verrouillé</span>' : ''}${u.must_change_password ? ' <span class="tag tag-warn">mdp à changer</span>' : ''}</td>
        <td class="right nowrap"><button class="btn btn-sm" data-edit="${u.id}">${icon('edit')}</button> <button class="btn btn-sm" data-reset="${u.id}" title="Réinitialiser le mot de passe">${icon('key')}</button>
          ${u.locked ? `<button class="btn btn-sm" data-unlock="${u.id}">Déverrouiller</button>` : ''} ${u.id !== state.user.id ? `<button class="btn btn-sm" data-del="${u.id}">${icon('trash')}</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div></div>`;
    el.querySelector('[data-new]').onclick = () => formModal('Nouvel utilisateur', fields(true), { actif: true }, async (d) => {
      const r = await post('/api/users', d);
      toast('Utilisateur créé', 'success');
      if (r.temporary_password) await showPassword(r.user.username, r.temporary_password);
      load();
    });
    el.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => { const u = users.find((x) => x.id === Number(b.dataset.edit)); formModal(`Modifier ${u.prenom} ${u.nom}`, fields(false), u, async (d) => { await put(`/api/users/${u.id}`, d); toast('Utilisateur modifié', 'success'); load(); }); }; });
    el.querySelectorAll('[data-reset]').forEach((b) => { b.onclick = async () => {
      const u = users.find((x) => x.id === Number(b.dataset.reset));
      if (!await confirmDialog('Réinitialiser le mot de passe', `Générer un nouveau mot de passe temporaire pour ${u.prenom} ${u.nom} ? Ses sessions seront fermées.`)) return;
      try { const r = await post(`/api/users/${u.id}/reset-password`); await showPassword(u.username, r.temporary_password); load(); } catch (e) { toastError(e); }
    }; });
    el.querySelectorAll('[data-unlock]').forEach((b) => { b.onclick = async () => { await post(`/api/users/${b.dataset.unlock}/unlock`); toast('Compte déverrouillé', 'success'); load(); }; });
    el.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { try { if (await removeItem(`/api/users/${b.dataset.del}`, 'cet utilisateur')) load(); } catch (e) { toastError(e); } }; });
  };
  await load();
}

// ================================================================== OPÉRATEURS
export async function renderEmployees(el) {
  const [services, teams, shifts] = await Promise.all([get('/api/services'), get('/api/teams'), get('/api/shifts')]);
  const shiftLabel = (s) => `${s.nom} (${s.heure_debut}–${s.heure_fin})`;
  const fields = [
    { name: 'matricule', label: 'Matricule', required: true }, { name: 'nom', label: 'Nom', required: true }, { name: 'prenom', label: 'Prénom', required: true },
    { name: 'service_id', label: 'Service', type: 'select', options: services, empty: '—' },
    { name: 'team_id', label: 'Affectation', type: 'select', options: teams, empty: '—' },
    { name: 'shift_id', label: 'Poste', type: 'select', options: shifts, empty: '—', optionLabel: shiftLabel },
    { name: 'telephone', label: 'Téléphone', type: 'tel' },
    { name: 'actif', label: 'Opérateur actif', type: 'checkbox', default: true },
  ];
  const f = { q: '', team_id: '', service_id: '', actif: '' };
  el.innerHTML = `${pageHead('Opérateurs', 'Ouvriers et opérateurs (sans compte utilisateur) : matricule, affectation, service, poste, photo.', `<div class="row"><a class="btn" href="#/admin/matricules">${icon('qr')} Badges QR / import</a><button class="btn btn-primary" data-new>${icon('plus')} Nouvel opérateur</button></div>`)}
    <div class="card"><div class="row mb">
      <input type="search" id="e-q" placeholder="Matricule, nom, prénom" style="max-width:280px">
      <select id="e-team" style="max-width:200px">${selectOptions(teams, '', { empty: 'Toutes les affectations' })}</select>
      <select id="e-service" style="max-width:200px">${selectOptions(services, '', { empty: 'Tous les services' })}</select>
      <select id="e-actif" style="max-width:160px"><option value="">Actifs et inactifs</option><option value="1">Actifs</option><option value="0">Inactifs</option></select>
      <span class="muted" id="e-count"></span></div><div id="e-body"></div></div>`;
  const body = el.querySelector('#e-body');
  let list = [];
  const load = async () => {
    list = await get(`/api/employees${qs({ ...f, limit: 1000 })}`);
    el.querySelector('#e-count').textContent = `${list.length} opérateur(s)`;
    body.innerHTML = `<div class="table-wrap"><table class="table responsive"><thead><tr><th>Opérateur</th><th>Service</th><th>Affectation</th><th>Poste</th><th>Téléphone</th><th>État</th><th></th></tr></thead><tbody>
      ${list.map((e) => `<tr><td class="main-cell"><div class="emp">${avatar(e.id, e.photo, e.prenom, e.nom)}<div><div class="name"><span class="mat">${esc(e.matricule)}</span> ${esc(e.nom)} ${esc(e.prenom)}</div></div></div></td>
        <td data-label="Service">${esc(e.service || '—')}</td><td data-label="Affectation">${esc(e.equipe || '—')}</td><td data-label="Poste">${posteLabel(e.poste_nom, e.poste_debut, e.poste_fin)}</td>
        <td data-label="Tél.">${esc(e.telephone || '')}</td><td data-label="État">${yesNo(e.actif)}</td>
        <td class="right nowrap"><button class="btn btn-sm" data-edit="${e.id}">${icon('edit')}</button> <button class="btn btn-sm" data-photo="${e.id}" title="Photo">${icon('upload')}</button> <button class="btn btn-sm" data-qr="${e.id}" title="QR code">${icon('qr')}</button> <button class="btn btn-sm" data-del="${e.id}">${icon('trash')}</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Aucun opérateur</td></tr>'}
      </tbody></table></div>`;
  };
  const deb = debounce(() => load().catch(toastError), 250);
  el.querySelector('#e-q').oninput = (e) => { f.q = e.target.value; deb(); };
  el.querySelector('#e-team').onchange = (e) => { f.team_id = e.target.value; deb(); };
  el.querySelector('#e-service').onchange = (e) => { f.service_id = e.target.value; deb(); };
  el.querySelector('#e-actif').onchange = (e) => { f.actif = e.target.value; deb(); };
  el.querySelector('[data-new]').onclick = () => formModal('Nouvel opérateur', fields, { actif: true }, async (d) => { await post('/api/employees', d); toast('Opérateur créé', 'success'); load(); });
  body.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    const e = list.find((x) => x.id === Number(b.dataset.edit || b.dataset.photo || b.dataset.qr || b.dataset.del));
    if (!e) return;
    try {
      if (b.dataset.edit) await formModal(`Modifier ${e.matricule}`, fields, e, async (d) => { await put(`/api/employees/${e.id}`, d); toast('Opérateur modifié', 'success'); load(); });
      if (b.dataset.del && await removeItem(`/api/employees/${e.id}`, `l'opérateur ${e.matricule}`)) load();
      if (b.dataset.qr) await qrModal(e);
      if (b.dataset.photo) {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/jpeg,image/png,image/webp';
        inp.onchange = async () => {
          const file = inp.files[0]; if (!file) return;
          try { await post(`/api/employees/${e.id}/photo`, { type: file.type, data: await fileToBase64(file) }); toast('Photo enregistrée', 'success'); load(); } catch (err) { toastError(err); }
        };
        inp.click();
      }
    } catch (err) { toastError(err); }
  });
  await load();
}

function qrModal(e) {
  return modal({
    title: `QR code — ${e.matricule}`,
    body: `<div class="center"><img src="/api/employees/${e.id}/qr.svg?t=${Date.now()}" alt="QR code" style="width:240px;height:240px"><h3>${esc(e.prenom)} ${esc(e.nom)}</h3><p class="mono">MAT. ${esc(e.matricule)}</p>
      <p class="muted">Le QR code permet uniquement d'identifier l'opérateur au poste de garde. Il ne permet aucune modification.</p>
      <p class="muted">Scannable avec l'appareil photo du téléphone du gardien (connecté à l'application). Adresse : <span class="mono" id="qr-addr"></span></p></div>`,
    onOpen: (b) => { get('/api/badge-address').then((r) => { b.querySelector('#qr-addr').textContent = r.adresse; }).catch(() => {}); },
    actions: [
      { label: 'Régénérer (badge perdu)', class: 'btn-danger', onClick: async () => { if (!await confirmDialog('Régénérer le QR code', "L'ancien badge ne sera plus reconnu. Continuer ?", { danger: true })) return false; await post(`/api/employees/${e.id}/regenerate-qr`); toast('Nouveau QR code généré', 'success'); return true; } },
      { label: 'Imprimer', onClick: () => { window.print(); return false; } },
      { label: 'Fermer', class: 'btn-primary', value: true },
    ],
  });
}

// ================================================================== MATRICULES & QR
export async function renderMatricules(el) {
  const teams = await get('/api/teams');
  el.innerHTML = `${pageHead('Matricules & QR codes', 'Badges QR à imprimer pour l\'identification rapide au poste de garde, et import des opérateurs.', `<button class="btn" data-import>${icon('upload')} Importer (CSV)</button>`)}
    <div class="card no-print"><div class="row"><select id="m-team" style="max-width:240px">${selectOptions(teams, '', { empty: 'Toutes les affectations' })}</select>
      <input type="search" id="m-q" placeholder="Matricule ou nom" style="max-width:260px"><button class="btn btn-primary" id="m-print">${icon('print')} Imprimer les badges</button></div></div>
    <div class="info-box mb no-print" id="m-addr"></div>
    <div class="card"><div class="badges" id="m-body"></div></div>`;
  get('/api/badge-address').then((r) => {
    el.querySelector('#m-addr').innerHTML = `Les badges ouvrent l'application à l'adresse <strong class="mono">${esc(r.adresse)}</strong>. Le gardien scanne avec l'appareil photo de son téléphone (connecté au Wi-Fi de la société et à l'application) : le résultat 🟢 / 🔴 s'affiche directement. Si cette adresse n'est pas la bonne, corrigez-la dans <a href="#/admin/parametres">Paramètres</a> avant d'imprimer.`;
  }).catch(() => {});
  const body = el.querySelector('#m-body');
  const f = { team_id: '', q: '' };
  const load = async () => {
    const list = await get(`/api/employees${qs({ ...f, actif: '1', limit: 1000 })}`);
    body.innerHTML = list.map((e) => `<div class="badge-card"><img src="/api/employees/${e.id}/qr.svg" alt="" loading="lazy"><div class="n">${esc(e.prenom)} ${esc(e.nom)}</div><div class="mono">MAT. ${esc(e.matricule)}</div><small class="muted">${esc(e.equipe || '')} · ${esc(e.service || '')}</small></div>`).join('') || '<div class="empty">Aucun opérateur</div>';
  };
  const deb = debounce(() => load().catch(toastError), 250);
  el.querySelector('#m-team').onchange = (e) => { f.team_id = e.target.value; deb(); };
  el.querySelector('#m-q').oninput = (e) => { f.q = e.target.value; deb(); };
  el.querySelector('#m-print').onclick = () => window.print();
  el.querySelector('[data-import]').onclick = () => modal({
    title: 'Importer des opérateurs (CSV)', wide: true,
    body: `<p>Colonnes (séparateur <code>;</code> ou <code>,</code>) : <code>matricule;nom;prenom;service;affectation;poste;telephone</code>.
      Les services et affectations inconnus sont créés automatiquement. Le poste doit correspondre au nom d'un poste existant (ex. « Poste 3 »).
      Un matricule existant est mis à jour.</p>
      <div class="field"><input type="file" id="imp-file" accept=".csv,text/csv"></div>
      <div class="field"><label>Ou coller le contenu</label><textarea id="imp-text" rows="8" placeholder="matricule;nom;prenom;service;affectation;poste&#10;4587;BEN ALI;Mohamed;Production;Injection;Poste 3"></textarea></div>`,
    onOpen: (b) => { b.querySelector('#imp-file').onchange = async (e) => { const file = e.target.files[0]; if (file) b.querySelector('#imp-text').value = await file.text(); }; },
    actions: [{ label: 'Annuler', value: null }, {
      label: 'Importer', class: 'btn-primary',
      onClick: async (b) => {
        const r = await post('/api/employees/import', { csv: b.querySelector('#imp-text').value });
        toast(`${r.created} créé(s), ${r.updated} mis à jour${r.errors.length ? `, ${r.errors.length} erreur(s)` : ''}`, r.errors.length ? 'warning' : 'success', { timeout: 8000 });
        if (r.errors.length) await modal({ title: "Erreurs d'import", body: `<ul>${r.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`, actions: [{ label: 'Fermer', value: true }] });
        load();
      },
    }],
  });
  await load();
}

// ================================================================== ÉQUIPES
export async function renderTeams(el) {
  const [shifts, services, users] = await Promise.all([get('/api/shifts'), get('/api/services'), get('/api/users')]);
  const chefs = users.filter((u) => ['chef', 'rh'].includes(u.role) && u.actif);
  const fields = [
    { name: 'nom', label: "Nom de l'affectation", required: true, placeholder: 'Injection, Assemblage…' },
    { name: 'chef_equipe_id', label: 'Chef / responsable', type: 'select', options: chefs, empty: '—', optionLabel: (u) => `${u.prenom} ${u.nom}` },
    { name: 'shift_id', label: 'Poste', type: 'select', options: shifts, empty: '—', optionLabel: (s) => `${s.nom} (${s.heure_debut}–${s.heure_fin})` },
    { name: 'service_id', label: 'Service', type: 'select', options: services, empty: '—' },
    { name: 'actif', label: 'Affectation active', type: 'checkbox', default: true },
  ];
  const load = async () => {
    const teams = await get('/api/teams');
    el.innerHTML = `${pageHead('Affectations', 'Injection, Assemblage, Production… Chaque affectation a un chef / responsable qui autorise la sortie de son personnel.', `<button class="btn btn-primary" data-new>${icon('plus')} Nouvelle affectation</button>`)}
      <div class="card"><div class="table-wrap"><table class="table responsive"><thead><tr><th>Affectation</th><th>Chef / responsable</th><th>Poste</th><th>Service</th><th>Opérateurs</th><th>État</th><th></th></tr></thead><tbody>
      ${teams.map((t) => `<tr><td class="main-cell"><strong>${esc(t.nom)}</strong></td><td data-label="Chef">${esc(t.chef || '—')}</td><td data-label="Poste">${posteLabel(t.poste_nom, t.heure_debut, t.heure_fin)}</td>
        <td data-label="Service">${esc(t.service || '—')}</td><td data-label="Opérateurs">${t.nb_operateurs}</td><td data-label="État">${yesNo(t.actif)}</td>
        <td class="right nowrap"><button class="btn btn-sm" data-edit="${t.id}">${icon('edit')}</button> <button class="btn btn-sm" data-del="${t.id}">${icon('trash')}</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Aucune affectation</td></tr>'}
      </tbody></table></div></div>`;
    el.querySelector('[data-new]').onclick = () => formModal('Nouvelle affectation', fields, { actif: true }, async (d) => { await post('/api/teams', d); toast('Affectation créée', 'success'); load(); });
    el.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => { const t = teams.find((x) => x.id === Number(b.dataset.edit)); formModal(`Modifier ${t.nom}`, fields, t, async (d) => { await put(`/api/teams/${t.id}`, d); toast('Affectation modifiée', 'success'); load(); }); }; });
    el.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { try { if (await removeItem(`/api/teams/${b.dataset.del}`, 'cette affectation')) load(); } catch (e) { toastError(e); } }; });
  };
  await load();
}

// ================================================================== SERVICES
export async function renderServices(el) {
  const fields = [{ name: 'nom', label: 'Nom du service', required: true }, { name: 'actif', label: 'Service actif', type: 'checkbox', default: true }];
  const load = async () => {
    const list = await get('/api/services');
    el.innerHTML = `${pageHead('Services', '', `<button class="btn btn-primary" data-new>${icon('plus')} Nouveau service</button>`)}
      <div class="card"><div class="table-wrap"><table class="table responsive"><thead><tr><th>Service</th><th>Opérateurs actifs</th><th>État</th><th></th></tr></thead><tbody>
      ${list.map((s) => `<tr><td class="main-cell"><strong>${esc(s.nom)}</strong></td><td data-label="Opérateurs">${s.nb_operateurs}</td><td data-label="État">${yesNo(s.actif)}</td>
        <td class="right nowrap"><button class="btn btn-sm" data-edit="${s.id}">${icon('edit')}</button> <button class="btn btn-sm" data-del="${s.id}">${icon('trash')}</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Aucun service</td></tr>'}
      </tbody></table></div></div>`;
    el.querySelector('[data-new]').onclick = () => formModal('Nouveau service', fields, { actif: true }, async (d) => { await post('/api/services', d); toast('Service créé', 'success'); load(); });
    el.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => { const s = list.find((x) => x.id === Number(b.dataset.edit)); formModal(`Modifier ${s.nom}`, fields, s, async (d) => { await put(`/api/services/${s.id}`, d); toast('Service modifié', 'success'); load(); }); }; });
    el.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { try { if (await removeItem(`/api/services/${b.dataset.del}`, 'ce service')) load(); } catch (e) { toastError(e); } }; });
  };
  await load();
}

// ================================================================== HORAIRES / POSTES
export async function renderShifts(el) {
  const fields = [
    { name: 'nom', label: 'Nom', required: true, placeholder: 'Poste 1' },
    { name: 'type', label: 'Type', type: 'select', options: [{ id: 'operateur', nom: 'Ouvriers / opérateurs' }, { id: 'administratif', nom: 'Personnel administratif' }] },
    { name: 'heure_debut', label: 'Début', type: 'time', required: true }, { name: 'heure_fin', label: 'Fin', type: 'time', required: true, hint: 'Une fin inférieure au début signifie le lendemain (ex. 23:00 → 07:00).' },
    { name: 'pause_debut', label: 'Début de pause', type: 'time' }, { name: 'pause_fin', label: 'Fin de pause', type: 'time' },
    { name: 'actif', label: 'Actif', type: 'checkbox', default: true },
  ];
  const load = async () => {
    const list = await get('/api/shifts');
    el.innerHTML = `${pageHead('Horaires & postes', 'Postes en 3×8 et horaire administratif.', `<button class="btn btn-primary" data-new>${icon('plus')} Nouveau poste</button>`)}
      <div class="info-box mb">Les horaires servent à décrire l'organisation du travail. <strong>Ils ne bloquent jamais l'application</strong> : une autorisation peut être créée, validée et utilisée à toute heure, y compris la nuit.</div>
      <div class="card"><div class="table-wrap"><table class="table responsive"><thead><tr><th>Poste</th><th>Type</th><th>Horaires</th><th>Pause</th><th>État</th><th></th></tr></thead><tbody>
      ${list.map((s) => `<tr><td class="main-cell"><strong>${esc(s.nom)}</strong></td><td data-label="Type">${s.type === 'administratif' ? 'Administratif' : 'Opérateurs'}</td>
        <td data-label="Horaires" class="nowrap"><strong>${esc(s.heure_debut)} → ${esc(s.heure_fin)}</strong>${s.heure_fin <= s.heure_debut ? ' <span class="tag">lendemain</span>' : ''}</td>
        <td data-label="Pause">${s.pause_debut ? `${esc(s.pause_debut)} → ${esc(s.pause_fin)}` : '—'}</td><td data-label="État">${yesNo(s.actif)}</td>
        <td class="right nowrap"><button class="btn btn-sm" data-edit="${s.id}">${icon('edit')}</button> <button class="btn btn-sm" data-del="${s.id}">${icon('trash')}</button></td></tr>`).join('')}
      </tbody></table></div></div>`;
    el.querySelector('[data-new]').onclick = () => formModal('Nouveau poste', fields, { actif: true, type: 'operateur' }, async (d) => { await post('/api/shifts', d); toast('Poste créé', 'success'); load(); });
    el.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => { const s = list.find((x) => x.id === Number(b.dataset.edit)); formModal(`Modifier ${s.nom}`, fields, s, async (d) => { await put(`/api/shifts/${s.id}`, d); toast('Poste modifié', 'success'); load(); }); }; });
    el.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { try { if (await removeItem(`/api/shifts/${b.dataset.del}`, 'ce poste')) load(); } catch (e) { toastError(e); } }; });
  };
  await load();
}

// ================================================================== JOURNAL D'AUDIT
export async function renderAudit(el) {
  const actions = await get('/api/audit/actions');
  const f = { page: 1, size: 50, user: '', action: '', entity_type: '', date_from: '', date_to: '' };
  el.innerHTML = `${pageHead("Journal d'audit", 'Toutes les actions sont enregistrées, horodatées et chaînées (empreinte SHA-256). Le journal ne peut être ni modifié ni supprimé.', `<button class="btn" id="a-verify">${icon('shield')} Vérifier l'intégrité</button>`)}
    <div class="card"><div class="form-grid">
      <div class="field"><label>Utilisateur</label><input type="search" data-f="user"></div>
      <div class="field"><label>Action</label><select data-f="action">${selectOptions(actions.map((a) => ({ id: a, nom: actionLabel(a) })), '', { empty: 'Toutes' })}</select></div>
      <div class="field"><label>Objet</label><select data-f="entity_type"><option value="">Tous</option><option value="authorization">Autorisation</option><option value="user">Utilisateur</option><option value="employee">Opérateur</option><option value="team">Affectation</option><option value="service">Service</option><option value="shift">Poste</option><option value="settings">Paramètres</option><option value="backup">Sauvegarde</option></select></div>
      <div class="field"><label>Du</label><input type="date" data-f="date_from"></div><div class="field"><label>Au</label><input type="date" data-f="date_to"></div>
    </div><div id="a-body"></div></div>`;
  const body = el.querySelector('#a-body');
  const load = async () => {
    const r = await get(`/api/audit${qs(f)}`);
    body.innerHTML = `<div class="table-wrap"><table class="table responsive"><thead><tr><th>Date</th><th>Heure</th><th>Action</th><th>Utilisateur</th><th>Objet</th><th>Détail</th><th>IP</th></tr></thead><tbody>
      ${r.items.map((a) => `<tr><td data-label="Date" class="nowrap">${esc(dmy(a.date))}</td><td data-label="Heure" class="mono">${esc(a.heure)}</td><td data-label="Action" class="main-cell"><strong>${esc(actionLabel(a.action))}</strong></td>
        <td data-label="Utilisateur">${esc(a.username)}${a.role && a.role !== 'systeme' ? ` <small class="muted">${esc(state.settings.roles[a.role] || a.role)}</small>` : ''}</td>
        <td data-label="Objet">${a.entity_type === 'authorization' && a.entity_id ? `<a href="#/autorisations/${a.entity_id}">Autorisation #${a.entity_id}</a>` : esc(a.entity_type ? `${a.entity_type}${a.entity_id ? ` #${a.entity_id}` : ''}` : '')}</td>
        <td data-label="Détail"><small class="mono" style="word-break:break-all">${esc(diff(a))}</small></td><td data-label="IP" class="mono"><small>${esc(a.ip_address || '')}</small></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Aucune entrée</td></tr>'}
      </tbody></table></div>${pager(r.total, r.page, r.size)}`;
  };
  const deb = debounce(() => load().catch(toastError), 300);
  el.querySelectorAll('[data-f]').forEach((i) => { i.addEventListener(i.tagName === 'SELECT' || i.type === 'date' ? 'change' : 'input', () => { f[i.dataset.f] = i.value; f.page = 1; deb(); }); });
  body.addEventListener('click', (e) => { const p = e.target.closest('[data-page]'); if (p) { f.page = Number(p.dataset.page); load(); } });
  el.querySelector('#a-verify').onclick = async () => {
    const r = await get('/api/audit/verify');
    modal({ title: "Intégrité du journal d'audit", body: r.ok ? `<div class="info-box">✅ Journal intègre : ${r.count} entrées vérifiées, aucune altération détectée.</div>` : `<div class="error-box">⚠ Altération détectée à l'entrée #${r.brokenAt}.</div>`, actions: [{ label: 'Fermer', value: true }] });
  };
  await load();
}

function diff(a) {
  const out = [];
  try {
    const before = a.ancienne_valeur ? JSON.parse(a.ancienne_valeur) : null;
    const after = a.nouvelle_valeur ? JSON.parse(a.nouvelle_valeur) : null;
    if (before && after && typeof before === 'object') {
      for (const k of Object.keys(after)) if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out.push(`${k}: ${fmtVal(before[k])} → ${fmtVal(after[k])}`);
    } else if (after) {
      for (const [k, v] of Object.entries(after)) out.push(`${k}: ${fmtVal(v)}`);
    }
  } catch { /* ignore */ }
  return out.join(' · ').slice(0, 300);
}
const fmtVal = (v) => (v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));

// ================================================================== PARAMÈTRES & SAUVEGARDES
export async function renderSettings(el) {
  const s = await get('/api/settings');
  const tzs = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [s.fuseau_horaire];
  el.innerHTML = `${pageHead('Paramètres', "Configuration de l'application.")}
    <form id="s-form">
    <div class="grid grid-2">
      <div class="card"><h2>Entreprise</h2>
        <div class="field"><label>Nom de l'entreprise</label><input name="entreprise_nom" value="${esc(s.entreprise_nom)}"></div>
        <div class="field"><label>Fuseau horaire</label><select name="fuseau_horaire">${tzs.map((t) => `<option ${t === s.fuseau_horaire ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
          <div class="hint">Toutes les heures sont enregistrées en UTC et affichées dans ce fuseau.</div></div>
        <div class="field"><label>Adresse de l'application (pour les badges QR)</label><input name="adresse_application" value="${esc(s.adresse_application)}" placeholder="Automatique — ex. http://192.168.1.10:3000">
          <div class="hint">Adresse que les téléphones utilisent pour ouvrir l'application. Laisser vide = détectée automatiquement.</div></div>
        <div class="field"><label>Postes de garde (un par ligne)</label><textarea name="postes_garde" rows="3">${esc(s.postes_garde.join('\n'))}</textarea></div>
      </div>
      <div class="card"><h2>Horaires administratifs RH</h2>
        <div class="info-box mb">Indicatifs uniquement : ils ne bloquent jamais les opérations de nuit.</div>
        <div class="form-grid"><div class="field"><label>Début</label><input type="time" name="rh_heure_debut" value="${esc(s.rh_heure_debut)}"></div><div class="field"><label>Fin</label><input type="time" name="rh_heure_fin" value="${esc(s.rh_heure_fin)}"></div>
        <div class="field"><label>Pause début</label><input type="time" name="rh_pause_debut" value="${esc(s.rh_pause_debut)}"></div><div class="field"><label>Pause fin</label><input type="time" name="rh_pause_fin" value="${esc(s.rh_pause_fin)}"></div></div>
        <a href="#/admin/horaires">Gérer les postes 3×8 →</a>
      </div>
      <div class="card"><h2>Règles des autorisations</h2>
        <div class="form-grid">
          <div class="field"><label>Tolérance avant l'heure de sortie (min)</label><input type="number" min="0" max="240" name="tolerance_sortie_avant_min" value="${s.tolerance_sortie_avant_min}"></div>
          <div class="field"><label>Durée maximale (heures)</label><input type="number" min="1" max="24" name="duree_max_heures" value="${s.duree_max_heures}"></div>
          <div class="field"><label>Création à l'avance max. (jours)</label><input type="number" min="0" max="365" name="delai_creation_max_jours" value="${s.delai_creation_max_jours}"></div>
        </div>
        <label class="check"><input type="checkbox" name="validation_rh_requise" ${s.validation_rh_requise ? 'checked' : ''}> Validation RH obligatoire avant la sortie <small class="muted">(décoché : l'autorisation du chef est valable tout de suite et part au gardien)</small></label>
        <label class="check"><input type="checkbox" name="motif_refus_obligatoire" ${s.motif_refus_obligatoire ? 'checked' : ''}> Motif obligatoire en cas de refus</label>
        <label class="check"><input type="checkbox" name="pieces_jointes_actives" ${s.pieces_jointes_actives ? 'checked' : ''}> Autoriser les pièces jointes</label>
        <label class="check"><input type="checkbox" name="scanner_qr_actif" ${s.scanner_qr_actif ? 'checked' : ''}> Afficher le bouton « Scanner QR » au poste de garde (caméra)</label>
      </div>
      <div class="card"><h2>Sécurité & notifications</h2>
        <div class="form-grid">
          <div class="field"><label>Déconnexion automatique — chefs, RH, admin</label><select name="session_inactivite_min">${dureeOptions(s.session_inactivite_min)}</select></div>
          <div class="field"><label>Déconnexion automatique — gardien</label><select name="session_inactivite_gardien_min">${dureeOptions(s.session_inactivite_gardien_min)}</select></div>
        </div>
        <div class="hint mb">« Jamais » : le téléphone reste connecté en permanence (désactiver le compte dans Utilisateurs pour couper l'accès). Protégez alors chaque téléphone par un code de verrouillage.
        </div>
        <label class="check"><input type="checkbox" name="notifications_email" ${s.notifications_email ? 'checked' : ''} ${s._info.smtp ? '' : 'disabled'}> Envoyer aussi les notifications par email ${s._info.smtp ? '' : '<small class="muted">(SMTP non configuré)</small>'}</label>
        <p class="muted">Notifications push : ${s._info.push ? 'disponibles (HTTPS requis côté navigateur)' : 'indisponibles'}.</p>
      </div>
    </div>
    <div class="row mt" style="justify-content:flex-end"><button class="btn btn-primary btn-lg" type="submit">Enregistrer les paramètres</button></div>
    </form>
    <div class="card mt"><div class="card-head"><h2>Sauvegardes de la base de données</h2><button class="btn btn-primary" id="b-new">${icon('download')} Sauvegarder maintenant</button></div>
      <div class="form-grid">
        <label class="check"><input type="checkbox" id="b-auto" ${s.sauvegarde_auto ? 'checked' : ''}> Sauvegarde automatique quotidienne</label>
        <div class="field"><label>Heure</label><input type="time" id="b-heure" value="${esc(s.sauvegarde_heure)}"></div>
        <div class="field"><label>Conserver (nombre)</label><input type="number" id="b-ret" min="1" max="365" value="${s.sauvegarde_retention}"></div>
      </div>
      <p class="muted">Dossier : <span class="mono">${esc(s._info.backups_dir)}</span>. Copiez régulièrement les sauvegardes sur un autre support.</p>
      <div id="b-list"></div></div>`;
  const form = el.querySelector('#s-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const num = (k) => Number(fd.get(k));
    const body = {
      entreprise_nom: fd.get('entreprise_nom').trim(), fuseau_horaire: fd.get('fuseau_horaire'), adresse_application: fd.get('adresse_application').trim(),
      postes_garde: fd.get('postes_garde').split('\n').map((x) => x.trim()).filter(Boolean),
      rh_heure_debut: fd.get('rh_heure_debut'), rh_heure_fin: fd.get('rh_heure_fin'), rh_pause_debut: fd.get('rh_pause_debut'), rh_pause_fin: fd.get('rh_pause_fin'),
      tolerance_sortie_avant_min: num('tolerance_sortie_avant_min'), duree_max_heures: num('duree_max_heures'), delai_creation_max_jours: num('delai_creation_max_jours'),
      session_inactivite_min: num('session_inactivite_min'), session_inactivite_gardien_min: num('session_inactivite_gardien_min'),
      motif_refus_obligatoire: fd.get('motif_refus_obligatoire') === 'on', pieces_jointes_actives: fd.get('pieces_jointes_actives') === 'on', scanner_qr_actif: fd.get('scanner_qr_actif') === 'on', validation_rh_requise: fd.get('validation_rh_requise') === 'on',
      notifications_email: fd.get('notifications_email') === 'on',
    };
    try {
      await put('/api/settings', body);
      const me = await get('/api/auth/me');
      state.settings = me.settings; state.idleMinutes = me.idle_minutes;
      toast('Paramètres enregistrés', 'success');
    } catch (err) { toastError(err); }
  });
  const saveBackupSettings = async () => {
    try { await put('/api/settings', { sauvegarde_auto: el.querySelector('#b-auto').checked, sauvegarde_heure: el.querySelector('#b-heure').value, sauvegarde_retention: Number(el.querySelector('#b-ret').value) }); toast('Paramètres de sauvegarde enregistrés', 'success'); } catch (err) { toastError(err); }
  };
  ['#b-auto', '#b-heure', '#b-ret'].forEach((id) => el.querySelector(id).addEventListener('change', saveBackupSettings));
  const loadBackups = async () => {
    const list = await get('/api/backups');
    el.querySelector('#b-list').innerHTML = list.length ? `<div class="table-wrap"><table class="table responsive"><thead><tr><th>Fichier</th><th>Date</th><th>Taille</th><th></th></tr></thead><tbody>
      ${list.map((b) => `<tr><td class="main-cell mono">${esc(b.name)}</td><td data-label="Date">${fmtDateTime(b.created_at)}</td><td data-label="Taille">${Math.round(b.size / 1024)} Ko</td>
        <td class="right"><a class="btn btn-sm" href="/api/backups/${encodeURIComponent(b.name)}">${icon('download')} Télécharger</a></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Aucune sauvegarde</div>';
  };
  el.querySelector('#b-new').onclick = async () => { try { const b = await post('/api/backups'); toast(`Sauvegarde ${b.name} créée`, 'success'); loadBackups(); } catch (err) { toastError(err); } };
  await loadBackups();
}


// Historique des autorisations et recherche multicritère (plusieurs mois / années).
import { get, qs } from '../api.js';
import { state, isRole } from '../state.js';
import { esc, icon, debounce, pager, selectOptions, STATUTS, localDateStr } from '../ui.js';
import { authorizationTable, bindTable } from './authorizations.js';

const PERIODES = [['aujourdhui', "Aujourd'hui"], ['hier', 'Hier'], ['semaine', 'Cette semaine'], ['mois', 'Ce mois'], ['', 'Toutes dates'], ['perso', 'Période personnalisée']];

export async function render(el, { advanced }) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const f = { page: 1, size: 25, periode: params.get('periode') ?? (advanced ? '' : 'mois'), q: '', matricule: '', nom: '', prenom: '', date_from: '', date_to: '', service_id: '', team_id: '', chef_id: '', guard_id: '', statut: params.get('statut') || '', type_sortie: '' };
  const [services, teams, chefs, guards] = await Promise.all([
    get('/api/services'), get('/api/teams'),
    isRole('chef') ? Promise.resolve([]) : get('/api/users/lookup?role=chef'),
    get('/api/users/lookup?role=gardien'),
  ]);
  const name = (u) => `${u.prenom} ${u.nom}`;
  el.innerHTML = `<div class="page-head"><div><h1>${advanced ? 'Recherche' : 'Historique des autorisations'}</h1>
      <p>Toutes les opérations sont conservées : création, validation, notification, sortie, retour.</p></div>
      <button class="btn btn-success" id="h-export">${icon('download')} Télécharger en Excel</button></div>
    <div class="card">
      <div class="chips mb" id="h-periodes">${PERIODES.map(([v, l]) => `<button class="chip ${v === f.periode ? 'active' : ''}" data-p="${v}">${l}</button>`).join('')}</div>
      <div class="form-grid" id="h-perso" ${f.periode === 'perso' ? '' : 'hidden'}>
        <div class="field"><label>Du</label><input type="date" data-f="date_from"></div>
        <div class="field"><label>Au</label><input type="date" data-f="date_to"></div>
      </div>
      <div class="form-grid">
        <div class="field"><label>Recherche libre</label><input type="search" data-f="q" placeholder="Matricule, nom, prénom, n°"></div>
        <div class="field"><label>Statut</label><select data-f="statut">${selectOptions(Object.entries(STATUTS).map(([id, nom]) => ({ id, nom })), f.statut, { empty: 'Tous' })}</select></div>
        <div class="field"><label>Type de sortie</label><select data-f="type_sortie">${selectOptions(Object.entries(state.settings.types_sortie).map(([id, nom]) => ({ id, nom })), '', { empty: 'Tous' })}</select></div>
        <div class="field"><label>Équipe</label><select data-f="team_id">${selectOptions(teams, '', { empty: 'Toutes' })}</select></div>
      </div>
      <details ${advanced ? 'open' : ''}><summary class="muted" style="cursor:pointer;margin-bottom:10px">Plus de critères</summary>
        <div class="form-grid">
          <div class="field"><label>Matricule exact</label><input type="text" data-f="matricule"></div>
          <div class="field"><label>Nom</label><input type="text" data-f="nom"></div>
          <div class="field"><label>Prénom</label><input type="text" data-f="prenom"></div>
          <div class="field"><label>Service</label><select data-f="service_id">${selectOptions(services, '', { empty: 'Tous' })}</select></div>
          ${chefs.length ? `<div class="field"><label>Chef d'équipe</label><select data-f="chef_id">${selectOptions(chefs, '', { empty: 'Tous', label: name })}</select></div>` : ''}
          <div class="field"><label>Gardien</label><select data-f="guard_id">${selectOptions(guards, '', { empty: 'Tous', label: name })}</select></div>
        </div>
      </details>
      <div id="h-body" class="mt"></div>
    </div>`;
  const body = el.querySelector('#h-body');
  const query = () => {
    const q = { ...f };
    if (q.periode === 'perso') q.periode = ''; else { q.date_from = ''; q.date_to = ''; }
    return q;
  };
  const load = async () => {
    body.innerHTML = '<div class="empty">Recherche…</div>';
    try {
      const r = await get(`/api/authorizations${qs(query())}`);
      body.innerHTML = r.items.length ? `${authorizationTable(r.items)}${pager(r.total, r.page, r.size)}` : '<div class="empty">Aucun résultat pour ces critères</div>';
    } catch (e) { body.innerHTML = `<div class="error-box">${esc(e.message)}</div>`; }
  };
  bindTable(body, load);
  body.addEventListener('click', (e) => { const p = e.target.closest('[data-page]'); if (p) { f.page = Number(p.dataset.page); load(); } });
  const deb = debounce(load, 300);
  el.querySelectorAll('[data-f]').forEach((input) => {
    const ev = input.tagName === 'SELECT' || input.type === 'date' ? 'change' : 'input';
    input.addEventListener(ev, () => { f[input.dataset.f] = input.value; f.page = 1; deb(); });
  });
  el.querySelector('#h-periodes').addEventListener('click', (e) => {
    const c = e.target.closest('[data-p]'); if (!c) return;
    f.periode = c.dataset.p; f.page = 1;
    el.querySelectorAll('#h-periodes .chip').forEach((x) => x.classList.toggle('active', x === c));
    el.querySelector('#h-perso').hidden = f.periode !== 'perso';
    load();
  });
  el.querySelector('#h-export').addEventListener('click', () => {
    const q = query(); delete q.page; delete q.size;
    window.location.href = `/api/rapport.xlsx${qs(q)}`;
  });
  await load();
}

// ================================================================== RAPPORT EXCEL (RH)
export async function renderReport(el) {
  const teams = await get('/api/teams');
  const today = localDateStr();
  el.innerHTML = `<div class="page-head"><div><h1>Rapport Excel de suivi</h1>
      <p>Fichier Excel présentable : liste détaillée des sorties (heures prévues et réelles, retours, retards) et une feuille de synthèse.</p></div></div>
    <div class="card">
      <div class="field"><label>Équipe</label><select id="r-team" style="max-width:320px">${selectOptions(teams, '', { empty: 'Toutes les équipes' })}</select></div>
      <div class="r-grid">
        <button class="btn btn-success btn-lg" data-p="aujourdhui">${icon('download')} Aujourd'hui</button>
        <button class="btn btn-success btn-lg" data-p="hier">${icon('download')} Hier</button>
        <button class="btn btn-success btn-lg" data-p="semaine">${icon('download')} Cette semaine</button>
        <button class="btn btn-success btn-lg" data-p="mois">${icon('download')} Ce mois</button>
      </div>
      <h3 class="mt">Autre période</h3>
      <div class="form-grid">
        <div class="field"><label>Du</label><input type="date" id="r-from" value="${today.slice(0, 8)}01"></div>
        <div class="field"><label>Au</label><input type="date" id="r-to" value="${today}"></div>
        <div class="field"><label>&nbsp;</label><button class="btn btn-primary btn-block" id="r-custom">${icon('download')} Télécharger</button></div>
      </div>
    </div>`;
  const team = () => el.querySelector('#r-team').value;
  el.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { window.location.href = `/api/rapport.xlsx${qs({ periode: b.dataset.p, team_id: team() })}`; }));
  el.querySelector('#r-custom').addEventListener('click', () => {
    window.location.href = `/api/rapport.xlsx${qs({ date_from: el.querySelector('#r-from').value, date_to: el.querySelector('#r-to').value, team_id: team() })}`;
  });
}

// Tableau de bord : indicateurs du jour, demandes en attente, opérateurs à l'extérieur, tendances.
import { get, on } from '../api.js';
import { state, isRole } from '../state.js';
import { esc, icon, statusBadge, windowLabel, avatar, fmtTime, duration, minutesSince, dmy, debounce } from '../ui.js';
import { quickDecision } from './authorizations.js';

export async function render(el) {
  const load = async () => {
    const d = await get('/api/dashboard');
    const t = d.aujourdhui;
    const s = state.settings;
    const max7 = Math.max(1, ...d.last7.map((x) => x.total));
    const maxType = Math.max(1, ...d.byType.map((x) => x.n));
    const maxTeam = Math.max(1, ...d.byTeam.map((x) => x.n));
    el.innerHTML = `
      <div class="page-head"><div><h1>Aujourd'hui — ${esc(dmy(d.date))}</h1>
        <p>${isRole('chef') ? 'Périmètre : vos équipes.' : 'Toutes les équipes.'} Mise à jour en temps réel.</p></div>
        ${isRole('chef', 'admin') ? `<a class="btn btn-primary btn-lg" href="#/nouvelle">${icon('plus')} Nouvelle autorisation de sortie</a>` : ''}
      </div>
      <div class="kpis">
        <a class="kpi total" href="#/historique?periode=aujourdhui"><div class="v">${t.total}</div><div class="l">Autorisations aujourd'hui</div></a>
        ${s.validation_rh_requise ? `<a class="kpi attente" href="#/${isRole('chef') ? 'mes-demandes' : 'en-attente'}"><div class="v">${d.en_attente_total}</div><div class="l">En attente</div></a>` : ''}
        <div class="kpi validee"><div class="v">${t.validees}</div><div class="l">Autorisées</div></div>
        <div class="kpi refusee"><div class="v">${t.refusees}</div><div class="l">Refusées</div></div>
        <a class="kpi sortie" href="#/exterieur"><div class="v">${t.sorties_en_cours}</div><div class="l">Actuellement sortis</div></a>
        ${t.retours_en_retard ? `<a class="kpi retard" href="#/exterieur"><div class="v">${t.retours_en_retard}</div><div class="l">Retours en retard</div></a>` : ''}
        <div class="kpi retour"><div class="v">${t.retours_effectues}</div><div class="l">Retours effectués</div></div>
        <div class="kpi expiree"><div class="v">${t.expirees}</div><div class="l">Expirées</div></div>
      </div>
      <div class="grid grid-2">
        <div class="card" ${s.validation_rh_requise || d.pending.length ? '' : 'hidden'}>
          <div class="card-head"><h2>Demandes en attente</h2>${isRole('rh', 'admin') ? '<a href="#/en-attente">Tout voir</a>' : ''}</div>
          ${d.pending.length ? `<div class="result-list">${d.pending.map((a) => `
            <div class="result-item" data-open="${a.id}">
              ${avatar(a.employee_id, a.emp_photo, a.emp_prenom, a.emp_nom)}
              <div class="grow"><div class="name"><span class="mat">${esc(a.matricule)}</span> ${esc(a.emp_prenom)} ${esc(a.emp_nom)}</div>
              <div class="meta">${windowLabel(a)} · ${esc(a.type_sortie_label)} · ${esc(a.equipe || '')}</div></div>
              ${isRole('rh', 'admin') ? `<div class="row" style="gap:6px"><button class="btn btn-success btn-sm" data-ok="${a.id}">${icon('check')} Valider</button><button class="btn btn-danger btn-sm" data-ko="${a.id}">Refuser</button></div>` : statusBadge(a.statut)}
            </div>`).join('')}</div>` : '<div class="empty">Aucune demande en attente</div>'}
        </div>
        <div class="card">
          <div class="card-head"><h2>Opérateurs à l'extérieur</h2><a href="#/exterieur">Tout voir</a></div>
          ${d.outside.length ? `<div class="result-list">${d.outside.map((a) => `
            <div class="result-item" data-open="${a.id}">
              ${avatar(a.employee_id, a.emp_photo, a.emp_prenom, a.emp_nom)}
              <div class="grow"><div class="name"><span class="mat">${esc(a.matricule)}</span> ${esc(a.emp_prenom)} ${esc(a.emp_nom)}</div>
              <div class="meta">Sortie ${fmtTime(a.heure_sortie_reelle)} · retour prévu ${esc(a.heure_retour_prevue)} · depuis ${duration(minutesSince(a.heure_sortie_reelle))}</div></div>
              ${a.en_retard ? '<span class="status st-RETARD">En retard</span>' : '<span class="status st-EXTERIEUR">À l\'extérieur</span>'}
            </div>`).join('')}</div>` : '<div class="empty">Aucun opérateur à l\'extérieur</div>'}
        </div>
        <div class="card">
          <div class="card-head"><h2>7 derniers jours</h2><small><span class="tag">Total</span> <span class="tag tag-red">Refusées</span></small></div>
          <div class="bars">${d.last7.map((x) => `<div class="bar" title="${esc(dmy(x.date))} : ${x.total} demandes, ${x.validees} validées, ${x.refusees} refusées">
            <div class="n">${x.total}</div><div class="fill" style="height:${(x.total / max7) * 100}%"><div class="ko" style="height:${x.total ? (x.refusees / x.total) * 100 : 0}%"></div></div>
            <div class="d">${esc(dmy(x.date).slice(0, 5))}</div></div>`).join('')}</div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Ce mois-ci</h2></div>
          <h3>Par type de sortie</h3>
          <div class="hbars">${d.byType.map((x) => `<div class="hbar"><span>${esc(x.label)}</span><div class="track"><div style="width:${(x.n / maxType) * 100}%"></div></div><strong class="right">${x.n}</strong></div>`).join('') || '<div class="muted">Aucune donnée</div>'}</div>
          <h3 class="mt">Par équipe</h3>
          <div class="hbars">${d.byTeam.map((x) => `<div class="hbar"><span>${esc(x.equipe)}</span><div class="track"><div style="width:${(x.n / maxTeam) * 100}%"></div></div><strong class="right">${x.n}</strong></div>`).join('') || '<div class="muted">Aucune donnée</div>'}</div>
        </div>
      </div>
      <div class="info-box mt">${icon('clock', 'no')} Horaires administratifs RH : ${esc(s.rh_heure_debut)}–${esc(s.rh_heure_fin)} (pause ${esc(s.rh_pause_debut)}–${esc(s.rh_pause_fin)}).
        Ces horaires sont indicatifs : l'application fonctionne 24 h/24 et 7 j/7 pour les équipes en 3×8.</div>`;

    el.querySelectorAll('[data-open]').forEach((x) => x.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      location.hash = `/autorisations/${x.dataset.open}`;
    }));
    el.querySelectorAll('[data-ok]').forEach((b) => b.addEventListener('click', () => quickDecision(Number(b.dataset.ok), 'approve').then((r) => r && load())));
    el.querySelectorAll('[data-ko]').forEach((b) => b.addEventListener('click', () => quickDecision(Number(b.dataset.ko), 'reject').then((r) => r && load())));
  };
  await load();
  const reload = debounce(() => load().catch(() => {}), 400);
  const off = on('authorization', reload);
  const timer = setInterval(reload, 60000);
  return () => { off(); clearInterval(timer); };
}

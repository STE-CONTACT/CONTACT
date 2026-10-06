// Centre de notifications et compte utilisateur.
import { get, post, emit } from '../api.js';
import { state, isRole } from '../state.js';
import { esc, icon, fmtDateTime, toast, toastError, navigate } from '../ui.js';
import { enablePush, pushStatus, pushSupported } from '../push.js';

export async function renderNotifications(el) {
  let all = false;
  const load = async () => {
    const r = await get(`/api/notifications?limit=200${all ? '&all=1' : ''}`);
    el.innerHTML = `<div class="page-head"><div><h1>Notifications</h1><p>Notifications en temps réel dans l'application${pushSupported() ? ', notifications push sur cet appareil' : ''}${state.settings && isRole('admin') ? ' et email (si configuré)' : ''}.</p></div>
      <div class="row">${isRole('admin') ? `<button class="btn" id="n-all">${all ? 'Mes notifications' : 'Toutes les notifications envoyées'}</button>` : ''}
      <button class="btn" id="n-read">Tout marquer comme lu</button></div></div>
      <div class="card mb"><div class="row"><div class="grow"><strong>${icon('bell', 'no')} Notifications push sur cet appareil</strong>
        <div class="muted">${pushStatus() ? 'Activées : vous serez alerté même si l\'application est en arrière-plan.' : pushSupported() ? 'Recommandé pour la tablette du poste de garde et le RH.' : 'Non disponibles ici (HTTPS requis, ou navigateur non compatible). Les notifications dans l\'application restent actives.'}</div></div>
        ${!pushStatus() && pushSupported() ? '<button class="btn btn-primary" id="n-push">Activer</button>' : ''}</div></div>
      <div class="card" style="padding:0">${r.items.length ? `<ul class="notif-list">${r.items.map((n) => `<li class="${n.lu ? '' : 'unread'}" data-id="${n.id}" data-entity="${n.entity_type === 'authorization' ? n.entity_id : ''}">
        <span class="dot"></span><div class="grow"><strong>${esc(n.titre)}</strong><div>${esc(n.message)}</div>
        <small class="muted">${fmtDateTime(n.created_at)}${all ? ` — destinataire : ${esc(n.username)} (${esc(state.settings.roles[n.role] || n.role)})` : ''}</small></div></li>`).join('')}</ul>` : '<div class="empty">Aucune notification</div>'}</div>`;
    el.querySelector('#n-read').onclick = async () => { await post('/api/notifications/read-all'); emit('unread-changed'); load(); };
    const ba = el.querySelector('#n-all'); if (ba) ba.onclick = () => { all = !all; load(); };
    const bp = el.querySelector('#n-push'); if (bp) bp.onclick = async () => { try { await enablePush(); toast('Notifications push activées', 'success'); load(); } catch (e) { toastError(e); } };
    el.querySelectorAll('li[data-id]').forEach((li) => li.addEventListener('click', async () => {
      if (!all) { await post(`/api/notifications/${li.dataset.id}/read`).catch(() => {}); emit('unread-changed'); }
      if (li.dataset.entity && !isRole('gardien')) navigate(`/autorisations/${li.dataset.entity}`);
      else load();
    }));
  };
  await load();
}

export async function renderAccount(el) {
  const u = state.user;
  el.innerHTML = `<div class="page-head"><div><h1>Mon compte</h1></div></div>
    <div class="grid grid-2">
      <div class="card"><h2>Profil</h2><div class="kv">
        <div><span>Nom</span><strong>${esc(u.prenom)} ${esc(u.nom)}</strong></div><div><span>Identifiant</span><strong class="mono">${esc(u.username)}</strong></div>
        <div><span>Rôle</span><strong>${esc(state.settings.roles[u.role])}</strong></div><div><span>Email</span><strong>${esc(u.email || '—')}</strong></div>
        <div><span>Déconnexion automatique</span><strong>après ${state.idleMinutes} min d'inactivité</strong></div></div></div>
      <form class="card" id="pw"><h2>Changer le mot de passe</h2>
        <div class="field"><label>Mot de passe actuel</label><input type="password" name="current" autocomplete="current-password" required></div>
        <div class="field"><label>Nouveau mot de passe</label><input type="password" name="password" autocomplete="new-password" required><div class="hint">10 caractères minimum, majuscule, minuscule, chiffre et caractère spécial.</div></div>
        <div class="field"><label>Confirmer</label><input type="password" name="confirm" autocomplete="new-password" required></div>
        <button class="btn btn-primary" type="submit">Enregistrer</button></form>
    </div>`;
  const form = el.querySelector('#pw');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.password.value !== form.confirm.value) { toast('Les mots de passe ne correspondent pas', 'error'); return; }
    try { await post('/api/auth/change-password', { current: form.current.value, password: form.password.value }); form.reset(); toast('Mot de passe modifié. Vos autres sessions ont été fermées.', 'success'); } catch (err) { toastError(err); }
  });
}

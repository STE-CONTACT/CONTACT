'use strict';
/**
 * Scénarios de recette demandés (section 27 du cahier des charges) + règles métier et sécurité.
 * L'horloge est simulée : les tests couvrent le jour, la pause, le soir, la nuit et le passage de minuit.
 * Fuseau de l'entreprise : Africa/Tunis (UTC+1).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, tunis, clock } = require('./helpers');

let S; let chefB; let chefA; let rh; let gardien; let admin;

test.before(async () => {
  S = await startServer();
  chefB = client(S.base); chefA = client(S.base); rh = client(S.base); gardien = client(S.base); admin = client(S.base);
  clock.set(tunis('2026-10-05', '07:30'));
  await chefB.login('chefb'); await chefA.login('chefa'); await rh.login('rh'); await gardien.login('gardien'); await admin.login('admin');
});
test.after(async () => { await S.stop(); });

/** Garde les sessions actives malgré l'avance de l'horloge simulée. */
function at(date, time) {
  clock.set(tunis(date, time));
  S.db.run('UPDATE sessions SET last_seen_at = ?', clock.nowIso());
}

async function createAuth(c, employee_id, date, hs, hr, extra = {}) {
  const r = await c.post('/api/authorizations', { employee_id, date_sortie: date, heure_sortie_prevue: hs, heure_retour_prevue: hr, type_sortie: 'PERSONNELLE', motif: 'Raison familiale', ...extra });
  return r;
}

async function fullCycle(label, date, createAt, hs, hr, employee = 'amine', chef = () => chefA) {
  at(date, createAt);
  const c = await createAuth(chef(), S.ids[employee], date, hs, hr);
  assert.equal(c.status, 201, `${label} création : ${JSON.stringify(c.data)}`);
  assert.equal(c.data.statut, 'EN_ATTENTE');
  const v = await rh.post(`/api/authorizations/${c.data.id}/approve`, {});
  assert.equal(v.status, 200, `${label} validation : ${JSON.stringify(v.data)}`);
  assert.equal(v.data.statut, 'VALIDEE');
  return v.data;
}

test('1. Autorisation pendant les heures RH (10:00)', async () => {
  const a = await fullCycle('heures RH', '2026-10-05', '10:00', '10:30', '11:15');
  assert.equal(a.cree_hors_horaires_rh, false);
});

test('2. Autorisation après 17:00 (18:40) — jamais bloquée', async () => {
  const a = await fullCycle('après 17h', '2026-10-05', '18:40', '19:00', '20:00', 'ines');
  assert.equal(a.cree_hors_horaires_rh, true, 'signalée hors horaires RH à titre informatif');
});

test('3. Autorisation pendant la pause 12:00–13:00', async () => {
  const a = await fullCycle('pause', '2026-10-06', '12:20', '12:30', '13:30');
  assert.equal(a.cree_hors_horaires_rh, true);
});

test('4-11. Scénario complet de nuit : 4587 — création 23:20, sortie 23:35, retour 00:48', async () => {
  // 4. Création à 23:20 pour une sortie à 23:30 (poste 23:00–07:00)
  at('2026-10-05', '23:20');
  const c = await createAuth(chefB, S.ids.mohamed, '2026-10-05', '23:30', '01:00');
  assert.equal(c.status, 201, JSON.stringify(c.data));
  const a = c.data;
  assert.equal(a.statut, 'EN_ATTENTE');
  assert.equal(a.retour_lendemain, true);
  assert.equal(a.date_retour, '2026-10-06');
  assert.equal(a.debut_at, '2026-10-05T22:30:00.000Z');
  assert.equal(a.fin_at, '2026-10-06T00:00:00.000Z');
  // 6. Le créneau est bien dans le poste 23:00–07:00
  assert.equal(a.poste_nom, 'Poste 3');
  assert.equal(a.dans_poste, true);

  // Le RH reçoit la notification
  const nRh = await rh.get('/api/notifications');
  assert.ok(nRh.data.items.some((n) => n.type === 'DEMANDE_CREEE' && n.entity_id === a.id));

  // 9. Notification temps réel au gardien : ouverture du flux SSE avant la validation
  const sse = await fetch(`${S.base}/api/events`, { headers: { Cookie: gardien.cookie() } });
  assert.equal(sse.status, 200);
  const reader = sse.body.getReader();
  const received = (async () => {
    let buf = '';
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return buf;
      buf += dec.decode(value);
      if (buf.includes('event: notification')) return buf;
    }
  })();

  // 8. Validation RH à 23:24
  at('2026-10-05', '23:24');
  const v = await rh.post(`/api/authorizations/${a.id}/approve`, { commentaire: 'OK' });
  assert.equal(v.status, 200, JSON.stringify(v.data));
  assert.equal(v.data.statut, 'VALIDEE');
  assert.equal(v.data.approved_by, S.ids.rh);
  assert.equal(v.data.approved_at, tunis('2026-10-05', '23:24'));

  const stream = await Promise.race([received, new Promise((_, rej) => setTimeout(() => rej(new Error('pas de notification SSE')), 3000))]);
  assert.match(stream, /Sortie autoris/);
  assert.match(stream, /4587/);
  await reader.cancel();
  const nG = await gardien.get('/api/notifications');
  assert.ok(nG.data.items.some((n) => n.type === 'AUTORISATION_VALIDEE' && n.entity_id === a.id), 'notification gardien enregistrée');

  // Visible immédiatement sur le tableau du poste de garde
  const board = await gardien.get('/api/gate/board');
  assert.ok(board.data.validated.some((x) => x.id === a.id));

  // 10. À 23:35, le gardien recherche 4587 → AUTORISATION VALIDÉE, sans informations confidentielles
  at('2026-10-05', '23:35');
  const look = await gardien.get('/api/gate/lookup?q=4587');
  assert.equal(look.status, 200);
  assert.equal(look.data.verdict, 'VALIDEE');
  assert.equal(look.data.authorization.id, a.id);
  assert.equal(look.data.authorization.motif, undefined, 'le motif est confidentiel');
  assert.equal(look.data.authorization.commentaire, undefined);

  const exit = await gardien.post(`/api/gate/${a.id}/exit`, {});
  assert.equal(exit.status, 200, JSON.stringify(exit.data));
  assert.equal(exit.data.statut, 'SORTIE_EFFECTUEE');
  assert.equal(exit.data.heure_sortie_reelle, tunis('2026-10-05', '23:35'));
  assert.equal(exit.data.gardien_sortie, 'gardien GARDIEN');
  assert.equal(exit.data.poste_garde_sortie, 'Poste de garde principal');

  // 7. Passage à minuit : toujours à l'extérieur, non en retard à 00:30 le 06/10
  at('2026-10-06', '00:30');
  const out = await rh.get('/api/outside');
  const o = out.data.find((x) => x.id === a.id);
  assert.ok(o, "visible dans « à l'extérieur »");
  assert.equal(o.en_retard, false);
  const look2 = await gardien.get('/api/gate/lookup?q=4587');
  assert.equal(look2.data.verdict, 'A_L_EXTERIEUR');

  // 11. Retour à 00:48 → durée 1 h 13 min
  at('2026-10-06', '00:48');
  const ret = await gardien.post(`/api/gate/${a.id}/return`, {});
  assert.equal(ret.status, 200, JSON.stringify(ret.data));
  assert.equal(ret.data.statut, 'RETOUR_EFFECTUE');
  assert.equal(ret.data.heure_retour_reel, tunis('2026-10-06', '00:48'));
  assert.equal(ret.data.duree_reelle, '1 h 13 min');
  assert.equal(ret.data.en_retard, false);

  // Historique complet de l'opération
  const d = await rh.get(`/api/authorizations/${a.id}`);
  const actions = d.data.timeline.map((t) => t.action);
  for (const x of ['DEMANDE_CREEE', 'DEMANDE_SOUMISE', 'NOTIFICATION_ENVOYEE', 'AUTORISATION_VALIDEE', 'CONTROLE_POSTE_GARDE', 'SORTIE_CONFIRMEE', 'RETOUR_CONFIRME']) {
    assert.ok(actions.includes(x), `action ${x} dans l'historique`);
  }
  const valid = d.data.timeline.find((t) => t.action === 'AUTORISATION_VALIDEE');
  assert.deepEqual([valid.date, valid.heure.slice(0, 5), valid.username], ['2026-10-05', '23:24', 'rh']);
  const ret2 = d.data.timeline.find((t) => t.action === 'RETOUR_CONFIRME');
  assert.deepEqual([ret2.date, ret2.heure.slice(0, 5)], ['2026-10-06', '00:48'], 'date du lendemain correctement enregistrée');
});

test('5. Autorisation créée et validée à 02:00 (poste de nuit)', async () => {
  at('2026-10-07', '02:00');
  const c = await createAuth(chefB, S.ids.sami, '2026-10-07', '02:15', '03:30');
  assert.equal(c.status, 201, JSON.stringify(c.data));
  assert.equal(c.data.dans_poste, true, '02:15–03:30 est dans le poste 23:00–07:00 commencé la veille');
  at('2026-10-07', '02:05');
  const v = await rh.post(`/api/authorizations/${c.data.id}/approve`, {});
  assert.equal(v.status, 200);
  assert.equal(v.data.approved_at, tunis('2026-10-07', '02:05'));
  at('2026-10-07', '02:16');
  const e = await gardien.post(`/api/gate/${c.data.id}/exit`, {});
  assert.equal(e.status, 200, JSON.stringify(e.data));
  at('2026-10-07', '03:10');
  assert.equal((await gardien.post(`/api/gate/${c.data.id}/return`, {})).status, 200);
});

test('6. Gestion du poste 23:00–07:00 (fonctions de temps)', () => {
  const { shiftWindowAt, isWithinShift, authorizationWindow } = require('../src/lib/time');
  const poste3 = { heure_debut: '23:00', heure_fin: '07:00' };
  const w = shiftWindowAt(poste3, new Date(tunis('2026-10-06', '03:00')), 'Africa/Tunis');
  assert.equal(w.startDate, '2026-10-05', 'à 03:00 le 06/10, le poste a commencé le 05/10');
  assert.equal(w.start.toISOString(), tunis('2026-10-05', '23:00'));
  assert.equal(w.end.toISOString(), tunis('2026-10-06', '07:00'));
  assert.equal(isWithinShift(poste3, new Date(tunis('2026-10-05', '23:30')), new Date(tunis('2026-10-06', '01:00')), 'Africa/Tunis'), true);
  assert.equal(isWithinShift(poste3, new Date(tunis('2026-10-06', '06:30')), new Date(tunis('2026-10-06', '08:00')), 'Africa/Tunis'), false);
  // Fenêtre traversant minuit
  const aw = authorizationWindow('2026-10-05', '23:30', '01:00', 'Africa/Tunis');
  assert.equal(aw.nextDay, true);
  assert.equal(aw.dateRetour, '2026-10-06');
  // Heure d'été (Europe/Paris, 25/10/2026 : 03:00 → 02:00) : la durée réelle est bien 2 h
  const dst = authorizationWindow('2026-10-25', '01:30', '02:30', 'Europe/Paris');
  assert.equal((dst.fin - dst.debut) / 60000, 120);
});

test('12. Autorisation expirée : non utilisable par le gardien', async () => {
  at('2026-10-08', '09:00');
  const c = await createAuth(chefA, S.ids.ines, '2026-10-08', '09:30', '10:00');
  assert.equal((await rh.post(`/api/authorizations/${c.data.id}/approve`, {})).status, 200);
  // Une demande en attente non traitée expire aussi
  const p = await createAuth(chefA, S.ids.amine, '2026-10-08', '09:10', '09:40');
  at('2026-10-08', '10:01');
  const look = await gardien.get('/api/gate/lookup?q=4101');
  assert.equal(look.data.verdict, 'AUCUNE');
  assert.equal(look.data.derniere_demande.statut, 'EXPIREE');
  const e = await gardien.post(`/api/gate/${c.data.id}/exit`, {});
  assert.equal(e.status, 409);
  assert.match(e.data.error, /EXPIR/);
  assert.equal((await rh.get(`/api/authorizations/${c.data.id}`)).data.statut, 'EXPIREE');
  assert.equal((await rh.get(`/api/authorizations/${p.data.id}`)).data.statut, 'EXPIREE');
  // Le RH ne peut plus valider une demande expirée
  assert.equal((await rh.post(`/api/authorizations/${p.data.id}/approve`, {})).status, 409);
});

test('13. Autorisation refusée : jamais présentée comme valide', async () => {
  at('2026-10-09', '15:00');
  const c = await createAuth(chefA, S.ids.amine, '2026-10-09', '15:10', '16:00');
  const noMotif = await rh.post(`/api/authorizations/${c.data.id}/reject`, {});
  assert.equal(noMotif.status, 400, 'motif obligatoire');
  const r = await rh.post(`/api/authorizations/${c.data.id}/reject`, { motif_refus: 'Sortie non justifiée' });
  assert.equal(r.status, 200);
  assert.equal(r.data.statut, 'REFUSEE');
  assert.equal(r.data.motif_refus, 'Sortie non justifiée');
  const n = await chefA.get('/api/notifications');
  assert.ok(n.data.items.some((x) => x.type === 'AUTORISATION_REFUSEE' && /Sortie non justifiée/.test(x.message)), 'chef notifié avec le motif');
  at('2026-10-09', '15:12');
  const look = await gardien.get('/api/gate/lookup?q=4100');
  assert.equal(look.data.verdict, 'AUCUNE');
  assert.equal(look.data.derniere_demande.statut, 'REFUSEE');
  const board = await gardien.get('/api/gate/board');
  assert.ok(!board.data.validated.some((x) => x.id === c.data.id));
  const e = await gardien.post(`/api/gate/${c.data.id}/exit`, {});
  assert.equal(e.status, 409);
  assert.match(e.data.error, /REFUS/);
});

test('14. Recherche dans l\'historique plusieurs mois après', async () => {
  at('2027-04-15', '10:00');
  const r = await rh.get('/api/authorizations?matricule=4587&date_from=2026-10-01&date_to=2026-10-31');
  assert.equal(r.status, 200);
  assert.equal(r.data.total, 1);
  const a = r.data.items[0];
  assert.equal(a.statut, 'RETOUR_EFFECTUE');
  assert.equal(a.duree_reelle, '1 h 13 min');
  const byName = await rh.get('/api/authorizations?q=ben%20ali');
  assert.ok(byName.data.total >= 1);
  const byGuard = await rh.get(`/api/authorizations?guard_id=${S.ids.gardien}&date_from=2026-10-01&date_to=2026-10-31`);
  assert.ok(byGuard.data.total >= 2);
  const byStatus = await rh.get('/api/authorizations?statut=REFUSEE&date_from=2026-10-01&date_to=2026-10-31');
  assert.equal(byStatus.data.total, 1);
  const byType = await rh.get('/api/authorizations?type_sortie=PERSONNELLE&team_id=' + S.ids.teamB + '&date_from=2026-10-01&date_to=2026-10-31');
  assert.equal(byType.data.total, 2);
  const csv = await rh.get('/api/authorizations/export.csv?date_from=2026-10-01&date_to=2026-10-31');
  assert.equal(csv.status, 200);
  assert.match(csv.data, /4587;BEN ALI;Mohamed/);
  // Chronologie toujours complète
  const d = await rh.get(`/api/authorizations/${a.id}`);
  assert.ok(d.data.timeline.length >= 7);
});

// ------------------------------------------------------------------ règles métier & sécurité
test('Règle 1 : un chef ne crée que pour son équipe (sauf droit spécial)', async () => {
  at('2027-04-15', '10:00');
  const r = await createAuth(chefA, S.ids.mohamed, '2027-04-15', '11:00', '12:00');
  assert.equal(r.status, 403);
  S.db.run('UPDATE users SET droit_toutes_equipes = 1 WHERE id = ?', S.ids.chefA);
  const ok = await createAuth(chefA, S.ids.mohamed, '2027-04-15', '11:00', '12:00');
  assert.equal(ok.status, 201);
  S.db.run('UPDATE users SET droit_toutes_equipes = 0 WHERE id = ?', S.ids.chefA);
  // Chevauchement interdit
  const dup = await createAuth(chefB, S.ids.mohamed, '2027-04-15', '11:30', '12:30');
  assert.equal(dup.status, 409);
  // Le chef A ne voit pas les opérateurs de l'équipe B
  const emps = await chefA.get('/api/employees?q=4587');
  assert.equal(emps.data.length, 0);
});

test('Règles 5-6 : le gardien ne peut ni valider ni sortir une demande non approuvée', async () => {
  at('2027-04-16', '08:00');
  const c = await createAuth(chefB, S.ids.sami, '2027-04-16', '08:05', '09:00');
  assert.equal((await gardien.post(`/api/authorizations/${c.data.id}/approve`, {})).status, 403);
  const e = await gardien.post(`/api/gate/${c.data.id}/exit`, {});
  assert.equal(e.status, 409);
  assert.match(e.data.error, /NON VALID/);
  assert.equal((await gardien.get('/api/authorizations')).status, 403, 'pas d\'accès aux listes confidentielles');
  assert.equal((await chefB.post(`/api/authorizations/${c.data.id}/approve`, {})).status, 403, 'le chef ne valide pas');
  // Annulation avant utilisation, puis impossible de sortir
  const cancel = await chefB.post(`/api/authorizations/${c.data.id}/cancel`, { motif: 'plus nécessaire' });
  assert.equal(cancel.data.statut, 'ANNULEE');
});

test('Annulation impossible après utilisation ; tolérance avant l\'heure de sortie', async () => {
  at('2027-04-17', '14:00');
  const c = await createAuth(chefA, S.ids.amine, '2027-04-17', '15:00', '16:00');
  await rh.post(`/api/authorizations/${c.data.id}/approve`, {});
  const early = await gardien.post(`/api/gate/${c.data.id}/exit`, {});
  assert.equal(early.status, 409, 'trop tôt (tolérance 30 min)');
  assert.match(early.data.error, /Trop tôt/);
  at('2027-04-17', '14:35');
  assert.equal((await gardien.get('/api/gate/lookup?q=4100')).data.verdict, 'VALIDEE');
  assert.equal((await gardien.post(`/api/gate/${c.data.id}/exit`, {})).status, 200);
  const cancel = await chefA.post(`/api/authorizations/${c.data.id}/cancel`, {});
  assert.equal(cancel.status, 409);
  // Retour en retard signalé
  at('2027-04-17', '16:20');
  S.ctx.authz.expireDue();
  const out = await rh.get('/api/outside');
  assert.equal(out.data.find((x) => x.id === c.data.id).en_retard, true);
  const n = await chefA.get('/api/notifications');
  assert.ok(n.data.items.some((x) => x.type === 'RETOUR_EN_RETARD'));
});

test('QR code : identification seule, badge régénéré refusé', async () => {
  at('2027-04-18', '10:00');
  const emp = S.db.get('SELECT matricule, qr_token FROM employees WHERE id = ?', S.ids.ines);
  const r = await gardien.get(`/api/gate/lookup?qr=${encodeURIComponent(`SORTIE:${emp.matricule}:${emp.qr_token}`)}`);
  assert.equal(r.data.employee.matricule, '4101');
  assert.equal((await gardien.get(`/api/gate/lookup?qr=${encodeURIComponent(`SORTIE:${emp.matricule}:fauxjeton`)}`)).data.verdict, 'INCONNU');
  const svg = await admin.get(`/api/employees/${S.ids.ines}/qr.svg`);
  assert.equal(svg.status, 200);
  assert.match(svg.data, /<svg/);
  const checks = await gardien.get('/api/gate/history?periode=aujourdhui');
  assert.ok(checks.data.checks.some((c) => c.methode === 'qr'));
});

test("Journal d'audit infalsifiable", async () => {
  assert.throws(() => S.db.run('DELETE FROM audit_logs'), /lecture seule/);
  assert.throws(() => S.db.run("UPDATE audit_logs SET action = 'X'"), /lecture seule/);
  const v = await admin.get('/api/audit/verify');
  assert.equal(v.data.ok, true);
  assert.ok(v.data.count > 50);
  assert.equal((await rh.get('/api/audit')).status, 403);
});

test('Sécurité : CSRF, mot de passe, verrouillage, inactivité', async () => {
  // Requête modifiante sans en-tête applicatif
  const raw = await fetch(`${S.base}/api/authorizations`, { method: 'POST', headers: { Cookie: rh.cookie(), 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(raw.status, 403);
  // Politique de mot de passe
  const weak = await admin.post('/api/users', { nom: 'X', prenom: 'Y', username: 'faible', role: 'rh', password: 'abc' });
  assert.equal(weak.status, 400);
  const created = await admin.post('/api/users', { nom: 'NOUVEAU', prenom: 'Rh', username: 'rh2', role: 'rh' });
  assert.equal(created.status, 201);
  assert.ok(created.data.temporary_password);
  const c = client(S.base);
  await c.login('rh2', created.data.temporary_password);
  assert.equal((await c.get('/api/dashboard')).status, 403, 'changement de mot de passe exigé');
  assert.equal((await c.post('/api/auth/change-password', { current: created.data.temporary_password, password: 'Nouveau#Pass2027' })).status, 200);
  assert.equal((await c.get('/api/dashboard')).status, 200);
  // Verrouillage après 5 échecs
  const bad = client(S.base);
  for (let i = 0; i < 5; i++) await bad.request('POST', '/api/auth/login', { username: 'rh2', password: 'mauvais' });
  const locked = await bad.request('POST', '/api/auth/login', { username: 'rh2', password: 'Nouveau#Pass2027' });
  assert.equal(locked.status, 423);
  // Déconnexion automatique après inactivité (20 min par défaut)
  const idle = client(S.base);
  await idle.login('chefa');
  clock.advance(21);
  const r = await idle.get('/api/auth/me');
  assert.equal(r.status, 401);
  assert.match(r.data.error, /inactivit/);
});

test('Suppression : désactivation si historique lié (aucune trace perdue)', async () => {
  at('2027-04-18', '11:00');
  const r = await admin.request('DELETE', `/api/employees/${S.ids.mohamed}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.deactivated, true);
  assert.equal(S.db.get('SELECT actif FROM employees WHERE id = ?', S.ids.mohamed).actif, 0);
  assert.ok(S.db.get('SELECT COUNT(*) AS n FROM exit_authorizations WHERE employee_id = ?', S.ids.mohamed).n > 0);
});

test('Tableau de bord', async () => {
  at('2026-10-05', '23:50');
  const d = await rh.get('/api/dashboard');
  assert.equal(d.status, 200);
  assert.equal(d.data.date, '2026-10-05');
  assert.ok(d.data.aujourdhui.total >= 2);
  assert.equal(d.data.last7.length, 7);
  const c = await chefB.get('/api/dashboard');
  assert.equal(c.status, 200);
});

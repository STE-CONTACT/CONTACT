'use strict';
/**
 * Mode par défaut : l'autorisation donnée par le chef est valable immédiatement et part au gardien.
 * Le RH ne valide pas : il consulte l'historique et télécharge le fichier Excel de suivi.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { startServer, client, tunis, clock } = require('./helpers');

let S; let chef; let rh; let gardien;
const at = (d, t) => { clock.set(tunis(d, t)); S.db.run('UPDATE sessions SET last_seen_at = ?', clock.nowIso()); };

test.before(async () => {
  S = await startServer({ validationRh: false });
  chef = client(S.base); rh = client(S.base); gardien = client(S.base);
  at('2026-10-05', '23:00');
  await chef.login('chefb'); await rh.login('rh'); await gardien.login('gardien');
});
test.after(async () => { await S.stop(); });

test('Le chef autorise → VALIDÉE tout de suite, le gardien est prévenu, pas le RH', async () => {
  at('2026-10-05', '23:20');
  const c = await chef.post('/api/authorizations', { employee_id: S.ids.mohamed, date_sortie: '2026-10-05', heure_sortie_prevue: '23:30', heure_retour_prevue: '01:00', type_sortie: 'PERSONNELLE', motif: 'Personnel' });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  assert.equal(c.data.statut, 'VALIDEE');
  assert.equal(c.data.approved_by, S.ids.chefB, 'autorisé par le chef');
  const g = await gardien.get('/api/notifications');
  assert.ok(g.data.items.some((n) => n.type === 'AUTORISATION_VALIDEE' && n.entity_id === c.data.id));
  const r = await rh.get('/api/notifications');
  assert.ok(!r.data.items.some((n) => n.entity_id === c.data.id), 'le RH ne reçoit rien à valider');
  at('2026-10-05', '23:35');
  assert.equal((await gardien.get('/api/gate/lookup?q=4587')).data.verdict, 'VALIDEE');
  assert.equal((await gardien.post(`/api/gate/${c.data.id}/exit`, {})).status, 200);
  at('2026-10-06', '00:48');
  assert.equal((await gardien.post(`/api/gate/${c.data.id}/return`, {})).status, 200);
  // Sans retour, également direct
  const s = await chef.post('/api/authorizations', { employee_id: S.ids.sami, date_sortie: '2026-10-06', heure_sortie_prevue: '01:00', avec_retour: false, type_sortie: 'URGENCE', motif: 'Maladie' });
  assert.equal(s.data.statut, 'VALIDEE');
  at('2026-10-06', '01:02');
  assert.equal((await gardien.post(`/api/gate/${s.data.id}/exit`, {})).data.statut, 'SORTIE_DEFINITIVE');
});

test('Le RH télécharge le fichier Excel de suivi', async () => {
  const res = await fetch(`${S.base}/api/rapport.xlsx?date_from=2026-10-05&date_to=2026-10-06`, { headers: { Cookie: rh.cookie() } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /spreadsheetml/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const ws = wb.getWorksheet('Suivi des sorties');
  assert.match(ws.getCell('A2').value, /du 05\/10\/2026 au 06\/10\/2026/);
  const values = [];
  ws.eachRow((row, n) => { if (n > 5) values.push(row.values.slice(1)); });
  const mohamed = values.find((v) => v[1] === '4587');
  assert.ok(mohamed, 'ligne 4587 présente');
  assert.equal(mohamed[6], 'Avec retour');
  assert.equal(mohamed[11], '23:35');
  assert.equal(mohamed[12], '00:48 (J+1)');
  assert.equal(mohamed[13], '1 h 13 min');
  const sami = values.find((v) => v[1] === '4600');
  assert.equal(sami[6], 'Sans retour');
  assert.equal(sami[15], 'Sortie sans retour');
  assert.ok(wb.getWorksheet('Synthèse'));
  // Le gardien n'a pas accès au rapport
  const g = await fetch(`${S.base}/api/rapport.xlsx`, { headers: { Cookie: gardien.cookie() } });
  assert.equal(g.status, 403);
});

test('Badge QR scanné plusieurs fois : une autorisation ne sert qu\'une seule fois', async () => {
  at('2026-10-07', '10:00');
  const emp = S.db.get('SELECT matricule, qr_token FROM employees WHERE id = ?', S.ids.amine);
  const badge = `SORTIE:${emp.matricule}:${emp.qr_token}`;
  const scan = async () => (await gardien.get(`/api/gate/lookup?q=${encodeURIComponent(badge)}`)).data; // douchette = saisie clavier
  assert.equal((await scan()).verdict, 'AUCUNE', 'pas d\'autorisation → rouge');
  S.db.run('UPDATE users SET droit_toutes_equipes = 1 WHERE id = ?', S.ids.chefB);
  const c = await chef.post('/api/authorizations', { employee_id: S.ids.amine, date_sortie: '2026-10-07', heure_sortie_prevue: '10:05', heure_retour_prevue: '11:00', type_sortie: 'PERSONNELLE', motif: 'Personnel' });
  assert.equal(c.data.statut, 'VALIDEE');
  const v1 = await scan();
  assert.equal(v1.verdict, 'VALIDEE', 'vert');
  assert.equal((await gardien.post(`/api/gate/${v1.authorization.id}/exit`, {})).status, 200);
  // 2e scan : la personne est déjà dehors → aucune 2e sortie possible
  assert.equal((await scan()).verdict, 'A_L_EXTERIEUR');
  assert.equal((await gardien.post(`/api/gate/${c.data.id}/exit`, {})).status, 409);
  at('2026-10-07', '10:40');
  assert.equal((await gardien.post(`/api/gate/${c.data.id}/return`, {})).status, 200);
  // Après le retour : l'autorisation est consommée → rouge
  assert.equal((await scan()).verdict, 'AUCUNE');
  // Faux badge (photo/copie d'un ancien code après régénération) → inconnu
  S.db.run("UPDATE employees SET qr_token = 'nouveauJeton' WHERE id = ?", S.ids.amine);
  assert.equal((await scan()).verdict, 'INCONNU');
});

test('Badge = lien ouvert par l\'appareil photo du téléphone (ou tapé par une douchette)', async () => {
  at('2026-10-08', '09:00');
  const emp = S.db.get('SELECT matricule, qr_token FROM employees WHERE id = ?', S.ids.ines);
  const lien = `http://192.168.1.10:3000/#/garde?badge=${emp.matricule}.${emp.qr_token}`;
  assert.equal((await gardien.get(`/api/gate/lookup?qr=${encodeURIComponent(`badge=${emp.matricule}.${emp.qr_token}`)}`)).data.employee.matricule, '4101');
  assert.equal((await gardien.get(`/api/gate/lookup?q=${encodeURIComponent(lien)}`)).data.employee.matricule, '4101');
  assert.equal((await gardien.get(`/api/gate/lookup?qr=${encodeURIComponent(`badge=${emp.matricule}.mauvais`)}`)).data.verdict, 'INCONNU');
  const adr = await rh.get('/api/badge-address');
  assert.match(adr.data.adresse, /^http:\/\//);
  assert.doesNotMatch(adr.data.adresse, /localhost|127\.0\.0\.1/, 'les téléphones ne peuvent pas ouvrir « localhost »');
});

test('Le RH peut aussi donner une autorisation (tout le personnel), valable immédiatement', async () => {
  at('2026-10-09', '10:00');
  const c = await rh.post('/api/authorizations', { employee_id: S.ids.ines, date_sortie: '2026-10-09', heure_sortie_prevue: '10:15', heure_retour_prevue: '11:00', type_sortie: 'RENDEZ_VOUS', motif: 'Rendez-vous médical' });
  assert.equal(c.status, 201, JSON.stringify(c.data));
  assert.equal(c.data.statut, 'VALIDEE');
  assert.equal(c.data.approved_by, S.ids.rh);
  const g = await gardien.get('/api/notifications');
  assert.ok(g.data.items.some((n) => n.entity_id === c.data.id && /Autorisée par/.test(n.message)));
  assert.equal((await gardien.get('/api/gate/lookup?q=4101')).data.verdict, 'VALIDEE');
  // Le gardien ne peut toujours pas créer d'autorisation
  assert.equal((await gardien.post('/api/authorizations', { employee_id: S.ids.ines })).status, 403);
});

test('Réglage « Jamais » : toujours connecté, même après 60 jours sans activité', async () => {
  S.ctx.settings.update({ session_inactivite_gardien_min: 0, session_inactivite_min: 0 });
  at('2026-10-10', '08:00');
  const g = client(S.base); await g.login('gardien');
  const me = await g.get('/api/auth/me');
  assert.match(me.headers.get('set-cookie'), /Max-Age=34560000/, 'cookie renouvelé pour 400 jours');
  clock.set(tunis('2026-12-15', '08:00'));
  assert.equal((await g.get('/api/auth/me')).status, 200);
  assert.equal((await g.get('/api/gate/board')).status, 200);
  // L'admin peut toujours couper l'accès en désactivant le compte
  S.db.run("UPDATE users SET actif = 0 WHERE username = 'gardien'");
  assert.equal((await g.get('/api/auth/me')).status, 401);
  S.db.run("UPDATE users SET actif = 1 WHERE username = 'gardien'");
});

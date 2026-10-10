'use strict';
/**
 * Tests de sécurité : chaque rôle n'accède qu'à ce qui le concerne, et les attaques web
 * courantes (accès sans connexion, CSRF, fichiers piégés, chemins, injections) sont bloquées.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, tunis, clock } = require('./helpers');

let S; let admin; let chef; let rh; let gardien; let anonyme;

test.before(async () => {
  S = await startServer({ validationRh: false });
  admin = client(S.base); chef = client(S.base); rh = client(S.base); gardien = client(S.base); anonyme = client(S.base);
  clock.set(tunis('2026-10-10', '09:00'));
  await admin.login('admin'); await chef.login('chefa'); await rh.login('rh'); await gardien.login('gardien');
});
test.after(async () => { await S.stop(); });

test('Sans connexion : toutes les données sont refusées', async () => {
  for (const url of ['/api/authorizations', '/api/employees', '/api/users', '/api/audit', '/api/gate/board', '/api/gate/lookup?q=4100',
    '/api/dashboard', '/api/settings', '/api/backups', '/api/rapport.xlsx', '/api/notifications', '/api/employees/1/photo', '/api/outside']) {
    assert.equal((await anonyme.get(url)).status, 401, url);
  }
  // Seules la page de connexion et des informations publiques sont accessibles
  const pub = await anonyme.get('/api/auth/public');
  assert.equal(pub.status, 200);
  // (« adresse_telephone » n'apparaît que sur le PC serveur lui-même : adresse réseau locale, sans donnée sensible)
  assert.deepEqual(Object.keys(pub.data).filter((k) => k !== 'adresse_telephone').sort(), ['entreprise_nom', 'version']);
});

test('Droits par rôle (matrice)', async () => {
  const matrix = [
    // [url, admin, rh, chef, gardien]
    ['/api/users', 200, 403, 403, 403],
    ['/api/audit', 200, 403, 403, 403],
    ['/api/settings', 200, 403, 403, 403],
    ['/api/backups', 200, 403, 403, 403],
    ['/api/authorizations', 200, 200, 200, 403],
    ['/api/employees', 200, 200, 200, 403],
    ['/api/dashboard', 200, 200, 200, 403],
    ['/api/gate/board', 200, 403, 403, 200],
    ['/api/gate/history', 200, 403, 403, 200],
  ];
  const who = [admin, rh, chef, gardien];
  for (const [url, ...expected] of matrix) {
    for (let i = 0; i < who.length; i++) assert.equal((await who[i].get(url)).status, expected[i], `${url} rôle n°${i}`);
  }
  // Un chef ne peut pas se donner les droits d'administrateur
  assert.equal((await chef.put(`/api/users/${S.ids.chefA}`, { role: 'admin' })).status, 403);
  assert.equal((await chef.put('/api/settings', { validation_rh_requise: true })).status, 403);
  // Le gardien ne peut pas créer, annuler ni confirmer à la place d'un responsable
  assert.equal((await gardien.post('/api/authorizations', {})).status, 403);
});

test('Le gardien ne voit aucune information confidentielle', async () => {
  const c = await chef.post('/api/authorizations', { employee_id: S.ids.amine, date_sortie: '2026-10-10', heure_sortie_prevue: '09:10', heure_retour_prevue: '10:00', type_sortie: 'RENDEZ_VOUS', motif: 'Consultation médicale confidentielle', commentaire: 'Secret' });
  assert.equal(c.status, 201);
  const texts = JSON.stringify([
    (await gardien.get('/api/gate/lookup?q=4100')).data,
    (await gardien.get('/api/gate/board')).data,
    (await gardien.get('/api/outside')).data,
    (await gardien.get('/api/notifications')).data,
  ]);
  assert.doesNotMatch(texts, /confidentielle|Secret|RENDEZ_VOUS|telephone/);
  assert.equal((await gardien.get(`/api/authorizations/${c.data.id}`)).status, 403);
});

test('Un chef ne voit pas les autorisations ni le personnel des autres affectations', async () => {
  const other = await rh.post('/api/authorizations', { employee_id: S.ids.mohamed, date_sortie: '2026-10-10', heure_sortie_prevue: '11:00', heure_retour_prevue: '12:00', type_sortie: 'PERSONNELLE', motif: 'Personnel' });
  assert.equal(other.status, 201);
  assert.equal((await chef.get(`/api/authorizations/${other.data.id}`)).status, 404);
  assert.equal((await chef.get(`/api/employees/${S.ids.mohamed}`)).status, 403);
  assert.equal((await chef.post(`/api/authorizations/${other.data.id}/cancel`, {})).status, 404);
  const list = await chef.get('/api/authorizations?size=200');
  assert.ok(!list.data.items.some((a) => a.id === other.data.id));
});

test('Attaque CSRF (requête venant d\'un autre site) bloquée', async () => {
  const res = await fetch(`${S.base}/api/authorizations`, {
    method: 'POST',
    headers: { Cookie: chef.cookie(), 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', Origin: 'https://site-pirate.example' },
    body: JSON.stringify({ employee_id: S.ids.ines }),
  });
  assert.equal(res.status, 403);
  const noHeader = await fetch(`${S.base}/api/auth/logout`, { method: 'POST', headers: { Cookie: chef.cookie() } });
  assert.equal(noHeader.status, 403);
});

test('Fichiers piégés refusés (faux PDF / fausse image contenant du HTML)', async () => {
  const html = Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
  const fake = await chef.post('/api/authorizations', {
    employee_id: S.ids.ines, date_sortie: '2026-10-10', heure_sortie_prevue: '13:00', heure_retour_prevue: '14:00', type_sortie: 'AUTRE', motif: 'Test',
    piece_jointe: { name: 'justif.pdf', type: 'application/pdf', data: html },
  });
  assert.equal(fake.status, 400);
  assert.match(fake.data.error, /ne correspond pas/);
  const svg = await chef.post('/api/authorizations', {
    employee_id: S.ids.ines, date_sortie: '2026-10-10', heure_sortie_prevue: '13:00', heure_retour_prevue: '14:00', type_sortie: 'AUTRE', motif: 'Test',
    piece_jointe: { name: 'x.svg', type: 'image/svg+xml', data: html },
  });
  assert.equal(svg.status, 400);
  assert.equal((await admin.post(`/api/employees/${S.ids.ines}/photo`, { type: 'image/png', data: html })).status, 400);
  // Un vrai PDF est accepté
  const pdf = Buffer.from('%PDF-1.4\n%test\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
  const ok = await chef.post('/api/authorizations', {
    employee_id: S.ids.ines, date_sortie: '2026-10-10', heure_sortie_prevue: '13:00', heure_retour_prevue: '14:00', type_sortie: 'AUTRE', motif: 'Test',
    piece_jointe: { name: 'justif.pdf', type: 'application/pdf', data: pdf },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  const dl = await fetch(`${S.base}/api/authorizations/${ok.data.id}/attachment`, { headers: { Cookie: chef.cookie() } });
  assert.equal(dl.headers.get('content-type'), 'application/pdf');
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
});

test('Chemins piégés (accès à d\'autres fichiers du serveur) refusés', async () => {
  for (const name of ['../sorties.db', '..%2F..%2Fpackage.json', 'sorties.db', '%2e%2e%2f.env']) {
    const r = await admin.get(`/api/backups/${name}`);
    assert.ok([400, 404].includes(r.status), `${name} → ${r.status}`);
  }
  assert.equal((await fetch(`${S.base}/.env`)).status, 404);
  assert.equal((await fetch(`${S.base}/../src/config.js`)).status, 404);
  assert.equal((await fetch(`${S.base}/data/sorties.db`)).status, 404);
});

test('Injection SQL sans effet', async () => {
  const r = await rh.get(`/api/authorizations?q=${encodeURIComponent("' OR 1=1 --")}&matricule=${encodeURIComponent("x' OR '1'='1")}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.total, 0);
  const g = await gardien.get(`/api/gate/lookup?q=${encodeURIComponent("4100' OR '1'='1")}`);
  assert.equal(g.data.verdict, 'INCONNU');
  assert.ok(S.db.get('SELECT COUNT(*) AS n FROM users').n >= 5, 'aucune table touchée');
});

test('Texte piégé (script) stocké tel quel, jamais exécuté ; formules Excel neutralisées', async () => {
  const c = await chef.post('/api/authorizations', { employee_id: S.ids.amine, date_sortie: '2026-10-10', heure_sortie_prevue: '15:00', heure_retour_prevue: '16:00', type_sortie: 'AUTRE', motif: '=HYPERLINK("http://pirate","clic")<img src=x onerror=alert(1)>' });
  assert.equal(c.status, 201);
  const r = await fetch(`${S.base}/api/authorizations/${c.data.id}`, { headers: { Cookie: chef.cookie() } });
  assert.match(r.headers.get('content-type'), /application\/json/);
  const csv = await rh.get('/api/authorizations/export.csv?date_from=2026-10-10&date_to=2026-10-10');
  assert.match(csv.data, /'=HYPERLINK/, 'formule neutralisée dans le CSV');
});

test('Notifications push : adresse arbitraire refusée (pas d\'envoi vers un site quelconque)', async () => {
  const keys = { p256dh: 'BOr8x', auth: 'abc' };
  assert.equal((await gardien.post('/api/push/subscribe', { endpoint: 'https://192.168.1.1/admin', keys })).status, 400);
  assert.equal((await gardien.post('/api/push/subscribe', { endpoint: 'http://fcm.googleapis.com/x', keys })).status, 400);
  assert.equal((await gardien.post('/api/push/subscribe', { endpoint: 'https://fcm.googleapis.com.pirate.com/x', keys })).status, 400);
  assert.equal((await gardien.post('/api/push/subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys })).status, 200);
});

test('En-têtes de sécurité présents', async () => {
  const r = await fetch(`${S.base}/`);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
  const login = await fetch(`${S.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify({ username: 'chefb', password: 'Test@Password1' }) });
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
});

test('Mots de passe jamais exposés ; jeton de session stocké chiffré', async () => {
  const users = await admin.get('/api/users');
  assert.doesNotMatch(JSON.stringify(users.data), /password_hash|scrypt\$/);
  const audit = await admin.get('/api/audit?size=200');
  assert.doesNotMatch(JSON.stringify(audit.data), /scrypt\$|Test@Password1/);
  const token = admin.cookie().split('=')[1];
  assert.equal(S.db.get('SELECT COUNT(*) AS n FROM sessions WHERE id = ?', token).n, 0, 'le jeton brut n\'est pas en base');
});

test('Téléphone perdu : l\'admin déconnecte tous les appareils d\'une personne', async () => {
  const phone = client(S.base);
  await phone.login('gardien');
  assert.equal((await phone.get('/api/gate/board')).status, 200);
  const r = await admin.post(`/api/users/${S.ids.gardien}/logout-all`);
  assert.equal(r.status, 200);
  assert.ok(r.data.sessions >= 1);
  assert.equal((await phone.get('/api/gate/board')).status, 401);
  assert.equal((await chef.post(`/api/users/${S.ids.gardien}/logout-all`)).status, 403);
  await gardien.login('gardien');
});

test('Données de démonstration interdites sur un serveur en production', () => {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/db/seed-demo.js'], {
    cwd: require('node:path').join(__dirname, '..'), env: { ...process.env, TRUST_PROXY: '1', DATA_DIR: require('node:os').tmpdir() }, encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /production/);
});

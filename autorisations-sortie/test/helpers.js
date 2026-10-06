'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');
const clock = require('../src/lib/clock');
const { hashPassword, randomToken } = require('../src/lib/security');

const PASSWORD = 'Test@Password1';

/** Démarre une instance isolée (base temporaire) avec un jeu de données minimal. */
async function startServer({ validationRh = true } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sorties-test-'));
  process.env.ADMIN_PASSWORD = PASSWORD;
  const { app, ctx, close } = createApp({ dataDir, startJobs: false, quiet: true });
  const { db } = ctx;
  ctx.settings.update({ fuseau_horaire: 'Africa/Tunis', validation_rh_requise: validationRh });
  db.run('UPDATE users SET must_change_password = 0 WHERE username = ?', 'admin');

  const now = new Date().toISOString();
  const shift = Object.fromEntries(db.all('SELECT id, nom FROM shifts').map((s) => [s.nom, s.id]));
  const service = Number(db.run("INSERT INTO services (nom, actif, created_at) VALUES ('Production', 1, ?)", now).lastInsertRowid);
  const user = (username, role, extra = {}) => Number(db.run(`INSERT INTO users (nom, prenom, username, password_hash, role, team_id, poste_garde, actif, must_change_password, created_at)
    VALUES (?,?,?,?,?,?,?,1,0,?)`, username.toUpperCase(), username, username, hashPassword(PASSWORD), role, extra.team_id || null, extra.poste_garde || null, now).lastInsertRowid);
  const chefB = user('chefb', 'chef');
  const chefA = user('chefa', 'chef');
  const rh = user('rh', 'rh');
  const gardien = user('gardien', 'gardien', { poste_garde: 'Poste de garde principal' });
  const teamB = Number(db.run('INSERT INTO teams (nom, chef_equipe_id, shift_id, service_id, actif, created_at) VALUES (?,?,?,?,1,?)', 'Équipe B', chefB, shift['Poste 3'], service, now).lastInsertRowid);
  const teamA = Number(db.run('INSERT INTO teams (nom, chef_equipe_id, shift_id, service_id, actif, created_at) VALUES (?,?,?,?,1,?)', 'Équipe A', chefA, shift['Poste 1'], service, now).lastInsertRowid);
  const emp = (matricule, nom, prenom, team, sh) => Number(db.run(`INSERT INTO employees (matricule, nom, prenom, service_id, team_id, shift_id, qr_token, actif, created_at)
    VALUES (?,?,?,?,?,?,?,1,?)`, matricule, nom, prenom, service, team, shift[sh], randomToken(12), now).lastInsertRowid);
  const mohamed = emp('4587', 'BEN ALI', 'Mohamed', teamB, 'Poste 3');
  const sami = emp('4600', 'GHARBI', 'Sami', teamB, 'Poste 3');
  const amine = emp('4100', 'TRABELSI', 'Amine', teamA, 'Poste 1');
  const ines = emp('4101', 'MEJRI', 'Ines', teamA, 'Poste 1');

  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base, ctx, db,
    ids: { chefB, chefA, rh, gardien, teamA, teamB, mohamed, sami, amine, ines, service },
    async stop() { clock.set(null); await new Promise((r) => server.close(r)); close(); fs.rmSync(dataDir, { recursive: true, force: true }); },
  };
}

/** Client HTTP avec cookie de session. */
function client(base) {
  let cookie = '';
  async function request(method, url, body, { headers = {} } = {}) {
    const res = await fetch(base + url, {
      method,
      headers: { 'X-Requested-With': 'fetch', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  return {
    request,
    get: (u, o) => request('GET', u, null, o),
    post: (u, b = {}, o) => request('POST', u, b, o),
    put: (u, b = {}, o) => request('PUT', u, b, o),
    cookie: () => cookie,
    async login(username, password = PASSWORD) {
      const r = await request('POST', '/api/auth/login', { username, password });
      if (r.status !== 200) throw new Error(`login ${username}: ${r.status} ${JSON.stringify(r.data)}`);
      return r.data;
    },
  };
}

/** Heure locale Tunis (UTC+1, sans heure d'été) → instant ISO. */
const tunis = (date, time) => new Date(`${date}T${time}:00+01:00`).toISOString();

module.exports = { startServer, client, tunis, PASSWORD, clock };

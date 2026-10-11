'use strict';
/** Import du fichier Excel du personnel (régime mensuel / horaire) et initialisation avec les comptes réels. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ExcelJS = require('exceljs');
const { startServer, client, tunis, clock } = require('./helpers');

async function sampleXlsx() {
  const wb = new ExcelJS.Workbook();
  const m = wb.addWorksheet('regimen mensuel');
  m.addRow(['  Matricule  ', '       Nom', '   Prénom', '  Fonction']);
  m.addRow([4, 'BEN ROMDHANE', 'KARIM', 'RESP.PROD.ASSEMBLAGE']);
  m.addRow([206, 'HICHRI', 'MARWEN', 'RESP.PROD.INJECT° ET MAINT']);
  m.addRow([16, 'KHALFAOUI', 'AFEF', 'Opératrice']);
  const h = wb.addWorksheet('regime horaire');
  h.addRow(['Matricule', 'Nom', 'Prénom', 'Fonction', 'Affectation']);
  h.addRow([10012, 'KHADHRAOUI', 'NEJMA', 'Opératrice', 'INJECTION']);
  h.addRow([10014, 'ZAAFOURI', 'RABAA', 'Opératrice', 'ASSEMBLAGE SAGEM']);
  h.addRow([10809, 'MEJRI', 'KAIS', 'GARDIEN', 'AFF.GENERAL']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('Import Excel depuis l\'écran admin (remplacement du personnel)', async () => {
  const S = await startServer({ validationRh: false });
  try {
    const admin = client(S.base); clock.set(tunis('2026-10-12', '08:00')); await admin.login('admin');
    const r = await admin.post('/api/employees/import-xlsx', { data: (await sampleXlsx()).toString('base64'), remplacer: true });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.created, 6);
    assert.equal(r.data.removed, 4, 'anciennes personnes de test retirées');
    const list = (await admin.get('/api/employees')).data;
    const afef = list.find((e) => e.matricule === '16');
    assert.equal(afef.regime, 'Mensuel');
    assert.equal(afef.equipe, 'PERSONNEL MENSUEL');
    assert.equal(afef.prenom, 'Afef');
    const nejma = list.find((e) => e.matricule === '10012');
    assert.deepEqual([nejma.regime, nejma.equipe, nejma.fonction], ['Horaire', 'INJECTION', 'Opératrice']);
    // Faux fichier refusé
    assert.equal((await admin.post('/api/employees/import-xlsx', { data: Buffer.from('<html>').toString('base64') })).status, 400);
    // Filtre par régime
    assert.equal((await admin.get('/api/employees?regime=Horaire')).data.length, 3);
  } finally { await S.stop(); }
});

test('Initialisation avec le vrai personnel et les comptes demandés', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sorties-reel-'));
  const xlsx = path.join(dir, 'base.xlsx');
  fs.writeFileSync(xlsx, await sampleXlsx());
  const env = { ...process.env, DATA_DIR: path.join(dir, 'data') };
  delete env.ADMIN_PASSWORD;
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/db/init-reel.js', xlsx], { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /6 personnes \(3 régime mensuel, 3 régime horaire\)/);
  // Connexion avec les identifiants demandés, changement de mot de passe imposé
  const { createApp } = require('../src/app');
  const { app, close } = createApp({ dataDir: path.join(dir, 'data'), startJobs: false, quiet: true });
  const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [u, p, role] of [['Karim', 'Karim', 'chef'], ['Marwen', 'Marwen', 'chef'], ['RH', 'RH', 'rh'], ['Gardien', 'Gardien', 'gardien'], ['Admin', 'Admin', 'admin']]) {
      const c = client(base);
      const me = await c.login(u, p);
      assert.equal(me.user.role, role, u);
      assert.equal(me.user.must_change_password, true, `${u} doit changer son mot de passe`);
      assert.equal((await c.get('/api/dashboard')).status, 403, 'accès bloqué tant que le mot de passe n\'est pas changé');
    }
    const karim = client(base);
    await karim.login('Karim', 'Karim');
    assert.equal((await karim.post('/api/auth/change-password', { current: 'Karim', password: 'Assemblage#2026' })).status, 200);
    const mine = (await karim.get('/api/employees')).data.map((e) => e.matricule);
    assert.deepEqual(mine, ['10014'], 'Karim voit le personnel ASSEMBLAGE uniquement');
  } finally { server.close(); close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

'use strict';
/**
 * Jeu de données de démonstration : npm run seed:demo
 * Crée services, équipes, utilisateurs de chaque rôle, ~40 opérateurs et plusieurs mois d'historique
 * en rejouant le vrai workflow (création → validation → sortie → retour) avec une horloge simulée.
 */
const clock = require('../lib/clock');
const { createApp } = require('../app');
const { hashPassword, randomToken } = require('../lib/security');
const { localDate, addDays, zonedToUtc } = require('../lib/time');

const DEMO_PASSWORD = 'Demo@2026!';
const ADMIN_PASSWORD = 'Admin@2026!';

const { ctx, close } = createApp({ startJobs: false, quiet: true });
const { db, authz, settings } = ctx;

if (db.get("SELECT id FROM employees LIMIT 1")) {
  console.log('La base contient déjà des opérateurs : données de démonstration non ajoutées.');
  console.log('Pour repartir de zéro, supprimez le dossier data/ puis relancez « npm run seed:demo ».');
  close();
  process.exit(0);
}

const tz = settings.tz();
const now = new Date();
const nowIso = now.toISOString();

// ------------------------------------------------------------------ référentiels
const serviceIds = {};
for (const nom of ['Production', 'Maintenance', 'Logistique', 'Qualité']) {
  serviceIds[nom] = Number(db.run('INSERT INTO services (nom, actif, created_at) VALUES (?,1,?)', nom, nowIso).lastInsertRowid);
}
const shift = Object.fromEntries(db.all('SELECT id, nom FROM shifts').map((s) => [s.nom, s.id]));

function addUser(username, nom, prenom, role, extra = {}) {
  const r = db.run(`INSERT INTO users (nom, prenom, username, email, password_hash, role, team_id, poste_garde, actif, must_change_password, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,1,0,?,?)`, nom, prenom, username, extra.email || null, hashPassword(DEMO_PASSWORD), role, extra.team_id || null, extra.poste_garde || null, nowIso, nowIso);
  return Number(r.lastInsertRowid);
}

db.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE username = ?', hashPassword(ADMIN_PASSWORD), 'admin');

const chefA = addUser('chef.ahmed', 'TRABELSI', 'Ahmed', 'chef');
const chefB = addUser('chef.karim', 'JEBALI', 'Karim', 'chef');
const chefC = addUser('chef.sami', 'GHARBI', 'Sami', 'chef');
const rh1 = addUser('rh.leila', 'MANSOUR', 'Leila', 'rh');
const rh2 = addUser('rh.nadia', 'BOUAZIZI', 'Nadia', 'rh');
const g1 = addUser('gardien.ali', 'HAMDI', 'Ali', 'gardien', { poste_garde: 'Poste de garde principal' });
const g2 = addUser('gardien.nabil', 'SASSI', 'Nabil', 'gardien', { poste_garde: 'Poste de garde principal' });

function addTeam(nom, chef, shiftName, service) {
  return Number(db.run('INSERT INTO teams (nom, chef_equipe_id, shift_id, service_id, actif, created_at) VALUES (?,?,?,?,1,?)',
    nom, chef, shift[shiftName], serviceIds[service], nowIso).lastInsertRowid);
}
const teamA = addTeam('Équipe A', chefA, 'Poste 1', 'Production');
const teamB = addTeam('Équipe B', chefB, 'Poste 3', 'Production');
const teamC = addTeam('Équipe C', chefC, 'Poste 2', 'Production');
const teamM = addTeam('Maintenance 1', chefA, 'Poste 1', 'Maintenance');
db.run('UPDATE users SET team_id = ? WHERE id = ?', teamA, chefA);
db.run('UPDATE users SET team_id = ? WHERE id = ?', teamB, chefB);
db.run('UPDATE users SET team_id = ? WHERE id = ?', teamC, chefC);

const PRENOMS = ['Mohamed', 'Ahmed', 'Ali', 'Youssef', 'Hamza', 'Bilel', 'Wassim', 'Amine', 'Sofiane', 'Nizar', 'Mehdi', 'Hichem', 'Fatma', 'Amira', 'Sonia', 'Rania', 'Ines', 'Mariem', 'Khaled', 'Walid'];
const NOMS = ['BEN SALAH', 'TRABELSI', 'GHARBI', 'BEN AMOR', 'JEBALI', 'MEJRI', 'HAMMAMI', 'BOUZID', 'CHAABANE', 'KHELIFI', 'SAIDI', 'FERCHICHI', 'ZOUARI', 'BACCOUCHE', 'RIAHI', 'MZOUGHI', 'KSOURI', 'AYARI', 'DRIDI', 'LAHMAR'];

const employees = [];
function addEmployee(matricule, nom, prenom, team, shiftName, service) {
  const id = Number(db.run(`INSERT INTO employees (matricule, nom, prenom, service_id, team_id, shift_id, telephone, qr_token, actif, created_at, updated_at)
    VALUES (?,?,?,?,?,?,NULL,?,1,?,?)`, matricule, nom, prenom, serviceIds[service], team, shift[shiftName], randomToken(12), nowIso, nowIso).lastInsertRowid);
  employees.push({ id, matricule, team, shiftName });
  return id;
}
// Exemple du cahier des charges
addEmployee('4587', 'BEN ALI', 'Mohamed', teamB, 'Poste 3', 'Production');
addEmployee('4590', 'BEN SALEM', 'Mouna', teamB, 'Poste 3', 'Production');
let mat = 4500;
const teamDefs = [[teamA, 'Poste 1', 'Production'], [teamB, 'Poste 3', 'Production'], [teamC, 'Poste 2', 'Production'], [teamM, 'Poste 1', 'Maintenance']];
for (let i = 0; i < 40; i++) {
  const [team, sh, service] = teamDefs[i % teamDefs.length];
  mat += 3 + (i % 5);
  if (String(mat) === '4587') mat++;
  addEmployee(String(mat), NOMS[(i * 7) % NOMS.length], PRENOMS[(i * 3) % PRENOMS.length], team, sh, service);
}

// ------------------------------------------------------------------ historique simulé
const users = Object.fromEntries(db.all('SELECT * FROM users').map((u) => [u.id, u]));
const chefOfTeam = { [teamA]: chefA, [teamB]: chefB, [teamC]: chefC, [teamM]: chefA };
const shiftStart = { 'Poste 1': 7 * 60, 'Poste 2': 15 * 60, 'Poste 3': 23 * 60 };
const TYPES = ['PERSONNELLE', 'PERSONNELLE', 'RENDEZ_VOUS', 'URGENCE', 'PROFESSIONNELLE', 'AUTRE'];
const MOTIFS = {
  PERSONNELLE: ['Démarche administrative', 'Raison familiale', 'Récupérer un enfant', 'Affaire personnelle'],
  RENDEZ_VOUS: ['Rendez-vous médical', 'Rendez-vous banque', 'Rendez-vous administration'],
  URGENCE: ['Urgence familiale', 'Malaise — consultation', 'Urgence domicile'],
  PROFESSIONNELLE: ['Livraison pièces fournisseur', 'Formation externe', 'Déplacement client'],
  AUTRE: ['Autre motif'],
};
const req = { ip: '127.0.0.1', get: () => 'seed-demo' };
const fakeReq = (ip) => ({ ...req, ip });
let rnd = 42;
const rand = () => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd / 2147483648; };
const pick = (a) => a[Math.floor(rand() * a.length)];
const hhmm = (m) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
const at = (date, minutes) => new Date(zonedToUtc(date, '00:00', tz).getTime() + minutes * 60000);

const today = localDate(now, tz);
let created = 0;
for (let d = 120; d >= 1; d--) {
  const date = addDays(today, -d);
  const perDay = Math.floor(rand() * 4) + (d % 7 === 0 ? 0 : 1);
  for (let k = 0; k < perDay; k++) {
    const emp = pick(employees);
    const start = shiftStart[emp.shiftName] + 60 + Math.floor(rand() * 300);
    const length = 45 + Math.floor(rand() * 150);
    const startDate = start >= 1440 ? addDays(date, 1) : date;
    const type = pick(TYPES);
    try {
      clock.set(at(date, start - 20 - Math.floor(rand() * 60)));
      const chef = users[chefOfTeam[emp.team]];
      const a = authz.create(chef, {
        employee_id: emp.id, date_sortie: startDate, heure_sortie_prevue: hhmm(start), heure_retour_prevue: hhmm(start + length),
        type_sortie: type, motif: pick(MOTIFS[type]), submit: true,
      }, fakeReq('10.0.0.21'));
      const fate = rand();
      clock.advance(3 + Math.floor(rand() * 15));
      const rh = users[pick([rh1, rh2])];
      if (fate < 0.08) {
        authz.reject(rh, a.id, { motif_refus: pick(['Sortie non justifiée', 'Effectif insuffisant sur le poste', 'Justificatif manquant']) }, fakeReq('10.0.0.30'));
      } else if (fate < 0.12) {
        authz.cancel(chef, a.id, { motif: "Annulée à la demande de l'opérateur" }, fakeReq('10.0.0.21'));
      } else if (fate < 0.15) {
        clock.set(new Date(a.fin_at).getTime() + 60000);
        authz.expireDue();
      } else {
        authz.approve(rh, a.id, {}, fakeReq('10.0.0.30'));
        if (fate < 0.19) {
          clock.set(new Date(a.fin_at).getTime() + 60000);
          authz.expireDue();
        } else {
          const guard = users[pick([g1, g2])];
          clock.set(new Date(a.debut_at).getTime() + Math.floor(rand() * 15) * 60000);
          authz.confirmExit(guard, a.id, {}, fakeReq('10.0.0.50'));
          const late = rand() < 0.1 ? 10 + Math.floor(rand() * 40) : -Math.floor(rand() * 30);
          clock.set(new Date(a.fin_at).getTime() + late * 60000);
          authz.expireDue();
          authz.confirmReturn(guard, a.id, {}, fakeReq('10.0.0.50'));
        }
      }
      created++;
    } catch (e) {
      // collision de créneau aléatoire : on ignore
    }
  }
}

// ------------------------------------------------------------------ situation « en cours » (aujourd'hui)
clock.set(null);
const nowMin = Math.floor((now - zonedToUtc(today, '00:00', tz)) / 60000);
const emp4587 = employees[0];
const others = employees.slice(2);
function scenario(emp, chefId, startOffset, length, steps, type = 'PERSONNELLE', avecRetour = true) {
  const chef = users[chefId];
  const s = nowMin + startOffset;
  const date = s >= 1440 ? addDays(today, 1) : s < 0 ? addDays(today, -1) : today;
  clock.set(new Date(now.getTime() + Math.min(startOffset - 30, -5) * 60000));
  const a = authz.create(chef, {
    employee_id: emp.id, date_sortie: date, heure_sortie_prevue: hhmm(s), heure_retour_prevue: avecRetour ? hhmm(s + length) : null,
    avec_retour: avecRetour, type_sortie: type, motif: avecRetour ? pick(MOTIFS[type]) : 'Maladie — quitte le poste', submit: true,
  }, fakeReq('10.0.0.21'));
  if (steps.includes('approve')) { clock.advance(4); authz.approve(users[rh1], a.id, {}, fakeReq('10.0.0.30')); }
  if (steps.includes('exit')) { clock.set(new Date(a.debut_at).getTime() + 2 * 60000); authz.confirmExit(users[g1], a.id, {}, fakeReq('10.0.0.50')); }
  clock.set(null);
  return a;
}
const byTeam = (t) => others.filter((e) => e.team === t);
try {
  scenario(byTeam(teamA)[0], chefA, 15, 90, ['approve']);                 // validée, sortie dans 15 min
  scenario(byTeam(teamC)[0], chefC, 40, 60, [], 'RENDEZ_VOUS');           // en attente
  scenario(byTeam(teamA)[1], chefA, 90, 120, [], 'URGENCE');              // en attente
  scenario(byTeam(teamC)[1], chefC, -40, 120, ['approve', 'exit']);       // à l'extérieur
  scenario(byTeam(teamM)[0], chefA, -150, 90, ['approve', 'exit']);       // à l'extérieur, retour en retard
  scenario(emp4587, chefB, 5, 85, ['approve']);                           // exemple du cahier des charges : MAT. 4587
  scenario(employees[1], chefB, 10, 0, ['approve'], 'URGENCE', false);   // Mme Mouna : sortie SANS RETOUR
} catch (e) { console.warn('Scénario du jour partiel :', e.message); }
authz.expireDue();

// Les notifications de l'historique simulé sont marquées comme lues
db.run('UPDATE notifications SET lu = 1 WHERE created_at < ?', new Date(now.getTime() - 6 * 3600000).toISOString());

console.log(`Données de démonstration créées : ${employees.length} opérateurs, ${created} autorisations historiques.`);
console.log('');
console.log('Comptes de démonstration :');
console.log(`  admin          / ${ADMIN_PASSWORD}   (Administrateur)`);
console.log(`  chef.karim     / ${DEMO_PASSWORD}    (Chef d'équipe — Équipe B, poste 23:00–07:00)`);
console.log(`  chef.ahmed     / ${DEMO_PASSWORD}    (Chef d'équipe — Équipe A + Maintenance 1)`);
console.log(`  chef.sami      / ${DEMO_PASSWORD}    (Chef d'équipe — Équipe C)`);
console.log(`  rh.leila       / ${DEMO_PASSWORD}    (RH / Responsable)`);
console.log(`  gardien.ali    / ${DEMO_PASSWORD}    (Gardien — Poste de garde)`);
close();

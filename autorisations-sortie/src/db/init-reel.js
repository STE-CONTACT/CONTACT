'use strict';
/**
 * Démarrage avec le VRAI personnel : npm run init:reel -- chemin/vers/base.xlsx
 * - part d'une base vide (le dossier data/ doit être vide ou absent : INITIALISER-BASE-REELLE.bat le met de côté) ;
 * - importe le personnel (feuilles « régime mensuel » et « régime horaire ») ;
 * - crée les comptes et rattache les affectations à leur responsable.
 * Les mots de passe ci-dessous sont des mots de passe de PREMIÈRE CONNEXION : un mot de passe
 * personnel sécurisé est exigé immédiatement après.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../app');
const { hashPassword } = require('../lib/security');
const { readPersonnelXlsx } = require('../lib/import-personnel');
const { importPeople } = require('../services/personnel');
const clock = require('../lib/clock');

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!file || !fs.existsSync(file)) {
  console.error('Usage : npm run init:reel -- chemin/vers/base.xlsx');
  process.exit(1);
}

// Comptes demandés : identifiant, mot de passe de première connexion, rôle, matricule de la personne (pour le nom)
const COMPTES = [
  { username: 'karim', password: 'Karim', role: 'chef', matricule: '4', libelle: 'RESP.PROD.ASSEMBLAGE' },
  { username: 'marwen', password: 'Marwen', role: 'chef', matricule: '206', libelle: 'RESP.PROD.INJECTION ET MAINTENANCE' },
  { username: 'rh', password: 'RH', role: 'rh', nom: 'RH', prenom: 'Service' },
  { username: 'gardien', password: 'Gardien', role: 'gardien', nom: 'POSTE DE GARDE', prenom: 'Gardien' },
];
// Personnel dont l'autorisation est réservée au RH (cadres, responsables, administration) :
// les chefs ne les voient pas. Tous les autres sont visibles par Karim et Marwen.
const RESERVES_RH = ['4', '44', '121', '129', '206', '373', '383', '446', '450', '466', '476', '478', '491', '503', '513', '514', '516'];
// Affectation → responsable (les autres affectations sont rattachées au RH, qui peut autoriser tout le monde)
const RESPONSABLE = (nom) => (/ASSEMBLAGE/i.test(nom) ? 'karim' : /INJECTION|MAINT/i.test(nom) ? 'marwen' : 'rh');

(async () => {
  const { ctx, close } = createApp({ startJobs: false, quiet: true });
  const { db } = ctx;
  if (db.get('SELECT COUNT(*) AS n FROM exit_authorizations').n > 0 && !process.argv.includes('--force')) {
    console.error('La base contient déjà des autorisations : utilisez INITIALISER-BASE-REELLE.bat (qui met l\'ancienne base de côté) ou ajoutez --force.');
    close(); process.exit(1);
  }
  const { people, errors } = await readPersonnelXlsx(fs.readFileSync(file));
  if (!people.length) { console.error('Aucune personne trouvée dans le fichier.', errors.join('\n')); close(); process.exit(1); }

  // Retire les données de démonstration éventuelles
  db.tx(() => {
    db.run("DELETE FROM users WHERE username != 'admin'");
    db.run('DELETE FROM teams');
    db.run('DELETE FROM services');
  });
  const report = importPeople(ctx, people, { replace: true });

  const now = clock.nowIso();
  const ids = {};
  db.tx(() => {
    db.run("UPDATE users SET password_hash = ?, must_change_password = 1, nom = 'ADMINISTRATEUR', prenom = 'Admin', updated_at = ? WHERE username = 'admin'", hashPassword('Admin'), now);
    ids.admin = db.get("SELECT id FROM users WHERE username = 'admin'").id;
    for (const c of COMPTES) {
      const emp = c.matricule ? db.get('SELECT nom, prenom FROM employees WHERE matricule = ?', c.matricule) : null;
      const r = db.run(`INSERT INTO users (nom, prenom, username, password_hash, role, actif, must_change_password, created_at, updated_at)
        VALUES (?,?,?,?,?,1,1,?,?)`, emp ? emp.nom : c.nom, emp ? emp.prenom : c.prenom, c.username, hashPassword(c.password), c.role, now, now);
      ids[c.username] = Number(r.lastInsertRowid);
    }
    for (const t of db.all('SELECT id, nom FROM teams')) db.run('UPDATE teams SET chef_equipe_id = ? WHERE id = ?', ids[RESPONSABLE(t.nom)], t.id);
    // Karim et Marwen voient et autorisent tout le personnel (sauf « réservé RH »)
    db.run("UPDATE users SET droit_toutes_equipes = 1 WHERE username IN ('karim', 'marwen')");
    for (const m of RESERVES_RH) db.run('UPDATE employees SET reserve_rh = 1 WHERE matricule = ?', m);
    ctx.audit.log({ user: null, action: 'INITIALISATION', entityType: 'user', after: { personnel: people.length, comptes: COMPTES.map((c) => c.username).concat('admin') } });
  });

  const teams = db.all(`SELECT t.nom, u.username, (SELECT COUNT(*) FROM employees e WHERE e.team_id = t.id) AS n FROM teams t LEFT JOIN users u ON u.id = t.chef_equipe_id ORDER BY t.nom`);
  console.log('');
  console.log(`Personnel importé : ${report.created} personnes (${people.filter((p) => p.regime === 'Mensuel').length} régime mensuel, ${people.filter((p) => p.regime === 'Horaire').length} régime horaire).`);
  if (errors.length || report.errors.length) console.log('Remarques :\n  - ' + [...errors, ...report.errors].join('\n  - '));
  console.log('\nAffectations (responsable) :');
  for (const t of teams) console.log(`  ${t.nom.padEnd(22)} ${String(t.n).padStart(3)} pers.  →  ${t.username}`);
  const nRes = db.get('SELECT COUNT(*) AS n FROM employees WHERE reserve_rh = 1').n;
  console.log(`\nKarim et Marwen voient tout le personnel, sauf ${nRes} personne(s) dont l'autorisation est réservée au RH.`);
  console.log('\nComptes (mot de passe de PREMIÈRE connexion — un nouveau mot de passe sera demandé) :');
  console.log('  Admin    / Admin     Administrateur');
  for (const c of COMPTES) console.log(`  ${c.password.padEnd(8)} / ${c.password.padEnd(9)} ${c.libelle || ({ rh: 'RH', gardien: 'Gardien' }[c.role])}`);
  console.log(`\nBase : ${path.resolve(ctx.config.dbPath)}`);
  close();
})().catch((e) => { console.error('Erreur :', e.message); process.exit(1); });

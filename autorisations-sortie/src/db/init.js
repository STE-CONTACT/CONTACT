'use strict';
const clock = require('../lib/clock');
const { hashPassword, generatePassword } = require('../lib/security');

/** Données de base : postes 3x8, horaire administratif, et compte administrateur initial. */
function initDatabase({ db, config, audit, log }) {
  const now = clock.nowIso();
  if (!db.get('SELECT id FROM shifts LIMIT 1')) {
    db.tx(() => {
      const ins = db.prepare('INSERT INTO shifts (nom, type, heure_debut, heure_fin, pause_debut, pause_fin, actif, created_at) VALUES (?,?,?,?,?,?,1,?)');
      ins.run('Poste 1', 'operateur', '07:00', '15:00', null, null, now);
      ins.run('Poste 2', 'operateur', '15:00', '23:00', null, null, now);
      ins.run('Poste 3', 'operateur', '23:00', '07:00', null, null, now);
      ins.run('Administratif', 'administratif', '08:00', '17:00', '12:00', '13:00', now);
    });
  }
  if (!db.get('SELECT id FROM users LIMIT 1')) {
    const password = config.adminPassword || generatePassword();
    db.tx(() => {
      const r = db.run(`INSERT INTO users (nom, prenom, username, password_hash, role, actif, must_change_password, created_at, updated_at)
        VALUES ('ADMINISTRATEUR', 'Système', 'admin', ?, 'admin', 1, 1, ?, ?)`, hashPassword(password), now, now);
      audit.log({ user: null, action: 'INITIALISATION', entityType: 'user', entityId: Number(r.lastInsertRowid), after: { username: 'admin' } });
    });
    if (!config.quiet) {
      log('================================================================');
      log(' Compte administrateur initial créé');
      log(' Identifiant : admin');
      log(` Mot de passe : ${config.adminPassword ? '(valeur de ADMIN_PASSWORD)' : password}`);
      log(' Le changement du mot de passe sera exigé à la première connexion.');
      log('================================================================');
    }
  }
}

module.exports = { initDatabase };

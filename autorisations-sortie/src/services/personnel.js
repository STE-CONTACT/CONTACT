'use strict';
const clock = require('../lib/clock');
const { randomToken } = require('../lib/security');

const MATRICULE_RE = /^[A-Za-z0-9-]{1,30}$/;

/**
 * Importe (ou met à jour) le personnel. Les affectations inconnues sont créées.
 * replace = true : les personnes absentes du fichier sont supprimées, ou désactivées si elles ont un historique.
 */
function importPeople({ db, audit }, people, { user = null, req = null, replace = false, defaultAffectation = 'PERSONNEL MENSUEL' } = {}) {
  const report = { created: 0, updated: 0, removed: 0, deactivated: 0, affectations: [], errors: [] };
  const now = clock.nowIso();
  const teamId = (nom) => {
    const r = db.get('SELECT id FROM teams WHERE nom = ? COLLATE NOCASE', nom);
    if (r) return r.id;
    report.affectations.push(nom);
    return Number(db.run('INSERT INTO teams (nom, actif, created_at) VALUES (?,1,?)', nom, now).lastInsertRowid);
  };
  db.tx(() => {
    const kept = new Set();
    for (const p of people) {
      const matricule = String(p.matricule || '').trim();
      if (!MATRICULE_RE.test(matricule)) { report.errors.push(`Matricule invalide « ${matricule} » (${p.nom || ''})`); continue; }
      if (!p.nom) { report.errors.push(`Matricule ${matricule} : nom manquant`); continue; }
      const team = teamId(p.affectation || (p.regime === 'Mensuel' ? defaultAffectation : 'NON AFFECTÉ'));
      const prenom = p.prenom || '-';
      const existing = db.get('SELECT id FROM employees WHERE matricule = ? COLLATE NOCASE', matricule);
      if (existing) {
        db.run('UPDATE employees SET nom=?, prenom=?, fonction=?, regime=?, team_id=?, actif=1, updated_at=? WHERE id=?',
          p.nom, prenom, p.fonction || null, p.regime || null, team, now, existing.id);
        report.updated++;
        kept.add(existing.id);
      } else {
        const r = db.run(`INSERT INTO employees (matricule, nom, prenom, fonction, regime, team_id, qr_token, actif, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,1,?,?)`, matricule, p.nom, prenom, p.fonction || null, p.regime || null, team, randomToken(12), now, now);
        report.created++;
        kept.add(Number(r.lastInsertRowid));
      }
    }
    if (replace) {
      for (const e of db.all('SELECT id FROM employees')) {
        if (kept.has(e.id)) continue;
        const used = db.get('SELECT 1 FROM exit_authorizations WHERE employee_id = ? LIMIT 1', e.id) || db.get('SELECT 1 FROM gate_checks WHERE employee_id = ? LIMIT 1', e.id);
        if (used) { db.run('UPDATE employees SET actif = 0, updated_at = ? WHERE id = ?', now, e.id); report.deactivated++; }
        else { db.run('DELETE FROM employees WHERE id = ?', e.id); report.removed++; }
      }
    }
    audit.log({
      user, action: 'OPERATEURS_IMPORTES', entityType: 'employee', req,
      after: { crees: report.created, mis_a_jour: report.updated, supprimes: report.removed, desactives: report.deactivated, remplacement: replace, erreurs: report.errors.length },
    });
  });
  return report;
}

module.exports = { importPeople };

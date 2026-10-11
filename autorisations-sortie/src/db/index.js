'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function openDatabase(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  migrate(db, schema);

  let depth = 0;
  /** Exécute fn dans une transaction (réentrante). */
  db.tx = (fn) => {
    if (depth > 0) return fn();
    db.exec('BEGIN IMMEDIATE');
    depth++;
    try {
      const r = fn();
      depth--;
      db.exec('COMMIT');
      return r;
    } catch (e) {
      depth--;
      try { db.exec('ROLLBACK'); } catch { /* déjà annulée */ }
      throw e;
    }
  };
  db.get = (sql, ...params) => db.prepare(sql).get(...params);
  db.all = (sql, ...params) => db.prepare(sql).all(...params);
  db.run = (sql, ...params) => db.prepare(sql).run(...params);
  return db;
}

/**
 * Migrations des bases existantes.
 * v2 : sortie sans retour (heure de retour facultative + statut SORTIE_DEFINITIVE).
 * SQLite ne permet pas de modifier une contrainte : la table est reconstruite à l'identique, données conservées.
 */
function migrate(db, schema) {
  // v3 : fonction et régime (mensuel / horaire) de chaque personne
  const empCols = db.prepare('PRAGMA table_info(employees)').all().map((c) => c.name);
  if (!empCols.includes('fonction')) db.exec('ALTER TABLE employees ADD COLUMN fonction TEXT');
  if (!empCols.includes('regime')) db.exec('ALTER TABLE employees ADD COLUMN regime TEXT');
  const cols = db.prepare('PRAGMA table_info(exit_authorizations)').all().map((c) => c.name);
  if (cols.includes('avec_retour')) return;
  const create = /CREATE TABLE IF NOT EXISTS exit_authorizations \([\s\S]*?\n\);/.exec(schema)[0]
    .replace('CREATE TABLE IF NOT EXISTS exit_authorizations', 'CREATE TABLE exit_authorizations_v2');
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec(create);
    db.exec(`INSERT INTO exit_authorizations_v2 (${cols.join(', ')}) SELECT ${cols.join(', ')} FROM exit_authorizations`);
    db.exec('DROP TABLE exit_authorizations');
    db.exec('ALTER TABLE exit_authorizations_v2 RENAME TO exit_authorizations');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  db.exec(schema); // recrée les index
}

module.exports = { openDatabase };

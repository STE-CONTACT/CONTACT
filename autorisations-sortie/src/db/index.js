'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function openDatabase(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

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

module.exports = { openDatabase };

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const clock = require('./clock');

const NAME_RE = /^sorties-\d{8}-\d{6}(-[a-z]+)?\.db$/;

/** Sauvegarde cohérente de la base (VACUUM INTO) — fonctionne même pendant l'utilisation. */
function createBackup(db, dir, label = 'manuel') {
  fs.mkdirSync(dir, { recursive: true });
  const ts = clock.now().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const name = `sorties-${ts}-${label}.db`;
  const file = path.join(dir, name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return { name, size: fs.statSync(file).size };
}

function listBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => NAME_RE.test(f)).map((name) => {
    const st = fs.statSync(path.join(dir, name));
    return { name, size: st.size, created_at: st.mtime.toISOString() };
  }).sort((a, b) => b.name.localeCompare(a.name));
}

function pruneBackups(dir, keep) {
  const list = listBackups(dir);
  for (const b of list.slice(keep)) fs.unlinkSync(path.join(dir, b.name));
}

function backupPath(dir, name) {
  if (!NAME_RE.test(name)) return null;
  const p = path.join(dir, name);
  return fs.existsSync(p) ? p : null;
}

module.exports = { createBackup, listBackups, pruneBackups, backupPath };

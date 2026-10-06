'use strict';
const { sha256 } = require('./security');
const { localDate, localTime } = require('./time');
const clock = require('./clock');

const GENESIS = '0'.repeat(64);
const SENSITIVE = new Set(['password_hash', 'password', 'qr_token', 'keys']);

function clean(value) {
  if (value == null) return null;
  if (typeof value !== 'object') return JSON.stringify(value);
  const out = {};
  for (const [k, v] of Object.entries(value)) if (!SENSITIVE.has(k)) out[k] = v;
  return JSON.stringify(out);
}

function rowHash(r) {
  return sha256([
    r.prev_hash, r.user_id ?? '', r.username, r.role ?? '', r.action, r.entity_type ?? '', r.entity_id ?? '',
    r.ancienne_valeur ?? '', r.nouvelle_valeur ?? '', r.date, r.heure, r.created_at, r.ip_address ?? '',
  ].join('|'));
}

/**
 * Journal d'audit en ajout seul : chaque entrée contient l'empreinte de la précédente.
 * Des triggers SQLite interdisent UPDATE et DELETE ; la chaîne d'empreintes permet de
 * détecter toute altération faite en dehors de l'application.
 */
function createAudit(db, settings) {
  const insert = db.prepare(`INSERT INTO audit_logs
    (user_id, username, role, action, entity_type, entity_id, ancienne_valeur, nouvelle_valeur, date, heure, created_at, ip_address, user_agent, prev_hash, hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  function log({ user, action, entityType = null, entityId = null, before = null, after = null, req = null }) {
    const now = clock.now();
    const tz = settings.tz();
    const last = db.get('SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1');
    const r = {
      prev_hash: last ? last.hash : GENESIS,
      user_id: user && user.id != null ? user.id : null,
      username: user ? (user.username || 'Système') : 'Système',
      role: user ? (user.role || null) : 'systeme',
      action,
      entity_type: entityType,
      entity_id: entityId,
      ancienne_valeur: clean(before),
      nouvelle_valeur: clean(after),
      date: localDate(now, tz),
      heure: localTime(now, tz, true),
      created_at: now.toISOString(),
      ip_address: req ? req.ip : null,
    };
    r.hash = rowHash(r);
    insert.run(r.user_id, r.username, r.role, r.action, r.entity_type, r.entity_id, r.ancienne_valeur, r.nouvelle_valeur,
      r.date, r.heure, r.created_at, r.ip_address, req ? String(req.get('user-agent') || '').slice(0, 200) : null, r.prev_hash, r.hash);
  }

  /** Vérifie l'intégrité de toute la chaîne. */
  function verify() {
    let prev = GENESIS;
    let count = 0;
    for (const r of db.prepare('SELECT * FROM audit_logs ORDER BY id').iterate()) {
      count++;
      if (r.prev_hash !== prev || rowHash(r) !== r.hash) return { ok: false, count, brokenAt: r.id };
      prev = r.hash;
    }
    return { ok: true, count };
  }

  return { log, verify };
}

module.exports = { createAudit };

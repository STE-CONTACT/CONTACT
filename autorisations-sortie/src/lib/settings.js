'use strict';
const { isValidTimezone, isValidTime } = require('./time');

/** Paramètres modifiables par l'administrateur (valeurs par défaut). */
const DEFAULTS = {
  entreprise_nom: 'STE CONTACT',
  fuseau_horaire: 'Africa/Tunis',
  // Horaires administratifs RH : purement informatifs, ils ne bloquent JAMAIS l'application.
  rh_heure_debut: '08:00',
  rh_heure_fin: '17:00',
  rh_pause_debut: '12:00',
  rh_pause_fin: '13:00',
  // false : l'autorisation donnée par le chef est valable immédiatement et part au gardien (le RH consulte seulement).
  validation_rh_requise: false,
  tolerance_sortie_avant_min: 30,
  duree_max_heures: 12,
  delai_creation_max_jours: 30,
  session_inactivite_min: 20,
  session_inactivite_gardien_min: 480,
  postes_garde: ['Poste de garde principal'],
  pieces_jointes_actives: true,
  // Scan du QR code au poste de garde (caméra) : désactivé tant que la société n'en a pas besoin.
  scanner_qr_actif: false,
  // Adresse de l'application encodée dans les badges QR (ex. http://192.168.1.10:3000). Vide = automatique.
  adresse_application: '',
  motif_refus_obligatoire: true,
  notifications_email: false,
  sauvegarde_auto: true,
  sauvegarde_heure: '03:00',
  sauvegarde_retention: 30,
};

const RULES = {
  entreprise_nom: (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 100,
  fuseau_horaire: (v) => typeof v === 'string' && isValidTimezone(v),
  rh_heure_debut: isValidTime, rh_heure_fin: isValidTime, rh_pause_debut: isValidTime, rh_pause_fin: isValidTime,
  tolerance_sortie_avant_min: (v) => Number.isInteger(v) && v >= 0 && v <= 240,
  duree_max_heures: (v) => Number.isInteger(v) && v >= 1 && v <= 24,
  delai_creation_max_jours: (v) => Number.isInteger(v) && v >= 0 && v <= 365,
  session_inactivite_min: (v) => Number.isInteger(v) && v >= 5 && v <= 720,
  session_inactivite_gardien_min: (v) => Number.isInteger(v) && v >= 5 && v <= 1440,
  postes_garde: (v) => Array.isArray(v) && v.length > 0 && v.length <= 20 && v.every((x) => typeof x === 'string' && x.trim() && x.length <= 60),
  pieces_jointes_actives: (v) => typeof v === 'boolean',
  scanner_qr_actif: (v) => typeof v === 'boolean',
  adresse_application: (v) => typeof v === 'string' && (v === '' || /^https?:\/\/[^\s/]+$/i.test(v.trim().replace(/\/+$/, ''))),
  validation_rh_requise: (v) => typeof v === 'boolean',
  motif_refus_obligatoire: (v) => typeof v === 'boolean',
  notifications_email: (v) => typeof v === 'boolean',
  sauvegarde_auto: (v) => typeof v === 'boolean',
  sauvegarde_heure: isValidTime,
  sauvegarde_retention: (v) => Number.isInteger(v) && v >= 1 && v <= 365,
};

function createSettings(db, config) {
  let cache = null;

  function load() {
    const out = { ...DEFAULTS, fuseau_horaire: config.defaultTimezone || DEFAULTS.fuseau_horaire };
    for (const row of db.all('SELECT key, value FROM settings')) {
      if (row.key in DEFAULTS) {
        try { out[row.key] = JSON.parse(row.value); } catch { /* ignore */ }
      }
    }
    cache = out;
    return out;
  }

  return {
    all() { return cache || load(); },
    get(key) { return (cache || load())[key]; },
    tz() { return (cache || load()).fuseau_horaire; },
    /** Retourne { before, after } des clés modifiées. */
    update(changes) {
      const current = this.all();
      const before = {}; const after = {};
      for (const [k, v] of Object.entries(changes)) {
        if (!(k in DEFAULTS)) continue;
        if (!RULES[k](v)) throw Object.assign(new Error(`Valeur invalide pour « ${k} »`), { status: 400 });
        if (JSON.stringify(current[k]) !== JSON.stringify(v)) { before[k] = current[k]; after[k] = v; }
      }
      db.tx(() => {
        for (const [k, v] of Object.entries(after)) {
          db.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, JSON.stringify(v));
        }
      });
      cache = null;
      return { before, after };
    },
    /** Valeurs internes (non exposées), ex. clés VAPID. */
    getInternal(key) { const r = db.get('SELECT value FROM settings WHERE key = ?', `_${key}`); return r ? JSON.parse(r.value) : null; },
    setInternal(key, value) {
      db.run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', `_${key}`, JSON.stringify(value));
    },
  };
}

module.exports = { createSettings, DEFAULTS };

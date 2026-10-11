'use strict';
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const compression = require('compression');
const { loadConfig } = require('./config');
const { openDatabase } = require('./db/index');
const { initDatabase } = require('./db/init');
const { createSettings } = require('./lib/settings');
const { createAudit } = require('./lib/audit');
const { createRealtime } = require('./lib/realtime');
const { createNotifier } = require('./lib/notify');
const { createAuth } = require('./middleware/auth');
const { createAuthorizationService } = require('./services/authorizations');
const { HttpError } = require('./lib/errors');
const { createBackup, pruneBackups } = require('./lib/backup');
const { localDate, localTime } = require('./lib/time');
const clock = require('./lib/clock');

function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  const log = (...m) => { if (!config.quiet) console.log(new Date().toISOString(), ...m); };
  const db = openDatabase(config.dbPath);
  const settings = createSettings(db, config);
  const audit = createAudit(db, settings);
  const realtime = createRealtime();
  const notifier = createNotifier({ db, realtime, audit, settings, config, log });
  const auth = createAuth({ db, settings, config });
  const authz = createAuthorizationService({ db, settings, audit, notifier, realtime, config });
  const ctx = { db, config, settings, audit, realtime, notifier, auth, authz, log };
  initDatabase(ctx);

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  // En-têtes de sécurité
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    if (config.secureCookies) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  // Compression des pages et données (chargement plus rapide en Wi-Fi) — sauf le flux temps réel.
  app.use(compression({ filter: (req, res) => !req.path.startsWith('/api/events') && compression.filter(req, res) }));
  app.use(express.json({ limit: '8mb' }));

  // API
  const api = express.Router();
  api.use(auth.csrf);
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use('/auth', require('./routes/auth')(ctx));
  const notif = require('./routes/notifications')(ctx);
  api.get('/events', notif.events);
  api.use(auth.authenticate);
  api.use(notif.router);
  api.use(require('./routes/admin')(ctx));
  api.use(require('./routes/authorizations')(ctx));
  api.get('/health', (req, res) => res.json({ ok: true, time: clock.nowIso() }));
  api.use((req, res, next) => next(new HttpError(404, 'Ressource API introuvable')));
  app.use('/api', api);

  // Fichiers statiques (interface)
  app.get('/vendor/jsQR.js', (req, res) => res.sendFile(require.resolve('jsqr/dist/jsQR.js')));
  app.use(express.static(path.join(config.root, 'public'), { index: 'index.html', maxAge: 0 }));

  // Gestion des erreurs
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) log('ERREUR', err.stack || err);
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Fichier trop volumineux' });
    res.status(status).json({ error: status >= 500 ? 'Erreur interne du serveur' : err.message });
  });

  // Tâches automatiques : expiration, retards, sauvegardes, battements SSE
  const timers = [];
  let lastBackupDay = null;
  function backupTick() {
    const s = settings.all();
    if (!s.sauvegarde_auto) return;
    const now = clock.now();
    const day = localDate(now, s.fuseau_horaire);
    if (localTime(now, s.fuseau_horaire) >= s.sauvegarde_heure && lastBackupDay !== day) {
      lastBackupDay = day;
      const already = fs.existsSync(config.backupsDir) && fs.readdirSync(config.backupsDir).some((f) => f.includes(day.replace(/-/g, '')) && f.endsWith('-auto.db'));
      if (already) return;
      try {
        const b = createBackup(db, config.backupsDir, 'auto');
        pruneBackups(config.backupsDir, s.sauvegarde_retention);
        audit.log({ user: null, action: 'SAUVEGARDE_AUTO', entityType: 'backup', after: b });
        log(`Sauvegarde automatique : ${b.name}`);
      } catch (e) { log('Échec sauvegarde', e.message); }
    }
  }
  function startJobs() {
    timers.push(setInterval(() => { try { authz.expireDue(); } catch (e) { log('expireDue', e.message); } }, 30000));
    timers.push(setInterval(() => realtime.heartbeat(), 25000));
    timers.push(setInterval(backupTick, 60000));
    timers.push(setInterval(() => {
      // Nettoyage des sessions expirées (rien n'est supprimé pour un rôle réglé sur « Jamais »)
      const limits = [['gardien', settings.get('session_inactivite_gardien_min')], ['autres', settings.get('session_inactivite_min')]];
      for (const [role, min] of limits) {
        if (!min) continue;
        const before = new Date(Date.now() - min * 60000 - 3600000).toISOString();
        db.run(`DELETE FROM sessions WHERE last_seen_at < ? AND user_id IN (SELECT id FROM users WHERE role ${role === 'gardien' ? "= 'gardien'" : "!= 'gardien'"})`, before);
      }
    }, 3600000));
    authz.expireDue();
  }
  if (config.startJobs) startJobs();

  function close() {
    for (const t of timers) clearInterval(t);
    realtime.closeAll();
    db.close();
  }

  return { app, ctx, close };
}

module.exports = { createApp };

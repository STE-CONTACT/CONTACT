'use strict';
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/**
 * Configuration lue depuis les variables d'environnement.
 * Les paramètres métier (fuseau, tolérances, postes de garde, etc.)
 * sont stockés en base et modifiables par l'administrateur.
 */
function loadConfig(overrides = {}) {
  const dataDir = path.resolve(overrides.dataDir || process.env.DATA_DIR || path.join(ROOT, 'data'));
  return {
    root: ROOT,
    port: Number(process.env.PORT) || 3000,
    // « :: » écoute à la fois en IPv4 et IPv6 : « localhost » répond tout de suite sous Windows.
    host: process.env.HOST || '::',
    dataDir,
    dbPath: overrides.dbPath || process.env.DB_PATH || path.join(dataDir, 'sorties.db'),
    uploadsDir: path.join(dataDir, 'uploads'),
    backupsDir: overrides.backupsDir || process.env.BACKUP_DIR || path.join(dataDir, 'backups'),
    // Cookie "Secure" : à activer derrière HTTPS (recommandé en production).
    secureCookies: process.env.SECURE_COOKIES === '1' || Boolean(process.env.HTTPS_KEY),
    trustProxy: process.env.TRUST_PROXY === '1',
    httpsKey: process.env.HTTPS_KEY || null,
    httpsCert: process.env.HTTPS_CERT || null,
    adminPassword: process.env.ADMIN_PASSWORD || null,
    defaultTimezone: process.env.TZ_ENTREPRISE || 'Africa/Tunis',
    smtp: process.env.SMTP_HOST ? {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === '1',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      from: process.env.SMTP_FROM || 'autorisations@entreprise.local',
    } : null,
    vapidSubject: process.env.VAPID_SUBJECT || 'mailto:admin@entreprise.local',
    startJobs: overrides.startJobs !== undefined ? overrides.startJobs : true,
    quiet: Boolean(overrides.quiet),
  };
}

module.exports = { loadConfig, ROOT };

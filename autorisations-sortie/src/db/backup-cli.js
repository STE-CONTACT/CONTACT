'use strict';
// Sauvegarde manuelle en ligne de commande : npm run backup
const { loadConfig } = require('../config');
const { openDatabase } = require('./index');
const { createBackup } = require('../lib/backup');

const config = loadConfig();
const db = openDatabase(config.dbPath);
const b = createBackup(db, config.backupsDir, 'cli');
console.log(`Sauvegarde créée : ${config.backupsDir}/${b.name} (${Math.round(b.size / 1024)} Ko)`);
db.close();

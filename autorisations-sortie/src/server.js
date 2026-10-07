'use strict';
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { lanAddresses } = require('./lib/network');
const { createApp } = require('./app');

const { app, ctx, close } = createApp();
const { config, log } = ctx;

const server = config.httpsKey && config.httpsCert
  ? https.createServer({ key: fs.readFileSync(config.httpsKey), cert: fs.readFileSync(config.httpsCert) }, app)
  : http.createServer(app);

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('');
    console.error(`  ERREUR : le port ${config.port} est déjà utilisé.`);
    console.error("  L'application (peut-être une ANCIENNE version) tourne déjà dans une autre fenêtre.");
    console.error('  Fermez toutes les fenêtres noires de l\'application, puis relancez.');
    console.error('');
    process.exit(1);
  }
  throw e;
});

server.listen(config.port, config.host, () => {
  log(`Autorisations de sortie — ${config.httpsKey ? 'https' : 'http'}://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  // Adresses à saisir sur les téléphones / tablettes connectés au même réseau
  const scheme = config.httpsKey ? 'https' : 'http';
  const lan = lanAddresses();
  lan.forEach((a, i) => log(`  ${i === 0 ? 'Adresse pour les TÉLÉPHONES' : 'Autre adresse possible   '} : ${scheme}://${a.address}:${config.port}   (${a.name})`));
  if (!lan.length) log('  Aucun réseau détecté : les téléphones ne pourront pas se connecter.');
  log(`Base de données : ${config.dbPath} — fuseau : ${ctx.settings.tz()}`);
});

function shutdown() {
  log('Arrêt en cours...');
  server.close();
  close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

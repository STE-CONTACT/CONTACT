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
  // Machine sans IPv6 : on se rabat sur IPv4 seul.
  if (config.host === '::' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EINVAL'].includes(e.code)) {
    config.host = '0.0.0.0';
    server.listen(config.port, config.host, onListening);
    return;
  }
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

function onListening() {
  const h = server.address().address;
  log(`Autorisations de sortie — ${config.httpsKey ? 'https' : 'http'}://${['::', '0.0.0.0'].includes(h) ? 'localhost' : config.host}:${config.port}`);
  // Adresses à saisir sur les téléphones / tablettes connectés au même réseau
  const scheme = config.httpsKey ? 'https' : 'http';
  const lan = lanAddresses();
  lan.forEach((a, i) => log(`  ${i === 0 ? 'Adresse pour les TÉLÉPHONES' : 'Autre adresse possible   '} : ${scheme}://${a.address}:${config.port}   (${a.name})`));
  if (!lan.length) log('  Aucun réseau détecté : les téléphones ne pourront pas se connecter.');
  log(`Base de données : ${config.dbPath} — fuseau : ${ctx.settings.tz()}`);
}

server.listen(config.port, config.host, onListening);

function shutdown() {
  log('Arrêt en cours...');
  server.close();
  close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

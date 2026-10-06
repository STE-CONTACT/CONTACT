'use strict';
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const { createApp } = require('./app');

const { app, ctx, close } = createApp();
const { config, log } = ctx;

const server = config.httpsKey && config.httpsCert
  ? https.createServer({ key: fs.readFileSync(config.httpsKey), cert: fs.readFileSync(config.httpsCert) }, app)
  : http.createServer(app);

server.listen(config.port, config.host, () => {
  log(`Autorisations de sortie — ${config.httpsKey ? 'https' : 'http'}://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  // Adresses à saisir sur les téléphones / tablettes connectés au même réseau
  const scheme = config.httpsKey ? 'https' : 'http';
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) log(`  Accès réseau (téléphones, tablettes) : ${scheme}://${a.address}:${config.port}`);
    }
  }
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

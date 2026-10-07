'use strict';
const express = require('express');
const clock = require('../lib/clock');
const { verifyPassword, hashPassword, passwordPolicyErrors } = require('../lib/security');
const { HttpError, badRequest } = require('../lib/errors');
const { publicUser, createLoginLimiter } = require('../middleware/auth');
const { TYPES_SORTIE, ROLE_LABELS } = require('../lib/constants');

const QRCode = require('qrcode');
const { lanAddresses } = require('../lib/network');
const APP_VERSION = require('../../package.json').version;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

module.exports = function authRoutes(ctx) {
  const { db, auth, audit, settings, notifier } = ctx;
  const router = express.Router();
  const limiter = createLoginLimiter();
  // Hachage factice pour uniformiser le temps de réponse si l'identifiant n'existe pas.
  const dummyHash = hashPassword('identifiant-inexistant-0');

  function clientSettings() {
    const s = settings.all();
    return {
      entreprise_nom: s.entreprise_nom, fuseau_horaire: s.fuseau_horaire,
      rh_heure_debut: s.rh_heure_debut, rh_heure_fin: s.rh_heure_fin, rh_pause_debut: s.rh_pause_debut, rh_pause_fin: s.rh_pause_fin,
      tolerance_sortie_avant_min: s.tolerance_sortie_avant_min, duree_max_heures: s.duree_max_heures,
      postes_garde: s.postes_garde, pieces_jointes_actives: s.pieces_jointes_actives, scanner_qr_actif: s.scanner_qr_actif, validation_rh_requise: s.validation_rh_requise, motif_refus_obligatoire: s.motif_refus_obligatoire,
      types_sortie: TYPES_SORTIE, roles: ROLE_LABELS,
      vapid_public_key: notifier.vapidPublicKey(),
    };
  }

  function sessionPayload(user) {
    return { user: publicUser(user), settings: clientSettings(), idle_minutes: auth.idleMinutes(user), server_time: clock.nowIso() };
  }

  /** Adresse à utiliser depuis les téléphones (affichée seulement sur le PC serveur lui-même). */
  function phoneAddress(req) {
    const configured = String(settings.get('adresse_application') || '').trim().replace(/\/+$/, '');
    if (configured) return configured;
    const lan = lanAddresses()[0];
    const port = (req.get('host') || '').split(':')[1];
    return lan ? `${req.protocol}://${lan.address}${port ? `:${port}` : ''}` : null;
  }
  // Seulement sur le PC serveur lui-même (jamais derrière un hébergeur / reverse proxy).
  const isLocal = (req) => !ctx.config.trustProxy && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

  router.get('/public', (req, res) => {
    res.json({ entreprise_nom: settings.get('entreprise_nom'), version: APP_VERSION, adresse_telephone: isLocal(req) ? phoneAddress(req) : undefined });
  });

  router.get('/phone-qr.svg', async (req, res) => {
    const addr = isLocal(req) ? phoneAddress(req) : null;
    if (!addr) throw new HttpError(404, 'Indisponible');
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(await QRCode.toString(addr, { type: 'svg', margin: 1 }));
  });

  router.post('/login', (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!limiter.check(req.ip)) throw new HttpError(429, 'Trop de tentatives. Réessayez dans quelques minutes.');
    if (!username || !password) throw badRequest('Identifiant et mot de passe requis');
    const user = db.get('SELECT * FROM users WHERE username = ?', username);
    const now = clock.now();
    if (!user) {
      verifyPassword(password, dummyHash);
      audit.log({ user: { username: `? ${username.slice(0, 40)}` }, action: 'CONNEXION_ECHEC', after: { raison: 'identifiant inconnu' }, req });
      throw new HttpError(401, 'Identifiant ou mot de passe incorrect');
    }
    if (user.locked_until && new Date(user.locked_until) > now) {
      throw new HttpError(423, `Compte temporairement verrouillé après plusieurs échecs. Réessayez après ${LOCK_MINUTES} minutes.`);
    }
    if (!verifyPassword(password, user.password_hash)) {
      const failed = user.failed_attempts + 1;
      const lock = failed >= MAX_FAILED ? new Date(now.getTime() + LOCK_MINUTES * 60000).toISOString() : null;
      db.run('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', lock ? 0 : failed, lock, user.id);
      audit.log({ user, action: lock ? 'COMPTE_VERROUILLE' : 'CONNEXION_ECHEC', entityType: 'user', entityId: user.id, after: { tentatives: failed }, req });
      throw new HttpError(401, 'Identifiant ou mot de passe incorrect');
    }
    if (!user.actif) throw new HttpError(403, 'Compte désactivé. Contactez l\'administrateur.');
    db.run('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', now.toISOString(), user.id);
    limiter.reset(req.ip);
    auth.createSession(res, user, req);
    audit.log({ user, action: 'CONNEXION', entityType: 'user', entityId: user.id, req });
    res.json(sessionPayload(user));
  });

  router.post('/logout', (req, res) => {
    const r = auth.resolve(req, false);
    if (r && r.user) audit.log({ user: r.user, action: 'DECONNEXION', entityType: 'user', entityId: r.user.id, after: { motif: req.body.reason === 'idle' ? 'inactivité' : 'manuelle' }, req });
    auth.destroySession(req, res);
    res.json({ ok: true });
  });

  router.get('/me', auth.authenticate, (req, res) => {
    auth.refreshCookie(req, res);
    res.json(sessionPayload(req.user));
  });

  router.post('/change-password', auth.authenticate, (req, res) => {
    const { current, password } = req.body;
    const user = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!verifyPassword(String(current || ''), user.password_hash)) throw badRequest('Mot de passe actuel incorrect');
    const errs = passwordPolicyErrors(password, user.username);
    if (errs.length) throw badRequest(`Mot de passe trop faible : ${errs.join(', ')}`);
    if (verifyPassword(password, user.password_hash)) throw badRequest("Le nouveau mot de passe doit être différent de l'ancien");
    const now = clock.nowIso();
    db.run('UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = ?, updated_at = ? WHERE id = ?', hashPassword(password), now, now, user.id);
    // Invalide les autres sessions de l'utilisateur.
    db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', user.id, req.sid);
    audit.log({ user, action: 'MOT_DE_PASSE_CHANGE', entityType: 'user', entityId: user.id, req });
    res.json(sessionPayload(db.get('SELECT * FROM users WHERE id = ?', user.id)));
  });

  router.put('/poste-garde', auth.authenticate, auth.requireRole('gardien', 'admin'), (req, res) => {
    const poste = String(req.body.poste_garde || '');
    if (!settings.get('postes_garde').includes(poste)) throw badRequest('Poste de garde inconnu');
    db.run('UPDATE users SET poste_garde = ? WHERE id = ?', poste, req.user.id);
    audit.log({ user: req.user, action: 'POSTE_GARDE_CHOISI', entityType: 'user', entityId: req.user.id, before: { poste_garde: req.user.poste_garde }, after: { poste_garde: poste }, req });
    res.json({ poste_garde: poste });
  });

  // Exposé pour les autres routeurs
  router.clientSettings = clientSettings;
  return router;
};

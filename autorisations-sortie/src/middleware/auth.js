'use strict';
const clock = require('../lib/clock');
const { sha256, randomToken } = require('../lib/security');
const { HttpError } = require('../lib/errors');

const COOKIE = 'sid';

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, nom: u.nom, prenom: u.prenom, username: u.username, email: u.email, role: u.role,
    team_id: u.team_id, droit_toutes_equipes: Boolean(u.droit_toutes_equipes), poste_garde: u.poste_garde,
    must_change_password: Boolean(u.must_change_password), actif: Boolean(u.actif),
  };
}

function createAuth({ db, settings, config }) {
  function idleMinutes(user) {
    return user.role === 'gardien' ? settings.get('session_inactivite_gardien_min') : settings.get('session_inactivite_min');
  }

  function createSession(res, user, req) {
    const token = randomToken();
    const now = clock.nowIso();
    db.run('INSERT INTO sessions (id, user_id, created_at, last_seen_at, ip_address, user_agent) VALUES (?,?,?,?,?,?)',
      sha256(token), user.id, now, now, req.ip, String(req.get('user-agent') || '').slice(0, 200));
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: config.secureCookies, path: '/' });
    return token;
  }

  function destroySession(req, res) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) db.run('DELETE FROM sessions WHERE id = ?', sha256(token));
    res.clearCookie(COOKIE, { path: '/' });
  }

  /** Résout la session ; `touch` = false pour les connexions de fond (SSE) qui ne comptent pas comme activité. */
  function resolve(req, touch = true) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const sid = sha256(token);
    const row = db.get(`SELECT s.id AS sid, s.last_seen_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`, sid);
    if (!row) return null;
    const now = clock.now();
    if (!row.actif) { db.run('DELETE FROM sessions WHERE id = ?', sid); return null; }
    if (now - new Date(row.last_seen_at) > idleMinutes(row) * 60000) {
      db.run('DELETE FROM sessions WHERE id = ?', sid);
      return { expired: true };
    }
    if (touch) db.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', now.toISOString(), sid);
    return { user: row, sid };
  }

  function authenticate(req, res, next) {
    const background = req.get('x-background') === '1';
    const r = resolve(req, !background);
    if (!r) return next(new HttpError(401, 'Authentification requise'));
    if (r.expired) {
      res.clearCookie(COOKIE, { path: '/' });
      return next(new HttpError(401, 'Session expirée après inactivité. Veuillez vous reconnecter.'));
    }
    req.user = r.user;
    req.sid = r.sid;
    // Changement de mot de passe obligatoire : seules quelques routes restent accessibles.
    if (r.user.must_change_password && !['/api/auth/me', '/api/auth/change-password', '/api/auth/logout'].includes(req.originalUrl.split('?')[0])) {
      return next(new HttpError(403, 'Vous devez changer votre mot de passe'));
    }
    return next();
  }

  function requireRole(...roles) {
    return (req, res, next) => {
      if (!req.user || !roles.includes(req.user.role)) return next(new HttpError(403, 'Accès refusé pour votre rôle'));
      return next();
    };
  }

  /** Protection CSRF : toute requête modifiante doit provenir de l'application (en-tête personnalisé + même origine). */
  function csrf(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('x-requested-with') !== 'fetch') return next(new HttpError(403, 'Requête refusée (CSRF)'));
    const origin = req.get('origin');
    if (origin) {
      try {
        if (new URL(origin).host !== req.get('host')) return next(new HttpError(403, 'Origine refusée'));
      } catch { return next(new HttpError(403, 'Origine refusée')); }
    }
    return next();
  }

  return { createSession, destroySession, resolve, authenticate, requireRole, csrf, idleMinutes };
}

/** Limitation simple des tentatives de connexion par IP. */
function createLoginLimiter({ max = 20, windowMs = 15 * 60000 } = {}) {
  const hits = new Map();
  return {
    check(ip) {
      const now = Date.now();
      const h = hits.get(ip);
      if (!h || now - h.start > windowMs) { hits.set(ip, { start: now, n: 1 }); return true; }
      h.n++;
      return h.n <= max;
    },
    reset(ip) { hits.delete(ip); },
  };
}

module.exports = { createAuth, createLoginLimiter, publicUser, parseCookies };

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { lanAddresses } = require('../lib/network');
const express = require('express');
const QRCode = require('qrcode');
const clock = require('../lib/clock');
const { hashPassword, passwordPolicyErrors, generatePassword, randomToken } = require('../lib/security');
const { badRequest, notFound, conflict, forbidden } = require('../lib/errors');
const { ROLES } = require('../lib/constants');
const { isValidTime } = require('../lib/time');
const { publicUser } = require('../middleware/auth');
const { createBackup, listBackups, pruneBackups, backupPath } = require('../lib/backup');
const { parseCsv } = require('../lib/csv');
const { contentMatches } = require('../lib/filecheck');

const PHOTO_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

function str(v, max = 100) { return String(v ?? '').trim().slice(0, max); }
function idOrNull(v) { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; }
function bool(v) { return v === true || v === 1 || v === '1' || v === 'true'; }
function isFkError(e) { return /FOREIGN KEY/i.test(e.message); }
function isUniqueError(e) { return /UNIQUE/i.test(e.message); }

module.exports = function adminRoutes(ctx) {
  const { db, auth, audit, settings, config, realtime, authz } = ctx;
  const router = express.Router();
  const admin = auth.requireRole('admin');
  const staff = auth.requireRole('admin', 'rh', 'chef');

  /** Suppression : définitive si aucune donnée liée, sinon désactivation (l'historique n'est jamais perdu). */
  function deleteOrDeactivate(table, id, req, user, entityType, label) {
    const before = db.get(`SELECT * FROM ${table} WHERE id = ?`, id);
    if (!before) throw notFound();
    try {
      db.tx(() => {
        db.run(`DELETE FROM ${table} WHERE id = ?`, id);
        audit.log({ user, action: `${label}_SUPPRIME`, entityType, entityId: id, before, req });
      });
      return { deleted: true };
    } catch (e) {
      if (!isFkError(e)) throw e;
      db.tx(() => {
        db.run(`UPDATE ${table} SET actif = 0 WHERE id = ?`, id);
        audit.log({ user, action: `${label}_DESACTIVE`, entityType, entityId: id, before: { actif: before.actif }, after: { actif: 0, raison: 'données historiques liées' }, req });
      });
      return { deleted: false, deactivated: true, message: 'Élément lié à un historique : il a été désactivé au lieu d\'être supprimé.' };
    }
  }

  /**
   * Adresse de l'application vue depuis les téléphones. Réglable dans Paramètres ;
   * sinon l'adresse utilisée par le navigateur, en remplaçant « localhost » par l'IP du PC sur le réseau.
   */
  function appAddress(req) {
    const configured = String(settings.get('adresse_application') || '').trim().replace(/\/+$/, '');
    if (configured) return configured;
    let host = req.get('host') || 'localhost';
    if (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(host)) {
      const port = host.includes(':') ? host.slice(host.lastIndexOf(':')) : '';
      const lan = lanAddresses()[0];
      if (lan) host = `${lan.address}${port}`;
    }
    return `${req.protocol}://${host}`;
  }
  const badgeUrl = (req, matricule, token) => `${appAddress(req)}/#/garde?badge=${encodeURIComponent(matricule)}.${token}`;

  // ================================================================ UTILISATEURS
  const USER_SELECT = `SELECT u.*, t.nom AS equipe FROM users u LEFT JOIN teams t ON t.id = u.team_id`;
  const userOut = (u) => ({ ...publicUser(u), equipe: u.equipe, last_login_at: u.last_login_at, created_at: u.created_at, locked: Boolean(u.locked_until && new Date(u.locked_until) > clock.now()) });

  router.get('/users', admin, (req, res) => {
    res.json(db.all(`${USER_SELECT} ORDER BY u.actif DESC, u.role, u.nom, u.prenom`).map(userOut));
  });

  /** Liste réduite (id + nom) pour les filtres de recherche. */
  router.get('/users/lookup', staff, (req, res) => {
    const role = ROLES.includes(req.query.role) ? req.query.role : null;
    const rows = role
      ? db.all('SELECT id, nom, prenom, role FROM users WHERE role = ? ORDER BY nom, prenom', role)
      : db.all("SELECT id, nom, prenom, role FROM users WHERE role IN ('chef','gardien','rh','admin') ORDER BY nom, prenom");
    res.json(rows.map((r) => ({ ...r })));
  });

  function validateUser(body, existing) {
    const u = {
      nom: str(body.nom ?? existing?.nom), prenom: str(body.prenom ?? existing?.prenom),
      username: str(body.username ?? existing?.username, 50).toLowerCase(),
      email: str(body.email ?? existing?.email ?? '', 150) || null,
      role: body.role ?? existing?.role,
      team_id: body.team_id !== undefined ? idOrNull(body.team_id) : existing?.team_id ?? null,
      droit_toutes_equipes: body.droit_toutes_equipes !== undefined ? (bool(body.droit_toutes_equipes) ? 1 : 0) : existing?.droit_toutes_equipes ?? 0,
      poste_garde: body.poste_garde !== undefined ? (str(body.poste_garde, 60) || null) : existing?.poste_garde ?? null,
      actif: body.actif !== undefined ? (bool(body.actif) ? 1 : 0) : existing?.actif ?? 1,
    };
    if (!u.nom || !u.prenom) throw badRequest('Nom et prénom obligatoires');
    if (!/^[a-z0-9._-]{3,50}$/.test(u.username)) throw badRequest("Identifiant invalide (3 à 50 caractères : lettres, chiffres, . _ -)");
    if (!ROLES.includes(u.role)) throw badRequest('Rôle invalide');
    if (u.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u.email)) throw badRequest('Email invalide');
    if (u.team_id && !db.get('SELECT id FROM teams WHERE id = ?', u.team_id)) throw badRequest('Affectation inconnue');
    return u;
  }

  router.post('/users', admin, (req, res) => {
    const u = validateUser(req.body);
    let password = String(req.body.password || '');
    let generated = false;
    if (!password) { password = generatePassword(); generated = true; }
    const errs = passwordPolicyErrors(password, u.username);
    if (errs.length) throw badRequest(`Mot de passe trop faible : ${errs.join(', ')}`);
    const now = clock.nowIso();
    let id;
    try {
      id = db.tx(() => {
        const r = db.run(`INSERT INTO users (nom, prenom, username, email, password_hash, role, team_id, droit_toutes_equipes, poste_garde, actif, must_change_password, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`, u.nom, u.prenom, u.username, u.email, hashPassword(password), u.role, u.team_id, u.droit_toutes_equipes, u.poste_garde, u.actif, now, now);
        const newId = Number(r.lastInsertRowid);
        audit.log({ user: req.user, action: 'UTILISATEUR_CREE', entityType: 'user', entityId: newId, after: u, req });
        return newId;
      });
    } catch (e) { if (isUniqueError(e)) throw conflict('Cet identifiant existe déjà'); throw e; }
    res.status(201).json({ user: userOut(db.get(`${USER_SELECT} WHERE u.id = ?`, id)), temporary_password: generated ? password : undefined });
  });

  router.put('/users/:id', admin, (req, res) => {
    const id = Number(req.params.id);
    const existing = db.get('SELECT * FROM users WHERE id = ?', id);
    if (!existing) throw notFound('Utilisateur introuvable');
    const u = validateUser(req.body, existing);
    if (id === req.user.id && (u.role !== 'admin' || !u.actif)) throw badRequest('Vous ne pouvez pas retirer vos propres droits administrateur');
    try {
      db.tx(() => {
        db.run(`UPDATE users SET nom=?, prenom=?, username=?, email=?, role=?, team_id=?, droit_toutes_equipes=?, poste_garde=?, actif=?, updated_at=? WHERE id=?`,
          u.nom, u.prenom, u.username, u.email, u.role, u.team_id, u.droit_toutes_equipes, u.poste_garde, u.actif, clock.nowIso(), id);
        if (!u.actif || u.role !== existing.role) db.run('DELETE FROM sessions WHERE user_id = ?', id);
        audit.log({ user: req.user, action: 'UTILISATEUR_MODIFIE', entityType: 'user', entityId: id, before: pickKeys(existing, Object.keys(u)), after: u, req });
      });
    } catch (e) { if (isUniqueError(e)) throw conflict('Cet identifiant existe déjà'); throw e; }
    if (!u.actif || u.role !== existing.role) realtime.closeUser(id);
    res.json(userOut(db.get(`${USER_SELECT} WHERE u.id = ?`, id)));
  });

  router.post('/users/:id/reset-password', admin, (req, res) => {
    const id = Number(req.params.id);
    const u = db.get('SELECT * FROM users WHERE id = ?', id);
    if (!u) throw notFound();
    let password = String(req.body.password || '');
    let generated = false;
    if (!password) { password = generatePassword(); generated = true; }
    const errs = passwordPolicyErrors(password, u.username);
    if (errs.length) throw badRequest(`Mot de passe trop faible : ${errs.join(', ')}`);
    db.tx(() => {
      db.run('UPDATE users SET password_hash=?, must_change_password=1, failed_attempts=0, locked_until=NULL, updated_at=? WHERE id=?', hashPassword(password), clock.nowIso(), id);
      db.run('DELETE FROM sessions WHERE user_id = ?', id);
      audit.log({ user: req.user, action: 'MOT_DE_PASSE_REINITIALISE', entityType: 'user', entityId: id, req });
    });
    realtime.closeUser(id);
    res.json({ ok: true, temporary_password: generated ? password : undefined });
  });

  /** Téléphone perdu : ferme toutes les sessions de la personne sans désactiver son compte. */
  router.post('/users/:id/logout-all', admin, (req, res) => {
    const id = Number(req.params.id);
    if (!db.get('SELECT id FROM users WHERE id = ?', id)) throw notFound();
    const r = db.run('DELETE FROM sessions WHERE user_id = ?', id);
    db.run('DELETE FROM push_subscriptions WHERE user_id = ?', id);
    audit.log({ user: req.user, action: 'SESSIONS_FERMEES', entityType: 'user', entityId: id, after: { sessions: Number(r.changes) }, req });
    realtime.closeUser(id);
    res.json({ ok: true, sessions: Number(r.changes) });
  });

  router.post('/users/:id/unlock', admin, (req, res) => {
    const id = Number(req.params.id);
    db.run('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=?', id);
    audit.log({ user: req.user, action: 'COMPTE_DEVERROUILLE', entityType: 'user', entityId: id, req });
    res.json({ ok: true });
  });

  router.delete('/users/:id', admin, (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw badRequest('Vous ne pouvez pas supprimer votre propre compte');
    const r = deleteOrDeactivate('users', id, req, req.user, 'user', 'UTILISATEUR');
    db.run('DELETE FROM sessions WHERE user_id = ?', id);
    realtime.closeUser(id);
    res.json(r);
  });

  // ================================================================ SERVICES
  router.get('/services', staff, (req, res) => {
    res.json(db.all(`SELECT s.*, (SELECT COUNT(*) FROM employees e WHERE e.service_id = s.id AND e.actif = 1) AS nb_operateurs
      FROM services s ORDER BY s.actif DESC, s.nom`).map((r) => ({ ...r })));
  });
  router.post('/services', admin, (req, res) => {
    const nom = str(req.body.nom);
    if (!nom) throw badRequest('Nom obligatoire');
    try {
      const id = db.tx(() => {
        const r = db.run('INSERT INTO services (nom, actif, created_at) VALUES (?, 1, ?)', nom, clock.nowIso());
        audit.log({ user: req.user, action: 'SERVICE_CREE', entityType: 'service', entityId: Number(r.lastInsertRowid), after: { nom }, req });
        return Number(r.lastInsertRowid);
      });
      res.status(201).json({ ...db.get('SELECT * FROM services WHERE id = ?', id) });
    } catch (e) { if (isUniqueError(e)) throw conflict('Ce service existe déjà'); throw e; }
  });
  router.put('/services/:id', admin, (req, res) => {
    const id = Number(req.params.id);
    const before = db.get('SELECT * FROM services WHERE id = ?', id);
    if (!before) throw notFound();
    const nom = str(req.body.nom ?? before.nom);
    const actif = req.body.actif !== undefined ? (bool(req.body.actif) ? 1 : 0) : before.actif;
    if (!nom) throw badRequest('Nom obligatoire');
    try {
      db.tx(() => {
        db.run('UPDATE services SET nom=?, actif=? WHERE id=?', nom, actif, id);
        audit.log({ user: req.user, action: 'SERVICE_MODIFIE', entityType: 'service', entityId: id, before, after: { nom, actif }, req });
      });
    } catch (e) { if (isUniqueError(e)) throw conflict('Ce service existe déjà'); throw e; }
    res.json({ ...db.get('SELECT * FROM services WHERE id = ?', id) });
  });
  router.delete('/services/:id', admin, (req, res) => res.json(deleteOrDeactivate('services', Number(req.params.id), req, req.user, 'service', 'SERVICE')));

  // ================================================================ POSTES / HORAIRES
  router.get('/shifts', staff, (req, res) => {
    res.json(db.all('SELECT * FROM shifts ORDER BY type DESC, heure_debut').map((r) => ({ ...r })));
  });
  function validateShift(body, existing) {
    const s = {
      nom: str(body.nom ?? existing?.nom, 60),
      type: body.type ?? existing?.type ?? 'operateur',
      heure_debut: body.heure_debut ?? existing?.heure_debut,
      heure_fin: body.heure_fin ?? existing?.heure_fin,
      pause_debut: body.pause_debut !== undefined ? (body.pause_debut || null) : existing?.pause_debut ?? null,
      pause_fin: body.pause_fin !== undefined ? (body.pause_fin || null) : existing?.pause_fin ?? null,
      actif: body.actif !== undefined ? (bool(body.actif) ? 1 : 0) : existing?.actif ?? 1,
    };
    if (!s.nom) throw badRequest('Nom obligatoire');
    if (!['operateur', 'administratif'].includes(s.type)) throw badRequest('Type invalide');
    if (!isValidTime(s.heure_debut) || !isValidTime(s.heure_fin)) throw badRequest('Heures invalides (HH:MM)');
    if (s.heure_debut === s.heure_fin) throw badRequest('Les heures de début et de fin doivent être différentes');
    if ((s.pause_debut && !isValidTime(s.pause_debut)) || (s.pause_fin && !isValidTime(s.pause_fin))) throw badRequest('Heures de pause invalides');
    return s;
  }
  router.post('/shifts', admin, (req, res) => {
    const s = validateShift(req.body);
    try {
      const id = db.tx(() => {
        const r = db.run('INSERT INTO shifts (nom, type, heure_debut, heure_fin, pause_debut, pause_fin, actif, created_at) VALUES (?,?,?,?,?,?,?,?)',
          s.nom, s.type, s.heure_debut, s.heure_fin, s.pause_debut, s.pause_fin, s.actif, clock.nowIso());
        audit.log({ user: req.user, action: 'POSTE_CREE', entityType: 'shift', entityId: Number(r.lastInsertRowid), after: s, req });
        return Number(r.lastInsertRowid);
      });
      res.status(201).json({ ...db.get('SELECT * FROM shifts WHERE id = ?', id) });
    } catch (e) { if (isUniqueError(e)) throw conflict('Ce poste existe déjà'); throw e; }
  });
  router.put('/shifts/:id', admin, (req, res) => {
    const id = Number(req.params.id);
    const before = db.get('SELECT * FROM shifts WHERE id = ?', id);
    if (!before) throw notFound();
    const s = validateShift(req.body, before);
    try {
      db.tx(() => {
        db.run('UPDATE shifts SET nom=?, type=?, heure_debut=?, heure_fin=?, pause_debut=?, pause_fin=?, actif=? WHERE id=?',
          s.nom, s.type, s.heure_debut, s.heure_fin, s.pause_debut, s.pause_fin, s.actif, id);
        audit.log({ user: req.user, action: 'POSTE_MODIFIE', entityType: 'shift', entityId: id, before, after: s, req });
      });
    } catch (e) { if (isUniqueError(e)) throw conflict('Ce poste existe déjà'); throw e; }
    res.json({ ...db.get('SELECT * FROM shifts WHERE id = ?', id) });
  });
  router.delete('/shifts/:id', admin, (req, res) => res.json(deleteOrDeactivate('shifts', Number(req.params.id), req, req.user, 'shift', 'POSTE')));

  // ================================================================ ÉQUIPES
  const TEAM_SELECT = `SELECT t.*, u.prenom || ' ' || u.nom AS chef, sh.nom AS poste_nom, sh.heure_debut, sh.heure_fin, s.nom AS service,
    (SELECT COUNT(*) FROM employees e WHERE e.team_id = t.id AND e.actif = 1) AS nb_operateurs
    FROM teams t LEFT JOIN users u ON u.id = t.chef_equipe_id LEFT JOIN shifts sh ON sh.id = t.shift_id LEFT JOIN services s ON s.id = t.service_id`;
  router.get('/teams', staff, (req, res) => {
    let rows = db.all(`${TEAM_SELECT} ORDER BY t.actif DESC, t.nom`);
    if (req.user.role === 'chef' && req.query.mine === '1') {
      const ids = authz.chefTeamIds(req.user);
      rows = rows.filter((t) => ids.includes(t.id));
    }
    res.json(rows.map((r) => ({ ...r })));
  });
  function validateTeam(body, existing) {
    const t = {
      nom: str(body.nom ?? existing?.nom, 60),
      chef_equipe_id: body.chef_equipe_id !== undefined ? idOrNull(body.chef_equipe_id) : existing?.chef_equipe_id ?? null,
      shift_id: body.shift_id !== undefined ? idOrNull(body.shift_id) : existing?.shift_id ?? null,
      service_id: body.service_id !== undefined ? idOrNull(body.service_id) : existing?.service_id ?? null,
      actif: body.actif !== undefined ? (bool(body.actif) ? 1 : 0) : existing?.actif ?? 1,
    };
    if (!t.nom) throw badRequest('Nom obligatoire');
    if (t.chef_equipe_id) {
      const u = db.get('SELECT role FROM users WHERE id = ?', t.chef_equipe_id);
      if (!u || !['chef', 'rh', 'admin'].includes(u.role)) throw badRequest("Le responsable doit avoir le rôle Chef d'équipe ou RH");
    }
    return t;
  }
  router.post('/teams', admin, (req, res) => {
    const t = validateTeam(req.body);
    try {
      const id = db.tx(() => {
        const r = db.run('INSERT INTO teams (nom, chef_equipe_id, shift_id, service_id, actif, created_at) VALUES (?,?,?,?,?,?)',
          t.nom, t.chef_equipe_id, t.shift_id, t.service_id, t.actif, clock.nowIso());
        audit.log({ user: req.user, action: 'EQUIPE_CREEE', entityType: 'team', entityId: Number(r.lastInsertRowid), after: t, req });
        return Number(r.lastInsertRowid);
      });
      res.status(201).json({ ...db.get(`${TEAM_SELECT} WHERE t.id = ?`, id) });
    } catch (e) { if (isUniqueError(e)) throw conflict('Cette affectation existe déjà'); throw e; }
  });
  router.put('/teams/:id', admin, (req, res) => {
    const id = Number(req.params.id);
    const before = db.get('SELECT * FROM teams WHERE id = ?', id);
    if (!before) throw notFound();
    const t = validateTeam(req.body, before);
    try {
      db.tx(() => {
        db.run('UPDATE teams SET nom=?, chef_equipe_id=?, shift_id=?, service_id=?, actif=? WHERE id=?', t.nom, t.chef_equipe_id, t.shift_id, t.service_id, t.actif, id);
        audit.log({ user: req.user, action: 'EQUIPE_MODIFIEE', entityType: 'team', entityId: id, before, after: t, req });
      });
    } catch (e) { if (isUniqueError(e)) throw conflict('Cette affectation existe déjà'); throw e; }
    res.json({ ...db.get(`${TEAM_SELECT} WHERE t.id = ?`, id) });
  });
  router.delete('/teams/:id', admin, (req, res) => res.json(deleteOrDeactivate('teams', Number(req.params.id), req, req.user, 'team', 'EQUIPE')));

  // ================================================================ OPÉRATEURS
  const EMP_SELECT = `SELECT e.id, e.matricule, e.nom, e.prenom, e.service_id, e.team_id, e.shift_id, e.telephone, e.photo, e.actif, e.created_at,
    s.nom AS service, t.nom AS equipe, sh.nom AS poste_nom, sh.heure_debut AS poste_debut, sh.heure_fin AS poste_fin
    FROM employees e LEFT JOIN services s ON s.id = e.service_id LEFT JOIN teams t ON t.id = e.team_id LEFT JOIN shifts sh ON sh.id = e.shift_id`;

  function employeeScope(user) {
    if (user.role === 'admin' || user.role === 'rh' || user.droit_toutes_equipes) return { sql: '1=1', params: [] };
    const ids = authz.chefTeamIds(user);
    return ids.length ? { sql: `e.team_id IN (${ids.map(() => '?').join(',')})`, params: ids } : { sql: '0=1', params: [] };
  }

  router.get('/employees', staff, (req, res) => {
    const sc = employeeScope(req.user);
    const where = [sc.sql]; const params = [...sc.params];
    if (req.query.q) {
      const q = str(req.query.q).replace(/[%_]/g, '');
      // Correspondance exacte du matricule en premier
      where.push("(e.matricule LIKE ? OR e.nom LIKE ? OR e.prenom LIKE ? OR (e.prenom || ' ' || e.nom) LIKE ? OR (e.nom || ' ' || e.prenom) LIKE ?)");
      params.push(`${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (req.query.team_id) { where.push('e.team_id = ?'); params.push(Number(req.query.team_id)); }
    if (req.query.service_id) { where.push('e.service_id = ?'); params.push(Number(req.query.service_id)); }
    if (req.query.actif === '1') where.push('e.actif = 1');
    if (req.query.actif === '0') where.push('e.actif = 0');
    const limit = Math.min(1000, Number(req.query.limit) || 500);
    const exact = req.query.q ? str(req.query.q) : '';
    const rows = db.all(`${EMP_SELECT} WHERE ${where.join(' AND ')}
      ORDER BY CASE WHEN e.matricule = ? COLLATE NOCASE THEN 0 ELSE 1 END, e.actif DESC, e.nom, e.prenom LIMIT ?`, ...params, exact, limit);
    res.json(rows.map((r) => ({ ...r, photo: Boolean(r.photo) })));
  });

  function getEmployeeChecked(user, id) {
    const e = db.get(`${EMP_SELECT} WHERE e.id = ?`, id);
    if (!e) throw notFound('Opérateur introuvable');
    if (user.role === 'chef' && !authz.canManageEmployee(user, e)) throw forbidden("Cette personne ne fait pas partie de votre affectation");
    return e;
  }

  router.get('/employees/:id', staff, (req, res) => {
    const e = getEmployeeChecked(req.user, Number(req.params.id));
    res.json({ ...e, photo: Boolean(e.photo) });
  });

  function validateEmployee(body, existing) {
    const e = {
      matricule: str(body.matricule ?? existing?.matricule, 30),
      nom: str(body.nom ?? existing?.nom).toUpperCase(),
      prenom: str(body.prenom ?? existing?.prenom),
      service_id: body.service_id !== undefined ? idOrNull(body.service_id) : existing?.service_id ?? null,
      team_id: body.team_id !== undefined ? idOrNull(body.team_id) : existing?.team_id ?? null,
      shift_id: body.shift_id !== undefined ? idOrNull(body.shift_id) : existing?.shift_id ?? null,
      telephone: body.telephone !== undefined ? (str(body.telephone, 30) || null) : existing?.telephone ?? null,
      actif: body.actif !== undefined ? (bool(body.actif) ? 1 : 0) : existing?.actif ?? 1,
    };
    if (!/^[A-Za-z0-9-]{1,30}$/.test(e.matricule)) throw badRequest('Matricule invalide (lettres, chiffres, tiret)');
    if (!e.nom || !e.prenom) throw badRequest('Nom et prénom obligatoires');
    return e;
  }

  router.post('/employees', admin, (req, res) => {
    const e = validateEmployee(req.body);
    const now = clock.nowIso();
    try {
      const id = db.tx(() => {
        const r = db.run(`INSERT INTO employees (matricule, nom, prenom, service_id, team_id, shift_id, telephone, qr_token, actif, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`, e.matricule, e.nom, e.prenom, e.service_id, e.team_id, e.shift_id, e.telephone, randomToken(12), e.actif, now, now);
        audit.log({ user: req.user, action: 'OPERATEUR_CREE', entityType: 'employee', entityId: Number(r.lastInsertRowid), after: e, req });
        return Number(r.lastInsertRowid);
      });
      res.status(201).json({ ...db.get(`${EMP_SELECT} WHERE e.id = ?`, id) });
    } catch (err) { if (isUniqueError(err)) throw conflict('Ce matricule existe déjà'); throw err; }
  });

  router.put('/employees/:id', admin, (req, res) => {
    const id = Number(req.params.id);
    const before = db.get('SELECT * FROM employees WHERE id = ?', id);
    if (!before) throw notFound();
    const e = validateEmployee(req.body, before);
    try {
      db.tx(() => {
        db.run('UPDATE employees SET matricule=?, nom=?, prenom=?, service_id=?, team_id=?, shift_id=?, telephone=?, actif=?, updated_at=? WHERE id=?',
          e.matricule, e.nom, e.prenom, e.service_id, e.team_id, e.shift_id, e.telephone, e.actif, clock.nowIso(), id);
        audit.log({ user: req.user, action: 'OPERATEUR_MODIFIE', entityType: 'employee', entityId: id, before: pickKeys(before, Object.keys(e)), after: e, req });
      });
    } catch (err) { if (isUniqueError(err)) throw conflict('Ce matricule existe déjà'); throw err; }
    res.json({ ...db.get(`${EMP_SELECT} WHERE e.id = ?`, id) });
  });

  router.delete('/employees/:id', admin, (req, res) => res.json(deleteOrDeactivate('employees', Number(req.params.id), req, req.user, 'employee', 'OPERATEUR')));

  router.post('/employees/:id/photo', admin, (req, res) => {
    const id = Number(req.params.id);
    const e = db.get('SELECT * FROM employees WHERE id = ?', id);
    if (!e) throw notFound();
    const ext = PHOTO_TYPES[req.body.type];
    if (!ext) throw badRequest('Format de photo non supporté (JPEG, PNG, WEBP)');
    const buf = Buffer.from(String(req.body.data || ''), 'base64');
    if (!buf.length || buf.length > 2 * 1024 * 1024) throw badRequest('Photo vide ou trop volumineuse (2 Mo max.)');
    if (!contentMatches(req.body.type, buf)) throw badRequest("Le fichier n'est pas une image valide (JPEG, PNG ou WEBP)");
    const dir = path.join(config.uploadsDir, 'photos');
    fs.mkdirSync(dir, { recursive: true });
    const name = `${crypto.randomUUID()}${ext}`;
    fs.writeFileSync(path.join(dir, name), buf);
    db.run('UPDATE employees SET photo = ?, updated_at = ? WHERE id = ?', name, clock.nowIso(), id);
    audit.log({ user: req.user, action: 'OPERATEUR_PHOTO', entityType: 'employee', entityId: id, after: { photo: name }, req });
    res.json({ ok: true });
  });

  // Photo visible par tous les rôles connectés (y compris gardien pour l'identification)
  router.get('/employees/:id/photo', (req, res) => {
    const e = db.get('SELECT photo FROM employees WHERE id = ?', Number(req.params.id));
    if (!e || !e.photo) throw notFound();
    res.set('Cache-Control', 'private, max-age=3600');
    res.sendFile(path.join(config.uploadsDir, 'photos', path.basename(e.photo)));
  });

  router.get('/employees/:id/qr.svg', staff, async (req, res) => {
    const e = getEmployeeChecked(req.user, Number(req.params.id));
    const raw = db.get('SELECT qr_token FROM employees WHERE id = ?', e.id);
    const svg = await QRCode.toString(badgeUrl(req, e.matricule, raw.qr_token), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  });

  /** Adresse encodée dans les badges (pour vérifier que les téléphones peuvent l'ouvrir). */
  router.get('/badge-address', staff, (req, res) => {
    res.json({ adresse: appAddress(req) });
  });

  router.post('/employees/:id/regenerate-qr', admin, (req, res) => {
    const id = Number(req.params.id);
    if (!db.get('SELECT id FROM employees WHERE id = ?', id)) throw notFound();
    db.run('UPDATE employees SET qr_token = ?, updated_at = ? WHERE id = ?', randomToken(12), clock.nowIso(), id);
    audit.log({ user: req.user, action: 'OPERATEUR_QR_REGENERE', entityType: 'employee', entityId: id, req });
    res.json({ ok: true });
  });

  /** Import CSV : matricule;nom;prenom;service;affectation;poste;telephone (mise à jour si le matricule existe). */
  router.post('/employees/import', admin, (req, res) => {
    const rows = parseCsv(req.body.csv);
    if (!rows.length) throw badRequest('Fichier vide');
    const header = rows[0].map((h) => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
    const hasHeader = header.includes('matricule');
    const idx = (name, def) => (hasHeader ? header.indexOf(name) : def);
    const cols = { matricule: idx('matricule', 0), nom: idx('nom', 1), prenom: idx('prenom', 2), service: idx('service', 3), equipe: hasHeader && header.includes('affectation') ? header.indexOf('affectation') : idx('equipe', 4), poste: idx('poste', 5), telephone: idx('telephone', 6) };
    const report = { created: 0, updated: 0, errors: [] };
    const now = clock.nowIso();
    const lookupOrCreate = (table, nom) => {
      if (!nom) return null;
      const r = db.get(`SELECT id FROM ${table} WHERE nom = ? COLLATE NOCASE`, nom);
      if (r) return r.id;
      if (table === 'shifts') throw new Error(`poste « ${nom} » inconnu`);
      const ins = table === 'services'
        ? db.run('INSERT INTO services (nom, actif, created_at) VALUES (?,1,?)', nom, now)
        : db.run('INSERT INTO teams (nom, actif, created_at) VALUES (?,1,?)', nom, now);
      return Number(ins.lastInsertRowid);
    };
    db.tx(() => {
      (hasHeader ? rows.slice(1) : rows).forEach((r, i) => {
        const line = i + (hasHeader ? 2 : 1);
        try {
          const get = (k) => (cols[k] >= 0 ? r[cols[k]] || '' : '');
          const e = validateEmployee({ matricule: get('matricule'), nom: get('nom'), prenom: get('prenom'), telephone: get('telephone') || undefined });
          const serviceId = lookupOrCreate('services', get('service'));
          const teamId = lookupOrCreate('teams', get('equipe'));
          const shiftId = lookupOrCreate('shifts', get('poste'));
          const existing = db.get('SELECT id FROM employees WHERE matricule = ? COLLATE NOCASE', e.matricule);
          if (existing) {
            db.run('UPDATE employees SET nom=?, prenom=?, service_id=COALESCE(?, service_id), team_id=COALESCE(?, team_id), shift_id=COALESCE(?, shift_id), telephone=COALESCE(?, telephone), updated_at=? WHERE id=?',
              e.nom, e.prenom, serviceId, teamId, shiftId, e.telephone, now, existing.id);
            report.updated++;
          } else {
            db.run(`INSERT INTO employees (matricule, nom, prenom, service_id, team_id, shift_id, telephone, qr_token, actif, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)`,
              e.matricule, e.nom, e.prenom, serviceId, teamId, shiftId, e.telephone, randomToken(12), now, now);
            report.created++;
          }
        } catch (err) { report.errors.push(`Ligne ${line} : ${err.message}`); }
      });
      audit.log({ user: req.user, action: 'OPERATEURS_IMPORTES', entityType: 'employee', after: { crees: report.created, mis_a_jour: report.updated, erreurs: report.errors.length }, req });
    });
    res.json(report);
  });

  // ================================================================ PARAMÈTRES
  router.get('/settings', admin, (req, res) => {
    res.json({ ...settings.all(), _info: { push: ctx.notifier.pushEnabled(), smtp: Boolean(config.smtp), backups_dir: config.backupsDir } });
  });
  router.put('/settings', admin, (req, res) => {
    const { before, after } = settings.update(req.body || {});
    if (Object.keys(after).length) audit.log({ user: req.user, action: 'PARAMETRES_MODIFIES', entityType: 'settings', before, after, req });
    res.json(settings.all());
  });

  // ================================================================ SAUVEGARDES
  router.get('/backups', admin, (req, res) => res.json(listBackups(config.backupsDir)));
  router.post('/backups', admin, (req, res) => {
    const b = createBackup(db, config.backupsDir, 'manuel');
    pruneBackups(config.backupsDir, settings.get('sauvegarde_retention'));
    audit.log({ user: req.user, action: 'SAUVEGARDE_CREEE', entityType: 'backup', after: b, req });
    res.status(201).json(b);
  });
  router.get('/backups/:name', admin, (req, res) => {
    const p = backupPath(config.backupsDir, req.params.name);
    if (!p) throw notFound();
    audit.log({ user: req.user, action: 'SAUVEGARDE_TELECHARGEE', entityType: 'backup', after: { name: req.params.name }, req });
    res.download(p);
  });

  // ================================================================ JOURNAL D'AUDIT
  router.get('/audit', admin, (req, res) => {
    const where = ['1=1']; const params = [];
    const q = req.query;
    if (q.user) { where.push('username LIKE ?'); params.push(`%${str(q.user)}%`); }
    if (q.action) { where.push('action = ?'); params.push(str(q.action, 60)); }
    if (q.entity_type) { where.push('entity_type = ?'); params.push(str(q.entity_type, 30)); }
    if (q.entity_id) { where.push('entity_id = ?'); params.push(Number(q.entity_id)); }
    if (q.date_from) { where.push('date >= ?'); params.push(str(q.date_from, 10)); }
    if (q.date_to) { where.push('date <= ?'); params.push(str(q.date_to, 10)); }
    const page = Math.max(1, Number(q.page) || 1);
    const size = Math.min(200, Math.max(1, Number(q.size) || 50));
    const total = db.get(`SELECT COUNT(*) AS n FROM audit_logs WHERE ${where.join(' AND ')}`, ...params).n;
    const items = db.all(`SELECT id, user_id, username, role, action, entity_type, entity_id, ancienne_valeur, nouvelle_valeur, date, heure, created_at, ip_address, hash
      FROM audit_logs WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, size, (page - 1) * size);
    res.json({ total, page, size, items: items.map((r) => ({ ...r })) });
  });
  router.get('/audit/actions', admin, (req, res) => {
    res.json(db.all('SELECT DISTINCT action FROM audit_logs ORDER BY action').map((r) => r.action));
  });
  router.get('/audit/verify', admin, (req, res) => {
    const r = ctx.audit.verify();
    audit.log({ user: req.user, action: 'AUDIT_VERIFIE', entityType: 'audit', after: r, req });
    res.json(r);
  });

  return router;
};

function pickKeys(o, keys) { const r = {}; for (const k of keys) r[k] = o[k]; return r; }

'use strict';
const express = require('express');
const { toCsv } = require('../lib/csv');
const { notFound } = require('../lib/errors');
const { localDate, localTime, dayBoundsUtc } = require('../lib/time');
const clock = require('../lib/clock');

const STATUT_LABELS = {
  BROUILLON: 'Brouillon', EN_ATTENTE: 'En attente', VALIDEE: 'Validée', REFUSEE: 'Refusée', ANNULEE: 'Annulée',
  SORTIE_EFFECTUEE: 'Sortie effectuée', RETOUR_EFFECTUE: 'Retour effectué', EXPIREE: 'Expirée',
};

module.exports = function authorizationRoutes(ctx) {
  const { db, auth, authz, settings } = ctx;
  const router = express.Router();
  const staff = auth.requireRole('admin', 'rh', 'chef');
  const guard = auth.requireRole('gardien', 'admin');

  // ---------------------------------------------------------------- autorisations
  router.get('/authorizations', staff, (req, res) => res.json(authz.search(req.user, req.query)));

  router.get('/authorizations/export.csv', staff, (req, res) => {
    const tz = settings.tz();
    const fmt = (iso) => (iso ? `${localDate(new Date(iso), tz).split('-').reverse().join('/')} ${localTime(new Date(iso), tz)}` : '');
    const rows = authz.exportRows(req.user, req.query);
    const csv = toCsv([
      { label: 'Numéro', key: 'numero' }, { label: 'Matricule', key: 'matricule' }, { label: 'Nom', key: 'emp_nom' }, { label: 'Prénom', key: 'emp_prenom' },
      { label: 'Service', key: 'service' }, { label: 'Équipe', key: 'equipe' }, { label: 'Poste', key: 'poste_nom' },
      { label: 'Date sortie', value: (r) => r.date_sortie.split('-').reverse().join('/') },
      { label: 'Sortie prévue', key: 'heure_sortie_prevue' }, { label: 'Retour prévu', value: (r) => `${r.heure_retour_prevue}${r.retour_lendemain ? ' (J+1)' : ''}` },
      { label: 'Type', key: 'type_sortie_label' }, { label: 'Motif', key: 'motif' }, { label: 'Statut', value: (r) => STATUT_LABELS[r.statut] },
      { label: "Chef d'équipe", key: 'createur' }, { label: 'Créée le', value: (r) => fmt(r.created_at) },
      { label: 'Validée/refusée par', value: (r) => r.valideur || r.refuseur || '' }, { label: 'Décision le', value: (r) => fmt(r.approved_at || r.rejected_at) },
      { label: 'Motif refus', key: 'motif_refus' },
      { label: 'Sortie réelle', value: (r) => fmt(r.heure_sortie_reelle) }, { label: 'Gardien sortie', key: 'gardien_sortie' },
      { label: 'Retour réel', value: (r) => fmt(r.heure_retour_reel) }, { label: 'Gardien retour', key: 'gardien_retour' },
      { label: 'Durée réelle', key: 'duree_reelle' }, { label: 'Retard', value: (r) => (r.en_retard ? 'Oui' : '') },
    ], rows);
    ctx.audit.log({ user: req.user, action: 'EXPORT_HISTORIQUE', entityType: 'authorization', after: { lignes: rows.length, filtres: req.query }, req });
    res.set('Content-Disposition', `attachment; filename="autorisations-${localDate(clock.now(), tz)}.csv"`);
    res.type('text/csv; charset=utf-8').send(csv);
  });

  router.get('/authorizations/:id', staff, (req, res) => {
    const a = authz.getForUser(req.user, Number(req.params.id));
    res.json({ ...a, timeline: authz.timeline(a.id).map((r) => ({ ...r })) });
  });

  router.get('/authorizations/:id/attachment', staff, (req, res) => {
    const a = authz.getForUser(req.user, Number(req.params.id));
    const raw = authz.getRaw(a.id);
    const p = authz.attachmentPath(raw);
    if (!p) throw notFound('Aucune pièce jointe');
    res.set('Content-Disposition', `inline; filename="${raw.piece_jointe_nom.replace(/"/g, '')}"`);
    res.type(raw.piece_jointe_type).sendFile(p);
  });

  router.post('/authorizations', staff, (req, res) => res.status(201).json(authz.create(req.user, req.body, req)));
  router.put('/authorizations/:id', staff, (req, res) => res.json(authz.updateDraft(req.user, Number(req.params.id), req.body, req)));
  router.post('/authorizations/:id/submit', staff, (req, res) => res.json(authz.submit(req.user, Number(req.params.id), req)));
  router.post('/authorizations/:id/approve', staff, (req, res) => res.json(authz.approve(req.user, Number(req.params.id), req.body, req)));
  router.post('/authorizations/:id/reject', staff, (req, res) => res.json(authz.reject(req.user, Number(req.params.id), req.body, req)));
  router.post('/authorizations/:id/cancel', staff, (req, res) => res.json(authz.cancel(req.user, Number(req.params.id), req.body, req)));

  // ---------------------------------------------------------------- tableau de bord & suivi
  router.get('/dashboard', staff, (req, res) => res.json(authz.dashboard(req.user)));
  router.get('/outside', (req, res) => res.json(authz.outsideNow(req.user)));

  // ---------------------------------------------------------------- poste de garde
  router.get('/gate/board', guard, (req, res) => res.json(authz.gateBoard()));
  router.get('/gate/lookup', guard, (req, res) => res.json(authz.gateLookup(req.user, { q: req.query.q, qr: req.query.qr, poste: req.query.poste }, req)));
  router.post('/gate/:id/exit', guard, (req, res) => res.json(authz.forGuard(authz.confirmExit(req.user, Number(req.params.id), req.body, req))));
  router.post('/gate/:id/return', guard, (req, res) => res.json(authz.forGuard(authz.confirmReturn(req.user, Number(req.params.id), req.body, req))));

  /** Historique des contrôles et mouvements au poste de garde (données non confidentielles). */
  router.get('/gate/history', guard, (req, res) => {
    const q = req.query;
    const range = authz.periodRange(q.periode || q.date_from || q.date_to ? q : { periode: 'aujourdhui' });
    const tz = settings.tz();
    const where = ['1=1']; const params = [];
    if (range.from) { where.push('c.created_at >= ?'); params.push(dayBoundsUtc(range.from, tz).start.toISOString()); }
    if (range.to) { where.push('c.created_at < ?'); params.push(dayBoundsUtc(range.to, tz).end.toISOString()); }
    if (q.q) { const like = `%${String(q.q).replace(/[%_]/g, '')}%`; where.push('(c.saisie LIKE ? OR e.matricule LIKE ? OR e.nom LIKE ? OR e.prenom LIKE ?)'); params.push(like, like, like, like); }
    if (q.mine === '1') { where.push('c.guard_id = ?'); params.push(req.user.id); }
    const rows = db.all(`SELECT c.id, c.created_at, c.methode, c.saisie, c.resultat, c.poste_garde, e.matricule, e.nom, e.prenom,
        u.prenom || ' ' || u.nom AS gardien, a.numero
      FROM gate_checks c LEFT JOIN employees e ON e.id = c.employee_id LEFT JOIN users u ON u.id = c.guard_id
      LEFT JOIN exit_authorizations a ON a.id = c.authorization_id
      WHERE ${where.join(' AND ')} ORDER BY c.id DESC LIMIT 500`, ...params);
    const mv = authz.search({ role: 'rh' }, { ...q, statut: 'SORTIE_EFFECTUEE,RETOUR_EFFECTUE', size: 200, periode: q.periode || (q.date_from || q.date_to ? undefined : 'aujourdhui') });
    res.json({ checks: rows.map((r) => ({ ...r })), movements: mv.items.map(authz.forGuard), total_movements: mv.total });
  });

  return router;
};

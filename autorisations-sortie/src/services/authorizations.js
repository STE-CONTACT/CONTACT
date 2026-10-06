'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const clock = require('../lib/clock');
const {
  authorizationWindow, noReturnWindow, localDate, localTime, minutesBetween, formatDuration, isWithinShift, toMinutes, addDays, dayBoundsUtc,
} = require('../lib/time');
const { badRequest, forbidden, notFound, conflict } = require('../lib/errors');
const { TYPES_SORTIE, STATUTS, STATUTS_ACTIFS } = require('../lib/constants');

const ATTACHMENT_TYPES = {
  'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
};
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const AUTH_SELECT = `
SELECT a.*,
  e.matricule, e.nom AS emp_nom, e.prenom AS emp_prenom, e.photo AS emp_photo, e.team_id, e.service_id, e.shift_id,
  t.nom AS equipe, s.nom AS service, sh.nom AS poste_nom, sh.heure_debut AS poste_debut, sh.heure_fin AS poste_fin,
  uc.prenom || ' ' || uc.nom AS createur, ua.prenom || ' ' || ua.nom AS valideur,
  ur.prenom || ' ' || ur.nom AS refuseur, ux.prenom || ' ' || ux.nom AS annuleur,
  gm.heure_sortie_reelle, gm.heure_retour_reel, gm.poste_garde_sortie, gm.poste_garde_retour,
  gm.guard_id, gm.guard_retour_id,
  ug.prenom || ' ' || ug.nom AS gardien_sortie, ugr.prenom || ' ' || ugr.nom AS gardien_retour
FROM exit_authorizations a
JOIN employees e ON e.id = a.employee_id
LEFT JOIN teams t ON t.id = e.team_id
LEFT JOIN services s ON s.id = e.service_id
LEFT JOIN shifts sh ON sh.id = e.shift_id
LEFT JOIN users uc ON uc.id = a.created_by
LEFT JOIN users ua ON ua.id = a.approved_by
LEFT JOIN users ur ON ur.id = a.rejected_by
LEFT JOIN users ux ON ux.id = a.cancelled_by
LEFT JOIN gate_movements gm ON gm.authorization_id = a.id
LEFT JOIN users ug ON ug.id = gm.guard_id
LEFT JOIN users ugr ON ugr.id = gm.guard_retour_id`;

function createAuthorizationService({ db, settings, audit, notifier, realtime, config }) {
  const tz = () => settings.tz();

  // ---------------------------------------------------------------- périmètre
  /** Affectations (table teams) dont l'utilisateur (chef / responsable) a la charge. */
  function chefTeamIds(user) {
    const ids = db.all('SELECT id FROM teams WHERE chef_equipe_id = ?', user.id).map((r) => r.id);
    if (user.team_id && !ids.includes(user.team_id)) ids.push(user.team_id);
    return ids;
  }

  /** Clause SQL limitant les autorisations visibles par l'utilisateur. */
  function scopeClause(user) {
    if (user.role === 'admin' || user.role === 'rh') return { sql: '1=1', params: [] };
    if (user.role === 'chef') {
      if (user.droit_toutes_equipes) return { sql: '1=1', params: [] };
      const teams = chefTeamIds(user);
      const ph = teams.map(() => '?').join(',');
      return {
        sql: teams.length ? `(a.created_by = ? OR e.team_id IN (${ph}))` : 'a.created_by = ?',
        params: [user.id, ...teams],
      };
    }
    return { sql: '0=1', params: [] };
  }

  function canManageEmployee(user, employee) {
    if (user.role === 'admin') return true;
    if (user.role !== 'chef') return false;
    if (user.droit_toutes_equipes) return true;
    return chefTeamIds(user).includes(employee.team_id);
  }

  // ---------------------------------------------------------------- présentation
  function decorate(row) {
    if (!row) return row;
    const now = clock.now();
    const a = { ...row };
    a.type_sortie_label = TYPES_SORTIE[a.type_sortie] || a.type_sortie;
    a.avec_retour = a.avec_retour !== 0;
    a.retour_lendemain = a.avec_retour && toMinutes(a.heure_retour_prevue) < toMinutes(a.heure_sortie_prevue);
    a.date_retour = a.avec_retour ? (a.retour_lendemain ? addDays(a.date_sortie, 1) : a.date_sortie) : null;
    // Sans retour : heure limite pour sortir (fin de poste), en heure locale
    a.valable_jusqua = localTime(new Date(a.fin_at), tz());
    a.valable_jusqua_date = localDate(new Date(a.fin_at), tz());
    a.en_retard = (a.statut === 'SORTIE_EFFECTUEE' && now > new Date(a.fin_at))
      || (a.statut === 'RETOUR_EFFECTUE' && a.heure_retour_reel && new Date(a.heure_retour_reel) > new Date(a.fin_at));
    if (a.heure_sortie_reelle) {
      const end = a.heure_retour_reel || now.toISOString();
      a.duree_reelle_min = minutesBetween(a.heure_sortie_reelle, end);
      a.duree_reelle = formatDuration(a.duree_reelle_min);
    }
    if (a.statut === 'SORTIE_EFFECTUEE') {
      a.retard_min = Math.max(0, minutesBetween(a.fin_at, now));
    }
    a.duree_prevue = formatDuration(minutesBetween(a.debut_at, a.fin_at));
    if (a.poste_debut && a.poste_fin && a.avec_retour) {
      a.dans_poste = isWithinShift({ heure_debut: a.poste_debut, heure_fin: a.poste_fin }, new Date(a.debut_at), new Date(a.fin_at), tz());
    }
    // Information uniquement : les horaires RH ne bloquent jamais le traitement.
    const created = new Date(a.created_at);
    const t = toMinutes(localTime(created, tz()));
    const s = settings.all();
    a.cree_hors_horaires_rh = t < toMinutes(s.rh_heure_debut) || t >= toMinutes(s.rh_heure_fin)
      || (t >= toMinutes(s.rh_pause_debut) && t < toMinutes(s.rh_pause_fin));
    a.has_piece_jointe = Boolean(a.piece_jointe);
    delete a.piece_jointe;
    return a;
  }

  /** Vue restreinte pour le gardien : aucune information confidentielle (motif, commentaires, pièce jointe). */
  function forGuard(a) {
    if (!a) return null;
    return {
      id: a.id, numero: a.numero, statut: a.statut, employee_id: a.employee_id,
      matricule: a.matricule, emp_nom: a.emp_nom, emp_prenom: a.emp_prenom, emp_photo: a.emp_photo,
      service: a.service, equipe: a.equipe, poste_nom: a.poste_nom, poste_debut: a.poste_debut, poste_fin: a.poste_fin,
      date_sortie: a.date_sortie, date_retour: a.date_retour, retour_lendemain: a.retour_lendemain,
      avec_retour: a.avec_retour, valable_jusqua: a.valable_jusqua, valable_jusqua_date: a.valable_jusqua_date,
      heure_sortie_prevue: a.heure_sortie_prevue, heure_retour_prevue: a.heure_retour_prevue,
      debut_at: a.debut_at, fin_at: a.fin_at, approved_at: a.approved_at,
      heure_sortie_reelle: a.heure_sortie_reelle, heure_retour_reel: a.heure_retour_reel,
      poste_garde_sortie: a.poste_garde_sortie, poste_garde_retour: a.poste_garde_retour,
      gardien_sortie: a.gardien_sortie, gardien_retour: a.gardien_retour,
      en_retard: a.en_retard, retard_min: a.retard_min, duree_reelle: a.duree_reelle, duree_reelle_min: a.duree_reelle_min,
    };
  }

  function getRaw(id) { return db.get('SELECT * FROM exit_authorizations WHERE id = ?', id); }
  function getFull(id) { return decorate(db.get(`${AUTH_SELECT} WHERE a.id = ?`, id)); }

  function getForUser(user, id) {
    const sc = scopeClause(user);
    const row = db.get(`${AUTH_SELECT} WHERE a.id = ? AND ${sc.sql}`, id, ...sc.params);
    if (!row) throw notFound('Autorisation introuvable');
    return decorate(row);
  }

  function timeline(id) {
    return db.all(`SELECT id, date, heure, created_at, action, username, role, nouvelle_valeur
      FROM audit_logs WHERE entity_type = 'authorization' AND entity_id = ? ORDER BY id`, id);
  }

  function broadcastChange(a, action) {
    realtime.broadcast('authorization', { id: a.id, statut: a.statut, action });
  }

  // ---------------------------------------------------------------- validations
  function validateFields(input, { requireAll = true } = {}) {
    const out = {};
    if (requireAll || input.date_sortie !== undefined) out.date_sortie = String(input.date_sortie || '');
    if (requireAll || input.heure_sortie_prevue !== undefined) out.heure_sortie_prevue = String(input.heure_sortie_prevue || '');
    if (requireAll || input.avec_retour !== undefined) out.avec_retour = input.avec_retour === false || input.avec_retour === 0 || input.avec_retour === '0' ? 0 : 1;
    if (requireAll || input.heure_retour_prevue !== undefined || input.avec_retour !== undefined) {
      out.heure_retour_prevue = out.avec_retour === 0 ? null : String(input.heure_retour_prevue || '');
      if (out.avec_retour !== 0 && !out.heure_retour_prevue) {
        throw badRequest("Indiquez l'heure de retour prévue, ou choisissez « Sans retour » si l'opérateur quitte son poste.");
      }
    }
    if (requireAll || input.type_sortie !== undefined) {
      if (!TYPES_SORTIE[input.type_sortie]) throw badRequest('Type de sortie invalide');
      out.type_sortie = input.type_sortie;
    }
    if (requireAll || input.motif !== undefined) {
      const motif = String(input.motif || '').trim();
      if (!motif) throw badRequest('Le motif est obligatoire');
      if (motif.length > 500) throw badRequest('Motif trop long (500 caractères max.)');
      out.motif = motif;
    }
    if (input.commentaire !== undefined) {
      const c = String(input.commentaire || '').trim();
      if (c.length > 1000) throw badRequest('Commentaire trop long (1000 caractères max.)');
      out.commentaire = c || null;
    }
    return out;
  }

  /** Contrôles de cohérence de la fenêtre horaire — aucun blocage lié aux horaires RH. */
  function checkWindow(employeeId, fields, excludeId = null) {
    let w;
    const sansRetour = fields.avec_retour === 0;
    try {
      if (sansRetour) {
        const shift = db.get('SELECT sh.heure_debut, sh.heure_fin FROM employees e JOIN shifts sh ON sh.id = e.shift_id WHERE e.id = ?', employeeId);
        w = noReturnWindow(fields.date_sortie, fields.heure_sortie_prevue, shift || null, tz());
      } else {
        w = authorizationWindow(fields.date_sortie, fields.heure_sortie_prevue, fields.heure_retour_prevue, tz());
      }
    } catch (e) { throw badRequest(e.message); }
    const now = clock.now();
    const s = settings.all();
    if (w.fin <= now) {
      throw badRequest(sansRetour
        ? "L'heure de sortie est trop ancienne (le poste de l'opérateur est terminé). Vérifiez la date et l'heure."
        : "L'heure de retour prévue est déjà passée. Vérifiez la date (pour une sortie après minuit, choisissez la date du lendemain).");
    }
    const dureeMin = minutesBetween(w.debut, w.fin);
    if (dureeMin > s.duree_max_heures * 60) throw badRequest(`Durée maximale dépassée (${s.duree_max_heures} h)`);
    if (minutesBetween(now, w.debut) > s.delai_creation_max_jours * 1440) {
      throw badRequest(`La sortie ne peut pas être prévue plus de ${s.delai_creation_max_jours} jours à l'avance`);
    }
    const overlap = db.get(`SELECT numero, statut FROM exit_authorizations
      WHERE employee_id = ? AND id != ? AND (statut = 'SORTIE_EFFECTUEE' OR (statut IN ('EN_ATTENTE','VALIDEE') AND debut_at < ? AND fin_at > ?))
      LIMIT 1`, employeeId, excludeId || 0, w.fin.toISOString(), w.debut.toISOString());
    if (overlap) {
      throw conflict(overlap.statut === 'SORTIE_EFFECTUEE'
        ? `Cet opérateur est actuellement à l'extérieur (${overlap.numero}). Son retour doit être confirmé avant une nouvelle autorisation.`
        : `Une autorisation active existe déjà sur ce créneau (${overlap.numero}).`);
    }
    return w;
  }

  function saveAttachment(file) {
    if (!file) return null;
    if (!settings.get('pieces_jointes_actives')) throw badRequest('Les pièces jointes sont désactivées');
    const ext = ATTACHMENT_TYPES[file.type];
    if (!ext) throw badRequest('Type de pièce jointe non autorisé (PDF, JPEG, PNG, WEBP)');
    const buf = Buffer.from(String(file.data || ''), 'base64');
    if (!buf.length) throw badRequest('Pièce jointe vide');
    if (buf.length > MAX_ATTACHMENT_BYTES) throw badRequest('Pièce jointe trop volumineuse (5 Mo max.)');
    const dir = path.join(config.uploadsDir, 'pieces-jointes');
    fs.mkdirSync(dir, { recursive: true });
    const name = `${crypto.randomUUID()}${ext}`;
    fs.writeFileSync(path.join(dir, name), buf);
    return { file: name, nom: String(file.name || `piece-jointe${ext}`).replace(/[^\w.\- ]+/g, '_').slice(0, 120), type: file.type };
  }

  function attachmentPath(a) {
    return a && a.piece_jointe ? path.join(config.uploadsDir, 'pieces-jointes', path.basename(a.piece_jointe)) : null;
  }

  // ---------------------------------------------------------------- workflow
  function notifySubmitted(a, user) {
    notifier.notify({
      userIds: notifier.recipientsByRole('rh'),
      excludeUserId: user.id,
      type: 'DEMANDE_CREEE',
      titre: 'Nouvelle demande de sortie',
      message: `${a.matricule} — ${a.emp_prenom} ${a.emp_nom} (${a.equipe || 'sans affectation'}) : sortie ${fmtWindow(a)}. Demandée par ${a.createur}.`,
      entityType: 'authorization', entityId: a.id,
    });
  }

  /** Le poste de garde est prévenu immédiatement d'une autorisation valable. */
  function notifyGuards(a) {
    notifier.notify({
      userIds: notifier.recipientsByRole('gardien'),
      type: 'AUTORISATION_VALIDEE',
      titre: `Sortie autorisée — MAT. ${a.matricule}`,
      message: `${a.emp_prenom} ${a.emp_nom} (${a.equipe || 'sans affectation'}) : sortie ${fmtWindow(a)}. Autorisée par ${a.valideur || a.createur}.`,
      entityType: 'authorization', entityId: a.id,
    });
  }

  function fmtWindow(a) {
    const d = a.date_sortie.split('-').reverse().join('/');
    if (!a.avec_retour) return `le ${d} à ${a.heure_sortie_prevue} — SANS RETOUR (valable jusqu'à ${a.valable_jusqua})`;
    return `le ${d} de ${a.heure_sortie_prevue} à ${a.heure_retour_prevue}${a.retour_lendemain ? ' (lendemain)' : ''}`;
  }

  /** Création d'une autorisation (brouillon ou directement soumise). */
  function create(user, input, req) {
    if (!['chef', 'admin'].includes(user.role)) throw forbidden("Seuls les chefs d'équipe et l'administrateur peuvent créer une autorisation");
    const employeeId = Number(input.employee_id);
    const emp = db.get('SELECT * FROM employees WHERE id = ?', employeeId);
    if (!emp) throw badRequest('Opérateur introuvable');
    if (!emp.actif) throw badRequest('Cet opérateur est inactif');
    if (!canManageEmployee(user, emp)) throw forbidden("Cette personne ne fait pas partie de votre affectation");
    const fields = validateFields(input);
    const submit = input.submit !== false;
    // Par défaut, l'autorisation du chef est valable immédiatement (pas de validation RH).
    const auto = submit && !settings.get('validation_rh_requise');
    const statut = !submit ? 'BROUILLON' : auto ? 'VALIDEE' : 'EN_ATTENTE';
    const w = checkWindow(employeeId, fields);
    const now = clock.nowIso();
    const attachment = saveAttachment(input.piece_jointe);

    const id = db.tx(() => {
      const r = db.run(`INSERT INTO exit_authorizations
        (employee_id, created_by, date_sortie, heure_sortie_prevue, heure_retour_prevue, avec_retour, debut_at, fin_at, type_sortie, motif, commentaire,
         piece_jointe, piece_jointe_nom, piece_jointe_type, statut, created_at, submitted_at, updated_at, approved_by, approved_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      employeeId, user.id, fields.date_sortie, fields.heure_sortie_prevue, fields.heure_retour_prevue, fields.avec_retour,
      w.debut.toISOString(), w.fin.toISOString(), fields.type_sortie, fields.motif, fields.commentaire ?? null,
      attachment?.file ?? null, attachment?.nom ?? null, attachment?.type ?? null,
      statut, now, submit ? now : null, now, auto ? user.id : null, auto ? now : null);
      const newId = Number(r.lastInsertRowid);
      const numero = `AS-${fields.date_sortie.slice(0, 4)}-${String(newId).padStart(6, '0')}`;
      db.run('UPDATE exit_authorizations SET numero = ? WHERE id = ?', numero, newId);
      const snapshot = { numero, matricule: emp.matricule, ...fields, debut_at: w.debut.toISOString(), fin_at: w.fin.toISOString(), statut };
      audit.log({ user, action: 'DEMANDE_CREEE', entityType: 'authorization', entityId: newId, after: snapshot, req });
      if (auto) audit.log({ user, action: 'AUTORISATION_VALIDEE', entityType: 'authorization', entityId: newId, after: { statut: 'VALIDEE', mode: 'autorisation directe du chef' }, req });
      else if (submit) audit.log({ user, action: 'DEMANDE_SOUMISE', entityType: 'authorization', entityId: newId, after: { statut: 'EN_ATTENTE' }, req });
      return newId;
    });
    const a = getFull(id);
    if (auto) notifyGuards(a);
    else if (submit) notifySubmitted(a, user);
    broadcastChange(a, 'created');
    return a;
  }

  /** Modification d'un brouillon. */
  function updateDraft(user, id, input, req) {
    const a = getForUser(user, id);
    if (a.statut !== 'BROUILLON') throw conflict('Seul un brouillon peut être modifié');
    if (user.role !== 'admin' && a.created_by !== user.id) throw forbidden();
    const fields = { ...pick(a, ['date_sortie', 'heure_sortie_prevue', 'heure_retour_prevue', 'type_sortie', 'motif', 'commentaire']), avec_retour: a.avec_retour ? 1 : 0, ...validateFields(input, { requireAll: false }) };
    const w = checkWindow(a.employee_id, fields, id);
    const attachment = input.piece_jointe ? saveAttachment(input.piece_jointe) : null;
    db.tx(() => {
      db.run(`UPDATE exit_authorizations SET date_sortie=?, heure_sortie_prevue=?, heure_retour_prevue=?, avec_retour=?, debut_at=?, fin_at=?, type_sortie=?,
        motif=?, commentaire=?, updated_at=? ${attachment ? ', piece_jointe=?, piece_jointe_nom=?, piece_jointe_type=?' : ''} WHERE id=? AND statut='BROUILLON'`,
      fields.date_sortie, fields.heure_sortie_prevue, fields.heure_retour_prevue, fields.avec_retour, w.debut.toISOString(), w.fin.toISOString(),
      fields.type_sortie, fields.motif, fields.commentaire ?? null, clock.nowIso(),
      ...(attachment ? [attachment.file, attachment.nom, attachment.type] : []), id);
      audit.log({ user, action: 'BROUILLON_MODIFIE', entityType: 'authorization', entityId: id, before: pick(a, Object.keys(fields)), after: fields, req });
    });
    return getFull(id);
  }

  function submit(user, id, req) {
    const a = getForUser(user, id);
    if (a.statut !== 'BROUILLON') throw conflict("Cette demande n'est pas un brouillon");
    if (user.role !== 'admin' && a.created_by !== user.id) throw forbidden();
    checkWindow(a.employee_id, { ...a, avec_retour: a.avec_retour ? 1 : 0 }, id);
    const now = clock.nowIso();
    const auto = !settings.get('validation_rh_requise');
    db.tx(() => {
      const r = auto
        ? db.run("UPDATE exit_authorizations SET statut='VALIDEE', submitted_at=?, approved_by=?, approved_at=?, updated_at=? WHERE id=? AND statut='BROUILLON'", now, user.id, now, now, id)
        : db.run("UPDATE exit_authorizations SET statut='EN_ATTENTE', submitted_at=?, updated_at=? WHERE id=? AND statut='BROUILLON'", now, now, id);
      if (!r.changes) throw conflict('La demande a été modifiée entre-temps');
      audit.log({ user, action: auto ? 'AUTORISATION_VALIDEE' : 'DEMANDE_SOUMISE', entityType: 'authorization', entityId: id, before: { statut: 'BROUILLON' }, after: { statut: auto ? 'VALIDEE' : 'EN_ATTENTE' }, req });
    });
    const full = getFull(id);
    if (auto) notifyGuards(full); else notifySubmitted(full, user);
    broadcastChange(full, 'submitted');
    return full;
  }

  function approve(user, id, input, req) {
    if (!['rh', 'admin'].includes(user.role)) throw forbidden('Seul le RH / responsable peut valider');
    expireDue();
    const a = getForUser(user, id);
    if (a.statut === 'EXPIREE') throw conflict('Cette demande a expiré : la période prévue est dépassée');
    if (a.statut !== 'EN_ATTENTE') throw conflict(`Impossible de valider une demande au statut ${a.statut}`);
    if (a.created_by === user.id && user.role !== 'admin') throw forbidden('Vous ne pouvez pas valider votre propre demande');
    const commentaire = String(input.commentaire || '').trim().slice(0, 1000) || null;
    const now = clock.nowIso();
    db.tx(() => {
      const r = db.run(`UPDATE exit_authorizations SET statut='VALIDEE', approved_by=?, approved_at=?, commentaire_rh=COALESCE(?, commentaire_rh), updated_at=?
        WHERE id=? AND statut='EN_ATTENTE'`, user.id, now, commentaire, now, id);
      if (!r.changes) throw conflict('La demande a déjà été traitée');
      audit.log({ user, action: 'AUTORISATION_VALIDEE', entityType: 'authorization', entityId: id, before: { statut: 'EN_ATTENTE' }, after: { statut: 'VALIDEE', commentaire_rh: commentaire }, req });
    });
    const full = getFull(id);
    notifyGuards(full);
    notifier.notify({
      userIds: [full.created_by], excludeUserId: user.id,
      type: 'AUTORISATION_VALIDEE',
      titre: 'Demande validée',
      message: `La sortie de ${full.emp_prenom} ${full.emp_nom} (${full.matricule}) ${fmtWindow(full)} a été validée par ${full.valideur}.`,
      entityType: 'authorization', entityId: id,
    });
    broadcastChange(full, 'approved');
    return full;
  }

  function reject(user, id, input, req) {
    if (!['rh', 'admin'].includes(user.role)) throw forbidden('Seul le RH / responsable peut refuser');
    const a = getForUser(user, id);
    if (a.statut !== 'EN_ATTENTE') throw conflict(`Impossible de refuser une demande au statut ${a.statut}`);
    const motif = String(input.motif_refus || '').trim().slice(0, 500);
    if (!motif && settings.get('motif_refus_obligatoire')) throw badRequest('Le motif du refus est obligatoire');
    const now = clock.nowIso();
    db.tx(() => {
      const r = db.run(`UPDATE exit_authorizations SET statut='REFUSEE', rejected_by=?, rejected_at=?, motif_refus=?, updated_at=?
        WHERE id=? AND statut='EN_ATTENTE'`, user.id, now, motif || null, now, id);
      if (!r.changes) throw conflict('La demande a déjà été traitée');
      audit.log({ user, action: 'AUTORISATION_REFUSEE', entityType: 'authorization', entityId: id, before: { statut: 'EN_ATTENTE' }, after: { statut: 'REFUSEE', motif_refus: motif }, req });
    });
    const full = getFull(id);
    notifier.notify({
      userIds: [full.created_by], excludeUserId: user.id,
      type: 'AUTORISATION_REFUSEE',
      titre: 'Autorisation refusée',
      message: `${full.emp_prenom} ${full.emp_nom} (${full.matricule}) — Autorisation refusée${motif ? ` — motif : ${motif}` : ''}.`,
      entityType: 'authorization', entityId: id,
    });
    broadcastChange(full, 'rejected');
    return full;
  }

  /** Annulation possible tant que l'autorisation n'a pas été utilisée (pas de sortie effectuée). */
  function cancel(user, id, input, req) {
    const a = getForUser(user, id);
    if (!['chef', 'admin', 'rh'].includes(user.role)) throw forbidden();
    if (user.role === 'rh' && a.statut !== 'VALIDEE' && a.statut !== 'EN_ATTENTE') throw forbidden();
    if (!['BROUILLON', 'EN_ATTENTE', 'VALIDEE'].includes(a.statut)) {
      throw conflict(['SORTIE_EFFECTUEE', 'RETOUR_EFFECTUE', 'SORTIE_DEFINITIVE'].includes(a.statut)
        ? "Impossible d'annuler : l'autorisation a déjà été utilisée"
        : `Impossible d'annuler une demande au statut ${a.statut}`);
    }
    const motif = String(input.motif || '').trim().slice(0, 500) || null;
    const now = clock.nowIso();
    db.tx(() => {
      const r = db.run(`UPDATE exit_authorizations SET statut='ANNULEE', cancelled_by=?, cancelled_at=?, motif_annulation=?, updated_at=?
        WHERE id=? AND statut=?`, user.id, now, motif, now, id, a.statut);
      if (!r.changes) throw conflict('La demande a été modifiée entre-temps');
      audit.log({ user, action: 'DEMANDE_ANNULEE', entityType: 'authorization', entityId: id, before: { statut: a.statut }, after: { statut: 'ANNULEE', motif_annulation: motif }, req });
    });
    const full = getFull(id);
    if (a.statut === 'VALIDEE') {
      notifier.notify({
        userIds: notifier.recipientsByRole('gardien'),
        type: 'AUTORISATION_ANNULEE',
        titre: `Autorisation ANNULÉE — MAT. ${full.matricule}`,
        message: `L'autorisation de ${full.emp_prenom} ${full.emp_nom} ${fmtWindow(full)} a été annulée. Ne plus autoriser cette sortie.`,
        entityType: 'authorization', entityId: id,
      });
    }
    if (a.statut === 'EN_ATTENTE' || a.statut === 'VALIDEE') {
      notifier.notify({
        userIds: [full.created_by, a.approved_by], excludeUserId: user.id,
        type: 'AUTORISATION_ANNULEE', titre: 'Demande annulée',
        message: `La demande ${full.numero} (${full.matricule} — ${full.emp_prenom} ${full.emp_nom}) a été annulée.`,
        entityType: 'authorization', entityId: id,
      });
    }
    broadcastChange(full, 'cancelled');
    return full;
  }

  // ---------------------------------------------------------------- poste de garde
  function guardPoste(user, poste) {
    const postes = settings.get('postes_garde');
    if (poste && postes.includes(poste)) return poste;
    return user.poste_garde && postes.includes(user.poste_garde) ? user.poste_garde : postes[0];
  }

  /** Le gardien confirme la sortie : uniquement pour une autorisation VALIDÉE et dans sa période de validité. */
  function confirmExit(user, id, input, req) {
    if (!['gardien', 'admin'].includes(user.role)) throw forbidden('Seul le gardien peut confirmer une sortie');
    expireDue();
    const a = getFull(id);
    if (!a) throw notFound('Autorisation introuvable');
    if (a.statut !== 'VALIDEE') {
      const msg = {
        EN_ATTENTE: "Autorisation NON VALIDÉE : en attente de validation RH. Sortie interdite.",
        REFUSEE: 'Autorisation REFUSÉE. Sortie interdite.',
        EXPIREE: 'Autorisation EXPIRÉE. Sortie interdite.',
        ANNULEE: 'Autorisation ANNULÉE. Sortie interdite.',
        SORTIE_EFFECTUEE: 'La sortie a déjà été enregistrée.',
        RETOUR_EFFECTUE: 'Autorisation déjà utilisée.',
        SORTIE_DEFINITIVE: 'Sortie sans retour déjà enregistrée : autorisation déjà utilisée.',
        BROUILLON: "Cette demande n'a pas été soumise. Sortie interdite.",
      }[a.statut] || 'Autorisation non valide.';
      throw conflict(msg);
    }
    const now = clock.now();
    const tol = settings.get('tolerance_sortie_avant_min');
    if (now < new Date(new Date(a.debut_at).getTime() - tol * 60000)) {
      throw conflict(`Trop tôt : sortie prévue le ${a.date_sortie.split('-').reverse().join('/')} à ${a.heure_sortie_prevue} (tolérance ${tol} min).`);
    }
    if (now >= new Date(a.fin_at)) throw conflict('Autorisation EXPIRÉE. Sortie interdite.');
    const poste = guardPoste(user, input.poste_garde);
    const iso = now.toISOString();
    const newStatut = a.avec_retour ? 'SORTIE_EFFECTUEE' : 'SORTIE_DEFINITIVE';
    db.tx(() => {
      const r = db.run('UPDATE exit_authorizations SET statut=?, updated_at=? WHERE id=? AND statut=\'VALIDEE\'', newStatut, iso, id);
      if (!r.changes) throw conflict('La sortie a déjà été enregistrée');
      db.run(`INSERT INTO gate_movements (authorization_id, guard_id, poste_garde_sortie, heure_sortie_reelle, statut, created_at)
        VALUES (?,?,?,?, 'SORTI', ?)`, id, user.id, poste, iso, iso);
      audit.log({
        user, action: 'SORTIE_CONFIRMEE', entityType: 'authorization', entityId: id, before: { statut: 'VALIDEE' },
        after: { statut: newStatut, sans_retour: !a.avec_retour, heure_sortie_reelle: iso, heure_locale: localTime(now, tz()), date_locale: localDate(now, tz()), poste_garde: poste }, req,
      });
    });
    const full = getFull(id);
    broadcastChange(full, 'exit');
    return full;
  }

  function confirmReturn(user, id, input, req) {
    if (!['gardien', 'admin'].includes(user.role)) throw forbidden('Seul le gardien peut confirmer un retour');
    const a = getFull(id);
    if (!a) throw notFound('Autorisation introuvable');
    if (a.statut !== 'SORTIE_EFFECTUEE') throw conflict(a.statut === 'RETOUR_EFFECTUE' ? 'Le retour a déjà été enregistré' : "Aucune sortie en cours pour cette autorisation");
    const now = clock.now();
    const poste = guardPoste(user, input.poste_garde);
    const iso = now.toISOString();
    const duree = minutesBetween(a.heure_sortie_reelle, iso);
    const retard = Math.max(0, minutesBetween(a.fin_at, iso));
    db.tx(() => {
      const r = db.run("UPDATE exit_authorizations SET statut='RETOUR_EFFECTUE', updated_at=? WHERE id=? AND statut='SORTIE_EFFECTUEE'", iso, id);
      if (!r.changes) throw conflict('Le retour a déjà été enregistré');
      db.run(`UPDATE gate_movements SET guard_retour_id=?, poste_garde_retour=?, heure_retour_reel=?, statut='RENTRE' WHERE authorization_id=?`,
        user.id, poste, iso, id);
      audit.log({
        user, action: 'RETOUR_CONFIRME', entityType: 'authorization', entityId: id, before: { statut: 'SORTIE_EFFECTUEE' },
        after: {
          statut: 'RETOUR_EFFECTUE', heure_retour_reel: iso, heure_locale: localTime(now, tz()), date_locale: localDate(now, tz()),
          poste_garde: poste, duree: formatDuration(duree), retard_min: retard,
        },
        req,
      });
    });
    const full = getFull(id);
    broadcastChange(full, 'return');
    return full;
  }

  /**
   * Contrôle au poste de garde par matricule, nom ou QR code.
   * Retourne un verdict simple et lisible, sans information confidentielle.
   */
  function gateLookup(user, { q, qr, poste }, req) {
    expireDue();
    let employees = [];
    let methode = 'recherche';
    let saisie = String(q || '').trim();
    if (qr) {
      methode = 'qr';
      saisie = String(qr).trim();
      const m = /^SORTIE:([^:]+):([A-Za-z0-9_-]+)$/.exec(saisie);
      const e = m
        ? db.get('SELECT * FROM employees WHERE qr_token = ? AND matricule = ? COLLATE NOCASE', m[2], m[1])
        : db.get('SELECT * FROM employees WHERE matricule = ? COLLATE NOCASE', saisie);
      if (e) employees = [e];
    } else if (saisie) {
      const exact = db.get('SELECT * FROM employees WHERE matricule = ? COLLATE NOCASE', saisie);
      if (exact) employees = [exact];
      else {
        const like = `%${saisie.replace(/[%_]/g, '')}%`;
        employees = db.all(`SELECT * FROM employees WHERE actif = 1 AND (matricule LIKE ? OR nom LIKE ? OR prenom LIKE ? OR (prenom || ' ' || nom) LIKE ? OR (nom || ' ' || prenom) LIKE ?)
          ORDER BY nom, prenom LIMIT 10`, like, like, like, like, like);
      }
    }
    const posteGarde = guardPoste(user, poste);

    if (employees.length !== 1) {
      const resultat = employees.length ? 'PLUSIEURS' : 'INCONNU';
      if (saisie) {
        db.run('INSERT INTO gate_checks (guard_id, poste_garde, methode, saisie, resultat, created_at) VALUES (?,?,?,?,?,?)',
          user.id, posteGarde, methode, saisie.slice(0, 80), resultat, clock.nowIso());
      }
      return {
        verdict: resultat,
        candidates: employees.map((e) => employeeCard(e)),
      };
    }

    const emp = employees[0];
    const result = employeeVerdict(emp);
    db.tx(() => {
      db.run('INSERT INTO gate_checks (guard_id, poste_garde, methode, saisie, employee_id, authorization_id, resultat, created_at) VALUES (?,?,?,?,?,?,?,?)',
        user.id, posteGarde, methode, saisie.slice(0, 80), emp.id, result.authorization ? result.authorization.id : null, result.verdict, clock.nowIso());
      audit.log({
        user, action: 'CONTROLE_POSTE_GARDE', entityType: result.authorization ? 'authorization' : 'employee',
        entityId: result.authorization ? result.authorization.id : emp.id,
        after: { matricule: emp.matricule, methode, verdict: result.verdict, poste_garde: posteGarde }, req,
      });
    });
    return result;
  }

  function employeeCard(e) {
    const row = db.get(`SELECT e.id, e.matricule, e.nom, e.prenom, e.photo, e.actif, t.nom AS equipe, s.nom AS service,
      sh.nom AS poste_nom, sh.heure_debut AS poste_debut, sh.heure_fin AS poste_fin
      FROM employees e LEFT JOIN teams t ON t.id = e.team_id LEFT JOIN services s ON s.id = e.service_id LEFT JOIN shifts sh ON sh.id = e.shift_id
      WHERE e.id = ?`, e.id);
    return { ...row };
  }

  function employeeVerdict(emp) {
    const card = employeeCard(emp);
    const nowIso = clock.nowIso();
    const outside = db.get(`${AUTH_SELECT} WHERE a.employee_id = ? AND a.statut = 'SORTIE_EFFECTUEE' ORDER BY a.debut_at DESC LIMIT 1`, emp.id);
    if (outside) return { verdict: 'A_L_EXTERIEUR', employee: card, authorization: forGuard(decorate(outside)) };
    const valid = db.get(`${AUTH_SELECT} WHERE a.employee_id = ? AND a.statut = 'VALIDEE' AND a.fin_at > ? ORDER BY a.debut_at LIMIT 1`, emp.id, nowIso);
    if (valid) {
      const tol = settings.get('tolerance_sortie_avant_min');
      const early = new Date(valid.debut_at).getTime() - tol * 60000 > Date.parse(nowIso);
      return { verdict: early ? 'VALIDEE_A_VENIR' : 'VALIDEE', employee: card, authorization: forGuard(decorate(valid)) };
    }
    if (!emp.actif) return { verdict: 'AUCUNE', employee: card, authorization: null, info: 'Opérateur inactif' };
    // Information complémentaire : dernière demande récente non utilisable (en attente, refusée, expirée...)
    const since = new Date(Date.parse(nowIso) - 24 * 3600000).toISOString();
    const last = db.get(`${AUTH_SELECT} WHERE a.employee_id = ? AND a.statut IN ('EN_ATTENTE','REFUSEE','EXPIREE','ANNULEE') AND a.fin_at > ?
      ORDER BY a.updated_at DESC LIMIT 1`, emp.id, since);
    return {
      verdict: 'AUCUNE', employee: card, authorization: null,
      derniere_demande: last ? { numero: last.numero, statut: last.statut, heure_sortie_prevue: last.heure_sortie_prevue, heure_retour_prevue: last.heure_retour_prevue, date_sortie: last.date_sortie } : null,
    };
  }

  /** Tableau du poste de garde : autorisations validées à venir, opérateurs à l'extérieur, retours du jour. */
  function gateBoard() {
    expireDue();
    const now = clock.now();
    const nowIso = now.toISOString();
    const horizon = new Date(now.getTime() + 24 * 3600000).toISOString();
    const validated = db.all(`${AUTH_SELECT} WHERE a.statut = 'VALIDEE' AND a.fin_at > ? AND a.debut_at < ? ORDER BY a.debut_at`, nowIso, horizon);
    const outside = db.all(`${AUTH_SELECT} WHERE a.statut = 'SORTIE_EFFECTUEE' ORDER BY a.fin_at`);
    const { start } = dayBoundsUtc(localDate(now, tz()), tz());
    const since = new Date(Math.min(start.getTime(), now.getTime() - 12 * 3600000)).toISOString();
    const returns = db.all(`${AUTH_SELECT} WHERE a.statut = 'RETOUR_EFFECTUE' AND gm.heure_retour_reel >= ? ORDER BY gm.heure_retour_reel DESC LIMIT 100`, since);
    const departs = db.all(`${AUTH_SELECT} WHERE a.statut = 'SORTIE_DEFINITIVE' AND gm.heure_sortie_reelle >= ? ORDER BY gm.heure_sortie_reelle DESC LIMIT 100`, since);
    return {
      now: nowIso,
      validated: validated.map((r) => forGuard(decorate(r))),
      outside: outside.map((r) => forGuard(decorate(r))),
      returns: returns.map((r) => forGuard(decorate(r))),
      departs: departs.map((r) => forGuard(decorate(r))),
    };
  }

  // ---------------------------------------------------------------- tâches automatiques
  /** Passe en EXPIRÉE les demandes dont la période est dépassée ; signale les retours en retard. */
  function expireDue() {
    const nowIso = clock.nowIso();
    const due = db.all("SELECT id, statut FROM exit_authorizations WHERE statut IN ('EN_ATTENTE','VALIDEE') AND fin_at <= ?", nowIso);
    for (const d of due) {
      let changed = false;
      db.tx(() => {
        const r = db.run("UPDATE exit_authorizations SET statut='EXPIREE', expired_at=?, updated_at=? WHERE id=? AND statut=?", nowIso, nowIso, d.id, d.statut);
        if (r.changes) {
          changed = true;
          audit.log({ user: null, action: 'AUTORISATION_EXPIREE', entityType: 'authorization', entityId: d.id, before: { statut: d.statut }, after: { statut: 'EXPIREE' } });
        }
      });
      if (changed) {
        const full = getFull(d.id);
        notifier.notify({
          userIds: [full.created_by], type: 'AUTORISATION_EXPIREE', titre: 'Autorisation expirée',
          message: `${full.numero} — ${full.matricule} ${full.emp_prenom} ${full.emp_nom} : ${d.statut === 'EN_ATTENTE' ? 'non traitée avant la fin de la période' : 'non utilisée'} (${fmtWindow(full)}).`,
          entityType: 'authorization', entityId: d.id,
        });
        broadcastChange(full, 'expired');
      }
    }
    const late = db.all("SELECT id FROM exit_authorizations WHERE statut = 'SORTIE_EFFECTUEE' AND fin_at <= ? AND retard_notifie = 0", nowIso);
    for (const l of late) {
      const r = db.run('UPDATE exit_authorizations SET retard_notifie = 1 WHERE id = ? AND retard_notifie = 0', l.id);
      if (!r.changes) continue;
      const full = getFull(l.id);
      audit.log({ user: null, action: 'RETOUR_EN_RETARD', entityType: 'authorization', entityId: l.id, after: { fin_at: full.fin_at } });
      notifier.notify({
        userIds: [full.created_by, ...notifier.recipientsByRole('gardien')], type: 'RETOUR_EN_RETARD', titre: `Retour en retard — MAT. ${full.matricule}`,
        message: `${full.emp_prenom} ${full.emp_nom} devait rentrer à ${full.heure_retour_prevue}${full.retour_lendemain ? ` le ${full.date_retour.split('-').reverse().join('/')}` : ''}.`,
        entityType: 'authorization', entityId: l.id,
      });
      broadcastChange(full, 'late');
    }
    return { expired: due.length, late: late.length };
  }

  // ---------------------------------------------------------------- recherche / historique
  function buildFilters(user, f) {
    const where = [];
    const params = [];
    const sc = scopeClause(user);
    where.push(sc.sql); params.push(...sc.params);
    if (f.q) {
      const like = `%${String(f.q).trim().replace(/[%_]/g, '')}%`;
      where.push("(e.matricule LIKE ? OR e.nom LIKE ? OR e.prenom LIKE ? OR (e.prenom || ' ' || e.nom) LIKE ? OR (e.nom || ' ' || e.prenom) LIKE ? OR a.numero LIKE ?)");
      params.push(like, like, like, like, like, like);
    }
    if (f.matricule) { where.push('e.matricule = ? COLLATE NOCASE'); params.push(String(f.matricule).trim()); }
    if (f.nom) { where.push('e.nom LIKE ?'); params.push(`%${String(f.nom).trim()}%`); }
    if (f.prenom) { where.push('e.prenom LIKE ?'); params.push(`%${String(f.prenom).trim()}%`); }
    if (f.employee_id) { where.push('a.employee_id = ?'); params.push(Number(f.employee_id)); }
    const range = periodRange(f);
    if (range.from) { where.push('a.date_sortie >= ?'); params.push(range.from); }
    if (range.to) { where.push('a.date_sortie <= ?'); params.push(range.to); }
    if (f.service_id) { where.push('e.service_id = ?'); params.push(Number(f.service_id)); }
    if (f.team_id) { where.push('e.team_id = ?'); params.push(Number(f.team_id)); }
    if (f.chef_id) { where.push('a.created_by = ?'); params.push(Number(f.chef_id)); }
    if (f.guard_id) { where.push('(gm.guard_id = ? OR gm.guard_retour_id = ?)'); params.push(Number(f.guard_id), Number(f.guard_id)); }
    if (f.statut) {
      const list = String(f.statut).split(',').filter((s) => STATUTS.includes(s));
      if (list.length) { where.push(`a.statut IN (${list.map(() => '?').join(',')})`); params.push(...list); }
    }
    if (f.type_sortie && TYPES_SORTIE[f.type_sortie]) { where.push('a.type_sortie = ?'); params.push(f.type_sortie); }
    if (f.mine === '1' || f.mine === true) { where.push('a.created_by = ?'); params.push(user.id); }
    return { sql: where.join(' AND '), params };
  }

  function periodRange(f) {
    const today = localDate(clock.now(), tz());
    switch (f.periode) {
      case 'aujourdhui': return { from: today, to: today };
      case 'hier': { const y = addDays(today, -1); return { from: y, to: y }; }
      case 'semaine': {
        const [y, m, d] = today.split('-').map(Number);
        const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // lundi = 0
        return { from: addDays(today, -dow), to: addDays(today, 6 - dow) };
      }
      case 'mois': return { from: `${today.slice(0, 8)}01`, to: `${today.slice(0, 8)}31` };
      default: return { from: f.date_from || null, to: f.date_to || null };
    }
  }

  function search(user, f = {}) {
    const { sql, params } = buildFilters(user, f);
    const page = Math.max(1, Number(f.page) || 1);
    const size = Math.min(200, Math.max(1, Number(f.size) || 25));
    const order = f.sort === 'asc' ? 'a.debut_at ASC' : 'a.debut_at DESC, a.id DESC';
    const total = db.get(`SELECT COUNT(*) AS n FROM (${AUTH_SELECT} WHERE ${sql})`, ...params).n;
    const rows = db.all(`${AUTH_SELECT} WHERE ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, size, (page - 1) * size);
    return { total, page, size, items: rows.map(decorate) };
  }

  function exportRows(user, f = {}) {
    const { sql, params } = buildFilters(user, f);
    return db.all(`${AUTH_SELECT} WHERE ${sql} ORDER BY a.debut_at DESC LIMIT 50000`, ...params).map(decorate);
  }

  function outsideNow(user) {
    expireDue();
    const sc = scopeClause(user.role === 'gardien' ? { ...user, role: 'rh' } : user);
    const rows = db.all(`${AUTH_SELECT} WHERE a.statut = 'SORTIE_EFFECTUEE' AND ${sc.sql} ORDER BY a.fin_at`, ...sc.params).map(decorate);
    return user.role === 'gardien' ? rows.map(forGuard) : rows;
  }

  function dashboard(user) {
    expireDue();
    const now = clock.now();
    const today = localDate(now, tz());
    const sc = scopeClause(user);
    const base = `FROM exit_authorizations a JOIN employees e ON e.id = a.employee_id LEFT JOIN gate_movements gm ON gm.authorization_id = a.id WHERE ${sc.sql}`;
    const counts = {};
    for (const s of STATUTS) counts[s] = 0;
    for (const r of db.all(`SELECT a.statut, COUNT(*) AS n ${base} AND a.date_sortie = ? GROUP BY a.statut`, ...sc.params, today)) counts[r.statut] = r.n;
    const totalToday = Object.values(counts).reduce((x, y) => x + y, 0);
    const { start, end } = dayBoundsUtc(today, tz());
    const outside = db.get(`SELECT COUNT(*) AS n, SUM(CASE WHEN a.fin_at <= ? THEN 1 ELSE 0 END) AS late ${base} AND a.statut = 'SORTIE_EFFECTUEE'`, now.toISOString(), ...sc.params);
    const returnsToday = db.get(`SELECT COUNT(*) AS n ${base} AND gm.heure_retour_reel >= ? AND gm.heure_retour_reel < ?`, ...sc.params, start.toISOString(), end.toISOString()).n;
    const pendingAll = db.get(`SELECT COUNT(*) AS n ${base} AND a.statut = 'EN_ATTENTE'`, ...sc.params).n;
    const expiredToday = db.get(`SELECT COUNT(*) AS n ${base} AND a.expired_at >= ? AND a.expired_at < ?`, ...sc.params, start.toISOString(), end.toISOString()).n;
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(today, -i);
      const r = db.get(`SELECT COUNT(*) AS n, SUM(CASE WHEN a.statut IN ('VALIDEE','SORTIE_EFFECTUEE','RETOUR_EFFECTUE','SORTIE_DEFINITIVE') THEN 1 ELSE 0 END) AS ok,
        SUM(CASE WHEN a.statut = 'REFUSEE' THEN 1 ELSE 0 END) AS ko ${base} AND a.date_sortie = ?`, ...sc.params, d);
      last7.push({ date: d, total: r.n || 0, validees: r.ok || 0, refusees: r.ko || 0 });
    }
    const monthFrom = `${today.slice(0, 8)}01`;
    const byType = db.all(`SELECT a.type_sortie, COUNT(*) AS n ${base} AND a.date_sortie >= ? AND a.date_sortie <= ? GROUP BY a.type_sortie ORDER BY n DESC`, ...sc.params, monthFrom, today)
      .map((r) => ({ ...r, label: TYPES_SORTIE[r.type_sortie] }));
    const byTeam = db.all(`SELECT COALESCE(t.nom, '—') AS equipe, COUNT(*) AS n ${base.replace('LEFT JOIN gate_movements', 'LEFT JOIN teams t ON t.id = e.team_id LEFT JOIN gate_movements')}
      AND a.date_sortie >= ? AND a.date_sortie <= ? GROUP BY t.nom ORDER BY n DESC LIMIT 8`, ...sc.params, monthFrom, today);
    const pending = db.all(`${AUTH_SELECT} WHERE a.statut = 'EN_ATTENTE' AND ${sc.sql} ORDER BY a.debut_at LIMIT 8`, ...sc.params).map(decorate);
    const outsideList = db.all(`${AUTH_SELECT} WHERE a.statut = 'SORTIE_EFFECTUEE' AND ${sc.sql} ORDER BY a.fin_at LIMIT 8`, ...sc.params).map(decorate);
    return {
      date: today, now: now.toISOString(),
      aujourdhui: {
        total: totalToday,
        en_attente: counts.EN_ATTENTE,
        validees: counts.VALIDEE + counts.SORTIE_EFFECTUEE + counts.RETOUR_EFFECTUE + counts.SORTIE_DEFINITIVE,
        sorties_sans_retour: counts.SORTIE_DEFINITIVE,
        refusees: counts.REFUSEE,
        annulees: counts.ANNULEE,
        expirees: counts.EXPIREE,
        sorties_en_cours: outside.n || 0,
        retours_en_retard: outside.late || 0,
        retours_effectues: returnsToday,
        expirees_aujourdhui: expiredToday,
      },
      en_attente_total: pendingAll,
      par_statut: counts,
      last7, byType, byTeam, pending, outside: outsideList,
    };
  }

  return {
    create, updateDraft, submit, approve, reject, cancel, confirmExit, confirmReturn, gateLookup, gateBoard, expireDue,
    search, exportRows, outsideNow, dashboard, getForUser, getFull, timeline, chefTeamIds, canManageEmployee, attachmentPath,
    getRaw, forGuard, decorate, periodRange, STATUTS_ACTIFS,
  };
}

function pick(o, keys) { const r = {}; for (const k of keys) r[k] = o[k]; return r; }

module.exports = { createAuthorizationService, AUTH_SELECT };

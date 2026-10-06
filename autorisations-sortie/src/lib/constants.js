'use strict';

const ROLES = ['admin', 'chef', 'rh', 'gardien'];
const ROLE_LABELS = { admin: 'Administrateur', chef: "Chef d'équipe", rh: 'RH / Responsable', gardien: 'Gardien' };

const STATUTS = ['BROUILLON', 'EN_ATTENTE', 'VALIDEE', 'REFUSEE', 'ANNULEE', 'SORTIE_EFFECTUEE', 'RETOUR_EFFECTUE', 'SORTIE_DEFINITIVE', 'EXPIREE'];
/** Statuts considérés comme « actifs » (bloquent une nouvelle demande qui chevauche). */
const STATUTS_ACTIFS = ['EN_ATTENTE', 'VALIDEE', 'SORTIE_EFFECTUEE'];

const TYPES_SORTIE = {
  PERSONNELLE: 'Sortie personnelle',
  URGENCE: 'Urgence',
  PROFESSIONNELLE: 'Raison professionnelle',
  RENDEZ_VOUS: 'Rendez-vous',
  AUTRE: 'Autre',
};

const SYSTEM_USER = { id: null, username: 'Système', role: 'systeme' };

module.exports = { ROLES, ROLE_LABELS, STATUTS, STATUTS_ACTIFS, TYPES_SORTIE, SYSTEM_USER };

'use strict';
/**
 * Horloge centralisée. Toute la logique métier passe par clock.now(),
 * ce qui permet aux tests de simuler n'importe quelle heure (nuit, changement de date...).
 */
let fixed = null;

module.exports = {
  now() { return fixed ? new Date(fixed.getTime()) : new Date(); },
  nowIso() { return module.exports.now().toISOString(); },
  /** Tests uniquement : fige l'horloge (Date | string ISO) ou la libère (null). */
  set(value) { fixed = value === null ? null : new Date(value); },
  advance(minutes) { if (fixed) fixed = new Date(fixed.getTime() + minutes * 60000); },
};

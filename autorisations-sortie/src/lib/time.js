'use strict';
/**
 * Gestion des dates/heures dans le fuseau horaire de l'entreprise.
 * Aucune dépendance : s'appuie sur Intl (gère l'heure d'été le cas échéant).
 */

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const fmtCache = new Map();
function formatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

function isValidTimezone(tz) {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; } catch { return false; }
}

function zonedParts(date, tz) {
  const p = {};
  for (const x of formatter(tz).formatToParts(date)) p[x.type] = x.value;
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour % 24, minute: +p.minute, second: +p.second,
  };
}

/** Décalage (ms) du fuseau par rapport à UTC à un instant donné. */
function tzOffsetMs(date, tz) {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function isValidTime(s) { return typeof s === 'string' && TIME_RE.test(s); }

function isValidDate(s) {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Convertit une date + heure locales (fuseau entreprise) en instant UTC. */
function zonedToUtc(dateStr, timeStr, tz) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffsetMs(new Date(guess), tz);
  let result = guess - off1;
  const off2 = tzOffsetMs(new Date(result), tz);
  if (off2 !== off1) result = guess - off2;
  return new Date(result);
}

const pad = (n) => String(n).padStart(2, '0');

function localDate(date, tz) {
  const p = zonedParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
function localTime(date, tz, withSeconds = false) {
  const p = zonedParts(date, tz);
  return withSeconds ? `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` : `${pad(p.hour)}:${pad(p.minute)}`;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function toMinutes(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }

/**
 * Fenêtre de validité d'une autorisation.
 * Si l'heure de retour est inférieure ou égale à l'heure de sortie, le retour a lieu le lendemain
 * (ex. 05/10 23:30 → 06/10 01:00).
 */
function authorizationWindow(dateSortie, heureSortie, heureRetour, tz) {
  if (!isValidDate(dateSortie)) throw new Error('Date de sortie invalide');
  if (!isValidTime(heureSortie)) throw new Error('Heure de sortie invalide (HH:MM)');
  if (!isValidTime(heureRetour)) throw new Error('Heure de retour invalide (HH:MM)');
  if (heureSortie === heureRetour) throw new Error("L'heure de retour doit être différente de l'heure de sortie");
  const nextDay = toMinutes(heureRetour) < toMinutes(heureSortie);
  const debut = zonedToUtc(dateSortie, heureSortie, tz);
  const fin = zonedToUtc(nextDay ? addDays(dateSortie, 1) : dateSortie, heureRetour, tz);
  return { debut, fin, nextDay, dateRetour: nextDay ? addDays(dateSortie, 1) : dateSortie };
}

/**
 * Fenêtre de validité d'une sortie SANS RETOUR : de l'heure de sortie jusqu'à la fin du poste
 * de l'opérateur (au moins 1 h). Sans poste connu ou hors poste : 4 h.
 */
function noReturnWindow(dateSortie, heureSortie, shift, tz) {
  if (!isValidDate(dateSortie)) throw new Error('Date de sortie invalide');
  if (!isValidTime(heureSortie)) throw new Error('Heure de sortie invalide (HH:MM)');
  const debut = zonedToUtc(dateSortie, heureSortie, tz);
  const w = shift ? shiftWindowAt(shift, debut, tz) : null;
  const minFin = new Date(debut.getTime() + 60 * 60000);
  const fin = w ? (w.end > minFin ? w.end : minFin) : new Date(debut.getTime() + 4 * 3600000);
  return { debut, fin, finDePoste: Boolean(w) };
}

/**
 * Fenêtre réelle d'un poste (shift) contenant ou précédant un instant donné.
 * Gère les postes qui traversent minuit (23:00 → 07:00).
 */
function shiftWindowAt(shift, instant, tz) {
  const crosses = toMinutes(shift.heure_fin) <= toMinutes(shift.heure_debut);
  const today = localDate(instant, tz);
  for (const offset of [-1, 0, 1]) {
    const startDate = addDays(today, offset);
    const start = zonedToUtc(startDate, shift.heure_debut, tz);
    const end = zonedToUtc(crosses ? addDays(startDate, 1) : startDate, shift.heure_fin, tz);
    if (instant >= start && instant < end) return { start, end, startDate };
  }
  return null;
}

/** Vrai si l'intervalle [debut, fin] est entièrement couvert par une occurrence du poste. */
function isWithinShift(shift, debut, fin, tz) {
  const w = shiftWindowAt(shift, debut, tz);
  return Boolean(w && fin <= w.end);
}

function minutesBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 60000); }

function formatDuration(totalMinutes) {
  if (totalMinutes == null || Number.isNaN(totalMinutes)) return '';
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r ? `${h} h ${pad(r)} min` : `${h} h`;
}

/** Bornes UTC [début, fin) d'une journée locale. */
function dayBoundsUtc(dateStr, tz) {
  return { start: zonedToUtc(dateStr, '00:00', tz), end: zonedToUtc(addDays(dateStr, 1), '00:00', tz) };
}

module.exports = {
  isValidTimezone, isValidTime, isValidDate, zonedToUtc, zonedParts, localDate, localTime, addDays,
  toMinutes, authorizationWindow, noReturnWindow, shiftWindowAt, isWithinShift, minutesBetween, formatDuration,
  dayBoundsUtc, tzOffsetMs,
};

'use strict';
const ExcelJS = require('exceljs');
const { localDate, localTime } = require('./time');

const STATUT_LABELS = {
  BROUILLON: 'Brouillon', EN_ATTENTE: 'En attente', VALIDEE: 'Autorisée (pas encore sortie)', REFUSEE: 'Refusée', ANNULEE: 'Annulée',
  SORTIE_EFFECTUEE: 'Dehors', RETOUR_EFFECTUE: 'Rentré', SORTIE_DEFINITIVE: 'Sortie sans retour', EXPIREE: 'Expirée (non utilisée)',
};
const STATUT_COLORS = {
  VALIDEE: 'FFE3F5EA', RETOUR_EFFECTUE: 'FFDEF3EF', SORTIE_EFFECTUEE: 'FFE2EEFC', SORTIE_DEFINITIVE: 'FFECE8F7',
  REFUSEE: 'FFFBE6E6', ANNULEE: 'FFEEF1F5', EXPIREE: 'FFE4E6EA', EN_ATTENTE: 'FFFDF0DC',
};
const NAVY = 'FF16406F';
const thin = { style: 'thin', color: { argb: 'FFC9D0DA' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

/**
 * Fichier Excel de suivi du personnel : feuille détaillée + synthèse.
 * @param rows autorisations décorées (service authz.exportRows)
 */
async function buildReport(rows, { entreprise, periode, tz, generePar }) {
  const d = (iso) => (iso ? localDate(new Date(iso), tz).split('-').reverse().join('/') : '');
  const t = (iso) => (iso ? localTime(new Date(iso), tz) : '');
  const wb = new ExcelJS.Workbook();
  wb.creator = entreprise;
  wb.created = new Date();

  // ------------------------------------------------------------ feuille détaillée
  const ws = wb.addWorksheet('Suivi des sorties', {
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: `&L${entreprise} — Suivi des sorties&RPage &P / &N` },
    views: [{ state: 'frozen', ySplit: 5 }],
  });
  const cols = [
    { h: 'Date', w: 11, v: (a) => a.date_sortie.split('-').reverse().join('/') },
    { h: 'Matricule', w: 10, v: (a) => a.matricule },
    { h: 'Nom', w: 18, v: (a) => a.emp_nom },
    { h: 'Prénom', w: 14, v: (a) => a.emp_prenom },
    { h: 'Fonction', w: 18, v: (a) => a.fonction || a.service || '' },
    { h: 'Régime', w: 10, v: (a) => a.regime || '' },
    { h: 'Affectation', w: 14, v: (a) => a.equipe || '' },
    { h: 'Retour', w: 12, v: (a) => (a.avec_retour ? 'Avec retour' : 'Sans retour') },
    { h: 'Motif', w: 26, v: (a) => a.motif },
    { h: 'Sortie prévue', w: 10, v: (a) => a.heure_sortie_prevue },
    { h: 'Retour prévu', w: 10, v: (a) => (a.avec_retour ? `${a.heure_retour_prevue}${a.retour_lendemain ? ' (J+1)' : ''}` : '—') },
    { h: 'Autorisé par', w: 18, v: (a) => a.valideur || a.createur || '' },
    { h: 'Sortie réelle', w: 11, v: (a) => t(a.heure_sortie_reelle) },
    { h: 'Retour réel', w: 11, v: (a) => (a.heure_retour_reel ? `${t(a.heure_retour_reel)}${d(a.heure_retour_reel) !== d(a.heure_sortie_reelle) ? ' (J+1)' : ''}` : '') },
    { h: 'Durée', w: 11, v: (a) => (a.avec_retour ? a.duree_reelle || '' : '') },
    { h: 'Gardien', w: 16, v: (a) => a.gardien_sortie || '' },
    { h: 'Situation', w: 27, v: (a) => (a.statut === 'SORTIE_EFFECTUEE' && a.en_retard ? 'Dehors — EN RETARD' : STATUT_LABELS[a.statut] || a.statut) },
    { h: 'Retard', w: 8, v: (a) => (a.en_retard ? 'Oui' : '') },
  ];
  ws.columns = cols.map((c) => ({ width: c.w }));
  const last = String.fromCharCode(64 + cols.length);

  ws.mergeCells(`A1:${last}1`);
  ws.getCell('A1').value = `${entreprise} — Suivi des autorisations de sortie du personnel`;
  ws.getCell('A1').font = { size: 16, bold: true, color: { argb: NAVY } };
  ws.mergeCells(`A2:${last}2`);
  ws.getCell('A2').value = `Période : ${periode}`;
  ws.getCell('A2').font = { size: 12, bold: true };
  ws.mergeCells(`A3:${last}3`);
  ws.getCell('A3').value = `Édité le ${d(new Date().toISOString())} à ${t(new Date().toISOString())} par ${generePar} — ${rows.length} autorisation(s)`;
  ws.getCell('A3').font = { size: 10, italic: true, color: { argb: 'FF586374' } };
  ws.getRow(1).height = 26;

  const header = ws.getRow(5);
  cols.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = border;
  });
  header.height = 30;

  rows.forEach((a, idx) => {
    const r = ws.getRow(6 + idx);
    cols.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      cell.value = c.v(a);
      cell.border = border;
      cell.alignment = { vertical: 'middle', wrapText: c.h === 'Motif' };
      if (idx % 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F8FA' } };
    });
    const sit = r.getCell(cols.length - 1);
    sit.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: a.en_retard ? 'FFFBE6E6' : STATUT_COLORS[a.statut] || 'FFFFFFFF' } };
    sit.font = { bold: true, color: { argb: a.en_retard ? 'FFC62F2F' : 'FF1C2430' } };
    if (a.en_retard) r.getCell(cols.length).font = { bold: true, color: { argb: 'FFC62F2F' } };
    r.getCell(2).font = { bold: true };
  });
  if (rows.length) ws.autoFilter = { from: 'A5', to: `${last}${5 + rows.length}` };
  else { ws.mergeCells(`A6:${last}6`); ws.getCell('A6').value = 'Aucune autorisation sur cette période.'; }

  // ------------------------------------------------------------ synthèse
  const ss = wb.addWorksheet('Synthèse', { pageSetup: { orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1 } });
  ss.columns = [{ width: 36 }, { width: 14 }];
  ss.getCell('A1').value = `${entreprise} — Synthèse`;
  ss.getCell('A1').font = { size: 16, bold: true, color: { argb: NAVY } };
  ss.getCell('A2').value = `Période : ${periode}`;
  ss.getCell('A2').font = { bold: true };
  let row = 4;
  const block = (title, entries) => {
    const h = ss.getRow(row);
    h.getCell(1).value = title; h.getCell(2).value = 'Nombre';
    [1, 2].forEach((i) => { const c = h.getCell(i); c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }; c.border = border; });
    row++;
    for (const [k, v] of entries) {
      const r = ss.getRow(row++);
      r.getCell(1).value = k; r.getCell(2).value = v;
      r.getCell(1).border = border; r.getCell(2).border = border;
      r.getCell(2).alignment = { horizontal: 'center' };
    }
    row++;
  };
  const count = (fn) => rows.filter(fn).length;
  block('Indicateurs', [
    ['Autorisations données', rows.length],
    ['Sorties effectuées (avec retour)', count((a) => ['SORTIE_EFFECTUEE', 'RETOUR_EFFECTUE'].includes(a.statut))],
    ['Sorties sans retour', count((a) => a.statut === 'SORTIE_DEFINITIVE')],
    ['Retours effectués', count((a) => a.statut === 'RETOUR_EFFECTUE')],
    ['Retours en retard', count((a) => a.en_retard)],
    ['Encore dehors', count((a) => a.statut === 'SORTIE_EFFECTUEE')],
    ['Autorisations non utilisées (expirées)', count((a) => a.statut === 'EXPIREE')],
    ['Annulées', count((a) => a.statut === 'ANNULEE')],
  ]);
  const group = (key) => {
    const m = new Map();
    for (const a of rows) { const k = key(a) || '—'; m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  };
  block('Par affectation', group((a) => a.equipe));
  block('Par régime', group((a) => a.regime));
  block('Par fonction', group((a) => a.fonction));
  block('Par motif', group((a) => a.motif));
  block('Par chef / responsable', group((a) => a.valideur || a.createur));
  const top = group((a) => `${a.matricule} — ${a.emp_prenom} ${a.emp_nom}`).slice(0, 10);
  block('Personnes avec le plus de sorties', top);

  return wb.xlsx.writeBuffer();
}

module.exports = { buildReport };

'use strict';
const ExcelJS = require('exceljs');

/** Normalise un intitulé de colonne : minuscules, sans accents ni espaces superflus. */
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((x) => x.text).join('').trim();
    if (v.result != null) return String(v.result).trim();
    if (v.text != null) return String(v.text).trim();
    if (v instanceof Date) return '';
    return '';
  }
  return String(v).trim();
}

/** Corrections d'orthographe demandées (fonction / affectation), appliquées à chaque import. */
const CORRECTIONS = {
  'technicien maintenace': 'TECHNICIEN MAINTENANCE',
  'controleuse qualite': 'Contrôle Qualité',
};
const corrige = (v) => CORRECTIONS[norm(v)] || v;

const COLS = {
  matricule: ['matricule', 'mat', 'mat.', 'n° matricule', 'numero'],
  nom: ['nom'],
  prenom: ['prenom'],
  fonction: ['fonction', 'poste occupe', 'emploi'],
  affectation: ['affectation', 'equipe', 'atelier', 'service'],
  regime: ['regime'],
};

/**
 * Lit un fichier Excel du personnel (toutes les feuilles).
 * Le régime est pris de la colonne « Régime » ou, à défaut, du nom de la feuille (« mensuel » / « horaire »).
 */
async function readPersonnelXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const people = [];
  const errors = [];
  wb.eachSheet((ws) => {
    let header = null;
    ws.eachRow((row, r) => {
      const values = row.values.slice(1).map(cellText);
      if (!header) {
        const n = values.map(norm);
        if (n.some((x) => COLS.matricule.includes(x)) && n.includes('nom')) {
          header = {};
          for (const [key, names] of Object.entries(COLS)) header[key] = n.findIndex((x) => names.includes(x));

        }
        return;
      }
      if (!values.some(Boolean)) return;
      const get = (k) => (header[k] >= 0 ? values[header[k]] || '' : '');
      const sheetRegime = /mensuel/i.test(ws.name) ? 'Mensuel' : /horaire/i.test(ws.name) ? 'Horaire' : '';
      const p = {
        feuille: ws.name, ligne: r,
        matricule: get('matricule').replace(/\.0$/, ''),
        nom: get('nom').toUpperCase(),
        prenom: get('prenom').replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()),
        fonction: corrige(get('fonction')),
        affectation: corrige(get('affectation')).toUpperCase(),
        regime: get('regime') ? (/mens/i.test(get('regime')) ? 'Mensuel' : 'Horaire') : sheetRegime,
      };
      if (!p.matricule || !p.nom) { errors.push(`${ws.name} ligne ${r} : matricule ou nom manquant`); return; }
      people.push(p);
    });
    if (!header) errors.push(`Feuille « ${ws.name} » : colonnes Matricule / Nom introuvables (ignorée)`);
  });
  // Matricules en double
  const seen = new Map();
  for (const p of people) {
    if (seen.has(p.matricule)) errors.push(`Matricule ${p.matricule} en double (${seen.get(p.matricule)} et ${p.feuille} ligne ${p.ligne}) : seule la première ligne est gardée`);
    else seen.set(p.matricule, `${p.feuille} ligne ${p.ligne}`);
  }
  const unique = people.filter((p, i) => people.findIndex((x) => x.matricule === p.matricule) === i);
  return { people: unique, errors };
}

module.exports = { readPersonnelXlsx };

'use strict';
/**
 * Vérifie que le contenu réel d'un fichier correspond au type annoncé (signature binaire).
 * Empêche d'envoyer un fichier piégé (HTML, script...) déguisé en image ou en PDF.
 */
const SIGNATURES = {
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

function contentMatches(type, buf) {
  const check = SIGNATURES[type];
  return Boolean(check && buf.length >= 12 && check(buf));
}

module.exports = { contentMatches };

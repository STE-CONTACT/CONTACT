'use strict';
const crypto = require('node:crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Politique de mot de passe : 10 caractères min., majuscule, minuscule, chiffre, caractère spécial. */
function passwordPolicyErrors(password, username = '') {
  const errors = [];
  const p = String(password || '');
  if (p.length < 10) errors.push('au moins 10 caractères');
  if (!/[A-Z]/.test(p)) errors.push('une majuscule');
  if (!/[a-z]/.test(p)) errors.push('une minuscule');
  if (!/\d/.test(p)) errors.push('un chiffre');
  if (!/[^A-Za-z0-9]/.test(p)) errors.push('un caractère spécial');
  if (username && p.toLowerCase().includes(String(username).toLowerCase())) errors.push("ne pas contenir l'identifiant");
  return errors;
}

function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

/** Mot de passe temporaire conforme à la politique. */
function generatePassword() {
  const core = crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, 'x');
  return `Tmp-${core}7a`;
}

module.exports = { hashPassword, verifyPassword, passwordPolicyErrors, randomToken, sha256, generatePassword };

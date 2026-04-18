/**
 * crypto-util.js – AES-256-GCM šifravimas / iššifravimas
 *
 * Naudojamas sesijai šifruoti ekrano kadrų duomenis tarp host ir viewer,
 * jei transportas naudoja paprastą ws:// (be TLS).
 *
 * Rekomenduojama: naudokite wss:// su TLS sertifikatu – tai paprasčiau
 * ir saugiau. Šis modulis – papildomas apsaugos sluoksnis.
 */

'use strict';

const crypto = require('crypto');

const ALGORITHM    = 'aes-256-gcm';
const KEY_LENGTH   = 32;  // 256 bitų
const IV_LENGTH    = 12;  // 96 bitų (GCM rekomendacija)
const TAG_LENGTH   = 16;  // 128 bitų autentifikavimo žyma

// ─── Rakto generavimas ────────────────────────────────────────────────────────
/**
 * Sugeneruoja atsitiktinį 256-bitų raktą (Buffer).
 */
function generateKey() {
  return crypto.randomBytes(KEY_LENGTH);
}

/**
 * Raktą iš slaptažodžio išveda PBKDF2 algoritmu.
 * @param {string} password
 * @param {Buffer|string} salt  – 16 baitų salt (arba generuojamas)
 */
function deriveKey(password, salt) {
  const s = salt || crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(password, s, 100_000, KEY_LENGTH, 'sha256');
  return { key, salt: s };
}

// ─── Šifravimas ───────────────────────────────────────────────────────────────
/**
 * encrypt(plaintext, key) → { iv, ciphertext, tag }
 * Visi laukai – Buffer.
 */
function encrypt(plaintext, key) {
  const iv  = crypto.randomBytes(IV_LENGTH);
  const buf = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'base64');

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const ct1    = cipher.update(buf);
  const ct2    = cipher.final();
  const tag    = cipher.getAuthTag();

  return {
    iv,
    ciphertext: Buffer.concat([ct1, ct2]),
    tag,
  };
}

/**
 * encryptToBase64(plaintext, key) → base64 eilutė
 * Formatas: iv(12) || tag(16) || ciphertext
 */
function encryptToBase64(plaintext, key) {
  const { iv, ciphertext, tag } = encrypt(plaintext, key);
  const packed = Buffer.concat([iv, tag, ciphertext]);
  return packed.toString('base64');
}

// ─── Iššifravimas ─────────────────────────────────────────────────────────────
/**
 * decryptFromBase64(base64str, key) → Buffer (originalūs duomenys)
 */
function decryptFromBase64(base64str, key) {
  const packed     = Buffer.from(base64str, 'base64');
  const iv         = packed.slice(0, IV_LENGTH);
  const tag        = packed.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = packed.slice(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  const pt1 = decipher.update(ciphertext);
  const pt2 = decipher.final();

  return Buffer.concat([pt1, pt2]);
}

// ─── Sesijos rakto apsikeitimas ───────────────────────────────────────────────
/**
 * Generuojam ECDH raktų porą sesijos raktui susitarti.
 * Kiekviena sesija naudoja atskirą raktą (Perfect Forward Secrecy).
 */
function createECDH() {
  return crypto.createECDH('prime256v1');
}

// ─── Slaptažodžių hash'inimas (atskiriamas nuo bcrypt serveryje) ──────────────
function hashPin(pin) {
  return crypto.createHash('sha256').update(pin).digest('hex');
}

module.exports = {
  generateKey,
  deriveKey,
  encrypt,
  encryptToBase64,
  decryptFromBase64,
  createECDH,
  hashPin,
};

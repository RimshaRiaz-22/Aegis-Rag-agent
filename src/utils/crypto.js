import crypto from 'crypto';
import { config } from '../config/env.js';

/**
 * Application-level encryption at rest (AES-256-GCM).
 *
 * - 256-bit key loaded from DATA_ENCRYPTION_KEY (64 hex chars). The server refuses
 *   to start without it, so data can never silently be written in plaintext or
 *   with a throwaway key.
 * - Random 96-bit IV per value + 128-bit GCM auth tag (tamper detection).
 * - Optional AAD ("context") binds a ciphertext to its owner/purpose, so an
 *   encrypted blob copied into another user's row will fail to decrypt.
 *
 * Envelope format: "enc:v1:<iv b64>:<tag b64>:<ciphertext b64>"
 */
const PREFIX = 'enc:v1:';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function loadKey() {
  const raw = (config.encryption.key || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      'DATA_ENCRYPTION_KEY is missing or invalid. It must be 64 hex characters (32 bytes). ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(raw, 'hex');
}

const KEY = loadKey();

export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Encrypt a UTF-8 string.
 * @param {string} plaintext
 * @param {string} [context] - AAD binding (e.g. `settings:${userId}`)
 */
export function encryptString(plaintext, context = '') {
  if (plaintext === null || plaintext === undefined) return plaintext;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  if (context) cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/**
 * Decrypt a value produced by encryptString. Non-encrypted (legacy) values are
 * returned unchanged so old rows keep working until they are re-written.
 */
export function decryptString(value, context = '') {
  if (!isEncrypted(value)) return value;
  const [ivB64, tagB64, dataB64] = value.slice(PREFIX.length).split(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(ivB64, 'base64'));
  if (context) decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

export function encryptJson(obj, context = '') {
  return encryptString(JSON.stringify(obj ?? null), context);
}

export function decryptJson(value, context = '', fallback = null) {
  if (value === null || value === undefined) return fallback;
  const text = decryptString(value, context);
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

// Password hashing (pure, tested) — scrypt from node:crypto, the built-in memory-hard KDF, so
// no external bcrypt dependency. Format: scrypt$<saltHex>$<hashHex>. Verification is
// constant-time (timingSafeEqual) so hashes can't be probed by timing.

import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const KEY_LEN = 64;

export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, KEY_LEN);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// User persistence. TWO backends behind one interface, selected explicitly by env (same
// pattern as lesson-store and the queue): MONGODB_URI set -> MongoDB (unique index on
// email; Atlas in dev, ApsaraDB for MongoDB in production); unset -> filesystem under
// .data/users for local dev and tests. Password hashes only — plaintext never touches
// storage.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { hashPassword, verifyPassword } from './password.js';
import { dbEnabled, usersCollection } from '../storage/db.js';

const ROOT = path.join(process.cwd(), '.data', 'users');

function emailKey(email) {
  return Buffer.from(String(email).trim().toLowerCase()).toString('base64url');
}

export async function registerUser({ email, password }, { collection = usersCollection } = {}) {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('A valid email is required');
  const user = { userId: `user_${randomUUID()}`, email: normalized, passwordHash: hashPassword(password), createdAt: new Date().toISOString() };

  if (dbEnabled()) {
    const users = await collection();
    try {
      await users.insertOne({ _id: user.userId, email: normalized, passwordHash: user.passwordHash, createdAt: new Date() });
    } catch (error) {
      if (error?.code === 11000) throw new Error('An account with this email already exists'); // duplicate key
      throw error;
    }
    return { userId: user.userId, email: user.email };
  }

  await mkdir(ROOT, { recursive: true });
  const indexPath = path.join(ROOT, `email_${emailKey(normalized)}.json`);
  if (await exists(indexPath)) throw new Error('An account with this email already exists');
  await writeFile(path.join(ROOT, `${user.userId}.json`), JSON.stringify(user));
  await writeFile(indexPath, JSON.stringify({ userId: user.userId }));
  return { userId: user.userId, email: user.email };
}

// Returns { userId, email } on success, null on wrong email/password (indistinguishable).
export async function authenticateUser({ email, password }, { collection = usersCollection } = {}) {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (dbEnabled()) {
    const users = await collection();
    const row = await users.findOne({ email: normalized });
    if (!row) return null;
    return verifyPassword(password, row.passwordHash) ? { userId: row._id, email: row.email } : null;
  }
  try {
    const { userId } = JSON.parse(await readFile(path.join(ROOT, `email_${emailKey(normalized)}.json`), 'utf8'));
    const user = JSON.parse(await readFile(path.join(ROOT, `${userId}.json`), 'utf8'));
    return verifyPassword(password, user.passwordHash) ? { userId: user.userId, email: user.email } : null;
  } catch {
    return null;
  }
}

async function exists(file) {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

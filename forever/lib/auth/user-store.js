// User persistence seam — same pattern as lesson-store: filesystem under .data/users now, one
// implementation swap to RDS later, no route changes. One JSON file per user keyed by a stable
// userId; an email index maps email -> userId for login.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { hashPassword, verifyPassword } from './password.js';

const ROOT = path.join(process.cwd(), '.data', 'users');

function emailKey(email) {
  return Buffer.from(String(email).trim().toLowerCase()).toString('base64url');
}

export async function registerUser({ email, password }) {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('A valid email is required');
  await mkdir(ROOT, { recursive: true });
  const indexPath = path.join(ROOT, `email_${emailKey(normalized)}.json`);
  if (await exists(indexPath)) throw new Error('An account with this email already exists');

  const user = { userId: `user_${randomUUID()}`, email: normalized, passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
  await writeFile(path.join(ROOT, `${user.userId}.json`), JSON.stringify(user));
  await writeFile(indexPath, JSON.stringify({ userId: user.userId }));
  return { userId: user.userId, email: user.email };
}

// Returns { userId, email } on success, null on wrong email/password (indistinguishable).
export async function authenticateUser({ email, password }) {
  const normalized = String(email ?? '').trim().toLowerCase();
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

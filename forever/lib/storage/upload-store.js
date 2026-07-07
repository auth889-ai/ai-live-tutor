// User-uploaded raw material (PDFs / images), owner-scoped on disk: every file lives under
// its owner's directory and is only ever resolved back THROUGH that owner's id — one user
// can never reach another user's file by construction. Production swaps the filesystem for
// OSS behind these same three functions.

import { mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const ROOT = path.join('.data', 'uploads');

export function uploadsDirFor(userId) {
  if (!userId?.trim()) throw new Error('uploadsDirFor requires a userId');
  return path.join(ROOT, userId.replace(/[^a-zA-Z0-9_-]/g, ''));
}

export async function saveUpload(userId, { bytes, extension }) {
  const uploadId = `up_${randomBytes(8).toString('hex')}`;
  const dir = uploadsDirFor(userId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${uploadId}.${extension}`), bytes);
  return { uploadId };
}

// Resolves an uploadId to its path ONLY within this user's directory; null if not theirs.
export async function resolveUpload(userId, uploadId) {
  const dir = uploadsDirFor(userId);
  const entries = await readdir(dir).catch(() => []);
  const fileName = entries.find((e) => e.startsWith(`${String(uploadId)}.`));
  return fileName ? path.join(dir, fileName) : null;
}

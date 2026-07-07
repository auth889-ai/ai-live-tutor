// POST /api/uploads (multipart, field "file") -> { uploadId, kind }. A user's raw material
// (PDF / image) lands in THEIR upload store; a job later references it by uploadId and the
// jobs route resolves it back through the same user — cross-user access is impossible.

import { sessionFromRequest } from '../../../lib/auth/session.js';
import { saveUpload } from '../../../lib/storage/upload-store.js';

const KIND_BY_TYPE = {
  'application/pdf': { ext: 'pdf', kind: 'pdf' },
  'image/png': { ext: 'png', kind: 'image' },
  'image/jpeg': { ext: 'jpg', kind: 'image' },
  'image/webp': { ext: 'webp', kind: 'image' },
};
const MAX_BYTES = 30 * 1024 * 1024;

export async function POST(request) {
  const session = sessionFromRequest(request);
  if (!session) return Response.json({ error: 'Sign in to upload material' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') {
    return Response.json({ error: 'Send multipart form-data with a "file" field' }, { status: 400 });
  }
  const meta = KIND_BY_TYPE[file.type] ?? (file.name?.toLowerCase().endsWith('.pdf') ? KIND_BY_TYPE['application/pdf'] : null);
  if (!meta) return Response.json({ error: 'Only PDF, PNG, JPEG, or WebP files are supported' }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: 'File too large (max 30 MB)' }, { status: 400 });

  const { uploadId } = await saveUpload(session.userId, {
    bytes: Buffer.from(await file.arrayBuffer()),
    extension: meta.ext,
  });
  return Response.json({ uploadId, kind: meta.kind }, { status: 201 });
}

// /api/notebooks/[id]/blocks — append one typed block per input. Link blocks are enriched
// server-side (extractReadableText -> title + content, trust: 'extracted'); uploads arrive as
// uploadId from the existing /api/uploads. Every write owner-scoped in the store.

import { addBlock } from '../../../../../lib/storage/notebook-store.js';
import { ingestUrl } from '../../../../../lib/ingest/url/ingest-url.js';
import { sessionFromRequest } from '../../../../../lib/auth/session.js';

export async function POST(request, { params }) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const spec = {
    userId: session.userId,
    notebookId: id,
    type: body.type,
    content: body.content ?? '',
    url: body.url ?? null,
    uploadId: body.uploadId ?? null,
    mediaType: body.mediaType ?? null,
    transcript: body.transcript ?? null,
    source: body.source ?? 'typed',
    origin: body.origin ?? null,
    title: body.title ?? null,
    trust: body.trust ?? 'user',
  };
  // Link blocks: fetch + extract the readable text so the notebook (and the course generator)
  // holds the actual content, provenance marked 'extracted' — never pretending the user wrote it.
  if (body.type === 'link' && body.url) {
    try {
      const ingested = await ingestUrl(String(body.url));
      spec.content = String(ingested?.text ?? '').slice(0, 20000);
      spec.title = spec.title ?? ingested?.title ?? null;
      spec.origin = new URL(String(body.url)).hostname;
      spec.trust = 'extracted';
      spec.source = 'url';
    } catch (e) {
      return Response.json({ error: `could not read that link: ${String(e.message ?? e).slice(0, 140)}` }, { status: 422 });
    }
  }
  try {
    const doc = await addBlock(spec);
    if (!doc) return Response.json({ error: 'notebook not found' }, { status: 404 });
    return Response.json({ block: doc }, { status: 201 });
  } catch (e) {
    return Response.json({ error: String(e.message ?? e) }, { status: 400 });
  }
}

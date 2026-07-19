// /api/study/signal — the Study Focus extension's endpoint (ported from w2). A page signal
// comes in; Qwen classifies study vs non-study against the learner's goal and, on drift,
// returns a warm refocus popup the extension overlays. Keeps the w2 response contract
// (type/voiceText/chatMessage/suggestedAction) so the existing extension works unchanged.
import { classifyFocusSignal } from '../../../../lib/focus/classify-signal.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors });
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'bad request' }, { status: 400, headers: cors }); }
  const goal = body?.goal ?? body?.session?.goal ?? '';
  const signal = { page: body?.page ?? body, behavior: body?.behavior ?? {} };
  try {
    const decision = await classifyFocusSignal(signal, { goal });
    // w2 contract: the extension reads top-level type/voiceText/chatMessage/suggestedAction.
    return Response.json({ ok: true, data: { ...decision, page: { url: signal.page?.url } } }, { headers: cors });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, { status: 500, headers: cors });
  }
}

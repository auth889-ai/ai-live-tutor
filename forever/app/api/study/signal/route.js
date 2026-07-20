// /api/study/signal — the Study Focus extension's endpoint (ported from w2). A page signal
// comes in; Qwen classifies study vs non-study against the learner's goal and, on drift,
// returns a warm refocus popup the extension overlays. Keeps the w2 response contract
// (type/voiceText/chatMessage/suggestedAction) so the existing extension works unchanged.
import { classifyFocusSignal } from '../../../../lib/focus/classify-signal.js';
import { recordActivity, currentSession } from '../../../../lib/focus/focus-store.js';
import { buildSignalResponse } from '../../../../lib/focus/build-popup.js';

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
  const deviceId = body?.deviceId ?? body?.session?.deviceId ?? 'device';
  const signal = { page: body?.page ?? body, behavior: body?.behavior ?? {}, screenshotBase64: body?.screenshotBase64 ?? body?.screenshot ?? null };
  try {
    const sess = await currentSession({ deviceId }).catch(() => null);
    const goal = body?.goal ?? body?.session?.goal ?? sess?.goal ?? '';
    const decision = await classifyFocusSignal(signal, { goal });
    // persist the decision so the dashboard survey has data (never blocks the response)
    recordActivity({ deviceId, sessionId: sess?._id ?? null, signal, decision, ownerId: sess?.ownerId ?? null }).catch(() => {});
    // w2 contract: the extension shows the overlay only when data.popup.shouldShow is true.
    return Response.json({ ok: true, message: 'Signal analyzed', data: buildSignalResponse(decision, { url: signal.page?.url ?? '' }) }, { headers: cors });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, { status: 500, headers: cors });
  }
}

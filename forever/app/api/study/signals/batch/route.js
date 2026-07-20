// /api/study/signals/batch — batched signals from the extension; classify the LATEST (the
// current page) and return one refocus decision. Same contract as /study/signal.
import { classifyFocusSignal } from '../../../../../lib/focus/classify-signal.js';
import { buildSignalResponse } from '../../../../../lib/focus/build-popup.js';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
export async function OPTIONS() { return new Response(null, { status: 204, headers: cors }); }

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'bad request' }, { status: 400, headers: cors }); }
  const signals = Array.isArray(body?.signals) ? body.signals : [body];
  const latest = signals[signals.length - 1] ?? {};
  const goal = body?.goal ?? latest?.goal ?? '';
  try {
    const decision = await classifyFocusSignal({ page: latest?.page ?? latest, behavior: latest?.behavior ?? {} }, { goal });
    return Response.json({ ok: true, message: 'Signals analyzed', data: { ...buildSignalResponse(decision, { url: (latest?.page ?? latest)?.url ?? '' }), count: signals.length } }, { headers: cors });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message ?? e).slice(0, 200) }, { status: 500, headers: cors });
  }
}

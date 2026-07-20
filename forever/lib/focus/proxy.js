// FOCUS PROXY — forever forwards the extension's study-focus requests to the copied FULL w2
// server (forever/focus-server, the proven Express + Qwen backend running on FOCUS_SERVER_URL).
// The extension only ever talks to forever (:3000); forever relays to the real w2 logic, so the
// exact w2 request/response contract is preserved — no reimplementation, no shape mismatches.

const TARGET = (process.env.FOCUS_SERVER_URL || 'http://localhost:3001').replace(/\/+$/, '');
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

export async function proxyFocus(request, path) {
  const url = `${TARGET}/api/study/${path}${new URL(request.url).search || ''}`;
  const init = { method: request.method, headers: { 'Content-Type': 'application/json' } };
  if (request.method === 'POST') { init.body = await request.text(); }
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (e) {
    return Response.json({ ok: false, error: `focus-server unreachable: ${String(e?.message ?? e).slice(0, 120)}` }, { status: 502, headers: cors });
  }
}

export function focusOptions() { return new Response(null, { status: 204, headers: cors }); }

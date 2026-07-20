// RAW PROXY — forwards a request (any content-type, incl. multipart audio) to the focus-server,
// preserving headers the w2 endpoints need (content-type, x-device-id, x-owner-key, etc.).
const TARGET = (process.env.FOCUS_SERVER_URL || 'http://localhost:3001').replace(/\/+$/, '');
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, x-device-id, x-owner-key, x-offline-user-id' };

export async function proxyRaw(request, path) {
  const url = `${TARGET}/api/${path}${new URL(request.url).search || ''}`;
  const headers = {};
  for (const h of ['content-type', 'x-device-id', 'x-owner-key', 'x-offline-user-id', 'authorization']) {
    const v = request.headers.get(h); if (v) headers[h] = v;
  }
  const init = { method: request.method, headers };
  if (request.method === 'POST') init.body = Buffer.from(await request.arrayBuffer());
  try {
    const res = await fetch(url, init);
    const buf = Buffer.from(await res.arrayBuffer());
    return new Response(buf, { status: res.status, headers: { ...cors, 'Content-Type': res.headers.get('content-type') || 'application/json' } });
  } catch (e) {
    return Response.json({ ok: false, error: `focus-server unreachable: ${String(e?.message ?? e).slice(0, 120)}` }, { status: 502, headers: cors });
  }
}
export function rawOptions() { return new Response(null, { status: 204, headers: cors }); }

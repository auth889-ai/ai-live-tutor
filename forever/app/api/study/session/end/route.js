import { endSession } from '../../../../../lib/focus/focus-store.js';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
export async function OPTIONS() { return new Response(null, { status: 204, headers: cors }); }
export async function POST(request) {
  const b = await request.json().catch(() => ({}));
  const data = await endSession({ deviceId: b.deviceId ?? 'device', sessionId: b.sessionId ?? null });
  return Response.json({ ok: true, data }, { headers: cors });
}

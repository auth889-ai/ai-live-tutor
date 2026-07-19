import { startSession } from '../../../../../lib/focus/focus-store.js';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
export async function OPTIONS() { return new Response(null, { status: 204, headers: cors }); }
export async function POST(request) {
  const b = await request.json().catch(() => ({}));
  const data = await startSession({ deviceId: b.deviceId ?? 'device', goal: b.goal ?? '', ownerId: b.ownerId ?? null });
  return Response.json({ ok: true, data }, { headers: cors });
}

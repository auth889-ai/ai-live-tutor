import { currentSession } from '../../../../../../lib/focus/focus-store.js';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
export async function OPTIONS() { return new Response(null, { status: 204, headers: cors }); }
export async function GET(_request, { params }) {
  const { deviceId } = await params;
  const data = await currentSession({ deviceId: deviceId ?? 'device' });
  return Response.json({ ok: true, data }, { headers: cors });
}

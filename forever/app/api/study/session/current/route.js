import { currentSession } from '../../../../../lib/focus/focus-store.js';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
export async function OPTIONS() { return new Response(null, { status: 204, headers: cors }); }
export async function GET(request) {
  const deviceId = new URL(request.url).searchParams.get('deviceId') ?? 'device';
  const session = await currentSession({ deviceId });
  const active = Boolean(session && session.status === 'active');
  return Response.json({ ok: true, data: { monitoringActive: active, session: active ? session : null, currentSession: active ? session : null } }, { headers: cors });
}

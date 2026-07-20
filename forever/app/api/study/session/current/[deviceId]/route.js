import { currentSession } from '../../../../../../lib/focus/focus-store.js';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
export async function OPTIONS() { return new Response(null, { status: 204, headers: cors }); }

export async function GET(_request, { params }) {
  const { deviceId } = await params;
  const session = await currentSession({ deviceId: deviceId ?? 'device' });
  // SHAPE MATTERS: the extension reads result.session / result.currentSession / result.monitoringActive
  // and RESETS its stored monitoringActive from them. A flat doc computes active=false and WIPES
  // monitoring — so return the nested shape it expects.
  const active = Boolean(session && session.status === 'active');
  return Response.json({
    ok: true,
    data: { monitoringActive: active, session: active ? session : null, currentSession: active ? session : null },
  }, { headers: cors });
}

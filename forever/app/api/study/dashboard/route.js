import { dashboard } from '../../../../lib/focus/focus-store.js';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
export async function OPTIONS() { return new Response(null, { status: 204, headers: cors }); }
export async function GET(request) {
  const deviceId = new URL(request.url).searchParams.get('deviceId') ?? 'device';
  const data = await dashboard({ deviceId });
  return Response.json({ ok: true, data }, { headers: cors });
}

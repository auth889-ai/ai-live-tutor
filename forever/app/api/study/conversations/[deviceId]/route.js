const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
export async function OPTIONS() { return new Response(null, { status: 204, headers: cors }); }
export async function GET() { return Response.json({ ok: true, data: { conversations: [] } }, { headers: cors }); }

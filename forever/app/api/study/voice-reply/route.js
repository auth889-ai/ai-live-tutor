// student replies to the nudge popup by voice/text — the tutor answers briefly.
import { runAgentChain } from '../../../../lib/qwen/client.js';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
export async function OPTIONS() { return new Response(null, { status: 204, headers: cors }); }
export async function POST(request) {
  const b = await request.json().catch(() => ({}));
  const msg = String(b?.message ?? b?.text ?? '').slice(0, 500);
  try {
    const { json } = await runAgentChain({ agent: 'focus-reply', maxTokens: 120, temperature: 0.5,
      system: 'A student replied to a "get back to studying" nudge. Answer in ONE short warm sentence that acknowledges them and points back to their goal. Return ONLY JSON {"reply": string}.',
      user: `GOAL: ${b?.goal ?? 'studying'}\nSTUDENT: ${msg}` });
    return Response.json({ ok: true, data: { reply: json?.reply ?? "You've got this — back to it." } }, { headers: cors });
  } catch { return Response.json({ ok: true, data: { reply: "You've got this — back to it." } }, { headers: cors }); }
}

// /api/focus/motivate — generates a POWERFUL, SPECIFIC, dynamic motivation for one activity,
// using forever's Qwen. Given the page (title/domain), the learner's goal, and the classified
// type, it writes a punchy, warm, non-generic nudge that names the real page + goal. Used by
// the Focus dashboard so every event carries a genuinely dynamic message (the w2 classifier's
// stored motivation is often cautious/generic; this replaces it with a strong coach line).
import { runAgentChain } from '../../../../lib/qwen/client.js';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
export async function OPTIONS() { return new Response(null, { status: 204, headers: cors }); }

export async function POST(request) {
  const b = await request.json().catch(() => ({}));
  const { title = '', domain = '', goal = 'studying', type = 'uncertain' } = b || {};
  const stance = /non|distract/.test(type) ? 'This page is OFF their goal — pull them back with energy and a concrete tiny next step.'
    : /partial|uncertain|ask/.test(type) ? 'This page is AMBIGUOUS — challenge them to honestly decide if it serves the goal.'
    : 'This page is ON their goal — celebrate the momentum and push them to keep going.';
  try {
    const { json } = await runAgentChain({
      agent: 'focus-motivator',
      maxTokens: 120, temperature: 0.8,
      system: `You are a sharp, warm study coach. Write ONE punchy motivation line (<=28 words) for a student. ${stance}
Rules: name the ACTUAL page ("${title || domain}") and their GOAL ("${goal}") — never generic. Be specific, energizing, and human — the kind of line that actually makes someone switch tabs. No emojis, no "as an AI", no hashtags. Vary your phrasing. Return ONLY JSON {"motivation": string}.`,
      user: `PAGE: ${title} (${domain})\nGOAL: ${goal}\nVERDICT: ${type}`,
    });
    return Response.json({ ok: true, motivation: json?.motivation ?? '' }, { headers: cors });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message ?? e).slice(0, 120) }, { status: 500, headers: cors });
  }
}

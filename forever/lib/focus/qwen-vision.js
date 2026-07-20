// QWEN VISION — how w2 did it (Gemma screenshot analysis), done in forever with Qwen VL.
// Given a screenshot (base64) + page text + the goal, Qwen's vision model decides study vs
// non-study by actually LOOKING at the page, then (on drift) writes the refocus nudge. This is
// the w2 technique — screenshot + text + AI — replicated inside forever's own backend, no
// separate server. Falls back to null on any error so the text classifier can take over.

const BASE = (process.env.DASHSCOPE_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '');
const KEY = () => process.env.DASHSCOPE_API_KEY || '';
const VISION_MODEL = () => process.env.MODEL_VISION || 'qwen3.7-plus';

const stripPrefix = (b64) => String(b64 || '').replace(/^data:image\/\w+;base64,/, '');

export async function classifyWithVision({ screenshotBase64, page = {}, goal = '', timeoutMs = 45000 } = {}) {
  const key = KEY();
  const b64 = stripPrefix(screenshotBase64);
  if (!key || !b64) return null;

  const system = `You are a study-focus coach. LOOK at the screenshot of the page the learner is on and
read the page text, then decide if it supports their GOAL. Return ONLY JSON:
{"type": "study"|"partial-study"|"non-study",
 "voiceText": string (<=18 words, spoken, empty if study),
 "chatMessage": string (<=30 words, the popup, empty if study),
 "suggestedAction": string (<=10 words, empty if study),
 "reason": string (<=15 words, what you SAW that decided it)}.
Judge by what is ACTUALLY on screen (a video feed, a game, a social wall = non-study; docs, code,
a lecture, notes = study), not just the domain. On drift, be warm and specific to the goal.`;

  const user = [
    { type: 'text', text: `GOAL: ${goal || '(general studying)'}\nPAGE: ${page.title ?? ''} — ${page.url ?? ''}\nTEXT: ${String(page.visibleText ?? '').slice(0, 500)}` },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
  ];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: VISION_MODEL(), temperature: 0.3, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const j = await res.json();
    const text = j?.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(text);
    const type = String(parsed.type ?? '').toLowerCase().includes('non') ? 'non-study'
      : String(parsed.type ?? '').toLowerCase().includes('partial') ? 'partial-study' : 'study';
    if (type === 'study') return { type, voiceText: '', chatMessage: '', suggestedAction: '', reason: parsed.reason ?? 'on task (vision)' };
    return {
      type,
      voiceText: String(parsed.voiceText ?? '').slice(0, 160),
      chatMessage: String(parsed.chatMessage ?? '').slice(0, 300),
      suggestedAction: String(parsed.suggestedAction ?? '').slice(0, 120),
      reason: String(parsed.reason ?? '').slice(0, 160),
    };
  } catch {
    clearTimeout(timer);
    return null; // vision failed — caller falls back to the text classifier
  }
}

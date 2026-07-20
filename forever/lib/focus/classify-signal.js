// FOCUS CLASSIFIER — the brain of the Study Focus extension, ported from the w2 project into
// forever and powered by Qwen (was Gemma). A page signal (URL, title, visible text, behavior)
// comes in; the model decides study vs non-study relative to the learner's GOAL, and — when the
// learner has drifted — writes a short, warm nudge to bring them back. This is the same
// "motivate back to study" loop the w2 extension shipped, now on forever's stack.
//
// Contract preserved from w2 so the existing extension works unchanged:
//   in:  { page:{url,domain,title,visibleText,...}, behavior:{...}, goal }
//   out: { type: "study"|"partial-study"|"non-study", voiceText, chatMessage, suggestedAction,
//          reason }  — type drives whether the extension shows the refocus popup.

import { runAgentChain } from '../qwen/client.js';
import { classifyWithVision } from './qwen-vision.js';

// Cheap deterministic pre-checks so obvious cases never spend a token (and work offline):
// clearly-study domains pass, clearly-distracting domains flag, before the model is consulted.
const STUDY_HINTS = /(wikipedia|khanacademy|coursera|edx|stackoverflow|github|arxiv|scholar|docs\.|mdn|geeksforgeeks|leetcode|w3schools|\.edu|notion|overleaf|colab|jupyter|forever)/i;
const DISTRACT_HINTS = /(youtube\.com\/(shorts|feed)|tiktok|instagram|facebook|twitter|x\.com|reddit\.com\/r\/(?!learn)|netflix|twitch|9gag|pinterest)/i;

export async function classifyFocusSignal(signal, { goal = '', call = runAgentChain, env = process.env } = {}) {
  const page = signal?.page ?? signal ?? {};
  const behavior = signal?.behavior ?? {};
  const url = String(page.url ?? '');
  const title = String(page.title ?? '');

  // fast path — no model call, works even offline
  if (DISTRACT_HINTS.test(url)) {
    return nudge('non-study', title, goal, `${page.domain || url} is a known distraction site`);
  }
  if (STUDY_HINTS.test(url) && !behavior.isHidden) {
    return { type: 'study', voiceText: '', chatMessage: '', suggestedAction: '', reason: 'known study resource' };
  }

  // VISION PATH (how w2 did it): if the extension captured a screenshot, LOOK at the page
  // with Qwen vision — the most reliable signal, exactly like w2's Gemma screenshot analysis.
  const shot = signal?.screenshotBase64 ?? signal?.page?.screenshotBase64 ?? signal?.screenshot;
  if (shot) {
    const visionDecision = await classifyWithVision({ screenshotBase64: shot, page, goal });
    if (visionDecision) return visionDecision;
  }

  // model path — ambiguous page: let Qwen judge against the goal
  const system = `You decide whether a web page is STUDY, PARTIAL-STUDY, or NON-STUDY for a learner
with a stated goal, and — only if they have DRIFTED — write ONE short warm nudge to bring them back
(never nagging, never shaming; specific to their goal). Return ONLY JSON:
{"type": "study"|"partial-study"|"non-study",
 "voiceText": string (<=18 words, spoken aloud, empty if type is study),
 "chatMessage": string (<=30 words, the popup text, empty if study),
 "suggestedAction": string (<=10 words, e.g. "reopen your notes tab", empty if study),
 "reason": string (<=15 words, why you classified it this way)}.
Judge by the page CONTENT and the goal, not just the domain. A video or forum CAN be study if it
matches the goal. Idle time, hidden tab, and rapid tab-switching are drift signals.`;

  const user = `GOAL: ${goal || '(general studying)'}
PAGE: ${title} — ${url}
TEXT (excerpt): ${String(page.visibleText ?? '').slice(0, 800)}
BEHAVIOR: idle ${Math.round((behavior.idleMs ?? 0) / 1000)}s, tabSwitches ${behavior.tabSwitches ?? 0}, hidden ${behavior.isHidden ? 'yes' : 'no'}, dwell ${Math.round((behavior.dwellMs ?? 0) / 1000)}s`;

  try {
    const { json } = await call({ agent: 'focus-classifier', system, user, maxTokens: 220, temperature: 0.4 });
    const type = normalizeType(json?.type);
    if (type === 'study') return { type, voiceText: '', chatMessage: '', suggestedAction: '', reason: json?.reason ?? 'on task' };
    return {
      type,
      voiceText: String(json?.voiceText ?? '').slice(0, 160),
      chatMessage: String(json?.chatMessage ?? '').slice(0, 300),
      suggestedAction: String(json?.suggestedAction ?? '').slice(0, 120),
      reason: String(json?.reason ?? '').slice(0, 160),
    };
  } catch {
    // model unreachable — fall back to the deterministic guess (never block the extension)
    if (STUDY_HINTS.test(url)) return { type: 'study', voiceText: '', chatMessage: '', suggestedAction: '', reason: 'offline heuristic' };
    return nudge('non-study', title, goal, 'offline heuristic — page did not match your goal');
  }
}

function normalizeType(t) {
  const v = String(t ?? '').toLowerCase();
  if (v.includes('non') || v.includes('distract')) return 'non-study';
  if (v.includes('partial')) return 'partial-study';
  return 'study';
}

// deterministic nudge for the offline / obvious-distraction path
function nudge(type, title, goal, reason) {
  const g = goal ? ` your goal: ${goal}` : ' studying';
  return {
    type,
    voiceText: `This looks off-track — let's get back to${g}.`,
    chatMessage: `You drifted from${g}. One small step back beats a long detour — reopen your study tab and keep the streak.`,
    suggestedAction: 'return to your study tab',
    reason,
  };
}

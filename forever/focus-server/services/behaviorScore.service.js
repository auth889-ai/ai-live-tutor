/**
 * File purpose:
 * Converts raw behavior into a signal summary for AI.
 *
 * Real behavior:
 * This does NOT make the final decision.
 * It only gives Gemma a structured behavior signal.
 * Final confidence and action are decided by AI in agenticGemma.service.js.
 */

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export function computeBehaviorScore(behavior = {}) {
  const dwell = clamp(Number(behavior.dwellMs || 0) / 60000);
  const scroll = clamp(Number(behavior.scrollDepth || 0) / 100);
  const typing = clamp(Number(behavior.typingCount || 0) / 20);
  const active = clamp(Number(behavior.mouseMoves || 0) / 80);

  const idlePenalty = clamp(Number(behavior.idleMs || 0) / 120000);
  const switchPenalty = clamp(Number(behavior.tabSwitches || 0) / 8);

  return clamp(
    dwell * 0.25 +
      scroll * 0.2 +
      typing * 0.2 +
      active * 0.15 +
      (1 - idlePenalty) * 0.1 +
      (1 - switchPenalty) * 0.1
  );
}
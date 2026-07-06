// Callout board object (pure, tested): the tutor's premium "human" cards used across EVERY
// subject — a striking common-mistake warning, a "pause & think" checkpoint, a key-takeaways
// recap, a tip, an analogy, an insight. Colored box + icon (research: use per-purpose, with
// restraint). Makes the misconception/recap teaching beats land.

export const CALLOUT_VARIANTS = Object.freeze(['mistake', 'checkpoint', 'recap', 'tip', 'analogy', 'insight']);

export function validateCalloutContent(content, context = 'callout') {
  if (!content || typeof content !== 'object') throw new Error(`${context} content must be an object`);
  if (!CALLOUT_VARIANTS.includes(content.variant)) {
    throw new Error(`${context}.variant must be one of ${CALLOUT_VARIANTS.join(', ')}`);
  }
  const hasBody = typeof content.body === 'string' ? content.body.trim() : Array.isArray(content.body) && content.body.length > 0;
  if (!hasBody) throw new Error(`${context} needs a non-empty body (string or list)`);
  return content;
}

// BUILD-POPUP — wraps the classifier decision into the EXACT response shape the ported w2
// extension expects. The extension's background.js only shows the overlay when
// `data.popup.shouldShow` is true, AND content.js's renderRealtimePopup returns early unless
// `popup.activityId` is set. My earlier response was missing both the popup object and the
// activityId, so the overlay never rendered — this restores the full w2 contract.

import { randomUUID } from 'node:crypto';

export function buildSignalResponse(decision, { url = '', activityId = null } = {}) {
  const id = activityId || randomUUID().replace(/-/g, '').slice(0, 24);
  const isDistraction = decision.type !== 'study';
  const shouldShow = isDistraction && Boolean(decision.chatMessage);
  const popup = {
    shouldShow,
    activityId: id, // REQUIRED — content.js's renderRealtimePopup returns early without it
    // "intervention" makes the extension treat it as an active refocus popup (voice + card).
    type: isDistraction ? 'intervention' : 'study',
    title: 'AI Study Coach',
    chatMessage: decision.chatMessage || '',
    message: decision.chatMessage || '',
    voiceText: decision.voiceText || '',
    suggestedAction: decision.suggestedAction || '',
    reason: decision.reason || '',
    page: { url },
    createdAt: new Date().toISOString(),
    ai: { type: decision.type, voiceText: decision.voiceText || '', decisionReason: decision.reason || '' },
  };
  return {
    // flat fields kept for any code path that reads them
    type: decision.type,
    voiceText: decision.voiceText || '',
    chatMessage: decision.chatMessage || '',
    suggestedAction: decision.suggestedAction || '',
    reason: decision.reason || '',
    // the shapes the extension actually reads
    popup,
    decision: { type: decision.type, finalType: decision.type, reason: decision.reason || '' },
    activity: { _id: id, id, page: { url }, ai: popup.ai, createdAt: popup.createdAt, decision: { type: decision.type } },
  };
}

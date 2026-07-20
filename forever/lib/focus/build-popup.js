// BUILD-POPUP — wraps the classifier decision into the EXACT response shape the ported w2
// extension expects. The extension's background.js only shows the overlay when
// `data.popup.shouldShow` is true and reads popup.type / chatMessage / voiceText /
// suggestedAction / page.url. My earlier flat response had no `popup` object, so the overlay
// never rendered — this restores the w2 contract so the existing extension works unchanged.

export function buildSignalResponse(decision, { url = '' } = {}) {
  const isDistraction = decision.type !== 'study';
  const shouldShow = isDistraction && Boolean(decision.chatMessage);
  const popup = {
    shouldShow,
    // "intervention" makes the extension treat it as an active refocus popup (voice + card).
    type: isDistraction ? 'intervention' : 'study',
    title: 'AI Study Coach',
    chatMessage: decision.chatMessage || '',
    message: decision.chatMessage || '',
    voiceText: decision.voiceText || '',
    suggestedAction: decision.suggestedAction || '',
    reason: decision.reason || '',
    page: { url },
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
    activity: { page: { url }, decision: { type: decision.type } },
  };
}

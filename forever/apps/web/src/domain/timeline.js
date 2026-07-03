export const CAPABILITIES = Object.freeze([
  "handwritten_text",
  "stroke_reveal",
  "pointer_motion",
  "circle",
  "underline",
  "highlight",
  "code_line_highlight",
  "variable_table",
  "output_panel",
  "source_proof_sidebar",
  "word_subtitles"
]);

export function getActiveActions(manifest, currentMs) {
  return manifest.actions.filter((action) => (
    currentMs >= action.startMs && currentMs <= action.endMs
  ));
}

export function getVisibleObjects(manifest, currentMs) {
  const visibleIds = new Set();
  for (const action of manifest.actions) {
    if (action.objectId && currentMs >= action.startMs) {
      visibleIds.add(action.objectId);
    }
    if (action.targetObjectId && currentMs >= action.startMs) {
      visibleIds.add(action.targetObjectId);
    }
  }
  return manifest.objects.filter((object) => visibleIds.has(object.objectId));
}

export function getActiveSubtitleWords(manifest, currentMs) {
  return manifest.subtitles.filter((word) => (
    currentMs >= word.startMs && currentMs <= word.endMs
  ));
}


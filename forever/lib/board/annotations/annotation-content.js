// Annotation contract (pure, tested) — the researched 7-verb teaching vocabulary a human
// layers over an image or figure: encircle, underline, arrow, cross_out, highlight, label,
// pointer. Every annotation anchors to a normalized bbox {x,y,w,h in 0..1} on the target
// image (OpenMAIC full-image rule: overlays draw ON TOP, the image never gets cropped).
// The player reveals them in order across the object's narration window.

export const ANNOTATION_VERBS = Object.freeze(['encircle', 'underline', 'arrow', 'cross_out', 'highlight', 'label', 'pointer']);
const NEEDS_TEXT = new Set(['label', 'arrow']);

export function validateAnnotations(annotations, context = 'image') {
  if (annotations === undefined) return annotations;
  if (!Array.isArray(annotations)) throw new Error(`${context}.annotations must be an array`);
  annotations.forEach((a, i) => {
    if (!a || typeof a !== 'object') throw new Error(`${context}.annotations[${i}] must be an object`);
    if (!ANNOTATION_VERBS.includes(a.verb)) {
      throw new Error(`${context}.annotations[${i}] has unknown verb "${a.verb}" (use ${ANNOTATION_VERBS.join('|')})`);
    }
    const bbox = a.bbox;
    if (!bbox || typeof bbox !== 'object') throw new Error(`${context}.annotations[${i}] needs bbox {x,y,w,h} normalized 0..1`);
    for (const key of ['x', 'y', 'w', 'h']) {
      if (typeof bbox[key] !== 'number' || bbox[key] < 0 || bbox[key] > 1) {
        throw new Error(`${context}.annotations[${i}].bbox.${key} must be a number in [0,1]`);
      }
    }
    if (bbox.x + bbox.w > 1.001 || bbox.y + bbox.h > 1.001) throw new Error(`${context}.annotations[${i}].bbox must stay inside the image`);
    if (NEEDS_TEXT.has(a.verb) && (typeof a.text !== 'string' || !a.text.trim())) {
      throw new Error(`${context}.annotations[${i}] verb "${a.verb}" needs text`);
    }
  });
  return annotations;
}

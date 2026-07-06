// Image board object contract (pure, tested). A real image shown on the board — a PDF
// figure, a fetched topic image, or a diagram — that the tutor teaches from and points at
// (bbox overlay, OpenMAIC full-image rule: never cropped, highlight drawn on top). Slice 1
// = display; the vision pass (describe-image) supplies the caption/explanation.

export function validateImageContent(content, context = 'image') {
  if (!content || typeof content !== 'object') throw new Error(`${context} content must be an object`);
  if (typeof content.url !== 'string' || !content.url.trim()) throw new Error(`${context} needs a url`);
  if (typeof content.alt !== 'string' || !content.alt.trim()) throw new Error(`${context} needs alt text (what the image shows)`);
  if (content.bbox !== undefined) validateBbox(content.bbox, context);
  return content;
}

function validateBbox(bbox, context) {
  for (const key of ['x', 'y', 'w', 'h']) {
    if (typeof bbox[key] !== 'number' || bbox[key] < 0 || bbox[key] > 1) {
      throw new Error(`${context}.bbox.${key} must be a number in [0,1] (normalized)`);
    }
  }
  if (bbox.x + bbox.w > 1.001 || bbox.y + bbox.h > 1.001) throw new Error(`${context}.bbox must stay inside the image`);
}

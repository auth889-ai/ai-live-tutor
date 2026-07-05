export function validateSourceRef(ref, context = 'sourceRef') {
  if (!ref || typeof ref !== 'object') throw new Error(`${context} must be an object`);
  if (!ref.chunkId?.trim()) throw new Error(`${context}.chunkId is required`);
  if (ref.page !== undefined && (!Number.isInteger(ref.page) || ref.page < 1)) {
    throw new Error(`${context}.page must be a positive integer`);
  }
  if (ref.bbox !== undefined) validateBbox(ref.bbox, context);
  return ref;
}

export function resolveSourceRef(ref, sourcePack, context = 'sourceRef') {
  validateSourceRef(ref, context);
  const chunk = sourcePack.chunks.find((candidate) => candidate.id === ref.chunkId);
  if (!chunk) throw new Error(`${context} references missing chunk ${ref.chunkId}`);
  return chunk;
}

function validateBbox(bbox, context) {
  for (const key of ['x', 'y', 'w', 'h']) {
    if (typeof bbox[key] !== 'number' || bbox[key] < 0 || bbox[key] > 1) {
      throw new Error(`${context}.bbox.${key} must be a number in [0,1] (normalized page coordinates)`);
    }
  }
  if (bbox.x + bbox.w > 1 || bbox.y + bbox.h > 1) {
    throw new Error(`${context}.bbox must stay inside the page (x+w and y+h <= 1)`);
  }
}

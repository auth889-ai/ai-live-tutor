// Array content contract (pure, tested). A sorted/unsorted array laid out as a row of cells,
// with an optional DRY-RUN TRACE — the canonical DSA visual for binary search, two-pointer,
// sliding window, and sorting. Each trace step is a full visual STATE at one logical move:
// named pointers (low/mid/high, i/j, slow/fast) sit on cell INDICES, a set of eliminated
// indices greys out, a current index highlights. The player animates through the steps.

export function validateArrayContent(content, context = 'array') {
  if (!content || typeof content !== 'object') throw new Error(`${context} content must be an object`);
  if (!Array.isArray(content.values) || content.values.length === 0) {
    throw new Error(`${context} array needs a non-empty values[]`);
  }
  const n = content.values.length;
  const inBounds = (i) => Number.isInteger(i) && i >= 0 && i < n;

  if (content.trace !== undefined) {
    if (!Array.isArray(content.trace) || content.trace.length === 0) {
      throw new Error(`${context} array trace must be a non-empty array of steps`);
    }
    content.trace.forEach((step, s) => {
      if (!step || typeof step !== 'object') throw new Error(`${context} array trace step ${s} must be an object`);
      if (typeof step.note !== 'string' || !step.note.trim()) throw new Error(`${context} array trace step ${s} needs a note`);
      if (step.current !== undefined && step.current !== null && !inBounds(step.current)) {
        throw new Error(`${context} array trace step ${s} current index is out of bounds`);
      }
      if (step.eliminated !== undefined) {
        if (!Array.isArray(step.eliminated)) throw new Error(`${context} array trace step ${s} eliminated must be an array`);
        for (const i of step.eliminated) if (!inBounds(i)) throw new Error(`${context} array trace step ${s} eliminated index out of bounds`);
      }
      if (step.pointers !== undefined) {
        if (typeof step.pointers !== 'object' || Array.isArray(step.pointers)) throw new Error(`${context} array trace step ${s} pointers must be an object`);
        for (const i of Object.values(step.pointers)) if (!inBounds(i)) throw new Error(`${context} array trace step ${s} pointer index out of bounds`);
      }
    });
  }
  return content;
}

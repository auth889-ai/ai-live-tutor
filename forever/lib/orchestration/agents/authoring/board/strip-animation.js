// Animation ownership (one job): algorithm state over time comes ONLY from the Execution
// Tracer, which ran the real code. A hand-authored "trace" is an IMAGINED animation —
// stripped deterministically before validation (this was the top scene-killer: invented
// traces failing the contract). highlightSequence (a simple visit order) stays allowed,
// except in dry_run scenes where the tracer owns all animation.

export function stripHandAuthoredAnimation(objects, brief) {
  if (!Array.isArray(objects)) return objects;
  const dryRun = brief?.pedagogicalRole === 'dry_run';
  return objects.map((object) => {
    if (object?.renderHint !== 'diagram' || !object.content || typeof object.content !== 'object') return object;
    const { trace, highlightSequence, ...content } = object.content;
    if (!dryRun && highlightSequence !== undefined) content.highlightSequence = highlightSequence;
    return { ...object, content };
  });
}

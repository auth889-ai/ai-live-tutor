// Algorithm narration — THE voice-match contract, extracted so it is TESTED, not hoped for.
// A dry run's voice is generated 1:1 from its trace steps: line i speaks step i's explanation
// verbatim and carries traceStep=i, and the player selects the visual step FROM the active
// line's traceStep (stage-presenter). Words and picture are therefore the same datum viewed
// twice — drift is structurally impossible, for EVERY engine (recursion, traversal,
// pointer-walk, operations, line-sim, @@STEP). The Voice Writer never touches these lines;
// it narrates only the non-algorithm board.

export function voiceLinesForTrace(algorithmObject) {
  const steps = algorithmObject?.content?.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('voiceLinesForTrace needs an algorithm object with trace steps');
  }
  return steps.map((step, i) => ({
    id: `${algorithmObject.id}_step_${i}`,
    text: step.explanation,
    targetObjectId: algorithmObject.id,
    traceStep: i,
    sourceRef: algorithmObject.sourceRef,
  }));
}

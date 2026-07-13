import { validateSourceRef } from '../../source-pack/refs/source-refs.js';

export function validateVoiceLine(line) {
  if (!line.id?.trim()) throw new Error('voiceLine.id is required');
  const context = `voiceLine ${line.id}`;
  if (!line.text?.trim()) throw new Error(`${context}.text is required`);
  if (!line.targetObjectId?.trim()) {
    throw new Error(`${context} must be bound to a board object via targetObjectId — narration always points at something`);
  }
  // Optional sub-element the tutor points at WHILE saying this line (graph node id, code
  // line number, trace row, image bbox) — enables "highlight and explain simultaneously".
  if (line.focusRef !== undefined && !(typeof line.focusRef === 'string' || typeof line.focusRef === 'number')) {
    throw new Error(`${context}.focusRef must be a string or number (a sub-element id)`);
  }
  // Optional: for a traced diagram (dry run), the 0-based trace step THIS line narrates. Binds
  // the animation to the words — the marked node/pointer is guaranteed to match what is spoken.
  if (line.traceStep !== undefined && !(Number.isInteger(line.traceStep) && line.traceStep >= 0)) {
    throw new Error(`${context}.traceStep must be a non-negative integer (the 0-based trace step this line narrates)`);
  }
  if (line.sourceRef !== undefined) validateSourceRef(line.sourceRef, `${context}.sourceRef`);
  return line;
}

export function validateVoiceLines(lines, objects) {
  if (!lines?.length) throw new Error('At least one voice line is required');
  const objectIds = new Set((objects ?? []).map((object) => object.id));
  const ids = new Set();
  for (const line of lines) {
    validateVoiceLine(line);
    if (ids.has(line.id)) throw new Error(`Duplicate voice line id: ${line.id}`);
    ids.add(line.id);
    if (objects && !objectIds.has(line.targetObjectId)) {
      throw new Error(`voiceLine ${line.id} targets missing board object "${line.targetObjectId}" — valid object ids: ${[...objectIds].join(', ')}`);
    }
  }
  return lines;
}

// Deterministic repair for the most common Voice Writer slip (measured live 2026-07-08: a
// dry-run scene died because a line targeted tree node "n5" instead of the diagram that holds
// it): when targetObjectId matches no object but IS a sub-element (graph/diagram node id) of
// exactly ONE object, the intent is unambiguous — point at that object and keep the node as
// focusRef. Ambiguous or unknown targets are left for validation to reject loudly.
export function normalizeVoiceTargets(lines, objects) {
  const objectIds = new Set((objects ?? []).map((object) => object.id));
  const ownerOf = (elementId) => {
    const owners = (objects ?? []).filter((o) =>
      (o.content?.nodes ?? []).some((n) => String(n.id) === String(elementId)));
    return owners.length === 1 ? owners[0] : null;
  };
  return (lines ?? []).map((line) => {
    if (!line?.targetObjectId || objectIds.has(line.targetObjectId)) return line;
    const owner = ownerOf(line.targetObjectId);
    if (!owner) return line;
    return { ...line, targetObjectId: owner.id, focusRef: line.focusRef ?? line.targetObjectId };
  });
}

// Deterministic shape repair for focusRef (measured live 2026-07-13: a heat-wave scene died
// because a line pointed at TWO annotations — focusRef ["E1","E2"]). An array of refs means
// the FIRST one is spoken first; an object/empty shape carries no usable pointer and is
// dropped (focusRef is optional). Never invents a pointer, only unwraps or removes.
export function normalizeFocusRefs(lines) {
  return (lines ?? []).map((line) => {
    if (!line || line.focusRef === undefined) return line;
    const ref = line.focusRef;
    if (typeof ref === 'string' || typeof ref === 'number') return line;
    if (Array.isArray(ref)) {
      const first = ref.find((v) => typeof v === 'string' || typeof v === 'number');
      if (first !== undefined) return { ...line, focusRef: first };
    }
    const { focusRef, ...rest } = line;
    return rest;
  });
}

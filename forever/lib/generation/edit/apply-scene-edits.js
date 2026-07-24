// Human-in-the-loop scene edits (one job): validate and apply a user's edits to ONE scene —
// narration text and plain-text board content only (v1; structured objects like graphs,
// traces and code stay read-only — editing those safely means editing their engines' truth,
// out of scope). Returns a NEW scene with `audioUrl` cleared so voiceScene re-voices it:
// the TTS cache is keyed on line text, so UNCHANGED lines replay their cached clips and
// only edited lines cost a real ElevenLabs/Qwen call — selective regeneration by design.
// Throws descriptive errors for the route to surface as 400s; never mutates the input.

import { validateAnnotations } from '../../board/annotations/annotation-content.js';

const MAX_TEXT = 4000;

export function applySceneEdits(scene, { voiceLines = [], objects = [], newVoiceLines = [], marks = [] } = {}) {
  if (!Array.isArray(voiceLines) || !Array.isArray(objects) || !Array.isArray(newVoiceLines) || !Array.isArray(marks)) {
    throw new Error('edits must be { voiceLines: [{id, text}], objects: [{id, content}], newVoiceLines: [{text, targetObjectId?}], marks: [{objectId, annotations}] }');
  }
  if (!voiceLines.length && !objects.length && !newVoiceLines.length && !marks.length) throw new Error('no edits provided');

  const lineById = new Map((scene.voiceLines ?? []).map((line) => [line.id, line]));
  for (const edit of voiceLines) {
    if (!lineById.has(edit?.id)) throw new Error(`voice line "${edit?.id}" does not exist in this scene`);
    if (typeof edit.text !== 'string' || !edit.text.trim()) throw new Error(`voice line "${edit.id}" needs non-empty text`);
    if (edit.text.length > MAX_TEXT) throw new Error(`voice line "${edit.id}" text too long (max ${MAX_TEXT} chars)`);
  }

  const objectById = new Map((scene.objects ?? []).map((object) => [object.id, object]));
  for (const edit of objects) {
    const target = objectById.get(edit?.id);
    if (!target) throw new Error(`board object "${edit?.id}" does not exist in this scene`);
    if (typeof target.content !== 'string') {
      throw new Error(`board object "${edit.id}" is structured (${target.renderHint}) — read-only in v1, edit narration instead`);
    }
    if (typeof edit.content !== 'string' || !edit.content.trim()) throw new Error(`board object "${edit.id}" needs non-empty content`);
    if (edit.content.length > MAX_TEXT) throw new Error(`board object "${edit.id}" content too long (max ${MAX_TEXT} chars)`);
  }

  // NEW lines ("write newly"): appended after the existing narration, each bound to a REAL
  // board object (the timeline contract: every spoken line points at something on screen).
  // Default target = the scene's first object; ids are made collision-proof against both
  // existing lines and each other.
  const existingIds = new Set((scene.voiceLines ?? []).map((line) => line.id));
  const defaultTarget = (scene.objects ?? [])[0]?.id;
  const objectIds = new Set((scene.objects ?? []).map((object) => object.id));
  const appended = newVoiceLines.map((entry, i) => {
    if (typeof entry?.text !== 'string' || !entry.text.trim()) throw new Error(`new line ${i + 1} needs non-empty text`);
    if (entry.text.length > MAX_TEXT) throw new Error(`new line ${i + 1} text too long (max ${MAX_TEXT} chars)`);
    const targetObjectId = entry.targetObjectId ?? defaultTarget;
    if (!objectIds.has(targetObjectId)) throw new Error(`new line ${i + 1} targets unknown board object "${targetObjectId}"`);
    let id = `vl_user_${i + 1}`;
    while (existingIds.has(id)) id = `${id}x`;
    existingIds.add(id);
    return { id, text: entry.text, targetObjectId };
  });

  // HUMAN MARKS: the one honest exception to vision grounding — the human SEES the image,
  // so their drawn/moved marks are the verification. Full annotation contract still applies
  // (known verbs, bbox inside the image, label/arrow need text); every human mark is
  // stamped groundedBy:"human" so provenance stays readable.
  const markEdits = new Map();
  for (const edit of marks) {
    const target = objectById.get(edit?.objectId);
    if (!target) throw new Error(`marks target "${edit?.objectId}" does not exist in this scene`);
    if (target.renderHint !== 'image') throw new Error(`marks can only be drawn on image objects ("${edit.objectId}" is ${target.renderHint})`);
    const annotations = (edit.annotations ?? []).map((a) => ({ ...a, groundedBy: 'human' }));
    validateAnnotations(annotations, `edit ${edit.objectId}`);
    markEdits.set(edit.objectId, annotations);
  }

  const lineEdits = new Map(voiceLines.map((e) => [e.id, e.text]));
  const objectEdits = new Map(objects.map((e) => [e.id, e.content]));
  const edited = {
    ...scene,
    objects: (scene.objects ?? []).map((object) => {
      let next = object;
      if (objectEdits.has(object.id)) next = { ...next, content: objectEdits.get(object.id) };
      if (markEdits.has(object.id)) next = { ...next, content: { ...next.content, annotations: markEdits.get(object.id) } };
      return next;
    }),
    voiceLines: [
      ...(scene.voiceLines ?? []).map((line) => (lineEdits.has(line.id) ? { ...line, text: lineEdits.get(line.id) } : line)),
      ...appended,
    ],
  };
  // Clearing audioUrl is what makes voiceScene actually re-voice (it early-returns on a
  // voiced scene). Mark-only edits change nothing SPOKEN — keep the audio and timeline.
  const spokenChanged = voiceLines.length || newVoiceLines.length || objects.length;
  if (spokenChanged) delete edited.audioUrl;
  return edited;
}

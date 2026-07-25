// Human-in-the-loop scene edits (one job): validate and apply a user's edits to ONE scene —
// narration text and plain-text board content only (v1; structured objects like graphs,
// traces and code stay read-only — editing those safely means editing their engines' truth,
// out of scope). Returns a NEW scene with `audioUrl` cleared so voiceScene re-voices it:
// the TTS cache is keyed on line text, so UNCHANGED lines replay their cached clips and
// only edited lines cost a real ElevenLabs/Qwen call — selective regeneration by design.
// Throws descriptive errors for the route to surface as 400s; never mutates the input.

import { validateAnnotations } from '../../board/annotations/annotation-content.js';

const MAX_TEXT = 4000;
const MAX_ARRAY_CELLS = 24;

// Human-added board objects ("write on the board"): text notes, hand-drawn arrays (rendered
// through the existing table cells), and images re-placed from the lesson's own real assets.
// Humans author teaching devices, never source facts — so these carry grounding:"analogy"
// (the contract's honest tag for invented-by-the-teacher devices) and human provenance.
function buildNewObject(entry, index, region) {
  const id = `obj_user_${index + 1}`;
  const base = { id, region, addedBy: 'human' };
  if (entry?.kind === 'text') {
    if (typeof entry.text !== 'string' || !entry.text.trim()) throw new Error(`new object ${index + 1}: text needs non-empty text`);
    if (entry.text.length > MAX_TEXT) throw new Error(`new object ${index + 1}: text too long`);
    return { ...base, objectType: 'human_note', renderHint: 'text', grounding: 'analogy', content: entry.text };
  }
  if (entry?.kind === 'array') {
    const values = entry.values;
    if (!Array.isArray(values) || values.length < 1 || values.length > MAX_ARRAY_CELLS) {
      throw new Error(`new object ${index + 1}: array needs 1-${MAX_ARRAY_CELLS} values`);
    }
    if (!values.every((v) => typeof v === 'number' || (typeof v === 'string' && v.length <= 12))) {
      throw new Error(`new object ${index + 1}: array values must be numbers or short strings`);
    }
    return {
      ...base,
      objectType: 'human_array',
      renderHint: 'table',
      grounding: 'analogy',
      content: {
        headers: ['', ...values.map((_, i) => String(i))],
        rows: [{ label: entry.label?.slice(0, 24) || 'values', values: values.map(String) }],
      },
    };
  }
  if (entry?.kind === 'image') {
    const url = String(entry.url ?? '');
    // Only the lesson's own stored assets — an arbitrary external URL on the board would
    // bypass every grounding rule the pipeline enforces.
    if (!/^\/(assets|images|audio)\//.test(url) && !url.startsWith('/dev-')) {
      throw new Error(`new object ${index + 1}: image url must be one of this lesson's own assets (/assets/...)`);
    }
    if (typeof entry.alt !== 'string' || !entry.alt.trim()) throw new Error(`new object ${index + 1}: image needs alt text`);
    return {
      ...base,
      objectType: 'human_image',
      renderHint: 'image',
      grounding: 'analogy',
      content: { url, alt: entry.alt.slice(0, 200), ...(isWidth(entry.displayWidth) ? { displayWidth: entry.displayWidth } : {}) },
    };
  }
  throw new Error(`new object ${index + 1}: kind must be text | array | image`);
}

const isWidth = (w) => typeof w === 'number' && w >= 0.2 && w <= 1;

export function applySceneEdits(scene, { voiceLines = [], objects = [], newVoiceLines = [], marks = [], newObjects = [], images = [] } = {}) {
  if (![voiceLines, objects, newVoiceLines, marks, newObjects, images].every(Array.isArray)) {
    throw new Error('edits must be arrays: { voiceLines, objects, newVoiceLines, marks, newObjects, images }');
  }
  if (!voiceLines.length && !objects.length && !newVoiceLines.length && !marks.length && !newObjects.length && !images.length) throw new Error('no edits provided');

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

  // IMAGE LAYOUT edits (resize on the board): displayWidth is pure presentation — no
  // re-voice, no grounding impact; validated range keeps the image legible.
  const imageEdits = new Map();
  for (const edit of images) {
    const target = objectById.get(edit?.objectId);
    if (!target) throw new Error(`images target "${edit?.objectId}" does not exist in this scene`);
    if (target.renderHint !== 'image') throw new Error(`images edits only apply to image objects ("${edit.objectId}" is ${target.renderHint})`);
    if (!isWidth(edit.displayWidth)) throw new Error(`images "${edit.objectId}": displayWidth must be a number between 0.2 and 1`);
    imageEdits.set(edit.objectId, edit.displayWidth);
  }

  // NEW board objects, placed in the same region as the scene's existing material.
  const region = (scene.objects ?? [])[0]?.region ?? 'notebook_area';
  const added = newObjects.map((entry, i) => buildNewObject(entry, i, region));
  const usedIds = new Set((scene.objects ?? []).map((o) => o.id));
  for (const object of added) {
    while (usedIds.has(object.id)) object.id = `${object.id}x`;
    usedIds.add(object.id);
  }

  const lineEdits = new Map(voiceLines.map((e) => [e.id, e.text]));
  const objectEdits = new Map(objects.map((e) => [e.id, e.content]));
  const edited = {
    ...scene,
    objects: [
      ...(scene.objects ?? []).map((object) => {
        let next = object;
        if (objectEdits.has(object.id)) next = { ...next, content: objectEdits.get(object.id) };
        if (markEdits.has(object.id)) next = { ...next, content: { ...next.content, annotations: markEdits.get(object.id) } };
        if (imageEdits.has(object.id)) next = { ...next, content: { ...next.content, displayWidth: imageEdits.get(object.id) } };
        return next;
      }),
      ...added,
    ],
    voiceLines: [
      ...(scene.voiceLines ?? []).map((line) => (lineEdits.has(line.id) ? { ...line, text: lineEdits.get(line.id) } : line)),
      ...appended,
    ],
  };
  // Clearing audioUrl is what makes voiceScene actually re-voice (it early-returns on a
  // voiced scene). Mark/layout-only edits change nothing SPOKEN — keep the audio; adding
  // board objects also keeps it (the human narrates them by adding lines if they want).
  const spokenChanged = voiceLines.length || newVoiceLines.length || objects.length;
  if (spokenChanged) delete edited.audioUrl;
  // Keeping the existing audio/timeline (mark/layout/add-only edits): human-added objects
  // still need a write action or the player never shows them (visibility = timeline).
  if (!spokenChanged && added.length && edited.timeline?.actions) {
    edited.timeline = {
      ...edited.timeline,
      actions: [
        ...added.map((object) => ({ id: `act_write_${object.id}`, kind: 'write', startMs: 0, durationMs: 800, targetObjectId: object.id })),
        ...edited.timeline.actions,
      ],
    };
  }
  return edited;
}

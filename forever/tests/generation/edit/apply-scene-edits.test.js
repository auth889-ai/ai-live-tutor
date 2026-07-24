// applySceneEdits: the validation gate between a user's edit and the revoice pipeline.
// Everything it lets through goes straight to TTS + reconcile, so bad edits must die here
// with reasons the UI can show.

import assert from 'node:assert/strict';
import test from 'node:test';
import { applySceneEdits } from '../../../lib/generation/edit/apply-scene-edits.js';

const scene = {
  sceneId: 'sc_01',
  audioUrl: '/audio/k/sc_01.mp3',
  objects: [
    { id: 'obj_text', renderHint: 'text', content: 'A JOIN stitches two tables.' },
    { id: 'obj_graph', renderHint: 'graph', content: { nodes: [{ id: 'a' }] } },
  ],
  voiceLines: [
    { id: 'vl_1', text: 'hello', targetObjectId: 'obj_text' },
    { id: 'vl_2', text: 'world', targetObjectId: 'obj_text' },
  ],
};

test('applies narration + text-object edits, clears audioUrl, never mutates the input', () => {
  const edited = applySceneEdits(scene, {
    voiceLines: [{ id: 'vl_2', text: 'world, but better explained' }],
    objects: [{ id: 'obj_text', content: 'A JOIN matches rows by a shared column.' }],
  });
  assert.equal(edited.voiceLines[1].text, 'world, but better explained');
  assert.equal(edited.voiceLines[0].text, 'hello'); // untouched line untouched
  assert.match(edited.objects[0].content, /shared column/);
  assert.equal('audioUrl' in edited, false); // cleared -> voiceScene will re-voice
  assert.equal(scene.audioUrl, '/audio/k/sc_01.mp3'); // input not mutated
  assert.equal(scene.voiceLines[1].text, 'world');
});

test('rejects edits to unknown ids, structured objects, and empty/oversized text', () => {
  assert.throws(() => applySceneEdits(scene, { voiceLines: [{ id: 'vl_9', text: 'x' }] }), /does not exist/);
  assert.throws(() => applySceneEdits(scene, { objects: [{ id: 'obj_graph', content: 'x' }] }), /read-only in v1/);
  assert.throws(() => applySceneEdits(scene, { voiceLines: [{ id: 'vl_1', text: '   ' }] }), /non-empty/);
  assert.throws(() => applySceneEdits(scene, { objects: [{ id: 'obj_text', content: 'x'.repeat(5000) }] }), /too long/);
  assert.throws(() => applySceneEdits(scene, {}), /no edits/);
  assert.throws(() => applySceneEdits(scene, { voiceLines: 'nope' }), /must be/);
});

test('newVoiceLines: human-written lines append, bind to a real object, get safe ids', () => {
  const edited = applySceneEdits(scene, {
    newVoiceLines: [
      { text: 'One more thing worth remembering about joins.' },
      { text: 'And here is how you would check it yourself.', targetObjectId: 'obj_text' },
    ],
  });
  assert.equal(edited.voiceLines.length, 4);
  const added = edited.voiceLines.slice(2);
  assert.ok(added.every((l) => l.targetObjectId === 'obj_text')); // default = first object
  assert.ok(added.every((l) => l.id.startsWith('vl_user_')));
  assert.equal(new Set(edited.voiceLines.map((l) => l.id)).size, 4); // no id collisions
  assert.equal('audioUrl' in edited, false);
  assert.throws(() => applySceneEdits(scene, { newVoiceLines: [{ text: 'x', targetObjectId: 'ghost' }] }), /unknown board object/);
  assert.throws(() => applySceneEdits(scene, { newVoiceLines: [{ text: '  ' }] }), /non-empty/);
});

test('human marks: replace annotations on an image object, stamped groundedBy human, audio kept', () => {
  const withImage = {
    ...scene,
    objects: [...scene.objects, { id: 'obj_img', renderHint: 'image', content: { url: '/f.png', alt: 'figure', annotations: [{ verb: 'encircle', bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }] } }],
  };
  const edited = applySceneEdits(withImage, {
    marks: [{ objectId: 'obj_img', annotations: [
      { verb: 'arrow', bbox: { x: 0.5, y: 0.5, w: 0.2, h: 0.1 }, text: 'the fact table' },
      { verb: 'encircle', bbox: { x: 0.05, y: 0.6, w: 0.3, h: 0.25 } },
    ] }],
  });
  const img = edited.objects.find((o) => o.id === 'obj_img');
  assert.equal(img.content.annotations.length, 2);
  assert.ok(img.content.annotations.every((a) => a.groundedBy === 'human'));
  assert.equal(edited.audioUrl, '/audio/k/sc_01.mp3'); // marks change nothing spoken — audio kept
  // contract still enforced on human marks
  assert.throws(() => applySceneEdits(withImage, { marks: [{ objectId: 'obj_img', annotations: [{ verb: 'arrow', bbox: { x: 0.5, y: 0.5, w: 0.2, h: 0.1 } }] }] }), /needs text/);
  assert.throws(() => applySceneEdits(withImage, { marks: [{ objectId: 'obj_text', annotations: [] }] }), /only be drawn on image/);
  assert.throws(() => applySceneEdits(withImage, { marks: [{ objectId: 'ghost', annotations: [] }] }), /does not exist/);
});

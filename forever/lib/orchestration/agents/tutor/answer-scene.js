// Ask-the-Tutor → a FULL board mini-lesson (one job): the student's question becomes a
// fresh interactive scene through the SAME machinery every lesson scene walks — sources
// retrieved (the lesson's own material) → brief planned from the question → board objects
// created by the Board Director → marks vision-grounded → narration written → voice
// synthesized → review gates (Grounding Auditor hard gate, Pedagogy Critic) passed.
// Nothing bespoke: generateSceneFromSourcePack IS the society's scene pipeline, so a Q&A
// scene meets exactly the same honesty bars as a lesson scene. Voicing failure degrades to
// a silent scene (manual clock) — never a fake.

import { generateSceneFromSourcePack } from '../../../generation/scene/generate-scene.js';
import { voiceScene, lessonAudioKey } from '../../../tts/voice-lesson.js';
import { buildMultimodalSourcePack } from '../../../source-pack/build/multimodal-source-pack.js';

// Chunk retrieval: prefer the chunks that share words with the question (simple lexical
// scoring — deterministic, no extra model call); always keep at least 4 so the auditor has
// material to ground against.
export function retrieveQuestionChunks(question, chunks, { keep = 6 } = {}) {
  const tokens = new Set(String(question).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t.length >= 4));
  const scored = chunks.map((chunk) => {
    const words = new Set(chunk.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' '));
    let score = 0;
    for (const token of tokens) if (words.has(token)) score += 1;
    return { chunk, score };
  }).sort((a, b) => b.score - a.score);
  // Best matches FIRST, then pad to the groundable floor (>=4) with the remaining chunks —
  // padding must never bury a real match (caught by test: 2 matches + floor returned the
  // original order instead of match-ranked).
  const matched = scored.filter((s) => s.score > 0).slice(0, keep).map((s) => s.chunk);
  const rest = chunks.filter((chunk) => !matched.includes(chunk));
  return [...matched, ...rest.slice(0, Math.max(0, Math.max(4, Math.min(keep, chunks.length)) - matched.length))];
}

export async function answerWithScene({ lesson, question, sourcePack, chunks, domain = 'general', onStep = () => {}, agents = {} }) {
  // Source pack: the course's real one when available (figures included); else rebuild a
  // text pack from the lesson's grounding chunks so the auditor still has a source of truth.
  let pack = sourcePack;
  if (!pack) {
    const usable = (chunks ?? []).length ? chunks : null;
    if (!usable) throw new Error('this lesson has no source material to ground an answer scene');
    pack = buildMultimodalSourcePack({
      title: `Q&A: ${question.slice(0, 60)}`,
      text: usable.map((chunk) => chunk.text).join('\n\n'),
      images: [],
      documentType: 'text',
    });
  } else if ((chunks ?? []).length) {
    // Focus the pack on the retrieved chunks (keeps the Board Director on-topic) while
    // keeping ids the auditor can cite.
    const keep = new Set(retrieveQuestionChunks(question, chunks).map((chunk) => chunk.id));
    pack = { ...pack, chunks: pack.chunks.filter((chunk) => keep.has(chunk.id) || keep.size === 0) };
    if (!pack.chunks.length) pack = sourcePack;
  }

  const brief = {
    title: `Your question: ${question.slice(0, 70)}`,
    pedagogicalRole: 'intuition',
    directive: `The student paused the lesson "${lesson.lessonTitle}" and asked: "${question}". Answer it AS A TAUGHT SCENE, not prose: open from a concrete example with real values from the source, put the answer's core idea on the board (diagram/table/steps as fits), name the misconception hiding inside the question if there is one, and end with one check-yourself question. Stay strictly inside what the source chunks support.`,
    focusChunkIds: pack.chunks.map((chunk) => chunk.id),
  };

  onStep({ stage: 'planning', message: 'mini-scene planned from your question' });
  const { scene, usage } = await generateSceneFromSourcePack(pack, {
    layout: 'teacher_notebook_code',
    sceneId: `ask_${Date.now().toString(36)}`,
    brief,
    domain,
    onStep,
    agents, // injectable for tests — production callers pass nothing and get the real society
  });
  scene.title = brief.title;
  scene.pedagogicalRole = 'qa';

  onStep({ stage: 'voicing', message: 'voice produced' });
  let voiced = scene;
  if (process.env.DISABLE_TTS !== '1' && scene.voiceLines?.length) {
    try {
      voiced = await voiceScene(scene, { lessonKey: `ask${lessonAudioKey(lesson.sourcePackId)}` });
      if (voiced.audioUrl) voiced = { ...voiced, audioUrl: `${voiced.audioUrl}?v=${Date.now()}` };
    } catch (error) {
      console.error(`[ask-scene] voicing failed — shipping silent scene: ${String(error?.message).slice(0, 120)}`);
    }
  }
  return { scene: voiced, usage };
}

import { LAYOUT_REGIONS } from '../../board/layout/layout-regions.js';
import { validateBoardObjects } from '../../board/objects/board-objects.js';
import { validateVoiceLines } from '../voice/voice-lines.js';
import { validateTimeline } from '../timeline/timeline-actions.js';
import { validateTeacherPersona } from '../../orchestration/persona/teacher-persona.js';
import { validateNotebookPage } from '../../course-series/notebook/notebook-page.js';
import { resolveSourceRef } from '../../source-pack/refs/source-refs.js';

// THE storage gate. A manifest that fails here is never stored — repair or honest error.
export function validateSceneManifest(manifest, { sourcePack = null, requireReconciled = true } = {}) {
  if (!manifest.sceneId?.trim()) throw new Error('manifest.sceneId is required');
  if (!manifest.sourcePackId?.trim()) throw new Error('manifest.sourcePackId is required');
  if (!LAYOUT_REGIONS[manifest.layout]) throw new Error(`manifest.layout is not a known layout: ${manifest.layout}`);
  if (manifest.persona) validateTeacherPersona(manifest.persona);

  validateBoardObjects(manifest.objects, manifest.layout);
  validateVoiceLines(manifest.voiceLines, manifest.objects);

  if (!manifest.timeline) throw new Error('manifest.timeline is required');
  if (manifest.timeline.sceneId !== manifest.sceneId) {
    throw new Error(`timeline.sceneId ${manifest.timeline.sceneId} does not match manifest.sceneId ${manifest.sceneId}`);
  }
  validateTimeline(manifest.timeline, { objects: manifest.objects, voiceLines: manifest.voiceLines });
  if (requireReconciled && manifest.timeline.timingSource !== 'reconciled') {
    throw new Error('Manifest cannot be stored with provisional timing — run TTS alignment and the reconciler first');
  }

  if (manifest.quiz) validateQuiz(manifest.quiz);
  if (manifest.notebookPage) validateNotebookPage(manifest.notebookPage, manifest.objects);
  if (sourcePack) assertAllSourceRefsResolve(manifest, sourcePack);
  return manifest;
}

function validateQuiz(quiz) {
  if (!quiz.questions?.length) throw new Error('quiz.questions must be non-empty');
  for (const question of quiz.questions) {
    if (!question.id?.trim()) throw new Error('quiz question id is required');
    const context = `quiz question ${question.id}`;
    if (!question.prompt?.trim()) throw new Error(`${context}.prompt is required`);
    if (!question.choices || question.choices.length < 2) throw new Error(`${context} needs at least 2 choices`);
    if (!Number.isInteger(question.answerIndex) || question.answerIndex < 0 || question.answerIndex >= question.choices.length) {
      throw new Error(`${context}.answerIndex must index into choices`);
    }
    if (!question.workedAnswer?.trim()) throw new Error(`${context}.workedAnswer is required — quizzes teach, not just test`);
    if (!question.sourceRef) throw new Error(`${context} needs a sourceRef — every question must be answerable from cited source`);
  }
}

function assertAllSourceRefsResolve(manifest, sourcePack) {
  for (const object of manifest.objects) {
    if (object.decorative === true) continue;
    resolveSourceRef(object.sourceRef, sourcePack, `boardObject ${object.id}.sourceRef`);
  }
  for (const line of manifest.voiceLines) {
    if (line.sourceRef) resolveSourceRef(line.sourceRef, sourcePack, `voiceLine ${line.id}.sourceRef`);
  }
  for (const question of manifest.quiz?.questions ?? []) {
    resolveSourceRef(question.sourceRef, sourcePack, `quiz question ${question.id}.sourceRef`);
  }
}

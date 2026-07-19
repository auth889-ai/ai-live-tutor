// DETERMINISTIC LESSON GATE — Universal Course Build, Step 1 ("START HERE").
// Zero tokens. The measured compliance win (0.47 -> 0.94 in the deterministic-verifier
// study) comes from checking EVERY structural teaching promise before any TTS/publish:
// coherence (narration <-> board), required beats, narration discipline, and
// numbers-trace-to-source. Failure returns TARGETED violations (scene + rule + element)
// so the repair prompt can name exactly what to fix — smallest scope first, max 2 rounds.
//
// Pure functions only: lesson payload in, verdict out. No model, no I/O.

const WORD_CAP_PER_LINE = 60;          // TeachLM lint: a spoken line stays speakable
const MAX_QUESTIONS_PER_CHECKIN = 2;   // more reads as a quiz wall, not a check-in

// Universal required beats (a domain pack may extend, never shrink).
export const REQUIRED_BEATS = Object.freeze(['worked_example', 'misconception', 'checkpoint', 'recap']);

const ROLE_ALIASES = {
  worked_example: ['worked_example', 'example', 'case', 'demonstration'],
  misconception: ['misconception', 'pitfall', 'common_error', 'refutation'],
  checkpoint: ['checkpoint', 'quiz', 'retrieval', 'practice', 'learner_action', 'check_in'],
  recap: ['recap', 'summary', 'reflection', 'closing'],
};

const words = (t) => String(t ?? '').trim().split(/\s+/).filter(Boolean);
const numbersIn = (t) => (String(t ?? '').match(/\d+(?:[.,]\d+)?%?/g) ?? [])
  .map((n) => n.replace(/,/g, ''))
  .filter((n) => n.replace(/[%.]/g, '').length >= 2); // single digits narrate freely ("two tables")

export function gateLesson(payload, { sourceText = '', requiredBeats = REQUIRED_BEATS } = {}) {
  const violations = [];
  const scenes = payload?.scenes ?? [];
  if (scenes.length === 0) {
    return { ok: false, violations: [{ sceneId: null, rule: 'lesson-empty', detail: 'lesson has no scenes' }] };
  }

  const rolesSeen = new Set(scenes.map((s) => String(s.pedagogicalRole ?? '').toLowerCase()));
  for (const beat of requiredBeats) {
    const hit = (ROLE_ALIASES[beat] ?? [beat]).some((alias) => [...rolesSeen].some((r) => r.includes(alias)));
    if (!hit) violations.push({ sceneId: null, rule: 'beat-missing', detail: `no scene carries the required "${beat}" beat` });
  }

  const source = String(sourceText ?? '').replace(/,/g, '');

  for (const scene of scenes) {
    const sid = scene.sceneId ?? '?';
    const objects = scene.objects ?? [];
    const objIds = new Set(objects.map((o) => o.id));
    const voiceLines = scene.voiceLines ?? [];
    const evidenceText = JSON.stringify(objects.map((o) => o.content ?? '')).replace(/,/g, ' ');

    // the known empty-board bug: a scene that talks over nothing
    if (objects.filter((o) => !o.decorative).length === 0) {
      violations.push({ sceneId: sid, rule: 'scene-empty-board', detail: 'scene has no non-decorative board object' });
    }

    const referenced = new Set();
    for (const vl of voiceLines) {
      // coherence: narration must point at a REAL object (Mayer signaling — the visible referent)
      if (vl.targetObjectId && !objIds.has(vl.targetObjectId)) {
        violations.push({ sceneId: sid, rule: 'voiceline-dangling-target', detail: `voiceLine "${vl.id}" targets missing object "${vl.targetObjectId}"` });
      }
      if (vl.targetObjectId) referenced.add(vl.targetObjectId);
      const w = words(vl.text);
      if (w.length > WORD_CAP_PER_LINE) {
        violations.push({ sceneId: sid, rule: 'voiceline-too-long', detail: `voiceLine "${vl.id}" is ${w.length} words (cap ${WORD_CAP_PER_LINE})` });
      }
      // numbers-trace-to-source: any narrated figure must exist in the source or on the board
      for (const num of numbersIn(vl.text)) {
        if (!source.includes(num) && !evidenceText.includes(num)) {
          violations.push({ sceneId: sid, rule: 'number-unsourced', detail: `voiceLine "${vl.id}" narrates "${num}" which appears in neither source nor board evidence` });
        }
      }
    }

    // check-in discipline: at most 2 questions in a checkpoint scene's narration
    const role = String(scene.pedagogicalRole ?? '').toLowerCase();
    if (ROLE_ALIASES.checkpoint.some((a) => role.includes(a))) {
      const questions = voiceLines.reduce((acc, vl) => acc + (String(vl.text).match(/\?/g) ?? []).length, 0);
      if (questions > MAX_QUESTIONS_PER_CHECKIN) {
        violations.push({ sceneId: sid, rule: 'checkin-question-flood', detail: `${questions} questions in one check-in (cap ${MAX_QUESTIONS_PER_CHECKIN})` });
      }
    }

    // coverage: a board object nobody ever speaks about is dead weight (or a hallucinated plan)
    for (const o of objects) {
      if (o.decorative) continue;
      const inTimeline = (scene.timeline?.actions ?? []).some((a) => a.targetObjectId === o.id);
      if (!referenced.has(o.id) && !inTimeline) {
        violations.push({ sceneId: sid, rule: 'object-never-referenced', detail: `object "${o.id}" is never targeted by any voiceLine or timeline action` });
      }
    }

    // timeline integrity: every action resolves
    for (const a of scene.timeline?.actions ?? []) {
      if (a.targetObjectId && !objIds.has(a.targetObjectId)) {
        violations.push({ sceneId: sid, rule: 'timeline-dangling-target', detail: `action "${a.id}" targets missing object "${a.targetObjectId}"` });
      }
      if (a.voiceLineId && !voiceLines.some((vl) => vl.id === a.voiceLineId)) {
        violations.push({ sceneId: sid, rule: 'timeline-dangling-voiceline', detail: `action "${a.id}" references missing voiceLine "${a.voiceLineId}"` });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

// The targeted repair note: names EXACTLY what failed, smallest scope first.
export function buildRepairNote(violations) {
  const byScene = new Map();
  for (const v of violations) {
    const k = v.sceneId ?? 'lesson';
    if (!byScene.has(k)) byScene.set(k, []);
    byScene.get(k).push(`- [${v.rule}] ${v.detail}`);
  }
  return [...byScene.entries()]
    .map(([scene, items]) => `${scene === 'lesson' ? 'LESSON-LEVEL' : `SCENE ${scene}`}:\n${items.join('\n')}`)
    .join('\n');
}

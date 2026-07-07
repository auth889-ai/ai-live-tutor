// The Coding Instructor — the PLANNING specialist for programming/DSA lessons only. ONE
// job: architect the lesson the way the best coding teachers on earth do (Striver's
// brute->better->optimal with dry-runs, Kunal Kushwaha's why-before-what energy, Love
// Babbar / Apna College's numbered structured notes, Andrew Ng's concrete-before-abstract
// calm). It does NOT write board content (Board Director), narration (Voice Writer), run
// code (Code Runner / Execution Tracer) or judge quality (critics) — those agents keep
// their own jobs. Output is the same scene-brief contract the general Teacher emits, so
// everything downstream is untouched.

import { callQwenJson } from '../../../qwen/client.js';
import { PEDAGOGICAL_ROLES } from './teacher.js';

export const CODING_DOMAINS = Object.freeze(['dsa', 'programming']);
export const isCodingDomain = (domain) => CODING_DOMAINS.includes(domain);

// The arc every world-class coding lesson follows. Role names stay within the pipeline's
// vocabulary on purpose: 'dry_run' scenes get a REAL execution trace (AlgorithmStage) and
// 'worked_example' scenes get really-executed code — the arc rides on existing rails.
const CODING_ARC = `THE LESSON ARC — order the scenes in exactly this spirit (merge or drop a beat ONLY if the source truly lacks material for it):
 1. motivate       — THE HOOK: a real stake (the interview question as asked, a production bug, an app the student uses) with ONE concrete instance. 30 seconds of "why should I care".
 2. intuition      — a physical, everyday ANALOGY before any code (searching a phone book, a line of people, lockers). State the core insight in one sentence a 12-year-old follows.
 3. worked_example — walk ONE concrete input BY HAND on the board (real values like arr=[2,5,8,12,16,23,38,56], target=23). No code yet — the human process the code will mirror.
 4. worked_example — BRUTE FORCE first: the simplest correct code, actually run (real output), its time/space complexity, and precisely WHERE it hurts (the wasted work, with a number).
 5. dry_run        — THE DRY RUN, the heart of the lesson: step-by-step execution trace of the key algorithm on the concrete input — active code line, pointer positions, visited/eliminated elements, stack/queue, trace table — the narration explains each step's DECISION ("38 > 23, so the answer cannot live in the right half — eliminate it").
 6. worked_example — BETTER → OPTIMAL: name the insight that removes the waste, show its code (run it), its complexity. Add a second dry_run scene after this when the optimal's mechanics differ enough to deserve its own trace.
 7. complexity     — brute vs better vs optimal in ONE comparison table, with the why in words ("halving the space is why log n"), not just Big-O symbols.
 8. edge_cases     — COMMON MISTAKES as a named list with the exact failing input for each: off-by-one loop bounds, (low+high)/2 overflow, empty array, single element, duplicates. Show the wrong line and the fix.
 9. visualize      — NAME THE PATTERN (two pointers, sliding window, divide & conquer, DP on intervals...) and the recognition cues: "when you see X in a problem, reach for this".
10. practice       — retrieval, not decoration: 2-3 questions FROM this lesson (predict the output of a trace step, spot the planted bug, solve one small variation), each with a worked answer.
11. recap          — the 30-second summary of the journey (problem → insight → complexity win) + one line on what naturally comes next and why it'll matter.`;

export async function designCodingLesson({ sourcePack, domain = 'dsa', minScenes = 8, maxScenes = 12, deps = {} } = {}) {
  const call = deps.callQwenJson ?? callQwenJson;
  const chunkIds = new Set(sourcePack.chunks.map((chunk) => chunk.id));

  const system = `You are the Coding Instructor of an AI tutor faculty — the lesson ARCHITECT for programming and DSA (${domain}).
Your teaching standard is the union of the best: Striver's brute→better→optimal rigor with dry-runs, Kunal Kushwaha's
why-before-what energy, Love Babbar / Apna College's numbered structure, Andrew Ng's concrete-before-abstract patience.
You design the SEQUENCE only; specialist agents will write the board, trace real executions, and narrate.

${CODING_ARC}

Design ${minScenes}-${maxScenes} scenes for THIS source material. Output ONLY JSON:
{"lessonTitle": string,
 "scenes": [{"title": string,
             "pedagogicalRole": one of ${JSON.stringify(PEDAGOGICAL_ROLES)},
             "directive": string,
             "focusChunkIds": [chunkId, ...]}]}

DIRECTIVE QUALITY BAR (every directive, 2-4 sentences, ALL of these):
- the CONCRETE example with actual values (the same running example should thread through the whole lesson);
- the programming language (use the source's language; default python);
- what must appear on the board for this beat (hand-walk / runnable code + output / execution trace / comparison table / mistake list / quiz);
- for dry_run scenes: which algorithm on which exact input, and that narration must state each step's decision.
Never write a vague directive like "explain binary search" — an agent must be able to build the scene from your words alone.

HARD RULES:
- Every focusChunkId MUST be one of the provided chunk ids; each scene needs at least one.
- Include AT LEAST one dry_run scene (two when the source covers a brute AND an optimal algorithm).
- Titles are student-facing and specific ("Dry Run: Watching Binary Search Eliminate Half the Array"), not generic.`;

  const user = JSON.stringify({
    task: 'Architect the coding lesson for this source material.',
    chunks: sourcePack.chunks.map((chunk) => ({ chunkId: chunk.id, text: chunk.text })),
  });

  // One honest repair pass: if the plan violates the contract, the Instructor sees the
  // exact problem and fixes it; a second failure raises (never a fake plan).
  let problem = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { json, usage } = await call({
      agent: 'coding_instructor',
      system: problem ? `${system}\n\nYOUR PREVIOUS PLAN WAS REJECTED: ${problem}\nOutput the corrected full JSON.` : system,
      user,
      model: process.env.MODEL_PLANNER || 'qwen3.7-max',
      temperature: 0.4,
      maxTokens: 3500,
    });

    const scenes = (Array.isArray(json.scenes) ? json.scenes : [])
      .map((scene) => ({
        title: String(scene.title || '').trim(),
        pedagogicalRole: PEDAGOGICAL_ROLES.includes(scene.pedagogicalRole) ? scene.pedagogicalRole : 'intuition',
        directive: String(scene.directive || '').trim(),
        focusChunkIds: (scene.focusChunkIds || []).filter((id) => chunkIds.has(id)),
      }))
      .filter((scene) => scene.title && scene.directive && scene.focusChunkIds.length > 0);

    if (scenes.length === 0) {
      problem = 'no valid scenes — every scene needs title, directive, and focusChunkIds drawn from the provided chunk ids.';
      continue;
    }
    if (!scenes.some((scene) => scene.pedagogicalRole === 'dry_run')) {
      problem = 'the plan has no dry_run scene — the step-by-step execution trace is mandatory for a coding lesson.';
      continue;
    }
    return { lessonTitle: String(json.lessonTitle || sourcePack.title).trim(), scenes, usage };
  }
  throw new Error(`Coding Instructor could not produce a valid lesson plan: ${problem}`);
}

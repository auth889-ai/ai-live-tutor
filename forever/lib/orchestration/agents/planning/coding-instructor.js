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

// The arcs world-class coding lessons follow (distilled from how Striver, Shraddha/Apna
// College, Kunal Kushwaha, Love Babbar, Andrew Ng, Angela Yu, Schwarzmüller and
// in28minutes actually teach). Role names stay within the pipeline's vocabulary on
// purpose: 'dry_run' scenes get a REAL execution trace (AlgorithmStage) and
// 'worked_example' scenes get really-executed code — the arcs ride on existing rails.
const CODING_ARC = `FIRST, CLASSIFY the source material into ONE lesson type, then follow THAT arc (merge or drop a beat only when the source truly lacks material for it):

TYPE A — ALGORITHM / DSA (searching, sorting, trees, graphs, DP, two pointers...):
 1. motivate       — the problem in plain words + ONE tiny concrete input/output (the interview question as asked). Board: the problem + the example array/tree drawn out.
 2. intuition      — a physical analogy BEFORE any code (phone book, lockers, a queue of people); the core insight in one sentence a 12-year-old follows.
 3. worked_example — walk the concrete input BY HAND (real values like arr=[2,5,8,12,16,23,38,56], target=23). No code yet — the human process the code will mirror.
 4. worked_example — BRUTE FORCE first (Striver discipline): simplest correct code, actually run, its complexity, and PRECISELY where it wastes work (with a number).
 5. dry_run        — THE HEART: step-by-step execution trace on the concrete input — active code line, pointers, visited/eliminated, stack/queue, trace table — narration states each step's DECISION ("38 > 23, the answer cannot live in the right half — eliminate it").
 6. worked_example — BETTER → OPTIMAL: name the insight that removes the waste, code it, run it, its complexity. A second dry_run when the optimal's mechanics deserve their own trace.
 7. complexity     — brute vs better vs optimal in ONE table, the why in words, not just Big-O.
 8. edge_cases     — COMMON MISTAKES with the exact failing input each (off-by-one, (low+high)/2 overflow, empty, single element, duplicates): the wrong line and the fix.
 9. visualize      — NAME THE PATTERN + recognition cues ("when you see 'sorted' + 'find', reach for this").
10. practice       — 2-3 retrieval questions FROM this lesson (predict a trace step, spot the planted bug, one variation), each with a worked answer.
11. recap          — the journey in 30 seconds (problem → insight → complexity win) + named homework + next-lesson hook.

TYPE B — LANGUAGE / OOP CONCEPT (Python decorators, Java inheritance, closures, pointers...):
 1. intuition      — real-life analogy for the concept (inheritance = family traits; decorator = gift-wrapping).
 2. motivate       — the PAIN without it (Kunal's why-before-what): show the duplicated/ugly "before" code first.
 3. worked_example — numbered definition notes (3-5 crisp, screenshot-able points — Shraddha style) + the SMALLEST runnable program that demonstrates it, run with real output.
 4. visualize      — UNDER THE HOOD: memory/dispatch diagram of what actually happens (boxes and arrows, call stack, object references).
 5. worked_example — 2-3 variations & gotchas, each with an "important point" callout (exam/interview flag).
 6. edge_cases     — the classic misuse with its failing code and the fix.
 7. practice       — pause-and-try challenge BEFORE the solution, then the solution walked through; plus 2 MCQs.
 8. recap          — numbered summary card + homework programs + next-lesson hook.

TYPE C — FRAMEWORK / PROJECT (React state, Express routes, RabbitMQ pub/sub, Docker...):
 1. motivate       — STEP GOAL in project context ("Step N: add live search to our app") + where we are in the build.
 2. intuition      — 2-3 minutes of why/what for exactly the concept this step needs (80-20 rule: the core API only).
 3. worked_example — the NAIVE attempt: do it the obvious way and hit the real error/limitation on screen (error-driven teaching).
 4. worked_example — THE RIGHT WAY: the framework feature as the fix, coded line by line, nothing unexplained, run and shown working.
 5. visualize      — the flow diagram (component tree, request path, message flow through the queue) with the new piece highlighted.
 6. edge_cases     — what goes wrong in production (stale state, lost messages, race) and the guard.
 7. practice       — "now add the same for Y yourself" challenge, then the solution diff.
 8. recap          — the project's growing feature checklist + next step teaser.
For REACT specifically: break the UI into a component tree diagram, show props/state as a flow diagram, and walk the
event flow user click → state update → re-render as a sequence; before/after UI states on the board
("App → TodoInput → TodoList → TodoItem; user types → setState → list re-renders").

TYPE D — SYSTEMS / ARCHITECTURE (microservices, caching, load balancing...):
 1. motivate       — the failure story at scale ("before" architecture with the pain point in red).
 2. intuition      — the tiny 2-3 box version of the system (Ng's tiny-dataset move applied to systems).
 3. visualize      — the PATTERN named (service discovery, pub/sub, circuit breaker) + numbered key properties + the full diagram.
 4. dry_run        — walk ONE request/message through the diagram step by step (the systems dry-run), narration explaining each hop's decision.
 5. worked_example — the smallest working demo (one queue, two services), config/code + the log output proving the flow.
 6. complexity     — trade-offs table: when to use, when NOT, alternatives.
 7. practice       — 2 MCQs on the flow + one "what breaks if X dies?" scenario question.
 8. recap          — this pattern's place in the bigger system + spiral hook ("next we add retries to this same system").
For MESSAGE BROKERS (RabbitMQ/Kafka): the flow is producer → exchange → queue (routing key) → consumer; the dry_run
walks ONE message end to end; the failure beat covers retry + dead-letter; the demo is two tiny services and the logs
proving the message moved ("order service publishes order.created, email service consumes it").

TYPE E — BACKEND / API (REST endpoints, auth, validation...):
 1. motivate       — the real API problem + the client → server → database flow drawn as a sequence.
 2. worked_example — the endpoint CONTRACT first: method, path, request body and response JSON, before any code.
 3. worked_example — the route/controller code with input validation, then RUN the request and show the real response.
 4. edge_cases     — the error paths with their actual responses (invalid body 400, missing auth 401, crash 500) + the security/performance note (injection, N+1, rate limits).
 5. practice       — extend the endpoint or predict the response for a given request; a test for the route.
 6. recap          — the contract recap + next endpoint hook.

TYPE F — DATABASE / SQL (schema design, queries, indexes...):
 1. motivate       — a real app's data problem ("find total sales per customer").
 2. visualize      — the ER diagram (erDiagram) with relationships explained in words.
 3. worked_example — the SQL query, RUN it, show the RESULT TABLE (never a query without its result).
 4. complexity     — indexes/scan-vs-seek when the source covers performance.
 5. edge_cases     — the classic wrong query (missing JOIN condition, NULL trap, cartesian product) with its wrong result shown.
 6. practice       — write the query for a stated question; predict the result rows.
 7. recap.

TYPE G — TESTING / SQA (unit tests, boundaries, TDD...):
 1. motivate       — the requirement card, verbatim.
 2. intuition      — deriving test scenarios from the requirement (boundaries, equivalence classes).
 3. worked_example — the test-case table, then the unit test code — RUN it, watch it FAIL, fix the code, watch it PASS (red-green on screen).
 4. edge_cases     — the boundary values everyone misses (min/max/empty/duplicate) each as a test row.
 5. practice       — write the missing test for a planted bug.
 6. recap          — coverage picture + next requirement hook.

If the material fits none of these exactly, blend the closest arcs over the universal spine:
why it matters → mental model diagram → small concrete example → code walkthrough → run output →
trace/dry-run/debug → common mistake → practice checkpoint → production note → recap + next-step hook.

CROSS-CUTTING RULES (what makes ALL beloved teachers beloved — apply to every scene):
- concrete example before any abstraction or notation; notation late, one symbol at a time;
- every code block is EXECUTED on screen — never show code that doesn't run;
- name the bottleneck/pain BEFORE revealing the solution;
- at least one challenge-before-solution checkpoint per lesson;
- reassure at the hard moment ("don't worry if this isn't clear yet — it will be after the trace");
- end with named homework + an explicit next-lesson hook;
- notes on screen are numbered, dense, screenshot-able.`;

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
- Every lesson includes at least one EXECUTABLE beat: a dry_run trace scene (mandatory for TYPE A and D —
  two for A when the source covers brute AND optimal) or a worked_example with runnable code.
- Every lesson includes a practice scene (retrieval questions with worked answers — never decorative).
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
    if (!scenes.some((scene) => scene.pedagogicalRole === 'dry_run' || scene.pedagogicalRole === 'worked_example')) {
      problem = 'the plan has no executable beat — include a dry_run trace scene (algorithms/systems) or a worked_example with runnable code.';
      continue;
    }
    if (!scenes.some((scene) => scene.pedagogicalRole === 'practice')) {
      problem = 'the plan has no practice scene — retrieval questions with worked answers are mandatory.';
      continue;
    }
    return { lessonTitle: String(json.lessonTitle || sourcePack.title).trim(), scenes, usage };
  }
  throw new Error(`Coding Instructor could not produce a valid lesson plan: ${problem}`);
}

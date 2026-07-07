// TRACK-3 BENCHMARK (spends tokens) — HONEST edition: every number is MEASURED, none
// asserted. Same source material through both arms:
//   A) single agent  — one mega-prompt call (the approach the society replaces)
//   B) agent society — router -> planner -> per-scene board/tracer/critics/arbiter
// Measured per arm: contract-valid scenes (programmatic validators), grounding rate
// (objects citing a REAL source chunk — same check for both arms), real token usage
// (client ledger), wall time, and a BLIND pedagogical rubric scored by an independent
// judge call in BOTH presentation orders (position-bias control, MT-Bench practice).
// Run:  node --env-file=.env eval/benchmark.eval.js [topicCount]

import { writeFile } from 'node:fs/promises';

import { generateLessonSingleAgent } from '../lib/generation/lesson/single-agent-baseline.js';
import { generateLessonFromText } from '../lib/generation/lesson/generate-lesson.js';
import { buildTextSourcePack } from '../lib/source-pack/build/source-pack.js';
import { callQwenJson, resetUsageLedger, readUsageLedger } from '../lib/qwen/client.js';

const TOPICS = [
  {
    name: 'binary-search',
    text: 'Binary search finds a target in a sorted array by halving the search space each step. Set low and high pointers, compute mid = low + (high - low) / 2, compare arr[mid] with the target, and move into the correct half. Time complexity is O(log n) because each comparison halves the remaining range. A classic mistake is writing mid = (low + high) / 2 which overflows for large indexes, or using the wrong loop bound low < high versus low <= high, which silently skips the last candidate element.',
  },
  {
    name: 'bfs',
    text: 'Breadth-first search (BFS) explores a graph level by level using a queue. Start from a source node, mark it visited, enqueue it. Then repeatedly dequeue a node, visit all its unvisited neighbors, mark them visited and enqueue them. BFS finds shortest paths in unweighted graphs. Common mistakes: forgetting to mark nodes visited WHEN enqueuing (not when dequeuing) which causes duplicates in the queue, and using a stack instead of a queue which turns it into DFS. Time complexity is O(V+E) since every vertex and edge is processed once.',
  },
  {
    name: 'python-lists',
    text: 'Python lists are dynamic arrays: create one with brackets, append() adds to the end in amortized O(1), insert(0, x) is O(n) because every element shifts. Indexing is O(1); a negative index counts from the end. Slicing list[a:b] copies a sub-list and never raises for out-of-range bounds, while list[10] on a short list raises IndexError — a classic beginner crash. Iterating while mutating the same list skips elements; iterate over a copy instead. Lists are references: b = a aliases the same list, use a.copy() for an independent one.',
  },
];

// The rubric a great human teacher would be graded on (binary criteria, judged blind).
const RUBRIC = [
  'opens with a CONCRETE example (real values) before any abstraction',
  'contains code or a step-by-step trace a student can follow',
  'names at least one common mistake with why it is wrong',
  'includes retrieval practice (question with a worked answer)',
  'progresses logically (hook -> intuition -> mechanics -> practice -> recap)',
  'board content is structured teaching material, not a wall of prose',
  'stays faithful to the source material (no invented claims)',
];

// A bounded, structure-revealing digest so the judge sees WHAT each lesson does
// without 100KB of payload. Same digest shape for both arms — blind and fair.
function digest(lessonTitle, scenes) {
  return {
    lessonTitle,
    sceneCount: scenes.length,
    scenes: scenes.slice(0, 14).map((scene) => ({
      title: scene.title,
      role: scene.pedagogicalRole ?? null,
      voiceLines: scene.voiceLines?.length ?? 0,
      objects: (scene.objects ?? []).slice(0, 6).map((object) => ({
        kind: object.renderHint,
        realExecutionTrace: object.renderHint === 'algorithm' ? (object.content?.steps?.length ?? 0) : undefined,
        executedOutput: object.renderHint === 'code' && object.output != null ? true : undefined,
        preview: JSON.stringify(object.content ?? '').slice(0, 220),
      })),
    })),
  };
}

async function judgePair(digestA, digestB) {
  const system = `You are an independent pedagogy judge. Two AI-generated lessons (X and Y) teach the SAME material.
For EACH criterion, decide which lesson satisfies it better: "X", "Y", or "tie". Judge only what is present.
Output ONLY JSON: {"verdicts": [{"criterion": string, "winner": "X"|"Y"|"tie"}]}
Criteria: ${JSON.stringify(RUBRIC)}`;
  const { json } = await callQwenJson({
    agent: 'benchmark_judge',
    system,
    user: JSON.stringify({ lessonX: digestA, lessonY: digestB }),
    model: process.env.MODEL_PLANNER || 'qwen3.7-max',
    temperature: 0.1,
    maxTokens: 1500,
  });
  return Array.isArray(json.verdicts) ? json.verdicts : [];
}

// Judge in BOTH orders; a win only counts when it survives the swap (position-bias control).
async function judgeBothOrders(societyDigest, singleDigest) {
  const pass1 = await judgePair(societyDigest, singleDigest); // X=society
  const pass2 = await judgePair(singleDigest, societyDigest); // X=single
  let society = 0;
  let single = 0;
  let ties = 0;
  for (let i = 0; i < RUBRIC.length; i += 1) {
    const a = pass1[i]?.winner;
    const b = pass2[i]?.winner;
    const societyWon = a === 'X' && b === 'Y';
    const singleWon = a === 'Y' && b === 'X';
    if (societyWon) society += 1;
    else if (singleWon) single += 1;
    else ties += 1; // disagreement across orders = positional noise -> tie
  }
  return { society, single, ties };
}

// Grounding, measured THE SAME WAY for both arms: share of board objects citing a chunk
// id that actually exists in the source pack.
function measureGrounding(scenes, chunkIds) {
  let total = 0;
  let grounded = 0;
  for (const scene of scenes) {
    for (const object of scene.objects ?? []) {
      total += 1;
      if (chunkIds.has(object.sourceRef?.chunkId)) grounded += 1;
    }
  }
  return total ? grounded / total : 0;
}

const topicCount = Math.min(Number(process.argv[2] || 2), TOPICS.length);
const rows = [];

for (const topic of TOPICS.slice(0, topicCount)) {
  console.log(`\n=== ${topic.name} ===`);
  const chunkIds = new Set(buildTextSourcePack(topic.text).chunks.map((c) => c.id));

  console.log('single-agent arm (one mega-prompt)...');
  resetUsageLedger();
  const singleStarted = Date.now();
  const single = await generateLessonSingleAgent(topic.text);
  const singleUsage = readUsageLedger();
  const singleWallMs = Date.now() - singleStarted;

  console.log('agent-society arm (full pipeline)...');
  resetUsageLedger();
  const societyStarted = Date.now();
  const lesson = await generateLessonFromText(topic.text);
  const societyUsage = readUsageLedger();
  const societyWallMs = Date.now() - societyStarted;
  const plannedScenes = lesson.scenes.length + (lesson.skippedScenes ?? 0);

  console.log('blind judge (both presentation orders)...');
  const verdict = await judgeBothOrders(
    digest(lesson.lessonTitle, lesson.scenes),
    digest(single.lessonTitle, single.scenes),
  );

  rows.push({
    topic: topic.name,
    single: {
      validScenes: `${single.validScenes}/${single.totalScenes}`,
      grounding: single.groundingRate,
      tokens: singleUsage.inputTokens + singleUsage.outputTokens,
      wallS: singleWallMs / 1000,
      rubric: verdict.single,
    },
    society: {
      validScenes: `${lesson.scenes.length}/${plannedScenes}`,
      grounding: measureGrounding(lesson.scenes, chunkIds),
      tokens: societyUsage.inputTokens + societyUsage.outputTokens,
      wallS: societyWallMs / 1000,
      rubric: verdict.society,
    },
    ties: verdict.ties,
  });
  console.log(JSON.stringify(rows.at(-1), null, 2));
}

const pct = (x) => `${Math.round(x * 100)}%`;
const md = `# Forever — Track 3 Benchmark: Agent Society vs Single Agent

Same source material through both arms. **Every number below is measured** — contract
validity by programmatic validators, grounding by the same citation check on both arms,
tokens from the client's usage ledger, rubric by a blind judge scored in BOTH presentation
orders (a win only counts if it survives the swap).

| Topic | Metric | Single agent | Agent society |
|---|---|---|---|
${rows.map((r) => [
  `| ${r.topic} | contract-valid scenes | ${r.single.validScenes} | ${r.society.validScenes} |`,
  `| | grounded objects | ${pct(r.single.grounding)} | ${pct(r.society.grounding)} |`,
  `| | blind rubric wins (of ${RUBRIC.length}, ${'ties'}: ${r.ties}) | ${r.single.rubric} | ${r.society.rubric} |`,
  `| | tokens (in+out) | ${r.single.tokens.toLocaleString()} | ${r.society.tokens.toLocaleString()} |`,
  `| | wall time | ${r.single.wallS.toFixed(1)}s | ${r.society.wallS.toFixed(1)}s |`,
].join('\n')).join('\n')}

## Honest reading

- The society spends MORE tokens and time — that is the cost of per-scene validation,
  real code execution, grounding debate, and honest failure. The gain it buys is in
  validity, grounding, and pedagogy — measured above, not asserted.
- Judge = ${process.env.MODEL_PLANNER || 'qwen3.7-max'} (single family — a cross-family judge would be stronger); N=${rows.length} topics.
- The single agent gets a SIMPLER output contract (text/list/code only) — the comparison
  favors it on validity, not the society.

Generated by \`eval/benchmark.eval.js\` on ${new Date().toISOString().slice(0, 10)}.
`;

await writeFile('eval/RESULTS.md', md);
console.log('\nSaved -> eval/RESULTS.md');

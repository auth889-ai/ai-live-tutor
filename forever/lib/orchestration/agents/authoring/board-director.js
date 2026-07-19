// Board Director agent: ONE job — turn a SourcePack into region-addressed board objects
// for one scene, DECOMPOSED (user design 2026-07-13 + research: composite JSON is the
// documented failure mode, board success ≈ p^n): plan stubs -> one focused call per
// object in parallel (board/produce-object.js) -> element repair -> object salvage.
// Can also REVISE an existing board given Grounding Auditor objections (whole-board,
// since objections are cross-object).

import { runAgentChain } from '../../../qwen/client.js';
import { validateBoardObjects } from '../../../board/objects/board-objects.js';
import { buildImageIndex, resolveImageIds } from './image-id-mapping.js';
import { coerceBoardObjects } from './board-coercion.js';
import { planBoard } from './board/plan-board.js';
import { produceObject, finalizeBoardObject } from './board/produce-object.js';
import { stripHandAuthoredAnimation } from './board/strip-animation.js';
import { HINT_GUIDES } from './board/hint-guides.js';
import { repairBoardObject } from './element-repair.js';
import { groundAnnotations } from '../vision/ground-annotations.js';
import { LAYOUT_REGIONS } from '../../../board/layout/layout-regions.js';
import { structureViolation } from '../../../board/structures/structure-rules.js';

const SUPPORTED_HINTS = ['text', 'list', 'code', 'diagram', 'chart', 'math', 'image', 'callout', 'quiz', 'manipulable']; // grows as the renderer grows

function boardSystemPrompt(regions, brief) {
  const teachingFocus = brief
    ? `\nTHIS SCENE'S TEACHING ROLE: ${brief.pedagogicalRole}. Directive: ${brief.directive}
Design the board to fulfill that role with DEPTH — concrete example / step-by-step trace /
complexity reasoning as the role requires, not a vague summary.${brief.pedagogicalRole === 'dry_run'
      ? `\nDRY-RUN DIVISION OF LABOUR: a separate Execution Tracer RUNS the real algorithm and its
step-by-step animation panel (code + structure + pointers + queue/stack + trace table) is attached
to this scene automatically. Therefore do NOT hand-author any "trace" or "highlightSequence"
yourself — your board supplies the framing around that animation: the scene title, the concrete
input being traced, and one short callout on what to watch for. 2-3 objects max.`
      : ''}`
    : '';
  return `You are the Board Director of an AI tutor. You design what gets written on the
teaching board for ONE teaching scene. You output ONLY JSON:${teachingFocus}
{"objects":[{"id","objectType","renderHint","region","lineNumber","content","sourceRef":{"chunkId"}}]}
Rules you must never break:
- renderHint must be one of: ${SUPPORTED_HINTS.join(', ')}. content for "list" is {"items":[...]}, for "text"/"code" a string.
- Use "diagram" when a VISUAL explains better than text. Pick the RIGHT diagram for the concept:
  SIMPLE shortcuts:
    {"diagramType":"flowchart","steps":["Step 1","Step 2",...]}         (a linear process)
    {"diagramType":"cycle","steps":["A","B","C"]}                        (a repeating cycle)
    {"diagramType":"tree","root":{"label":"Topic","children":[{"label":"Sub","detail":"..."}]}}
    {"diagramType":"comparison","columns":["X","Y"],"rows":[{"label":"Feature","values":["No","Yes"]}]}
    {"diagramType":"grid","rows":[[1,1,1,1],[1,2,3,4],[1,3,6,10]],"highlight":[[2,3]]}   (a DP TABLE / matrix / 2D board —
      ALWAYS this for grid concepts; a matrix drawn as coordinate-labeled graph nodes is REJECTED)
  ARRAYS (binary search, two-pointer, sliding window, sorting) — show the concrete array:
    {"diagramType":"array","values":["2","5","8","12","16","23","38","56"]}
  DATA STRUCTURES (binary tree, BST, graph, linked list) — output a real laid-out graph:
    {"diagramType":"graph","nodes":[{"id":"1","label":"8"},{"id":"2","label":"3"},{"id":"3","label":"10"}],"edges":[{"from":"1","to":"2"},{"from":"1","to":"3"}],"directed":true}
    (use this for actual tree/graph/linked-list data with node values — it auto-lays-out cleanly)
    For a simple visit ORDER (BFS levels, DFS order), you may add "highlightSequence":["1","2","3"] —
    nodes light up in that order as the clock plays. Every id must be a node id from "nodes".
  STRUCTURE-TRUE RULE: if the scene's concept IS a linked structure (tree/BST/trie/heap/graph/
    linked list), you MUST draw it as diagramType "graph" with its real nodes and edges — node labels
    may carry values/roles ("root: 8", "curr"), edge labels "left"/"right"/"next". A flowchart ABOUT
    a tree is rejected. Human teachers draw the structure itself.
  ANIMATION OWNERSHIP (never violate): you NEVER hand-author step-by-step algorithm traces — any "trace"
    field you output is discarded. Real dry-run animation (active code line, moving pointers, queue/stack,
    growing trace table) is produced by the Execution Tracer agent, which RUNS the real algorithm. Your
    board FRAMES that animation: the concrete input, the structure, and what to watch for.
  RICH diagrams — output raw Mermaid (DECLARE the type on line 1), for example:
    {"diagramType":"mermaid","code":"sequenceDiagram\\n  Client->>Server: SYN\\n  Server->>Client: SYN-ACK\\n  Client->>Server: ACK"}
    classDiagram (OOP: classes, inheritance) · stateDiagram-v2 (state machines, lifecycles) ·
    erDiagram (databases) · architecture-beta (system design) · mindmap · timeline (history) ·
    quadrantChart (SWOT/risk) · gitGraph. Use whichever fits.
  Prefer a diagram for any process, structure, interaction, hierarchy, or comparison — it teaches far better than text.
- CURVES AND GRAPHS OF QUANTITIES (supply/demand, cost curves, loss curves, function plots,
  trajectories): use renderHint "chart" — NEVER mermaid xychart (it cannot draw legends, marked
  points, or shifted-curve ghosts and will be REJECTED). content shape:
  {"xAxis":{"label":"Quantity (scoops)","min":0,"max":300},"yAxis":{"label":"Price ($)","min":0,"max":6},
   "series":[{"id":"demand_old","label":"Demand (before)","style":"ghost","points":[[0,6],[300,0]]},
             {"id":"demand","label":"Demand (after heat wave)","points":[[50,6],[300,1]]},
             {"id":"supply","label":"Supply","points":[[0,1],[300,6]]}],
   "annotations":[{"type":"point","x":150,"y":3,"label":"E1"},{"type":"point","x":200,"y":4,"label":"E2"},
                  {"type":"arrow","from":[120,3.5],"to":[190,3.5],"label":"demand shifts right"},
                  {"type":"vline","x":150},{"type":"region","x1":150,"x2":250,"label":"shortage"}]}
  Rules: every point INSIDE the axis ranges · every series labeled (the legend shows them) ·
  a SHIFT keeps the old curve as style "ghost" with the same id stem ("demand_old"/"demand" share
  a color) plus an arrow annotation — the student must SEE the curve move · name equilibria with
  "point" annotations. Annotation types are EXACTLY point/vline/hline/arrow/region — nothing else.
  2-6 series maximum. NEVER an empty/blank chart template: always draw the real curves and let the
  narration reveal the answer. A chart is a FACTUAL object: it carries "sourceRef" citing the chunk
  its numbers/relationships come from, like every other object.
- GROUNDING LABEL (never skip): EVERY object carries either "sourceRef":{"chunkId":"..."} (its
  facts come from the source) or "grounding":"analogy" (a teaching device YOU invented: a hook,
  a practice question, a scenario, a conceptual drawing). An object with neither is REJECTED.
- NUMBER HONESTY (gate-enforced downstream — a violation gets your object REWRITTEN or DROPPED):
  every figure of 2+ digits inside any content STRING (a table cell, a node label, a chart
  annotation label, a callout body, an example) must appear in the source material or be derived
  by arithmetic FROM source figures with the derivation shown. NEVER decorate an example, diagram
  or scenario with invented sample numbers ("customer 84 spent 477") — a teaching device either
  uses the source's OWN figures or stays number-free (structure and labels, no fake values).
- Use "math" for equations/formulas (KaTeX LaTeX). content is {"latex":"E = mc^2"} for one equation,
  or {"steps":[{"latex":"x + 2 = 5","note":"start"},{"latex":"x = 3","note":"subtract 2"}]} for a step-by-step derivation.
- IMAGES: if availableImages below is non-empty and any of them is relevant to THIS scene, you MUST place it
  with an "image" object and teach FROM it (this is a source-grounded document — show its real diagrams and
  pages, don't just describe them). content is {"url": <the imageId from availableImages, e.g. "fig_003" —
  write the ID exactly; the system resolves it to the real file, and an unknown id is DELETED>, "alt": <what it shows>,
  "caption": <short caption>, "page": <its source page number, copy from availableImages when present>,
  "bbox": {"x","y","w","h"} (OPTIONAL, all normalized 0-1) to highlight the exact part you are teaching —
  the full image always stays visible (never cropped), the highlight draws ON TOP.
  TEACH ON the image with "annotations": an ordered list of teaching marks revealed AS YOU SPEAK:
    [{"verb":"encircle","bbox":{...}}, {"verb":"arrow","bbox":{...},"text":"fact table"},
     {"verb":"underline"|"cross_out"|"highlight"|"pointer","bbox":{...}}, {"verb":"label","bbox":{...},"text":"..."}]
  Order them to match your narration (first thing you mention = first annotation). 2-5 marks, each on the
  exact region it refers to. Prefer a "figure" when one
  matches; use a "page" render when the page's own layout/pictures ARE the lesson (a diagram beside its text).
- Use "callout" for a striking teacher card. content is {"variant": one of mistake|checkpoint|recap|tip|analogy|insight, "body": string or [items]}. Use "mistake" for the common-mistake beat, "recap" for key takeaways, "checkpoint" to pause and think. Use sparingly, for emphasis.
- Use "quiz" for a checkpoint question (practice/checkpoint scenes). content is {"question": string, "choices": ['A','B',...], "answerIndex": int, "explanation": string}. The lesson pauses until the student answers.
- objectType is a free descriptive snake_case name YOU invent for this subject.
- region must be one of: ${Object.keys(regions).join(', ')}. lineNumber is 0-INDEXED: 0..maxLines-1.
- NEVER output x/y coordinates.
- Every FACTUAL object MUST cite sourceRef.chunkId from the provided chunks — claims come from the source.
  A teaching device YOU invent — an analogy, an opening hook, a motivational callout — cites nothing real,
  so it carries "grounding":"analogy" INSTEAD of a sourceRef. Never put source facts in an analogy object,
  and never dress an invented analogy in a sourceRef.
- 2 to 4 objects: a short title first, then the teaching content. Write like a great teacher's board: compact, structured, concrete.`;
}

function boardUser(sourcePack, regions) {
  // Offer described figures (vision-read or content_list-captioned) AND full-page renders
  // BY ID ONLY — the model places "fig_003", never a path it could misremember; the
  // deterministic post-pass (resolveImageIds) substitutes the real url.
  const availableImages = buildImageIndex(sourcePack).available;
  return JSON.stringify({
    task: 'Design the board for one teaching scene from this source material.',
    layoutRegions: Object.fromEntries(
      Object.entries(regions).map(([name, region]) => [name, { maxLines: region.maxLines ?? null, role: region.role }]),
    ),
    chunks: sourcePack.chunks.map((chunk) => ({ chunkId: chunk.id, text: chunk.text })),
    availableImages,
  });
}

async function runBoardCall({ system, user, sourcePack, layout, brief = null }) {
  const imageIndex = buildImageIndex(sourcePack);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const repair = attempt === 0 ? '' : `\nYour previous output was rejected: ${lastError}. Fix exactly that and output the full JSON again.`;
    // 10k budget: qwen3.7-plus spends 1.5-3k tokens REASONING before it writes (measured:
    // 1,621 reasoning tokens on a trivial prompt), and a rich 4-object board is 2-3k more.
    // At the old 4k cap the model ran dry and closed with "{}" — which parses, validates as
    // "At least one board object is required", and silently killed the richest scenes.
    const { json, usage } = await runAgentChain({ agent: 'board_director', system: system + repair, user, maxTokens: 10_000 });
    if (!Array.isArray(json.objects) || json.objects.length === 0) {
      lastError = 'output had no "objects" array — return the full board JSON';
      continue;
    }
    try {
      // Image ids -> real urls; an image object citing an UNKNOWN id is a hallucinated
      // source and is deleted before it can reach a student (the OpenMAIC contract).
      const { objects: resolved, dropped } = resolveImageIds(json.objects, imageIndex);
      for (const id of dropped) console.error(`[board] image object "${id}" cited an unknown imageId — deleted (hallucinated source)`);
      // Deterministic shape coercion BEFORE validation — 62% of drops were mechanical shape
      // slips on content that was otherwise fine (see board-coercion.js).
      const objects = coerceBoardObjects(stripHandAuthoredAnimation(resolved, brief), { layout, brief });
      validateBoardObjects(objects, layout);
      for (const object of objects) {
        if (object.decorative === true || object.grounding === 'analogy') continue; // cites nothing by design
        if (!sourcePack.chunks.some((chunk) => chunk.id === object.sourceRef?.chunkId)) {
          throw new Error(`object ${object.id} cites unknown chunk ${object.sourceRef?.chunkId} — copy ONE of the real chunkIds EXACTLY: ${sourcePack.chunks.slice(0, 8).map((chunk) => chunk.id).join(', ')}`);
        }
      }
      // Structure-true rule (classify-then-constrain): a tree/graph concept must be DRAWN
      // as its structure — a flowchart about a tree is rejected and repaired.
      const violation = structureViolation(objects, brief);
      if (violation) throw new Error(violation);
      return { objects, usage };
    } catch (error) {
      lastError = error.message;
    }
  }
  throw new Error(`Board Director failed contract validation after repair: ${lastError}`);
}

export async function designBoard({ sourcePack, layout = 'teacher_notebook_code', brief = null, domain = 'general', call = runAgentChain }) {
  const regions = LAYOUT_REGIONS[layout];
  if (!regions) throw new Error(`Unknown layout: ${layout}`);
  const imageIndex = buildImageIndex(sourcePack);

  const plan = await planBoard({ sourcePack, regions, brief, imageIndex, call });
  const fallbackRegion = Object.keys(regions)[0];
  const produced = await Promise.all(plan.stubs.map((stub, index) => produceObject({
    stub: {
      ...stub,
      id: stub.id?.trim() || `obj_${index + 1}`,
      // A misremembered region name is a mechanical slip, not a reason to lose an object.
      region: regions[stub.region] ? stub.region : fallbackRegion,
    },
    sourcePack, layout, brief, imageIndex, call,
  })));

  const objects = [];
  const seen = new Set();
  for (const result of produced) {
    if (result.object && !seen.has(result.object.id)) {
      objects.push(result.object);
      seen.add(result.object.id);
    }
  }
  // A board must still have a teachable core: at least one non-decorative content object.
  if (!objects.some((o) => o.decorative !== true)) {
    throw new Error(`Board Director failed contract validation after repair: no teachable object survived (${plan.stubs.length} planned)`);
  }

  // STRUCTURE GUARANTEES (deterministic, content stays AI-written):
  // 1. The Teacher assigned this scene source FIGURES to teach from -> every one of them
  //    lands on the board (live-caught: 24 figures offered at board level, 1 placed —
  //    encouragement loses to habit; guarantees don't).
  for (const figureId of brief?.focusFigureIds ?? []) {
    const asset = imageIndex.mapping.get(figureId);
    if (!asset || objects.some((o) => o.renderHint === 'image' && o.content?.url === asset.url)) continue;
    const result = await produceObject({
      stub: {
        id: `figure_${figureId}`,
        renderHint: 'image',
        region: fallbackRegion,
        purpose: `Teach FROM the source figure "${asset.caption}"${asset.page ? ` (page ${asset.page})` : ''}: place it with 2-5 teaching annotations (encircle/arrow/label) tied to this scene's goal, ordered to match the narration.`,
      },
      sourcePack, layout, brief, imageIndex, call,
    });
    if (result.object) objects.push(result.object);
  }
  // 2. A practice scene without a QUIZ is a checkpoint that cannot check (the universal
  //    gate rule, enforced live-caught: a 7-scene lesson shipped zero quizzes).
  if (brief?.pedagogicalRole === 'practice' && !objects.some((o) => o.renderHint === 'quiz')) {
    const result = await produceObject({
      stub: {
        id: 'checkpoint_quiz',
        renderHint: 'quiz',
        region: fallbackRegion,
        purpose: `A quiz checkpoint for this scene's goal: ${brief.directive} — concrete values, plausible wrong choices, an explanation that teaches.`,
      },
      sourcePack, layout, brief, imageIndex, call,
    });
    if (result.object) objects.push(result.object);
  }

  // 2b. MAZUR COMMIT (physics register: PREDICT-AND-COMMIT before every reveal — live round 1:
  //     'The Bet You'll Lose' FRAMED the bet but never made the student commit). A physics
  //     motivate/hook scene without a quiz gets a committed-prediction checkpoint.
  if (domain === 'physics' && ['motivate', 'hook'].includes(brief?.pedagogicalRole)
    && !objects.some((o) => o.renderHint === 'quiz')) {
    const result = await produceObject({
      stub: {
        id: 'staked_prediction',
        renderHint: 'quiz',
        region: fallbackRegion,
        purpose: `The STAKED PREDICTION for this scene's hook: ${brief.directive} — an MCQ whose choices are the plausible predictions (including the popular WRONG one); the student must commit BEFORE the reveal. The explanation confronts the wrong intuition with the evidence.`,
      },
      sourcePack, layout, brief, imageIndex, call,
    });
    if (result.object) objects.push(result.object);
  }

  // 3. The MANIPULATE beat (live-caught 2026-07-15: an ML lesson's "The Threshold is YOUR
  //    Decision" scene shipped a static chart while the Pedagogy Critic objected "no parameter
  //    adjustment required" — soft planner guidance lost to habit, exactly like figures did).
  //    In a quantitative domain, when the scene's own directive IS a cause-effect idea, the
  //    board gets a manipulable: the student drags the parameter and the curve recomputes.
  const QUANT_DOMAINS = new Set(['ml_ai', 'math', 'physics', 'economics', 'business_finance']);
  const CAUSE_EFFECT = /threshold|learning rate|steep|slope|coefficient|parameter|elasticity|shift|trade-?off|angle|gravity|velocity|speed|force|mass|launch|what happens (when|if)|what changes|as .{0,24}(increases|decreases|rises|falls|changes|doubles)/i;
  // Placement discipline (live round-2: 5 of 9 scenes got sliders, recap+practice duplicating
  // the threshold one) — the guarantee fires only on CONTENT scenes where the cause-effect is
  // being TAUGHT; recap/practice may still get one organically from the planner, never forced.
  const MANIPULATE_ROLES = new Set(['intuition', 'mechanism', 'worked_example', 'dry_run', 'edge_cases', 'application', 'misconception', 'visualize', 'complexity']);
  const sceneIdea = `${brief?.title ?? ''} ${brief?.directive ?? ''}`;
  if (QUANT_DOMAINS.has(domain) && MANIPULATE_ROLES.has(brief?.pedagogicalRole)
    && CAUSE_EFFECT.test(sceneIdea) && !objects.some((o) => o.renderHint === 'manipulable')) {
    const result = await produceObject({
      stub: {
        id: 'manipulate_it',
        renderHint: 'manipulable',
        region: fallbackRegion,
        purpose: `The MANIPULATE beat for this scene's cause-effect idea: ${brief.directive} — pick the ONE parameter the student should change, choose a whitelisted formula that honestly models the relationship, set axes that hold the curve across the whole parameter range, and ALWAYS include the predict question (commit before reveal).`,
      },
      sourcePack, layout, brief, imageIndex, call,
    });
    if (result.object) objects.push(result.object);
  }

  // 4. VISION-GROUNDED annotations: the Board Director is a TEXT model — its annotation
  //    bboxes are guesses (live user report: marks landed on the wrong parts). Real boxes
  //    come from the Vision Grounding agent looking at the pixels; a mark it cannot locate
  //    is dropped, and if vision is unavailable the annotations go entirely — a wrong
  //    pointer teaches worse than no pointer.
  for (const object of objects) {
    if (object.renderHint !== 'image' || !object.content?.annotations?.length) continue;
    const url = String(object.content.url ?? '');
    if (/^https?:\/\//.test(url)) continue; // no local pixels to read
    try {
      const mime = /\.png$/i.test(url) ? 'image/png' : 'image/jpeg';
      const { annotations, dropped } = await groundAnnotations({ imagePath: url, mime, annotations: object.content.annotations });
      if (dropped?.length) console.error(`[board] ${object.id}: ${dropped.length} annotation(s) not visually locatable — dropped (${dropped.slice(0, 3).join(' | ')})`);
      object.content = { ...object.content, annotations };
    } catch (error) {
      console.error(`[board] ${object.id}: vision grounding unavailable (${String(error?.message).slice(0, 80)}) — annotations removed rather than mis-pointed`);
      const { annotations: removed, ...content } = object.content;
      object.content = content;
    }
  }

  // Structure-true rule names its offending object — element-repair it (live v10: a whole
  // edge_cases scene died because ONE decision tree was drawn as a flowchart).
  const structured = await repairStructureViolation(objects, { sourcePack, layout, brief, imageIndex, call });
  return { objects: structured, usage: [plan.usage, ...produced.flatMap((r) => r.usages)].filter(Boolean)[0] ?? null };
}

async function repairStructureViolation(objects, { sourcePack, layout, brief, imageIndex, call }) {
  let violation = structureViolation(objects, brief);
  if (!violation) return objects;
  const id = violation.match(/^object (\S+):/)?.[1];
  const index = objects.findIndex((object) => object.id === id);
  if (index >= 0) {
    const offender = objects[index];
    const next = [...objects];
    try {
      const repaired = await repairBoardObject({ object: offender, error: violation, brief, hintGuide: HINT_GUIDES[offender.renderHint], call });
      next[index] = finalizeBoardObject({ ...repaired.object, id: offender.id, region: offender.region }, { sourcePack, layout, brief, imageIndex });
    } catch (error) {
      console.error(`[board] structure repair failed for "${offender.id}" — dropping the object: ${String(error?.message).slice(0, 160)}`);
      next.splice(index, 1);
    }
    if (next.some((object) => object.decorative !== true)) {
      violation = structureViolation(next, brief);
      if (!violation) return next;
    }
  }
  throw new Error(violation);
}

// Revise the board to answer critic objections — DECOMPOSED like first production (live
// v10: the whole-board revise mega-call was the top scene killer, re-rolling every healthy
// object and reintroducing random contract errors). Only OBJECTED objects are re-produced;
// an objected object that cannot be repaired leaves alone (the auditor wanted it changed
// anyway); healthy objects are never touched.
export async function reviseBoard({ sourcePack, layout, previousObjects, objections, brief = null, call = runAgentChain }) {
  const regions = LAYOUT_REGIONS[layout];
  if (!regions) throw new Error(`Unknown layout: ${layout}`);
  const imageIndex = buildImageIndex(sourcePack);

  const byObject = new Map();
  const unattributed = [];
  for (const message of objections) {
    const objectId = message.evidenceRefs?.find((ref) => ref.objectId)?.objectId;
    if (objectId && previousObjects.some((object) => object.id === objectId)) {
      byObject.set(objectId, [...(byObject.get(objectId) ?? []), message.body]);
    } else {
      unattributed.push(message.body);
    }
  }

  const revised = await Promise.all(previousObjects.map(async (object) => {
    const complaints = byObject.get(object.id);
    if (!complaints) return object; // healthy objects are NEVER re-rolled
    const error = `Critic objections to this object: ${[...complaints, ...unattributed].join(' ; ')}`;
    try {
      const repaired = await repairBoardObject({ object, error, brief, hintGuide: HINT_GUIDES[object.renderHint], call });
      return finalizeBoardObject({ ...repaired.object, id: object.id, renderHint: object.renderHint, region: object.region }, { sourcePack, layout, brief, imageIndex });
    } catch (revisionError) {
      console.error(`[board] revision dropped object "${object.id}" (objected + unrepairable): ${String(revisionError?.message).slice(0, 160)}`);
      return null;
    }
  }));

  const objects = revised.filter(Boolean);
  if (!objects.some((object) => object.decorative !== true)) {
    throw new Error('Board Director failed contract validation after repair: revision left no teachable object');
  }
  return { objects, usage: null };
}

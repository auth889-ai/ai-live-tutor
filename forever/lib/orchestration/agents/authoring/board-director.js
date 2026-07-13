// Board Director agent: ONE job — turn a SourcePack into region-addressed board
// objects for one scene. Free objectType (invents subject-appropriate names),
// closed renderHints, every object cites a REAL chunk. Validated against the
// board-object contract; one repair round; then honest failure.
// Can also REVISE an existing board given Grounding Auditor objections.

import { callQwenJson } from '../../../qwen/client.js';
import { validateBoardObjects } from '../../../board/objects/board-objects.js';
import { buildImageIndex, resolveImageIds } from './image-id-mapping.js';
import { coerceBoardObjects } from './board-coercion.js';
import { LAYOUT_REGIONS } from '../../../board/layout/layout-regions.js';
import { structureViolation } from '../../../board/structures/structure-rules.js';

const SUPPORTED_HINTS = ['text', 'list', 'code', 'diagram', 'chart', 'math', 'image', 'callout', 'quiz']; // grows as the renderer grows

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

// STRUCTURAL division of labour (never trust prompt obedience alone): algorithm state over
// time comes ONLY from the Execution Tracer, which ran the real code. A hand-authored
// "trace" is an IMAGINED animation — stripped from every scene, deterministically, before
// validation (this was the top scene-killer: invented traces failing the contract).
// highlightSequence (a simple visit order) stays allowed, except in dry_run scenes where
// the tracer owns all animation.
function stripHandAuthoredAnimation(objects, brief) {
  if (!Array.isArray(objects)) return objects;
  const dryRun = brief?.pedagogicalRole === 'dry_run';
  return objects.map((object) => {
    if (object?.renderHint !== 'diagram' || !object.content || typeof object.content !== 'object') return object;
    const { trace, highlightSequence, ...content } = object.content;
    if (!dryRun && highlightSequence !== undefined) content.highlightSequence = highlightSequence;
    return { ...object, content };
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
    const { json, usage } = await callQwenJson({ agent: 'board_director', system: system + repair, user, maxTokens: 10_000 });
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
          throw new Error(`object ${object.id} cites unknown chunk ${object.sourceRef?.chunkId}`);
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

export async function designBoard({ sourcePack, layout = 'teacher_notebook_code', brief = null }) {
  const regions = LAYOUT_REGIONS[layout];
  if (!regions) throw new Error(`Unknown layout: ${layout}`);
  return runBoardCall({ system: boardSystemPrompt(regions, brief), user: boardUser(sourcePack, regions), sourcePack, layout, brief });
}

// Revise the board to answer specific Grounding Auditor objections.
export async function reviseBoard({ sourcePack, layout, previousObjects, objections, brief = null }) {
  const regions = LAYOUT_REGIONS[layout];
  if (!regions) throw new Error(`Unknown layout: ${layout}`);
  const complaints = objections
    .map((message) => {
      const objectId = message.evidenceRefs.find((ref) => ref.objectId)?.objectId;
      return `- object "${objectId}": ${message.body}`;
    })
    .join('\n');
  const system = `${boardSystemPrompt(regions, brief)}
The Grounding Auditor rejected your previous board. Fix EXACTLY these grounding problems —
rewrite or remove the offending objects so every claim is supported by its cited chunk:
${complaints}`;
  const user = `${boardUser(sourcePack, regions)}\n\nYour previous (rejected) board was:\n${JSON.stringify(previousObjects)}`;
  return runBoardCall({ system, user, sourcePack, layout, brief });
}

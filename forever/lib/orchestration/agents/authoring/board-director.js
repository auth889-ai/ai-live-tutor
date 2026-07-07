// Board Director agent: ONE job — turn a SourcePack into region-addressed board
// objects for one scene. Free objectType (invents subject-appropriate names),
// closed renderHints, every object cites a REAL chunk. Validated against the
// board-object contract; one repair round; then honest failure.
// Can also REVISE an existing board given Grounding Auditor objections.

import { callQwenJson } from '../../../qwen/client.js';
import { validateBoardObjects } from '../../../board/objects/board-objects.js';
import { LAYOUT_REGIONS } from '../../../board/layout/layout-regions.js';

const SUPPORTED_HINTS = ['text', 'list', 'code', 'diagram', 'math', 'image', 'callout', 'quiz']; // grows as the renderer grows

function boardSystemPrompt(regions, brief) {
  const teachingFocus = brief
    ? `\nTHIS SCENE'S TEACHING ROLE: ${brief.pedagogicalRole}. Directive: ${brief.directive}
Design the board to fulfill that role with DEPTH — concrete example / step-by-step trace /
complexity reasoning as the role requires, not a vague summary.`
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
  ARRAYS (binary search, two-pointer, sliding window, sorting) — output a real array with a dry-run trace:
    {"diagramType":"array","values":["1","3","5","7","9","11","13"],"trace":[
      {"note":"low=0, high=6, mid=3 -> arr[3]=7. Target 11 > 7, discard left half.","current":3,"pointers":{"low":0,"mid":3,"high":6}},
      {"note":"low=4, high=6, mid=5 -> arr[5]=11. Found it!","current":5,"eliminated":[0,1,2,3],"pointers":{"low":4,"mid":5,"high":6}}]}
    "values" are the cells (index-labelled automatically). Each trace step is ONE logical move: "note" is the
    plain-English state (comparisons + the decision), "pointers" map names (low/mid/high, i/j, slow/fast) to cell
    INDICES and ride above those cells, "eliminated" are indices ruled out (grey/strike-through), "current" is the
    index examined NOW (orange). The array animates through the steps SYNCED to your narration — a teacher moving
    their finger across the array. THIS is how you teach binary search / two-pointer / sliding window — never a
    static table. Group micro-moves into logical steps (4–10, one per real decision).
  DATA STRUCTURES (binary tree, BST, graph, linked list) — output a real laid-out graph:
    {"diagramType":"graph","nodes":[{"id":"1","label":"8"},{"id":"2","label":"3"},{"id":"3","label":"10"}],"edges":[{"from":"1","to":"2"},{"from":"1","to":"3"}],"directed":true}
    (use this for actual tree/graph/linked-list data with node values — it auto-lays-out cleanly)
    For a TRAVERSAL (BFS/DFS/visit order), add "highlightSequence":["1","2","3"] — nodes light up in that order as the clock plays.
    DRY-RUN TRACE (the BEST way to teach a search/traversal — a real teacher WALKS the structure): add
      "trace":[{"note":"low=0, high=6, mid=3 -> arr[3]=8, too big, go left","current":"4","visited":["1"],"pointers":{"low":"2","mid":"4","high":"7"}},{"note":"...","current":"2","pointers":{...}}]
    Each step is ONE logical move: "note" is the plain-English state (comparisons, decisions), "current" is the node
    being examined NOW (highlights orange), "visited" are nodes already ruled out/walked (stay green), "pointers" ride
    ON nodes (low/mid/high, slow/fast, curr/prev). The graph animates through these steps SYNCED to your narration —
    so the tutor points and explains while the algorithm moves. USE THIS for binary search, BST insert/search, tree/graph
    traversal, two-pointer, linked-list walks. Group micro-moves into logical steps (aim for 4–10 steps, one per real decision).
  RICH diagrams — output raw Mermaid (DECLARE the type on line 1), for example:
    {"diagramType":"mermaid","code":"sequenceDiagram\\n  Client->>Server: SYN\\n  Server->>Client: SYN-ACK\\n  Client->>Server: ACK"}
    classDiagram (OOP: classes, inheritance) · stateDiagram-v2 (state machines, lifecycles) ·
    erDiagram (databases) · architecture-beta (system design) · mindmap · timeline (history) ·
    quadrantChart (SWOT/risk) · xychart-beta (graphs) · gitGraph. Use whichever fits.
  Prefer a diagram for any process, structure, interaction, hierarchy, or comparison — it teaches far better than text.
- Use "math" for equations/formulas (KaTeX LaTeX). content is {"latex":"E = mc^2"} for one equation,
  or {"steps":[{"latex":"x + 2 = 5","note":"start"},{"latex":"x = 3","note":"subtract 2"}]} for a step-by-step derivation.
- IMAGES: if availableImages below is non-empty and any figure is relevant to THIS scene, you MUST place it
  with an "image" object and teach FROM it (this is a source-grounded document — show its real diagrams, don't
  just describe them). content is {"url": <exact url from availableImages>, "alt": <what it shows>, "caption": <short caption>}.
- Use "callout" for a striking teacher card. content is {"variant": one of mistake|checkpoint|recap|tip|analogy|insight, "body": string or [items]}. Use "mistake" for the common-mistake beat, "recap" for key takeaways, "checkpoint" to pause and think. Use sparingly, for emphasis.
- Use "quiz" for a checkpoint question (practice/checkpoint scenes). content is {"question": string, "choices": ['A','B',...], "answerIndex": int, "explanation": string}. The lesson pauses until the student answers.
- objectType is a free descriptive snake_case name YOU invent for this subject.
- region must be one of: ${Object.keys(regions).join(', ')}. lineNumber is an integer within the region's capacity.
- NEVER output x/y coordinates.
- Every object MUST cite sourceRef.chunkId from the provided chunks — only claims supported by the source.
- 2 to 4 objects: a short title first, then the teaching content. Write like a great teacher's board: compact, structured, concrete.`;
}

function boardUser(sourcePack, regions) {
  // Only offer described figures — an image without a caption isn't teachable yet.
  const availableImages = (sourcePack.assets ?? [])
    .filter((asset) => asset.kind === 'figure' && asset.caption?.trim())
    .map((asset) => ({ url: asset.url, caption: asset.caption }));
  return JSON.stringify({
    task: 'Design the board for one teaching scene from this source material.',
    layoutRegions: Object.fromEntries(
      Object.entries(regions).map(([name, region]) => [name, { maxLines: region.maxLines ?? null, role: region.role }]),
    ),
    chunks: sourcePack.chunks.map((chunk) => ({ chunkId: chunk.id, text: chunk.text })),
    availableImages,
  });
}

async function runBoardCall({ system, user, sourcePack, layout }) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const repair = attempt === 0 ? '' : `\nYour previous output was rejected: ${lastError}. Fix exactly that and output the full JSON again.`;
    const { json, usage } = await callQwenJson({ agent: 'board_director', system: system + repair, user });
    try {
      const objects = json.objects;
      validateBoardObjects(objects, layout);
      for (const object of objects) {
        if (!sourcePack.chunks.some((chunk) => chunk.id === object.sourceRef?.chunkId)) {
          throw new Error(`object ${object.id} cites unknown chunk ${object.sourceRef?.chunkId}`);
        }
      }
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
  return runBoardCall({ system: boardSystemPrompt(regions, brief), user: boardUser(sourcePack, regions), sourcePack, layout });
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
  return runBoardCall({ system, user, sourcePack, layout });
}

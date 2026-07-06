// Board Director agent: ONE job — turn a SourcePack into region-addressed board
// objects for one scene. Free objectType (invents subject-appropriate names),
// closed renderHints, every object cites a REAL chunk. Validated against the
// board-object contract; one repair round; then honest failure.
// Can also REVISE an existing board given Grounding Auditor objections.

import { callQwenJson } from '../../qwen/client.js';
import { validateBoardObjects } from '../../board/objects/board-objects.js';
import { LAYOUT_REGIONS } from '../../board/layout/layout-regions.js';

const SUPPORTED_HINTS = ['text', 'list', 'code']; // grows as the renderer grows

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
- objectType is a free descriptive snake_case name YOU invent for this subject.
- region must be one of: ${Object.keys(regions).join(', ')}. lineNumber is an integer within the region's capacity.
- NEVER output x/y coordinates.
- Every object MUST cite sourceRef.chunkId from the provided chunks — only claims supported by the source.
- 2 to 4 objects: a short title first, then the teaching content. Write like a great teacher's board: compact, structured, concrete.`;
}

function boardUser(sourcePack, regions) {
  return JSON.stringify({
    task: 'Design the board for one teaching scene from this source material.',
    layoutRegions: Object.fromEntries(
      Object.entries(regions).map(([name, region]) => [name, { maxLines: region.maxLines ?? null, role: region.role }]),
    ),
    chunks: sourcePack.chunks.map((chunk) => ({ chunkId: chunk.id, text: chunk.text })),
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

import { getRegion, validateRegionLine } from '../layout/layout-regions.js';
import { validateSourceRef } from '../../source-pack/refs/source-refs.js';
import { validateDiagramContent } from '../diagrams/diagram-content.js';
import { validateMathContent } from '../math/render-math.js';
import { validateImageContent } from '../image/image-content.js';
import { validateCalloutContent } from '../callout/callout-content.js';
import { validateQuizContent } from '../quiz/quiz-content.js';
import { validateExecutionTrace } from '../execution/execution-trace.js';

// Rendering hints are a closed set the renderer understands. objectType stays a FREE
// string so agents can invent subject-appropriate objects (reaction_mechanism,
// chord_diagram, battle_map_annotation) — hardcode TYPES of rendering, never content.
export const RENDER_HINTS = Object.freeze([
  'text',
  'list',
  'table',
  'diagram',
  'code',
  'math',
  'image',
  'callout',
  'quiz',
  'timeline',
  'annotation',
  'algorithm', // a full ExecutionTrace rendered by the clock-driven AlgorithmStage (DSA/ML dry run)
]);

export function validateBoardObject(object, layout) {
  if (!object.id?.trim()) throw new Error('boardObject.id is required');
  const context = `boardObject ${object.id}`;
  if ('x' in object || 'y' in object) {
    throw new Error(`${context} must not carry raw x/y coordinates — agents output layout/region/lineNumber only`);
  }
  if (!object.objectType?.trim()) throw new Error(`${context}.objectType is required`);
  // Unambiguous synonyms are normalized instead of rejected (measured live: a practice scene
  // died because the model wrote renderHint "graph" for a tree picture — it meant "diagram").
  const HINT_ALIASES = { graph: 'diagram', tree: 'diagram', flowchart: 'diagram', chart: 'diagram', note: 'callout', bullet_list: 'list' };
  if (HINT_ALIASES[object.renderHint]) object.renderHint = HINT_ALIASES[object.renderHint];
  if (!RENDER_HINTS.includes(object.renderHint)) {
    throw new Error(`${context}.renderHint must be one of ${RENDER_HINTS.join(', ')}`);
  }
  getRegion(layout, object.region);
  if (object.lineNumber !== undefined) validateRegionLine(layout, object.region, object.lineNumber);
  if (!hasContent(object.content)) throw new Error(`${context}.content is required and must be non-empty`);
  if (object.renderHint === 'diagram') validateDiagramContent(object.content, context);
  if (object.renderHint === 'math') validateMathContent(object.content, context);
  if (object.renderHint === 'image') validateImageContent(object.content, context);
  if (object.renderHint === 'callout') validateCalloutContent(object.content, context);
  if (object.renderHint === 'quiz') validateQuizContent(object.content, context);
  if (object.renderHint === 'algorithm') validateExecutionTrace(object.content, context);
  // Source proof is for FACTS. A teaching device the AI invents — an analogy, a hook, a
  // motivational callout — has no source chunk by nature; it declares grounding:"analogy"
  // instead of faking a citation (measured live: motivate/intuition scenes died for lacking
  // sourceRefs on analogies). The Grounding Auditor still audits it against the source.
  if (object.decorative !== true && object.grounding !== 'analogy') {
    if (!object.sourceRef) {
      throw new Error(`${context} needs a sourceRef — every factual board object carries source proof (a teaching analogy may declare "grounding":"analogy" instead)`);
    }
    validateSourceRef(object.sourceRef, `${context}.sourceRef`);
  }
  return object;
}

export function validateBoardObjects(objects, layout) {
  if (!objects?.length) throw new Error('At least one board object is required');
  const ids = new Set();
  for (const object of objects) {
    validateBoardObject(object, layout);
    if (ids.has(object.id)) throw new Error(`Duplicate board object id: ${object.id}`);
    ids.add(object.id);
  }
  return objects;
}

function hasContent(content) {
  if (typeof content === 'string') return content.trim().length > 0;
  if (content && typeof content === 'object') return Object.keys(content).length > 0;
  return false;
}

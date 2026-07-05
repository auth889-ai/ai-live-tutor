import { getRegion, validateRegionLine } from '../layout/layout-regions.js';
import { validateSourceRef } from '../../source-pack/refs/source-refs.js';

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
  'timeline',
  'annotation',
]);

export function validateBoardObject(object, layout) {
  if (!object.id?.trim()) throw new Error('boardObject.id is required');
  const context = `boardObject ${object.id}`;
  if ('x' in object || 'y' in object) {
    throw new Error(`${context} must not carry raw x/y coordinates — agents output layout/region/lineNumber only`);
  }
  if (!object.objectType?.trim()) throw new Error(`${context}.objectType is required`);
  if (!RENDER_HINTS.includes(object.renderHint)) {
    throw new Error(`${context}.renderHint must be one of ${RENDER_HINTS.join(', ')}`);
  }
  getRegion(layout, object.region);
  if (object.lineNumber !== undefined) validateRegionLine(layout, object.region, object.lineNumber);
  if (!hasContent(object.content)) throw new Error(`${context}.content is required and must be non-empty`);
  if (object.decorative !== true) {
    if (!object.sourceRef) {
      throw new Error(`${context} needs a sourceRef — every factual board object carries source proof`);
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

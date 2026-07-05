import { RENDER_HINTS } from '../../board/objects/board-objects.js';

// The notebook page IS the board's final state re-rendered — sections reference the
// scene's board objects so notebook and lesson can never drift apart.
export function validateNotebookPage(page, objects = null) {
  if (!page.id?.trim()) throw new Error('notebookPage.id is required');
  const context = `notebookPage ${page.id}`;
  if (!page.sceneId?.trim()) throw new Error(`${context}.sceneId is required`);
  if (!page.title?.trim()) throw new Error(`${context}.title is required`);
  if (!page.sections?.length) throw new Error(`${context}.sections must be non-empty`);

  const objectIds = objects ? new Set(objects.map((object) => object.id)) : null;
  for (const section of page.sections) {
    if (!section.objectId?.trim()) throw new Error(`${context} sections must reference a board objectId`);
    if (!RENDER_HINTS.includes(section.renderHint)) {
      throw new Error(`${context} section ${section.objectId} has unknown renderHint: ${section.renderHint}`);
    }
    if (objectIds && !objectIds.has(section.objectId)) {
      throw new Error(`${context} section references missing board object ${section.objectId}`);
    }
  }
  if (!page.keyTakeaways?.length) throw new Error(`${context}.keyTakeaways must be non-empty`);
  return page;
}

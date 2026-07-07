// Build a focused sub-SourcePack containing only the chunks a scene teaches, so each
// scene's agents see just their slice of the source (keeps scenes distinct + grounded).
// Preserves contract shape (ascending orderIndex, valid documents).

import { validateSourcePack } from './source-pack.js';

export function focusSourcePack(sourcePack, focusChunkIds) {
  const keep = new Set(focusChunkIds);
  const chunks = sourcePack.chunks
    .filter((chunk) => keep.has(chunk.id))
    .map((chunk, index) => ({ ...chunk, orderIndex: index }));
  if (chunks.length === 0) throw new Error('focusSourcePack: no chunks matched the focus set');

  const usedDocIds = new Set(chunks.map((chunk) => chunk.sourceId));
  const focused = {
    ...sourcePack,
    id: `${sourcePack.id}_f${[...keep].length}`,
    documents: sourcePack.documents.filter((document) => usedDocIds.has(document.id)),
    chunks,
  };
  validateSourcePack(focused);
  return focused;
}

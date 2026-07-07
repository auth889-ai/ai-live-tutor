import { createHash } from 'node:crypto';
import { chunkText, estimateTokens, normalizeText } from './chunking.js';
import { extractConceptCandidates } from './concepts.js';

export function buildTextSourcePack(text, { title } = {}) {
  const normalized = normalizeText(text);
  if (normalized.length < 40) {
    throw new Error('Text source must contain at least 40 characters');
  }

  const sourceId = stableId('src', normalized);
  const sourcePack = {
    id: stableId('sp', normalized),
    title: title ?? deriveTitle(normalized),
    inputType: 'text',
    documents: [
      {
        id: sourceId,
        type: 'text',
        title: title ?? deriveTitle(normalized),
        metadata: { characterCount: String(normalized.length) },
      },
    ],
    chunks: chunkText(normalized).map((chunk, index) => ({
      id: `chunk_${String(index + 1).padStart(4, '0')}`,
      sourceId,
      text: chunk,
      sourceRef: `User text chunk ${index + 1}`,
      tokenEstimate: estimateTokens(chunk),
      orderIndex: index,
      metadata: {},
    })),
    conceptCandidates: extractConceptCandidates(normalized),
  };
  validateSourcePack(sourcePack);
  return sourcePack;
}

export function validateSourcePack(sourcePack) {
  if (!sourcePack.id) throw new Error('sourcePack.id is required');
  if (!sourcePack.title) throw new Error('sourcePack.title is required');
  if (!sourcePack.documents?.length) throw new Error('sourcePack.documents is required');
  if (!sourcePack.chunks?.length) throw new Error('sourcePack.chunks is required');

  const documentIds = new Set(sourcePack.documents.map((document) => document.id));
  const chunkIds = new Set();
  let previousOrder = -1;

  for (const chunk of sourcePack.chunks) {
    if (chunkIds.has(chunk.id)) throw new Error(`Duplicate source chunk id: ${chunk.id}`);
    chunkIds.add(chunk.id);
    if (!documentIds.has(chunk.sourceId)) throw new Error(`Chunk ${chunk.id} references missing source ${chunk.sourceId}`);
    if (!chunk.text?.trim()) throw new Error(`Chunk ${chunk.id} has empty text`);
    if (!chunk.sourceRef?.trim()) throw new Error(`Chunk ${chunk.id} has empty sourceRef`);
    if (chunk.orderIndex <= previousOrder) throw new Error('Source chunks must be in ascending orderIndex');
    if (chunk.tokenEstimate <= 0) throw new Error(`Chunk ${chunk.id} tokenEstimate must be positive`);
    previousOrder = chunk.orderIndex;
  }
}

function deriveTitle(text) {
  const firstLine = text.split('\n').find((line) => line.trim()) ?? 'Untitled lesson';
  return firstLine.replace(/^#+\s*/, '').slice(0, 90);
}

function stableId(prefix, text) {
  return `${prefix}_${createHash('sha1').update(text).digest('hex').slice(0, 12)}`;
}


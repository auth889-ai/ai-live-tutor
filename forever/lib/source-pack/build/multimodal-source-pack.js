import { createHash } from 'node:crypto';
import { chunkText, estimateTokens, normalizeText } from './chunking.js';
import { extractConceptCandidates } from './concepts.js';
import { validateSourcePack } from './source-pack.js';

// A multimodal SourcePack: text chunks PLUS image assets (figures/pages/tables extracted
// from a PDF or fetched from the web). Assets let the tutor teach FROM real images — the
// Board Director can place an `image` board object and point at parts (bbox). Same contract
// shape as the text SourcePack, extended with assets[]; validated the same way + asset checks.

export const ASSET_KINDS = Object.freeze(['figure', 'page', 'table', 'web']);

export function buildMultimodalSourcePack({ title, text, images = [], documentType = 'pdf' } = {}) {
  const normalized = normalizeText(text || '');
  if (normalized.length < 40) throw new Error('SourcePack text must contain at least 40 characters');

  const sourceId = stableId('src', normalized);
  const assets = images.map((image, index) => normalizeAsset(image, index));

  const sourcePack = {
    id: stableId('sp', normalized + assets.map((a) => a.id).join('')),
    title: title ?? deriveTitle(normalized),
    inputType: documentType,
    documents: [{ id: sourceId, type: documentType, title: title ?? deriveTitle(normalized), metadata: { characterCount: String(normalized.length) } }],
    chunks: chunkText(normalized).map((chunk, index) => ({
      id: `chunk_${String(index + 1).padStart(4, '0')}`,
      sourceId,
      text: chunk,
      sourceRef: `${documentType} chunk ${index + 1}`,
      tokenEstimate: estimateTokens(chunk),
      orderIndex: index,
      metadata: {},
    })),
    assets,
    conceptCandidates: extractConceptCandidates(normalized),
  };
  validateMultimodalSourcePack(sourcePack);
  return sourcePack;
}

export function validateMultimodalSourcePack(sourcePack) {
  validateSourcePack(sourcePack); // text/chunk contract
  const ids = new Set();
  for (const asset of sourcePack.assets ?? []) {
    if (!asset.id?.trim()) throw new Error('asset.id is required');
    if (ids.has(asset.id)) throw new Error(`Duplicate asset id: ${asset.id}`);
    ids.add(asset.id);
    if (!ASSET_KINDS.includes(asset.kind)) throw new Error(`asset ${asset.id} has unknown kind: ${asset.kind}`);
    if (!asset.url?.trim()) throw new Error(`asset ${asset.id} needs a url/path`);
    if (asset.page !== undefined && (!Number.isInteger(asset.page) || asset.page < 1)) {
      throw new Error(`asset ${asset.id}.page must be a positive integer`);
    }
  }
  return sourcePack;
}

function normalizeAsset(image, index) {
  return {
    id: image.id || `asset_${String(index + 1).padStart(3, '0')}`,
    kind: ASSET_KINDS.includes(image.kind) ? image.kind : 'figure',
    url: image.url || image.path || '',
    page: image.page,
    caption: image.caption || '',
    // Vision depth (describeImage) rides the asset to the authoring agents: dropping it here
    // was the "one-line figure explanation" bug — ingest paid for the vision pass, then the
    // Board Director only ever saw `caption` (image-id-mapping reads asset.whatItShows).
    ...(image.whatItShows ? { whatItShows: image.whatItShows } : {}),
    // Inventory (transcribe-first pass): verbatim visible text + located components. The
    // components double as grounding ANCHORS (name-matched boxes) and as the per-part
    // teaching checklist for the Board Director / Voice Writer.
    ...(image.transcript ? { transcript: image.transcript } : {}),
    ...(Array.isArray(image.components) && image.components.length ? { components: image.components } : {}),
    bbox: image.bbox,
  };
}

function deriveTitle(text) {
  const firstLine = text.split('\n').find((line) => line.trim()) ?? 'Untitled lesson';
  return firstLine.replace(/^#+\s*/, '').slice(0, 90);
}

function stableId(prefix, text) {
  return `${prefix}_${createHash('sha1').update(text).digest('hex').slice(0, 12)}`;
}

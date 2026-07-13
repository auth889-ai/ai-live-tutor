// Image id mapping (one job): the OpenMAIC anti-hallucination contract for placing source
// images. The model NEVER writes an image URL — it writes the asset's ID ("fig_003"); a
// deterministic post-pass substitutes the real url and DELETES any image object whose id
// is unknown. An LLM can misremember a path; it cannot invent a valid id that survives
// this pass. (Read from OpenMAIC's generation contract at source: LLM writes "img_1",
// post-pass maps imageMapping[id] and drops unknowns.)

export function buildImageIndex(sourcePack) {
  const offerable = (sourcePack.assets ?? [])
    .filter((asset) => (asset.kind === 'figure' && asset.caption?.trim()) || asset.kind === 'page');
  return {
    // What the Board Director sees: ids + meaning, never raw paths.
    available: offerable.map((asset) => ({
      imageId: asset.id,
      kind: asset.kind,
      caption: asset.kind === 'page' ? `Full render of source page ${asset.page}` : asset.caption,
      ...(asset.whatItShows ? { whatItShows: asset.whatItShows } : {}),
      ...(asset.page ? { page: asset.page } : {}),
    })),
    mapping: new Map(offerable.map((asset) => [asset.id, asset])),
  };
}

// Substitute ids -> real urls on image objects; delete image objects that reference
// neither a known id nor a known real url (hallucinated source = never shown to a student).
// Enriches page/alt from the asset when the model omitted them. Returns dropped ids so the
// caller can log loudly — silent deletion is how quality rots.
export function resolveImageIds(objects, index) {
  if (!Array.isArray(objects)) return { objects, dropped: [] };
  const byUrl = new Map([...index.mapping.values()].map((asset) => [asset.url, asset]));
  const kept = [];
  const dropped = [];
  for (const object of objects) {
    if (object?.renderHint !== 'image' || !object.content || typeof object.content !== 'object') {
      kept.push(object);
      continue;
    }
    const ref = String(object.content.url ?? object.content.imageId ?? '').trim();
    const asset = index.mapping.get(ref) ?? byUrl.get(ref);
    if (!asset) {
      dropped.push(object.id ?? ref);
      continue;
    }
    kept.push({
      ...object,
      content: {
        ...object.content,
        url: asset.url,
        ...(object.content.page === undefined && asset.page ? { page: asset.page } : {}),
        ...(!object.content.alt && asset.caption ? { alt: asset.caption } : {}),
      },
    });
  }
  return { objects: kept, dropped };
}

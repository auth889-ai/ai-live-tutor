// EXIT-DOOR GROUNDING SWEEP (one job): the LAST line of defense before a scene leaves
// generation. The board-production grounding pass covers first-draft marks, but objects
// authored or altered AFTER it — critic revisions, element repair, structure repair —
// carried fresh unverified marks straight to students (kernel-caught 2026-07-26: three
// scenes, groundedBy=none). This sweep grounds every image object that still carries ANY
// untagged mark; tagged marks pass through untouched (no double vision spend). Unfixable
// marks are dropped — the standing law: unverifiable is undrawable.

import { groundAnnotations, fetchImageForGrounding } from './ground-annotations.js';

export async function groundSceneImages(objects, { assets = [], ground = groundAnnotations, fetchRemote = fetchImageForGrounding } = {}) {
  const byUrl = new Map(assets.map((asset) => [asset.url, asset]));
  for (const object of objects ?? []) {
    if (object?.renderHint !== 'image') continue;
    const annotations = object.content?.annotations ?? [];
    const untagged = annotations.filter((a) => !a.groundedBy);
    if (untagged.length === 0) continue;
    const url = String(object.content.url ?? '');
    const asset = byUrl.get(url);
    try {
      const remote = /^https?:\/\//.test(url) ? await fetchRemote(url) : null;
      const mime = remote?.mime ?? (/\.png$/i.test(url) ? 'image/png' : 'image/jpeg');
      const { annotations: grounded, dropped, wrongImage } = await ground({
        imagePath: remote ? undefined : url,
        imageBytes: remote?.bytes,
        mime,
        annotations: untagged,
        anchors: asset?.components ?? [],
        transcript: asset?.transcript ?? '',
      });
      if (wrongImage) {
        console.error(`[exit-sweep] ${object.id}: post-repair marks match nothing in the figure — all stripped`);
        object.content = { ...object.content, annotations: annotations.filter((a) => a.groundedBy) };
        continue;
      }
      if (dropped?.length) console.error(`[exit-sweep] ${object.id}: ${dropped.length} post-repair mark(s) unverifiable — dropped`);
      object.content = { ...object.content, annotations: [...annotations.filter((a) => a.groundedBy), ...grounded] };
    } catch (error) {
      console.error(`[exit-sweep] ${object.id}: grounding unavailable (${String(error?.message).slice(0, 80)}) — ${untagged.length} unverified mark(s) removed`);
      object.content = { ...object.content, annotations: annotations.filter((a) => a.groundedBy) };
    }
  }
  return objects;
}

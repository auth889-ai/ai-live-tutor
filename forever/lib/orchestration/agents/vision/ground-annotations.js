// Annotation grounding agent (one job): the Board Director writes annotation INTENTS
// (encircle X, label Y) but it is a text model that has never seen the image — its bboxes
// are guesses, which is why marks landed on the wrong parts (live user report: "it cannot
// point at the correct thing"). This agent LOOKS at the pixels (Qwen-VL) and returns the
// real box for each intent: bbox_2d [x1,y1,x2,y2] normalized 0-1000 (the model's native
// grounding format) -> converted to forever's fractional {x,y,w,h}. Honest failure per
// mark: an intent the model cannot locate is DROPPED (never a made-up box), and the whole
// pass degrades to the unannotated image if vision is unavailable.

import { readFile } from 'node:fs/promises';
import { callQwenVisionJson } from '../../../qwen/vision.js';
import { toFractionalBbox, bboxIoU, bboxMean } from '../../../util/image-size.js';
import { prepareImageForVision, cropAroundBbox } from '../../../util/image-prep.js';

// COORDINATE SPACE — measured, not assumed (scripts/calibrate-vision-grounding.mjs, the
// rerunnable authority; run it again whenever MODEL_VISION changes). Verdict for
// qwen3.7-plus on 2026-07-24: the model answers in 0-1000 NORMALIZED space in EVERY prompt
// style — even when ordered to use absolute pixels with the real dimensions stated (IoU vs
// ground truth: 0.93-0.99 as-0-1000, 0.00-0.17 as-pixels). Its self-reported imageWidth/
// imageHeight is unreliable (claimed 1024x768 and 1000x700 for a 1200x800 image), so it
// must NEVER be used for normalization. Hence: prompt asks for 0-1000, we divide by 1000.
// toFractionalBbox stays defensive for already-fractional answers.
export function bboxFromModelAnswer(bbox2d) {
  return toFractionalBbox(bbox2d, 1000, 1000);
}

// ANCHOR MATCHING (research: retrieval beats regression — a mark matched to a NAMED
// inventory component cannot land on an unrelated part). Anchors come from the ingest
// inventory pass (describe-image components: label + located bbox). Conservative,
// deterministic: normalized token-subset match (stopwords stripped, so "the dimension
// table" finds "dimension table (product)"), and the overlap must contain at least one
// substantive token (>=4 chars) — "the"/"box" alone never match. A miss returns null and
// the caller falls back to vision-only behavior.
const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'this', 'that', 'its']);
const labelTokens = (s) => new Set(
  String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t && !STOPWORDS.has(t)),
);
const isSubset = (small, big) => [...small].every((t) => big.has(t));

export function matchAnchor(targetText, anchors) {
  const target = labelTokens(targetText);
  if (!target.size || !Array.isArray(anchors)) return null;
  let best = null;
  let bestOverlap = 0;
  for (const anchor of anchors) {
    const label = labelTokens(anchor?.label);
    if (!label.size || !anchor?.bbox) continue;
    const overlap = [...target].filter((t) => label.has(t));
    if (!overlap.some((t) => t.length >= 4)) continue; // no substantive shared token
    const exact = target.size === label.size && isSubset(target, label);
    if (exact) return anchor; // identical name = strongest possible match
    if ((isSubset(target, label) || isSubset(label, target)) && overlap.length > bestOverlap) {
      best = anchor;
      bestOverlap = overlap.length;
    }
  }
  return best;
}

// Fetch a REMOTE image so it can be grounded like a local one (web images used to skip
// grounding entirely and ship the text model's blind guessed bboxes — the exact bug this
// agent exists to fix). Bounded on purpose: a lesson build must not hang or balloon on a
// slow/huge remote image; any failure throws and the caller strips the annotations
// (honest degrade — unannotated beats mis-pointed).
export async function fetchImageForGrounding(url, { maxBytes = 8 * 1024 * 1024, timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = String(response.headers.get('content-type') ?? '').toLowerCase();
    const mime = type.startsWith('image/') ? type.split(';')[0]
      : /\.png(\?|$)/i.test(url) ? 'image/png'
      : /\.(jpe?g)(\?|$)/i.test(url) ? 'image/jpeg'
      : null;
    if (!mime) throw new Error(`not an image (content-type: ${type || 'missing'})`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) throw new Error('empty body');
    if (buffer.length > maxBytes) throw new Error(`image too large (${buffer.length} bytes > ${maxBytes})`);
    return { bytes: buffer, mime };
  } finally {
    clearTimeout(timer);
  }
}

// A consensus box that swallows most of the image is not a pointer — it is the model
// hedging. Live-caught (2026-07-24 gate lesson): asked twice to find "FK: Sale.product_id"
// in a SALES LINE CHART, both passes returned agreeing vague boxes — same-model consensus
// cannot catch consistent hallucination. Area cap + inventory cross-check below are the
// deterministic defenses.
const MAX_MARK_AREA = 0.55;

// WRONG-IMAGE DETECTOR (pure): when the figure has an ingest inventory, a real mark's text
// should match SOME component name or appear in the figure's own visible text. If NONE of
// the intents match anything the figure actually contains, the author is describing a
// DIFFERENT image — nothing may ship on this one.
export function intentsMatchFigure(intents, { anchors = [], transcript = '' } = {}) {
  if (!anchors.length && !transcript) return { checkable: false, matched: 0, total: intents.length };
  const haystack = String(transcript).toLowerCase();
  let matched = 0;
  for (const intent of intents) {
    const text = String(intent.text ?? '').trim();
    if (!text) continue;
    if (matchAnchor(text, anchors)) { matched += 1; continue; }
    // Transcript fallback is word-boundary + >=5-char tokens: "sale" inside "Yearly sale"
    // must NOT vouch for "FK: Sale.product_id" (live false-match on the chart lesson).
    const tokens = text.toLowerCase().replace(/[^a-z0-9_.]+/g, ' ').split(' ').filter((t) => t.length >= 5);
    const words = new Set(haystack.replace(/[^a-z0-9_.]+/g, ' ').split(' '));
    if (tokens.some((t) => words.has(t))) matched += 1;
  }
  return { checkable: true, matched, total: intents.length };
}

export async function groundAnnotations({ imagePath, imageBytes, mime = 'image/jpeg', annotations, anchors = [], transcript = '' }) {
  if (!annotations?.length) return { annotations: [], usage: null };
  // Wrong-image guard BEFORE spending vision calls: an inventoried figure none of whose
  // parts appear in ANY intent is not the figure these marks were written for.
  const consistency = intentsMatchFigure(annotations, { anchors, transcript });
  if (consistency.checkable && consistency.matched === 0 && consistency.total >= 2) {
    return {
      annotations: [],
      dropped: annotations.map((a) => a.text ?? a.verb),
      usage: null,
      wrongImage: true,
    };
  }
  const raw = imageBytes ?? (await readFile(imagePath));
  const prepped = await prepareImageForVision(raw, mime); // ≤2560px: inside Qwen-VL's reliable range
  const bytes = prepped.bytes;
  mime = prepped.mime;
  const base64 = Buffer.from(bytes).toString('base64');

  const system = `You are the Vision Grounding agent of an AI tutor. You are given an image and a list of
teaching marks a teacher wants to draw on it. For EACH mark, locate the exact region in the image.
Report each bounding box as "bbox_2d": [x1, y1, x2, y2] with coordinates normalized to the 0-1000
range (0,0 = top-left corner, 1000,1000 = bottom-right corner of the image; x1<x2, y1<y2, tight
around the named part). Output ONLY JSON:
{"marks":[{"index": <the mark's index from the input>, "bbox_2d": [x1,y1,x2,y2], "found": true|false}]}
Report "found": false for any mark whose target is NOT actually visible in the image — never guess a box.`;

  const user = JSON.stringify({
    marks: annotations.map((a, index) => ({ index, verb: a.verb, target: a.text ?? a.alt ?? '' })),
  });

  // DOUBLE-GROUNDING CONSENSUS (live user report: marks still circled the wrong parts on a
  // dense PDF diagram). Two independent vision passes; a mark survives only when both passes
  // land on the SAME region (IoU >= 0.35) and ships as their average. A box the model cannot
  // reproduce is dropped — drawn-wrong teaches worse than absent.
  const passOnce = async () => {
    const { json, usage } = await callQwenVisionJson({
      agent: 'vision_ground', system, user, images: [{ base64, mime }],
      timeoutMs: 180_000, // slow regional pools: 90s default aborted live under evening load
    });
    const map = new Map();
    for (const mark of Array.isArray(json.marks) ? json.marks : []) {
      if (mark?.found !== true) continue;
      const bbox = bboxFromModelAnswer(mark.bbox_2d);
      if (bbox) map.set(Number(mark.index), bbox);
    }
    return { map, usage };
  };

  const [passA, passB] = await Promise.all([passOnce(), passOnce()]);
  const usage = passA.usage ?? passB.usage;
  const byIndex = new Map();
  for (const [index, boxA] of passA.map) {
    const boxB = passB.map.get(index);
    if (boxB && bboxIoU(boxA, boxB) >= 0.35) byIndex.set(index, bboxMean(boxA, boxB));
  }

  const grounded = [];
  const dropped = [];
  const soft = []; // consensus marks with NO anchor corroboration -> blind crop-verify below
  annotations.forEach((annotation, index) => {
    const bbox = byIndex.get(index);
    if (bbox && bbox.w * bbox.h > MAX_MARK_AREA) { dropped.push(annotation.text ?? annotation.verb); return; }
    if (bbox) {
      const mark = { ...annotation, bbox };
      grounded.push(mark);
      if (!matchAnchor(annotation.text ?? annotation.alt ?? '', anchors)) soft.push(mark);
      return;
    }
    // ANCHOR RESCUE: the two live passes disagreed (or found nothing) — before dropping,
    // try the ingest inventory by NAME. A name-matched component box is pixel-derived and
    // retrieval-matched, so it beats losing the mark; consensus (when it exists) still wins.
    const anchor = matchAnchor(annotation.text ?? annotation.alt ?? '', anchors);
    if (anchor) grounded.push({ ...annotation, bbox: anchor.bbox, groundedBy: 'anchor' });
    else dropped.push(annotation.text ?? annotation.verb);
  });

  // BLIND CROP-VERIFY (research: naive "is this right?" self-checks COLLAPSE accuracy —
  // the working variant is an OPEN question on a zoomed crop, then a text match). Only for
  // soft marks (no anchor vouches for them), capped to bound latency/cost; a verify-call
  // failure keeps the mark (provider weather must not delete teaching), a confident
  // mismatch deletes it (drawn-wrong teaches worse than absent).
  const toVerify = soft.slice(0, 3);
  for (const mark of toVerify) {
    try {
      const crop = await cropAroundBbox(bytes, mark.bbox, { mime });
      if (!crop) continue;
      const { json } = await callQwenVisionJson({
        agent: 'vision_crop_verify',
        system: 'You are looking at a small CROP from a larger figure. Describe what is at the CENTER of this crop — name any visible text verbatim. Output ONLY JSON: {"center": "a few words", "visibleText": "any text you can read, verbatim"}',
        user: 'What is at the center of this crop?',
        images: [{ base64: Buffer.from(crop.bytes).toString('base64'), mime: crop.mime }],
        maxTokens: 300,
        timeoutMs: 120_000,
      });
      const seen = `${json.center ?? ''} ${json.visibleText ?? ''}`;
      const target = mark.text ?? mark.alt ?? '';
      const verdict = intentsMatchFigure([{ text: target }], { anchors: [], transcript: seen });
      if (verdict.checkable && verdict.matched === 0) {
        const at = grounded.indexOf(mark);
        if (at >= 0) grounded.splice(at, 1);
        dropped.push(target);
      } else {
        mark.groundedBy = 'consensus+crop';
      }
    } catch {
      // verify unavailable -> the double-pass consensus stands on its own
    }
  }
  return { annotations: grounded, dropped, usage };
}

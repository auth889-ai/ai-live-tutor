// Isomorphic board renderer core (ENGINEERING_PLAYBOOK Phase 1 slice-2 decisions):
// pure functions from (scene objects + action-engine state) to an SVG string.
// No React, no DOM — the same code draws the live board, timeline thumbnails,
// and server-rendered notebook pages. Determinism is a hard requirement: the
// rough.js seed derives from the object id, so state-at-t always draws the
// exact same strokes (no jitter between frames, no drift on seek).

import rough from 'roughjs';

import { BOARD_WIDTH, BOARD_HEIGHT, getRegionLinePosition } from '../../../../lib/board/layout/layout-regions.js';

const INK = '#c0392b'; // primary handwriting ink (mockups: warm red)
const PAPER = '#fdf8f0';
const HIGHLIGHT = '#fdeaa7';
const CODE_BG = '#1e2430';
const CODE_INK = '#e8eef7';
const HAND_FONT = 'Caveat, "Patrick Hand", cursive';
const CODE_FONT = 'ui-monospace, Menlo, monospace';

export function renderBoardSvg(scene, state) {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}" font-family='${HAND_FONT}'>`,
    `<rect x="0" y="0" width="${BOARD_WIDTH}" height="${BOARD_HEIGHT}" fill="${PAPER}"/>`,
  ];

  for (const object of scene.objects) {
    const writing = state.writing.get(object.id) ?? state.codeReveal.get(object.id);
    if (!writing) continue; // not written yet at this clock time
    if (state.highlights.has(object.id)) parts.push(highlightChip(scene.layout, object));
    parts.push(renderObject(scene.layout, object, writing.progress, state));
  }

  const pointerTarget = state.pointer && scene.objects.find((object) => object.id === state.pointer);
  if (pointerTarget && (state.writing.has(pointerTarget.id) || state.codeReveal.has(pointerTarget.id))) {
    parts.push(pointerMarker(scene.layout, pointerTarget));
  }

  parts.push('</svg>');
  return parts.join('');
}

function renderObject(layout, object, progress, state) {
  switch (object.renderHint) {
    case 'text':
      return revealText(layout, object, String(object.content), progress);
    case 'list':
      return revealText(layout, object, object.content.items.map((item) => `• ${item}`).join('\n'), progress);
    case 'code':
      return codePanel(layout, object, progress, state);
    default:
      // Honest failure over silent blanks: unsupported hints fail loudly in dev.
      throw new Error(`board-svg does not support renderHint "${object.renderHint}" yet (object ${object.id})`);
  }
}

// Handwriting reveal: words appear as the tutor speaks them. The engine's progress
// (0..1 across the write action) maps to how many words are visible.
function revealText(layout, object, text, progress) {
  const position = getRegionLinePosition(layout, object.region, object.lineNumber ?? 0);
  const lines = text.split('\n');
  const words = lines.flatMap((line, row) => line.split(/\s+/).filter(Boolean).map((word) => ({ word, row })));
  const visibleCount = Math.floor(progress * words.length + 1e-9);
  const out = [`<g data-object-id="${escapeXml(object.id)}" fill="${INK}" font-size="26">`];

  let cursorRow = -1;
  let lineWords = [];
  const flush = () => {
    if (cursorRow >= 0 && lineWords.length) {
      const y = position.y + cursorRow * 34;
      out.push(`<text x="${position.x}" y="${y}">${escapeXml(lineWords.join(' '))}</text>`);
    }
    lineWords = [];
  };
  for (const { word, row } of words.slice(0, visibleCount)) {
    if (row !== cursorRow) {
      flush();
      cursorRow = row;
    }
    lineWords.push(word);
  }
  flush();

  if (object.objectType.includes('title')) out.push(roughUnderline(object.id, position, progress));
  out.push('</g>');
  return out.join('');
}

function codePanel(layout, object, progress, state) {
  const region = getRegionLinePosition(layout, object.region, 0);
  const lines = String(object.content).split('\n');
  const visibleLines = Math.max(progress > 0 ? 1 : 0, Math.floor(progress * lines.length + 1e-9));
  const height = lines.length * 20 + 24;
  const out = [
    `<g data-object-id="${escapeXml(object.id)}" font-family='${CODE_FONT}' font-size="14">`,
    `<rect x="${region.x}" y="${region.y}" width="${region.w}" height="${height}" rx="8" fill="${CODE_BG}"/>`,
  ];
  lines.slice(0, visibleLines).forEach((line, index) => {
    out.push(`<text x="${region.x + 14}" y="${region.y + 26 + index * 20}" fill="${CODE_INK}">${escapeXml(line)}</text>`);
  });
  if (state.outputShown.has(object.id) && object.output !== undefined) {
    const outputY = region.y + height + 8;
    out.push(`<rect x="${region.x}" y="${outputY}" width="${region.w}" height="60" rx="8" fill="${CODE_BG}"/>`);
    out.push(`<text x="${region.x + 14}" y="${outputY + 24}" fill="#7ee787">${escapeXml(String(object.output))}</text>`);
  }
  out.push('</g>');
  return out.join('');
}

function highlightChip(layout, object) {
  const position = getRegionLinePosition(layout, object.region, object.lineNumber ?? 0);
  return `<rect x="${position.x - 6}" y="${position.y - 24}" width="${position.w + 12}" height="36" rx="10" fill="${HIGHLIGHT}" data-highlight="${escapeXml(object.id)}"/>`;
}

function pointerMarker(layout, object) {
  const position = getRegionLinePosition(layout, object.region, object.lineNumber ?? 0);
  const x = position.x - 18;
  const y = position.y - 8;
  return `<g data-pointer="${escapeXml(object.id)}"><circle cx="${x}" cy="${y}" r="6" fill="${INK}"/><path d="M${x} ${y} l14 5 l-6 3 z" fill="${INK}"/></g>`;
}

// Hand-drawn underline via rough.js, seeded by object id: identical strokes every frame.
function roughUnderline(objectId, position, progress) {
  const generator = rough.generator({ options: { seed: seedFrom(objectId), roughness: 1.6, stroke: INK, strokeWidth: 2.4 } });
  const width = position.w * 0.6 * progress;
  if (width < 4) return '';
  const drawable = generator.line(position.x, position.y + 10, position.x + width, position.y + 12);
  return generator
    .toPaths(drawable)
    .map((path) => `<path d="${path.d}" stroke="${path.stroke}" stroke-width="${path.strokeWidth}" fill="none"/>`)
    .join('');
}

export function seedFrom(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2 ** 31 || 1;
}

export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

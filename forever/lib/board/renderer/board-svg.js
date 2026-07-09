// Isomorphic board renderer core (ENGINEERING_PLAYBOOK Phase 1 decisions):
// pure functions from (scene objects + action-engine state) to an SVG string.
// No React, no DOM — the same code draws the live board, timeline thumbnails,
// and server-rendered notebook pages. Determinism is a hard requirement: the
// rough.js seed derives from the object id, so state-at-t always draws the
// exact same strokes (no jitter between frames, no drift on seek).
//
// LAYOUT: objects FLOW top-to-bottom within their region by measured height, and
// text WRAPS to the region width. Position is computed here, never trusted from the
// agent's guessed lineNumber (W4 principle) — so objects never overlap or run off.

import rough from 'roughjs';

import { BOARD_WIDTH, BOARD_HEIGHT, getRegion } from '../layout/layout-regions.js';
import { layoutDiagram } from '../diagrams/diagram-layout.js';

const INK = '#c0392b'; // primary handwriting ink (mockups: warm red)
const PAPER = '#fdf6f3';
const HIGHLIGHT = '#fdeaa7';
const CODE_BG = '#1e2430';
const CODE_INK = '#e8eef7';
const HAND_FONT = 'Caveat, "Patrick Hand", cursive';
const CODE_FONT = 'ui-monospace, Menlo, monospace';

const TEXT_SIZE = 24;
const LINE_H = 32;
const CODE_SIZE = 14;
const CODE_LINE_H = 20;
const OBJECT_GAP = 16;
const TOP_PAD = 10;

export function renderBoardSvg(scene, state) {
  const positions = layoutObjects(scene.layout, scene.objects);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}" font-family='${HAND_FONT}'>`,
    `<rect x="0" y="0" width="${BOARD_WIDTH}" height="${BOARD_HEIGHT}" fill="${PAPER}"/>`,
  ];

  for (const object of scene.objects) {
    const writing = state.writing.get(object.id) ?? state.codeReveal.get(object.id);
    if (!writing) continue; // not written yet at this clock time
    const pos = positions.get(object.id);
    if (state.highlights.has(object.id)) parts.push(highlightChip(object, pos));
    parts.push(renderObject(object, pos, writing.progress, state));
  }

  const pointerTarget = state.pointer && scene.objects.find((object) => object.id === state.pointer);
  if (pointerTarget && (state.writing.has(pointerTarget.id) || state.codeReveal.has(pointerTarget.id))) {
    parts.push(pointerMarker(pointerTarget, positions.get(pointerTarget.id)));
  }

  parts.push('</svg>');
  return parts.join('');
}

// Flow pass: group by region, order by the agent's lineNumber hint, then stack each
// object below the previous one by its measured height. Returns objectId -> {x,y,w,lines}.
function layoutObjects(layout, objects) {
  const byRegion = new Map();
  for (const object of objects) {
    if (!byRegion.has(object.region)) byRegion.set(object.region, []);
    byRegion.get(object.region).push(object);
  }
  const positions = new Map();
  for (const [regionName, regionObjects] of byRegion) {
    const region = getRegion(layout, regionName);
    regionObjects.sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0));
    let cursorY = region.y + TOP_PAD;
    for (const object of regionObjects) {
      if (object.renderHint === 'diagram') {
        const h = diagramHeight(object.content);
        positions.set(object.id, { x: region.x, y: cursorY, w: region.w, lines: [] });
        cursorY += h + OBJECT_GAP;
        continue;
      }
      const lines = displayLines(object, region);
      const lineH = object.renderHint === 'code' ? CODE_LINE_H : LINE_H;
      const bodyH = lines.length * lineH + (object.renderHint === 'code' ? 24 : 0);
      positions.set(object.id, { x: region.x, y: cursorY, w: region.w, lines });
      cursorY += bodyH + OBJECT_GAP;
    }
  }
  return positions;
}

// Wrap a plain string's paragraphs to the region width (greedy word wrap).
function displayLines(object, region) {
  const maxChars = Math.max(8, Math.floor(region.w / (object.renderHint === 'code' ? CODE_SIZE * 0.6 : TEXT_SIZE * 0.52)));
  if (object.renderHint === 'code') return String(object.content).split('\n');
  if (object.renderHint === 'list') {
    return object.content.items.flatMap((item) => wrap(`• ${item}`, maxChars, '   '));
  }
  return String(object.content)
    .split('\n')
    .flatMap((paragraph) => (paragraph.trim() ? wrap(paragraph, maxChars, '') : ['']));
}

function wrap(text, maxChars, contIndent) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = contIndent + word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [text];
}

function renderObject(object, pos, progress, state) {
  switch (object.renderHint) {
    case 'text':
    case 'list':
      return revealText(object, pos, progress);
    case 'code':
      return codePanel(object, pos, progress, state);
    case 'diagram':
      return renderDiagram(object, pos, progress);
    default:
      throw new Error(`board-svg does not support renderHint "${object.renderHint}" yet (object ${object.id})`);
  }
}

const DIAGRAM_COLORS = { box: '#fff' };

function diagramHeight(content) {
  if (content.diagramType === 'tree') return 200;
  if (content.diagramType === 'comparison') return 40 + (content.rows?.length ?? 0) * 34;
  if (content.diagramType === 'cycle') return 150;
  return 110; // flowchart
}

// Hand-drawn diagram: rough.js boxes + arrows + labels, revealed shape-by-shape with the clock.
function renderDiagram(object, pos, progress) {
  const region = { x: pos.x, y: pos.y, w: pos.w, h: diagramHeight(object.content) };
  const shapes = layoutDiagram(object.content, region);
  const visible = Math.max(1, Math.floor(progress * shapes.length + 1e-9));
  const generator = rough.generator({ options: { seed: seedFrom(object.id), roughness: 1.4 } });
  const out = [`<g data-object-id="${escapeXml(object.id)}">`];

  shapes.slice(0, visible).forEach((shape, index) => {
    if (shape.kind === 'box') {
      const rect = generator.rectangle(shape.x, shape.y, shape.w, shape.h, { stroke: shape.color, strokeWidth: 2, fill: '#fffcfa', fillStyle: 'solid' });
      for (const p of generator.toPaths(rect)) {
        out.push(`<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill || 'none'}"/>`);
      }
      out.push(`<text x="${shape.x + shape.w / 2}" y="${shape.y + shape.h / 2 + 6}" text-anchor="middle" fill="${shape.color}" font-size="17">${escapeXml(shape.label)}</text>`);
    } else if (shape.kind === 'arrow') {
      out.push(arrowSvg(shape, `${object.id}_${index}`));
    } else if (shape.kind === 'rule') {
      out.push(`<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" stroke="#e0d6c2" stroke-width="1"/>`);
    } else if (shape.kind === 'text') {
      out.push(`<text x="${shape.x}" y="${shape.y}" ${shape.anchor ? `text-anchor="${shape.anchor}"` : ''} fill="${INK}" font-size="${shape.size ?? 15}"${shape.bold ? ' font-weight="700"' : ''}>${escapeXml(shape.text)}</text>`);
    }
  });
  out.push('</g>');
  return out.join('');
}

function arrowSvg(shape, id) {
  return `<g><line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" stroke="${INK}" stroke-width="2" marker-end="url(#arrow_${escapeXml(id)})"/><defs><marker id="arrow_${escapeXml(id)}" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="${INK}"/></marker></defs></g>`;
}

// Handwriting reveal: words appear progressively across the pre-wrapped display lines.
function revealText(object, pos, progress) {
  const words = pos.lines.flatMap((line, row) => line.split(/\s+/).filter(Boolean).map((word) => ({ word, row })));
  const visibleCount = Math.floor(progress * words.length + 1e-9);
  const out = [`<g data-object-id="${escapeXml(object.id)}" fill="${INK}" font-size="${TEXT_SIZE}">`];

  let cursorRow = -1;
  let lineWords = [];
  const flush = () => {
    if (cursorRow >= 0 && lineWords.length) {
      const y = pos.y + cursorRow * LINE_H + TEXT_SIZE;
      out.push(`<text x="${pos.x}" y="${y}">${escapeXml(lineWords.join(' '))}</text>`);
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

  if (object.objectType.includes('title')) out.push(roughUnderline(object.id, pos, progress));
  out.push('</g>');
  return out.join('');
}

function codePanel(object, pos, progress, state) {
  const lines = pos.lines;
  const visibleLines = Math.max(progress > 0 ? 1 : 0, Math.floor(progress * lines.length + 1e-9));
  const height = lines.length * CODE_LINE_H + 24;
  const out = [
    `<g data-object-id="${escapeXml(object.id)}" font-family='${CODE_FONT}' font-size="${CODE_SIZE}">`,
    `<rect x="${pos.x}" y="${pos.y}" width="${pos.w}" height="${height}" rx="8" fill="${CODE_BG}"/>`,
  ];
  lines.slice(0, visibleLines).forEach((line, index) => {
    out.push(`<text x="${pos.x + 14}" y="${pos.y + 22 + index * CODE_LINE_H}" fill="${CODE_INK}" xml:space="preserve">${escapeXml(line)}</text>`);
  });
  if (state.outputShown.has(object.id) && object.output !== undefined) {
    const outputY = pos.y + height + 8;
    const outputLines = String(object.output).split('\n');
    out.push(`<rect x="${pos.x}" y="${outputY}" width="${pos.w}" height="${outputLines.length * CODE_LINE_H + 16}" rx="8" fill="${CODE_BG}"/>`);
    outputLines.forEach((line, index) => {
      out.push(`<text x="${pos.x + 14}" y="${outputY + 20 + index * CODE_LINE_H}" fill="#7ee787" xml:space="preserve">${escapeXml(line)}</text>`);
    });
  }
  out.push('</g>');
  return out.join('');
}

function highlightChip(object, pos) {
  return `<rect x="${pos.x - 6}" y="${pos.y - 4}" width="${pos.w + 12}" height="${pos.lines.length * LINE_H + 12}" rx="10" fill="${HIGHLIGHT}" data-highlight="${escapeXml(object.id)}"/>`;
}

function pointerMarker(object, pos) {
  const x = pos.x - 18;
  const y = pos.y + 14;
  return `<g data-pointer="${escapeXml(object.id)}"><circle cx="${x}" cy="${y}" r="6" fill="${INK}"/><path d="M${x} ${y} l14 5 l-6 3 z" fill="${INK}"/></g>`;
}

// Hand-drawn underline via rough.js, seeded by object id: identical strokes every frame.
function roughUnderline(objectId, pos, progress) {
  const generator = rough.generator({ options: { seed: seedFrom(objectId), roughness: 1.6, stroke: INK, strokeWidth: 2.4 } });
  const width = Math.min(pos.w, pos.lines[0] ? pos.lines[0].length * TEXT_SIZE * 0.52 : pos.w * 0.5) * progress;
  if (width < 4) return '';
  const y = pos.y + LINE_H + 6;
  const drawable = generator.line(pos.x, y, pos.x + width, y + 2);
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

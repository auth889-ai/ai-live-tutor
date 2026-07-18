'use client';

// INK ENGINE v2 — Xournal++'s tool set, mirrored from its OWN source (verified 2026-07-19):
//   tools:    TOOL_PEN, TOOL_HIGHLIGHTER, TOOL_DRAW_LINE/RECT/ELLIPSE/ARROW/DOUBLE_ARROW,
//             text, select+move                       (src/core/control/ToolEnums.h:71-90)
//   erasers:  DELETE_STROKE (default) + WHITEOUT      (ToolEnums.h:157)
//   styles:   solid / dashed / dotted                 (src/core/model/LineStyle.h)
//   pressure: per-point widths                        (src/core/model/Stroke.h setPressure)
//   layers:   show/hide, active layer, add, reorder   (src/core/model/Layer.h, XojPage.h:39)
//   lasso:    even-odd ray casting                    (src/core/control/tools/Selector.cpp:230)
//             all-points-inside selection rule        (src/core/model/Stroke.cpp:235)
//             move/scale/rotate handles               (CursorSelectionType.h, Element.h:58-59)
//   papers:   blank / ruled / grid / scratch / whiteboard, grid snapping
//   stabilization: moving-average smoothing toggle
// Storage law (Xournal's): vectors, never flattened pixels. Data v2:
//   { version: 2, paper, layers: [{ name, visible, items: [stroke|shape|text] }] }

// Structure (one concern per module):
//   lib/notebook/ink-geometry.js         pure selection/transform math (suite-tested)
//   components/notebook/ink/render.js    drawing model + SVG rendering (viewer)
//   components/notebook/ink/export.js    SVG/PNG export
//   components/notebook/ink/editor.js    the interactive editor
// This barrel keeps the original import surface stable.

export { W, H, lassoContains, itemInLasso, selectionBounds, moveItem, scaleItem, rotateItem } from '../../lib/notebook/ink-geometry.js';
export { paperDefs, parseData, SvgDrawing } from './ink/render.js';
export { drawingToSvgString, downloadDrawing } from './ink/export.js';
export { DrawingEditor } from './ink/editor.js';

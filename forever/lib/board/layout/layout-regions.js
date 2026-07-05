export const BOARD_WIDTH = 900;
export const BOARD_HEIGHT = 500;

export const LAYOUT_REGIONS = Object.freeze({
  teacher_notebook: Object.freeze({
    notebook_title: Object.freeze({ x: 40, y: 52, w: 820, h: 52, maxLines: 1, lineHeight: 36, role: 'title' }),
    notebook_body: Object.freeze({ x: 40, y: 120, w: 820, h: 246, maxLines: 7, lineHeight: 36, role: 'writing' }),
    notebook_footer: Object.freeze({ x: 40, y: 390, w: 820, h: 70, maxLines: 2, lineHeight: 32, role: 'summary' }),
    pointer_zone: Object.freeze({ x: 0, y: 0, w: 900, h: 500, role: 'pointer' }),
  }),
  teacher_notebook_code: Object.freeze({
    notebook_area: Object.freeze({ x: 40, y: 56, w: 430, h: 390, maxLines: 10, lineHeight: 36, role: 'writing' }),
    code_panel: Object.freeze({ x: 500, y: 56, w: 360, h: 260, maxLines: 20, lineHeight: 20, role: 'code' }),
    output_panel: Object.freeze({ x: 500, y: 338, w: 360, h: 120, maxLines: 6, lineHeight: 20, role: 'output' }),
    pointer_zone: Object.freeze({ x: 0, y: 0, w: 900, h: 500, role: 'pointer' }),
  }),
  teacher_diagram_source: Object.freeze({
    diagram_area: Object.freeze({ x: 40, y: 56, w: 520, h: 360, maxLines: 1, lineHeight: 36, role: 'diagram' }),
    source_sidebar: Object.freeze({ x: 590, y: 56, w: 270, h: 360, maxLines: 8, lineHeight: 34, role: 'source' }),
    notebook_footer: Object.freeze({ x: 40, y: 430, w: 820, h: 48, maxLines: 1, lineHeight: 32, role: 'summary' }),
    pointer_zone: Object.freeze({ x: 0, y: 0, w: 900, h: 500, role: 'pointer' }),
  }),
  quiz_checkpoint: Object.freeze({
    quiz_area: Object.freeze({ x: 90, y: 70, w: 720, h: 300, maxLines: 5, lineHeight: 52, role: 'quiz' }),
    notebook_footer: Object.freeze({ x: 40, y: 400, w: 820, h: 70, maxLines: 2, lineHeight: 32, role: 'summary' }),
    pointer_zone: Object.freeze({ x: 0, y: 0, w: 900, h: 500, role: 'pointer' }),
  }),
});

export function getRegion(layout, region) {
  const regionDef = LAYOUT_REGIONS[layout]?.[region];
  if (!regionDef) {
    throw new Error(`Unknown board region: ${layout}.${region}`);
  }
  return regionDef;
}

export function getRegionLinePosition(layout, region, lineNumber) {
  validateRegionLine(layout, region, lineNumber);
  const regionDef = getRegion(layout, region);
  return {
    x: regionDef.x,
    y: regionDef.y + lineNumber * (regionDef.lineHeight ?? 36),
    w: regionDef.w,
  };
}

export function validateRegionLine(layout, region, lineNumber) {
  const regionDef = getRegion(layout, region);
  if (!Number.isInteger(lineNumber) || lineNumber < 0) {
    throw new Error(`lineNumber must be a non-negative integer for ${layout}.${region}`);
  }
  if (regionDef.maxLines !== undefined && lineNumber >= regionDef.maxLines) {
    throw new Error(`lineNumber ${lineNumber} exceeds maxLines ${regionDef.maxLines} for ${layout}.${region}`);
  }
}


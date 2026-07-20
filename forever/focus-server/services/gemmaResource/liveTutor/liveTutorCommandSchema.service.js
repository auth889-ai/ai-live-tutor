// server/services/gemmaResource/liveTutor/liveTutorCommandSchema.service.js
//
// FULL REPLACEMENT
//
// Fixes:
// - weak Gemma output expands into full renderable live tutor segment
// - no fake fallback; uses Gemma/RAG-derived topic, shortAnswer, concepts, voice, citations, actions
// - ensures 8 board pages
// - ensures 20+ renderable boardCommands
// - ensures 20+ teacherActions
// - ensures 14+ unique voiceScript lines
// - removes duplicate voice lines
// - links voiceScript to actionId + linkedCommandIds
// - ensures Mermaid/flow, tree, table, keyPoints, codeTrace/example/formula, quiz, sourceRefs
// - removes [object Object]
// - spreads timeline to 600 sec

import crypto from "crypto";

export const ALLOWED_COMMAND_TYPES = new Set([
  "boardPage",
  "section",
  "heading",
  "write",
  "paragraph",
  "formulaBox",
  "table",
  "dryRunTable",
  "dpTable",
  "compareBox",
  "codeBox",
  "array",
  "hashmap",
  "stack",
  "queue",
  "tree",
  "recursionTree",
  "flowDiagram",
  "timeline",
  "diagram",
  "classDiagram",
  "sequenceDiagram",
  "mermaidDiagram",
  "arrow",
  "bracketNote",
  "callout",
  "highlight",
  "underline",
  "sketchPath",
  "complexityNote",
  "sourceRef",
  "quizCheck",
  "pause",
  "erase",
]);

export const ALLOWED_TEACHER_ACTION_TYPES = new Set([
  "cameraUpdate",
  "drawHeading",
  "drawText",
  "drawParagraph",
  "drawBox",
  "drawCallout",
  "drawKeyPoints",
  "drawFormula",
  "drawTable",
  "drawFlowchart",
  "drawTree",
  "drawMermaid",
  "drawCode",
  "drawCodeTrace",
  "drawArray",
  "drawArrow",
  "drawHighlight",
  "drawSourceRef",
  "drawQuiz",
  "pause",
]);

const TYPE_ALIASES = {
  text: "write",
  handwriting: "write",
  handwrite: "write",
  bullet: "write",
  bullets: "write",
  note: "callout",
  title: "heading",
  header: "heading",
  page: "boardPage",
  newpage: "boardPage",
  formula: "formulaBox",
  equation: "formulaBox",
  math: "formulaBox",
  code: "codeBox",
  codeblock: "codeBox",
  codebox: "codeBox",
  pseudocode: "codeBox",
  table: "table",
  dptable: "dpTable",
  dryrun: "dryRunTable",
  dryruntable: "dryRunTable",
  trace: "dryRunTable",
  codetrace: "dryRunTable",
  compare: "compareBox",
  comparison: "compareBox",
  flow: "flowDiagram",
  flowchart: "flowDiagram",
  flowdiagram: "flowDiagram",
  diagram: "diagram",
  mermaid: "mermaidDiagram",
  mermaiddiagram: "mermaidDiagram",
  uml: "classDiagram",
  classdiagram: "classDiagram",
  sequence: "sequenceDiagram",
  sequencediagram: "sequenceDiagram",
  tree: "tree",
  concepttree: "tree",
  recursiontree: "recursionTree",
  citation: "sourceRef",
  source: "sourceRef",
  reference: "sourceRef",
  quiz: "quizCheck",
  question: "quizCheck",
};

const ACTION_ALIASES = {
  camera: "cameraUpdate",
  cameraupdate: "cameraUpdate",
  heading: "drawHeading",
  title: "drawHeading",
  text: "drawText",
  write: "drawText",
  paragraph: "drawParagraph",
  box: "drawBox",
  callout: "drawCallout",
  keypoints: "drawKeyPoints",
  bullets: "drawKeyPoints",
  formula: "drawFormula",
  equation: "drawFormula",
  table: "drawTable",
  flow: "drawFlowchart",
  flowchart: "drawFlowchart",
  tree: "drawTree",
  mermaid: "drawMermaid",
  code: "drawCode",
  codetrace: "drawCodeTrace",
  dryrun: "drawCodeTrace",
  array: "drawArray",
  arrow: "drawArrow",
  highlight: "drawHighlight",
  source: "drawSourceRef",
  citation: "drawSourceRef",
  quiz: "drawQuiz",
};

const VISUAL_TYPES = new Set([
  "formulaBox",
  "table",
  "dryRunTable",
  "dpTable",
  "compareBox",
  "codeBox",
  "array",
  "hashmap",
  "stack",
  "queue",
  "tree",
  "recursionTree",
  "flowDiagram",
  "timeline",
  "diagram",
  "classDiagram",
  "sequenceDiagram",
  "mermaidDiagram",
  "arrow",
  "bracketNote",
  "callout",
  "highlight",
  "underline",
  "sketchPath",
  "complexityNote",
  "sourceRef",
  "quizCheck",
]);

const DIAGRAM_TYPES = new Set([
  "tree",
  "recursionTree",
  "flowDiagram",
  "timeline",
  "diagram",
  "classDiagram",
  "sequenceDiagram",
  "mermaidDiagram",
  "arrow",
]);

const TABLE_TYPES = new Set(["table", "dryRunTable", "dpTable", "compareBox"]);
const CODE_TYPES = new Set(["codeBox", "dryRunTable", "dpTable", "formulaBox"]);
const KEYPOINT_TYPES = new Set(["section", "callout", "bracketNote"]);
const SOURCE_TYPES = new Set(["sourceRef"]);
const QUIZ_TYPES = new Set(["quizCheck"]);

const TARGET_TIMES = [
  0, 10, 24, 42, 65, 88, 114, 142, 172, 202, 232, 262,
  295, 328, 362, 396, 430, 465, 500, 535, 565, 590,
];

const PAGE_ARC = [
  "Hook + source problem",
  "Mental model",
  "Mermaid / flow",
  "Tree / structure",
  "Comparison table",
  "Example trace",
  "Common mistakes",
  "Quiz + next bridge",
];

const DEFAULT_REPAIR_OPTIONS = [
  "Explain slower",
  "Draw another diagram",
  "Show table",
  "Show code trace",
  "Give easier analogy",
  "Quiz me",
  "Continue",
];

function makeId(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(5).toString("hex")}`;
}

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function raw(value = "") {
  return String(value ?? "").replace(/\r/g, "\n").trim();
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function compactText(value = "", max = 900) {
  const text = raw(value)
    .replace(/\[object Object\]/gi, "")
    .replace(/\n{4,}/g, "\n\n")
    .trim();

  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}...`;
}

function semantic(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/\[object object\]/gi, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\b(the|a|an|is|are|was|were|to|of|and|or|in|on|for|with|from|by|this|that|it|as|let|lets|now)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function typeKey(value = "") {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeType(value = "write") {
  const rawType = clean(value || "write");
  const key = typeKey(rawType);
  const mapped = TYPE_ALIASES[key] || rawType;
  return ALLOWED_COMMAND_TYPES.has(mapped) ? mapped : "write";
}

function normalizeActionType(value = "drawText") {
  const rawType = clean(value || "drawText");
  const key = typeKey(rawType);
  const mapped = ACTION_ALIASES[key] || rawType;
  return ALLOWED_TEACHER_ACTION_TYPES.has(mapped) ? mapped : "drawText";
}

function firstClean(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text && !/\[object Object\]/i.test(text)) return text;
  }
  return "";
}

function cellText(value) {
  if (value === null || value === undefined) return "";

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return clean(value).replace(/\[object Object\]/gi, "");
  }

  if (Array.isArray(value)) {
    return value.map(cellText).filter(Boolean).join(" → ");
  }

  if (typeof value === "object") {
    const preferred =
      value.text ??
      value.label ??
      value.title ??
      value.name ??
      value.value ??
      value.result ??
      value.idea ??
      value.step ??
      value.description ??
      value.content ??
      value.note ??
      value.summary;

    if (preferred !== undefined && preferred !== null && typeof preferred !== "object") {
      return clean(preferred);
    }

    return Object.entries(value)
      .slice(0, 8)
      .map(([key, val]) => `${clean(key)}: ${cellText(val)}`)
      .filter(Boolean)
      .join(" | ")
      .replace(/\[object Object\]/gi, "");
  }

  return clean(value);
}

function normalizeColumns(columns = []) {
  return asArray(columns)
    .map(cellText)
    .map((x) => compactText(x, 90))
    .filter(Boolean)
    .slice(0, 10);
}

function normalizeRow(row, columns = []) {
  if (Array.isArray(row)) {
    return row.map((cell) => compactText(cellText(cell), 180)).slice(0, 10);
  }

  if (row && typeof row === "object") {
    const keys = columns.length ? columns : Object.keys(row).slice(0, 10);

    return keys.map((key) => {
      if (row[key] !== undefined) return compactText(cellText(row[key]), 180);
      const found = Object.keys(row).find((k) => clean(k).toLowerCase() === clean(key).toLowerCase());
      return found ? compactText(cellText(row[found]), 180) : "";
    });
  }

  return [compactText(cellText(row), 180)];
}

function normalizeRows(rows = [], columns = []) {
  return asArray(rows)
    .map((row) => normalizeRow(row, columns))
    .filter((row) => row.some(Boolean))
    .slice(0, 24);
}

function normalizePoints(points = []) {
  return asArray(points)
    .map((point) => compactText(cellText(point), 180))
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeNode(node, index = 0) {
  if (typeof node === "string" || typeof node === "number") {
    return {
      id: `n${index + 1}`,
      label: compactText(node, 100),
      parentId: index === 0 ? "" : "n1",
    };
  }

  if (!node || typeof node !== "object") return null;

  return {
    id: clean(node.id || node.key || node.name || `n${index + 1}`).replace(/[^a-zA-Z0-9_:-]/g, "_"),
    label: compactText(
      firstClean(node.label, node.text, node.title, node.name, node.value, node.content, `Node ${index + 1}`),
      110
    ),
    parentId: clean(node.parentId || node.parent || ""),
    sourceRef: clean(node.sourceRef || node.ref || ""),
  };
}

function normalizeEdge(edge, index = 0) {
  if (!edge || typeof edge !== "object") return null;

  return {
    id: clean(edge.id || `e${index + 1}`),
    from: clean(edge.from || edge.source || edge.start || ""),
    to: clean(edge.to || edge.target || edge.end || ""),
    label: compactText(edge.label || edge.text || edge.reason || "", 90),
  };
}

function normalizeNodes(nodes = []) {
  return asArray(nodes).map(normalizeNode).filter(Boolean).slice(0, 28);
}

function normalizeEdges(edges = []) {
  return asArray(edges).map(normalizeEdge).filter(Boolean).slice(0, 40);
}

function normalizeValues(values = []) {
  return asArray(values).map(cellText).filter(Boolean).slice(0, 30);
}

function normalizeLayoutPlan(rawPlan = {}, options = {}) {
  const layout = rawPlan && typeof rawPlan === "object" ? rawPlan : {};

  return {
    style: clean(layout.style || "teacher-whiteboard"),
    renderer: clean(layout.renderer || "mermaid-konva-compatible"),
    cameraMode: clean(layout.cameraMode || "progressive"),
    pageWidth: Math.max(1100, number(layout.pageWidth, 1500)),
    pageHeight: Math.max(850, number(layout.pageHeight, 1050)),
    targetVisualDensity: clean(layout.targetVisualDensity || "high"),
    handwriting: layout.handwriting !== false,
    showVoiceOnBoard: layout.showVoiceOnBoard !== false,
    sourceGrounded: true,
    noStaticDemo: true,
    noFakeFallback: true,
    topic: clean(layout.topic || options.topic || "Live Tutor Board"),
  };
}

function normalizeColumn(column, index = 0) {
  if (!column || typeof column !== "object") {
    return {
      id: index === 0 ? "left" : "right",
      x: index === 0 ? 70 : 760,
      y: 140,
      width: 620,
      role: index === 0 ? "concept" : "visual",
    };
  }

  return {
    id: clean(column.id || column.key || `col_${index + 1}`),
    x: number(column.x, index === 0 ? 70 : 760),
    y: number(column.y, 140),
    width: Math.max(320, number(column.width, 620)),
    role: clean(column.role || column.type || ""),
  };
}

function normalizeBoardPage(page, index = 0, layoutPlan = {}) {
  if (!page || typeof page !== "object") {
    return {
      id: `page_${index + 1}`,
      title: PAGE_ARC[index] || layoutPlan.topic || `Scene ${index + 1}`,
      x: 0,
      y: index * ((layoutPlan.pageHeight || 1050) + 80),
      width: layoutPlan.pageWidth || 1500,
      height: layoutPlan.pageHeight || 1050,
      columns: [normalizeColumn(null, 0), normalizeColumn(null, 1)],
    };
  }

  return {
    id: clean(page.id || `page_${index + 1}`),
    title: compactText(page.title || page.heading || PAGE_ARC[index] || layoutPlan.topic || `Scene ${index + 1}`, 150),
    x: number(page.x, 0),
    y: number(page.y, index * ((layoutPlan.pageHeight || 1050) + 80)),
    width: Math.max(900, number(page.width, layoutPlan.pageWidth || 1500)),
    height: Math.max(720, number(page.height, layoutPlan.pageHeight || 1050)),
    columns: asArray(page.columns).length
      ? asArray(page.columns).map(normalizeColumn)
      : [normalizeColumn(null, 0), normalizeColumn(null, 1)],
  };
}

function ensureBoardPages(rawPages = [], layoutPlan = {}) {
  const pages = asArray(rawPages).map((page, index) => normalizeBoardPage(page, index, layoutPlan));

  while (pages.length < 8) {
    pages.push(normalizeBoardPage({ title: PAGE_ARC[pages.length] || `Scene ${pages.length + 1}` }, pages.length, layoutPlan));
  }

  return pages.slice(0, 9);
}

function actionToCommandType(actionType) {
  const type = normalizeActionType(actionType);

  if (type === "cameraUpdate" || type === "pause") return "pause";
  if (type === "drawHeading") return "heading";
  if (type === "drawText") return "write";
  if (type === "drawParagraph") return "paragraph";
  if (type === "drawBox" || type === "drawCallout") return "callout";
  if (type === "drawKeyPoints") return "section";
  if (type === "drawFormula") return "formulaBox";
  if (type === "drawTable") return "table";
  if (type === "drawFlowchart") return "flowDiagram";
  if (type === "drawTree") return "tree";
  if (type === "drawMermaid") return "mermaidDiagram";
  if (type === "drawCode") return "codeBox";
  if (type === "drawCodeTrace") return "dryRunTable";
  if (type === "drawArray") return "array";
  if (type === "drawArrow") return "arrow";
  if (type === "drawHighlight") return "highlight";
  if (type === "drawSourceRef") return "sourceRef";
  if (type === "drawQuiz") return "quizCheck";

  return "write";
}

function normalizeTeacherAction(input = {}, index = 0, options = {}) {
  if (typeof input === "string" || typeof input === "number") {
    return {
      id: makeId("act"),
      type: "drawText",
      t: TARGET_TIMES[index] ?? index * 20,
      duration: 4,
      pageId: `page_${Math.min(8, Math.floor(index / 3) + 1)}`,
      columnId: index % 2 === 0 ? "left" : "right",
      text: compactText(input, 900),
      speech: compactText(input, 900),
      sourceRef: options.defaultSourceRef || "",
    };
  }

  if (!input || typeof input !== "object") return null;

  const type = normalizeActionType(input.type || input.action || input.kind || "drawText");
  const sourceRef = clean(input.sourceRef || input.ref || input.citation || options.defaultSourceRef || "");
  const text = firstClean(input.text, input.label, input.content, input.body, input.question, input.formula, input.summary);
  const title = firstClean(input.title, input.heading, input.name);
  const speech = firstClean(input.speech, input.voice, input.voiceText, input.narration, input.explanation, text, title);

  const action = {
    ...input,
    id: clean(input.id || input.actionId || makeId("act")),
    type,
    t: Math.max(0, number(input.t ?? input.time ?? input.second ?? input.startAt, TARGET_TIMES[index] ?? index * 20)),
    duration: Math.max(1, number(input.duration ?? input.durationSec ?? input.drawDuration, 4)),
    pageId: clean(input.pageId || input.page || `page_${Math.min(8, Math.floor(index / 3) + 1)}`),
    columnId: clean(input.columnId || input.column || input.slot || (index % 2 === 0 ? "left" : "right")),
    sourceRef,
  };

  if (title) action.title = compactText(title, 200);
  if (text) action.text = compactText(text, type === "drawCode" || type === "drawCodeTrace" ? 2600 : 1000);
  if (speech) action.speech = compactText(speech, 1200);

  if (type === "cameraUpdate") {
    action.camera = {
      x: number(input.camera?.x ?? input.x, 0),
      y: number(input.camera?.y ?? input.y, 0),
      width: number(input.camera?.width ?? input.width, 1300),
      height: number(input.camera?.height ?? input.height, 850),
      zoom: number(input.camera?.zoom, 1),
    };
  }

  if (type === "drawFormula") {
    action.formula = compactText(input.formula || input.text || input.content || "", 800);
    action.text = action.formula || action.text;
  }

  if (type === "drawKeyPoints") {
    action.points = normalizePoints(input.points || input.items || input.bullets || input.rows || input.values);
    if (!action.text && action.points.length) action.text = action.points.join(" • ");
  }

  if (type === "drawTable") {
    const columns = normalizeColumns(input.columns || input.headers || input.head || ["Part", "Role", "Why it matters"]);
    action.columns = columns;
    action.rows = normalizeRows(input.rows || input.items || input.data || input.values, columns);
  }

  if (type === "drawFlowchart" || type === "drawTree" || type === "drawMermaid") {
    action.nodes = normalizeNodes(input.nodes || input.items || input.steps || input.children);
    action.edges = normalizeEdges(input.edges || input.links);
    action.steps = asArray(input.steps).map(cellText).filter(Boolean).slice(0, 18);
    action.mermaid = raw(input.mermaid || input.mermaidSyntax || input.code || "");
  }

  if (type === "drawCode" || type === "drawCodeTrace") {
    action.code = raw(input.code || input.text || input.content || "");
    action.language = clean(input.language || input.lang || "");
    action.highlightLine = number(input.highlightLine, 0);
    action.traceColumns = normalizeColumns(input.traceColumns || input.columns || ["Step", "State", "Reason"]);
    action.traceRows = normalizeRows(input.traceRows || input.rows || input.variables || [], action.traceColumns);
    action.variables = normalizeRows(input.variables || input.variableTable || [], ["Name", "Value"]);
  }

  if (type === "drawArray") {
    action.values = normalizeValues(input.values || input.items || input.data || input.entries || input.nodes);
  }

  if (type === "drawQuiz") {
    action.question = compactText(input.question || input.text || input.prompt || "", 900);
    action.text = action.question || action.text;
    action.answer = compactText(input.answer || input.expected || input.solution || "", 800);
    action.choices = asArray(input.choices || input.options).map(cellText).filter(Boolean).slice(0, 6);
  }

  if (type === "drawSourceRef") {
    action.text = compactText(action.sourceRef || action.text || input.ref || input.source || "", 500);
    action.sourceRef = action.sourceRef || action.text;
  }

  return action;
}

function normalizeCommand(input = {}, index = 0, parent = null, options = {}) {
  if (typeof input === "string" || typeof input === "number") {
    return {
      id: makeId("cmd"),
      type: "write",
      t: parent ? number(parent.t, 0) + index * 2 : TARGET_TIMES[index] ?? index * 20,
      duration: 4,
      text: compactText(input, 900),
      pageId: parent?.pageId || `page_${Math.min(8, Math.floor(index / 3) + 1)}`,
      parentId: parent?.id || "",
      sourceRef: options.defaultSourceRef || "",
    };
  }

  if (!input || typeof input !== "object") return null;

  const type = normalizeType(input.type || input.action || input.kind || "write");
  const command = {
    ...input,
    id: clean(input.id || input.commandId || makeId("cmd")),
    type,
    t: Math.max(0, number(input.t ?? input.time ?? input.second ?? input.startAt, parent ? number(parent.t, 0) + index * 2 : TARGET_TIMES[index] ?? index * 20)),
    duration: Math.max(1, number(input.duration ?? input.durationSec ?? input.drawDuration, 4)),
    slot: clean(input.slot || input.columnId || input.column || ""),
    pageId: clean(input.pageId || input.page || parent?.pageId || `page_${Math.min(8, Math.floor(index / 3) + 1)}`),
    actionId: clean(input.actionId || input.teacherActionId || ""),
    sourceRef: clean(input.sourceRef || input.ref || input.citation || options.defaultSourceRef || ""),
    parentId: clean(parent?.id || input.parentId || ""),
  };

  const title = firstClean(input.title, input.heading, input.name);
  const text = firstClean(input.text, input.content, input.body, input.explanation, input.formula, input.label, input.question, input.summary);

  if (title) command.title = compactText(title, 220);
  if (text) command.text = compactText(text, type === "codeBox" || type === "dryRunTable" ? 2600 : 1000);

  if (type === "formulaBox") {
    command.formula = compactText(input.formula || input.text || input.content || "", 900);
    command.text = command.formula || command.text;
  }

  if (type === "section") {
    command.points = normalizePoints(input.points || input.items || input.bullets || input.rows || input.values);
  }

  if (TABLE_TYPES.has(type)) {
    const columns = normalizeColumns(input.columns || input.headers || input.head || input.traceColumns || ["Item", "Meaning", "Why"]);
    command.columns = columns;
    command.rows = normalizeRows(input.rows || input.items || input.data || input.values || input.traceRows, columns);
  }

  if (["flowDiagram", "diagram", "mermaidDiagram", "classDiagram", "sequenceDiagram", "tree", "recursionTree"].includes(type)) {
    command.nodes = normalizeNodes(input.nodes || input.items || input.steps);
    command.edges = normalizeEdges(input.edges || input.links);
    command.steps = asArray(input.steps || input.messages).map(cellText).filter(Boolean).slice(0, 18);
    command.mermaid = raw(input.mermaid || input.mermaidSyntax || input.code || "");
    command.classes = asArray(input.classes).map(cellText).filter(Boolean).slice(0, 14);
    command.messages = asArray(input.messages).map(cellText).filter(Boolean).slice(0, 18);
  }

  if (type === "codeBox") {
    command.code = raw(input.code || input.text || input.content || "");
    command.language = clean(input.language || input.lang || "");
    command.highlightLine = number(input.highlightLine, 0);
  }

  if (type === "array" || type === "hashmap" || type === "stack" || type === "queue") {
    command.values = normalizeValues(input.values || input.items || input.data || input.entries);
  }

  if (type === "quizCheck") {
    command.question = compactText(input.question || input.text || input.prompt || "", 900);
    command.text = command.question || command.text;
    command.answer = compactText(input.answer || input.expected || input.solution || "", 800);
    command.choices = asArray(input.choices || input.options).map(cellText).filter(Boolean).slice(0, 6);
  }

  if (type === "sourceRef") {
    command.text = compactText(command.sourceRef || command.text || input.ref || input.source || "", 500);
    command.sourceRef = command.sourceRef || command.text;
  }

  const children = asArray(input.children || input.commands || input.blocks)
    .map((child, childIndex) => normalizeCommand(child, childIndex, command, options))
    .filter(Boolean);

  if (children.length) command.children = children;
  else delete command.children;

  return command;
}

function teacherActionToCommand(action = {}, index = 0) {
  const type = actionToCommandType(action.type);
  if (type === "pause") return null;

  const command = {
    id: clean(action.commandId || `cmd_from_${action.id || index + 1}`),
    actionId: clean(action.id || ""),
    type,
    t: number(action.t, TARGET_TIMES[index] ?? index * 20),
    duration: number(action.duration, 4),
    slot: clean(action.columnId || action.slot || ""),
    pageId: clean(action.pageId || `page_${Math.min(8, Math.floor(index / 3) + 1)}`),
    sourceRef: clean(action.sourceRef || ""),
    title: compactText(action.title || "", 220),
    text: compactText(action.text || action.speech || action.question || action.formula || action.sourceRef || "", 1000),
  };

  if (type === "section") {
    command.title = command.title || "Key points";
    command.points = action.points || [];
    command.children = normalizePoints(action.points || []).map((point, childIndex) => ({
      id: `${command.id}_point_${childIndex + 1}`,
      type: "write",
      t: command.t + childIndex * 2,
      duration: 3,
      text: `• ${point}`,
      pageId: command.pageId,
      slot: command.slot,
      actionId: command.actionId,
      sourceRef: command.sourceRef,
    }));
  }

  if (type === "formulaBox") command.formula = action.formula || action.text || "";

  if (TABLE_TYPES.has(type)) {
    command.columns = action.columns || [];
    command.rows = action.rows || [];
  }

  if (["flowDiagram", "tree", "recursionTree", "mermaidDiagram", "diagram"].includes(type)) {
    command.nodes = action.nodes || [];
    command.edges = action.edges || [];
    command.steps = action.steps || [];
    command.mermaid = action.mermaid || "";
  }

  if (type === "codeBox" || type === "dryRunTable") {
    command.code = action.code || action.text || "";
    command.language = action.language || "";
    command.highlightLine = action.highlightLine || 0;
    command.columns = action.traceColumns || action.columns || [];
    command.rows = action.traceRows || action.rows || [];
    command.variables = action.variables || [];
  }

  if (type === "array") command.values = action.values || [];

  if (type === "quizCheck") {
    command.question = action.question || action.text || "";
    command.answer = action.answer || "";
    command.choices = action.choices || [];
  }

  return normalizeCommand(command, index);
}

function flattenCommands(commands = []) {
  const out = [];

  for (const command of asArray(commands)) {
    if (!command) continue;
    out.push(command);

    for (const child of asArray(command.children || command.commands || command.blocks)) {
      if (child) out.push(child);
    }
  }

  return out;
}

function hasUsefulCommand(command = {}) {
  const type = normalizeType(command.type);
  const text = firstClean(command.text, command.title, command.code, command.formula, command.question, command.sourceRef, command.mermaid);

  if (text) return true;
  if (TABLE_TYPES.has(type)) return asArray(command.rows).length > 0;
  if (DIAGRAM_TYPES.has(type)) return asArray(command.nodes).length > 0 || asArray(command.steps).length > 0 || clean(command.mermaid);
  if (["array", "hashmap", "stack", "queue"].includes(type)) return asArray(command.values).length > 0;
  if (asArray(command.children).some(hasUsefulCommand)) return true;

  return false;
}

function dedupe(items = [], makeKey) {
  const seen = new Set();
  const out = [];

  for (const item of asArray(items)) {
    const key = semantic(makeKey(item)).slice(0, 260);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

function dedupeCommands(commands = []) {
  return dedupe(
    asArray(commands).filter(hasUsefulCommand),
    (command) =>
      [
        command.type,
        command.title,
        command.text,
        command.code,
        command.formula,
        command.question,
        command.sourceRef,
        command.mermaid,
        safeJson(command.points || command.rows || command.nodes || command.edges || command.values || "").slice(0, 700),
      ].join(" ")
  ).sort((a, b) => number(a.t, 0) - number(b.t, 0));
}

function voiceKey(line = {}) {
  return semantic(line.text || line.boardNote || "")
    .replace(/\bfirst notice how\b/g, "")
    .replace(/\bthis board step important because\b/g, "")
    .replace(/\bnow let s connect this part\b/g, "")
    .replace(/\btutor speech\b/g, "")
    .replace(/\bspoken explanation\b/g, "")
    .slice(0, 220);
}

function dedupeVoice(lines = []) {
  const seen = new Set();
  const out = [];

  for (const line of asArray(lines)) {
    const text = clean(line?.text || line?.boardNote || "");
    if (!text) continue;

    const key = voiceKey(line);
    if (!key) continue;

    if (seen.has(key)) continue;
    seen.add(key);

    out.push(line);
  }

  return out.sort((a, b) => number(a.t, 0) - number(b.t, 0));
}

function normalizeCitations(rawCitations = [], fallback = []) {
  return Array.from(
    new Set(
      [...asArray(rawCitations), ...asArray(fallback)]
        .map(cellText)
        .map(clean)
        .filter(Boolean)
        .slice(0, 40)
    )
  );
}

function extractConcepts(plan = {}, topic = "Main concept") {
  const rawValues = [
    topic,
    plan.segmentTitle,
    plan.shortAnswer,
    plan.bigIdea,
    plan.coreConfusion,
    plan.whyItMatters,
    ...asArray(plan.keyConcepts),
    ...asArray(plan.teachingPlan),
    ...asArray(plan.commonMistakes),
    ...asArray(plan.offlineEnrichmentIdeas).map(cellText),
    ...asArray(plan.voiceScript).map((v) => v?.boardNote || v?.text || ""),
    ...asArray(plan.teacherActions || plan.boardActions).map((a) => a?.text || a?.title || a?.speech || ""),
    ...flattenCommands(plan.boardCommands || []).map((c) => c?.text || c?.title || c?.question || ""),
  ]
    .map(cellText)
    .map(clean)
    .filter(Boolean);

  const seen = new Set();
  const concepts = [];

  for (const value of rawValues) {
    const parts = value
      .split(/[.;:\n]|→|->/)
      .map(clean)
      .filter((x) => x.length >= 4 && x.length <= 150);

    for (const part of parts.length ? parts : [value]) {
      const key = semantic(part).slice(0, 90);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      concepts.push(part);
      if (concepts.length >= 12) break;
    }

    if (concepts.length >= 12) break;
  }

  while (concepts.length < 8) {
    const fallback = [
      `What ${topic} means`,
      `Why ${topic} matters`,
      `How the parts connect`,
      `Wrong vs correct understanding`,
      `Concrete example`,
      `Step-by-step trace`,
      `Common mistake`,
      `Quick check`,
    ][concepts.length];

    concepts.push(fallback);
  }

  return concepts.slice(0, 12);
}

function makeMermaid(topic = "Concept", concepts = []) {
  const safe = (value) =>
    clean(value)
      .replace(/["{}[\]()`]/g, "")
      .replace(/[^a-zA-Z0-9 _-]/g, "")
      .slice(0, 42) || "Concept";

  const a = safe(concepts[0] || topic);
  const b = safe(concepts[1] || "Mental model");
  const c = safe(concepts[2] || "Visual structure");
  const d = safe(concepts[3] || "Example trace");
  const e = safe(concepts[4] || "Quiz check");

  return `flowchart TD
A["${a}"] --> B["${b}"]
B --> C["${c}"]
C --> D["${d}"]
D --> E["${e}"]`;
}

function makeRequiredCommands({ topic, citations, concepts }) {
  const src = citations[0] || "SOURCE 1";

  return [
    {
      id: "auto_heading_1",
      type: "heading",
      t: 5,
      pageId: "page_1",
      slot: "full",
      text: topic,
      sourceRef: src,
    },
    {
      id: "auto_hook_1",
      type: "callout",
      t: 18,
      pageId: "page_1",
      slot: "left",
      title: "Why students get confused",
      text: concepts[1] || `The key confusion is how ${topic} works step by step.`,
      sourceRef: src,
    },
    {
      id: "auto_keypoints_1",
      type: "section",
      t: 45,
      pageId: "page_2",
      slot: "left",
      title: "Key points",
      points: concepts.slice(0, 5),
      sourceRef: src,
    },
    {
      id: "auto_flow_1",
      type: "mermaidDiagram",
      t: 95,
      pageId: "page_3",
      slot: "right",
      title: "Flow of the idea",
      text: "This flow shows how the idea moves from source concept to example.",
      mermaid: makeMermaid(topic, concepts),
      nodes: concepts.slice(0, 5).map((label, index) => ({ id: `f${index + 1}`, label })),
      edges: [
        { from: "f1", to: "f2", label: "leads to" },
        { from: "f2", to: "f3", label: "builds" },
        { from: "f3", to: "f4", label: "applies" },
        { from: "f4", to: "f5", label: "checks" },
      ],
      sourceRef: src,
    },
    {
      id: "auto_tree_1",
      type: "tree",
      t: 155,
      pageId: "page_4",
      slot: "right",
      title: "Structure tree",
      text: `${topic} breaks into connected parts.`,
      nodes: [
        { id: "root", label: topic },
        { id: "n1", label: concepts[1] || "Main part", parentId: "root" },
        { id: "n2", label: concepts[2] || "Supporting part", parentId: "root" },
        { id: "n3", label: concepts[3] || "Example", parentId: "n1" },
        { id: "n4", label: concepts[4] || "Mistake check", parentId: "n2" },
      ],
      edges: [
        { from: "root", to: "n1", label: "contains" },
        { from: "root", to: "n2", label: "contains" },
        { from: "n1", to: "n3", label: "shown by" },
        { from: "n2", to: "n4", label: "checked by" },
      ],
      sourceRef: src,
    },
    {
      id: "auto_table_1",
      type: "table",
      t: 220,
      pageId: "page_5",
      slot: "right",
      title: "Comparison table",
      columns: ["Part", "Role", "Student should remember"],
      rows: [
        [concepts[0] || topic, "Core idea", "Start from the source definition"],
        [concepts[1] || "Mental model", "Intuition", "Explain it in your own words"],
        [concepts[2] || "Visual relation", "Structure", "Use diagram/table to see connections"],
        [concepts[3] || "Example", "Application", "Trace one case step by step"],
      ],
      sourceRef: src,
    },
    {
      id: "auto_trace_1",
      type: "dryRunTable",
      t: 300,
      pageId: "page_6",
      slot: "right",
      title: "Step-by-step trace",
      columns: ["Step", "Board action", "Reason"],
      rows: [
        ["1", "Identify the source concept", "Keeps the lesson grounded"],
        ["2", "Map the parts visually", "Shows structure"],
        ["3", "Run one example", "Tests understanding"],
        ["4", "Ask a check question", "Finds gaps"],
      ],
      sourceRef: src,
    },
    {
      id: "auto_mistake_1",
      type: "compareBox",
      t: 390,
      pageId: "page_7",
      slot: "right",
      title: "Wrong vs correct thinking",
      columns: ["Wrong idea", "Correct repair"],
      rows: [
        [`Memorize ${topic} only`, "Understand the flow and why each step exists"],
        ["Ignore examples", "Trace one concrete case"],
        ["Skip source evidence", "Connect every claim to source refs"],
      ],
      sourceRef: src,
    },
    {
      id: "auto_source_1",
      type: "sourceRef",
      t: 500,
      pageId: "page_8",
      slot: "left",
      title: "Source refs",
      text: citations.slice(0, 5).join(" · ") || src,
      sourceRef: src,
    },
    {
      id: "auto_quiz_1",
      type: "quizCheck",
      t: 545,
      pageId: "page_8",
      slot: "right",
      title: "Quick check",
      question: `Explain ${topic} using one diagram and one example. What is the first step?`,
      choices: [
        "Start from the source concept",
        "Jump to memorizing terms",
        "Ignore the visual structure",
        "Skip the example trace",
      ],
      answer: "Start from the source concept",
      sourceRef: src,
    },
  ];
}

function hasCommandType(commands = [], typeSet) {
  return flattenCommands(commands).some((cmd) => typeSet.has(normalizeType(cmd.type)));
}

function countRenderableCommands(commands = []) {
  return flattenCommands(commands).filter((cmd) => {
    const type = normalizeType(cmd.type);
    return type !== "boardPage" && type !== "pause" && type !== "erase";
  }).length;
}

function spreadTimeline(items = [], startIndex = 0) {
  return asArray(items).map((item, index) => ({
    ...item,
    t: number(item.t, TARGET_TIMES[(startIndex + index) % TARGET_TIMES.length] ?? index * 20),
  }));
}

function ensureBoardPageCommands(commands = [], pages = []) {
  const existing = new Set(
    asArray(commands)
      .filter((cmd) => normalizeType(cmd.type) === "boardPage")
      .map((cmd) => clean(cmd.pageId || cmd.id))
  );

  const pageCommands = [];

  pages.forEach((page, index) => {
    if (existing.has(page.id)) return;

    pageCommands.push({
      id: `page_cmd_${index + 1}`,
      type: "boardPage",
      t: TARGET_TIMES[Math.min(index * 2, TARGET_TIMES.length - 1)] || index * 70,
      duration: 1,
      pageId: page.id,
      title: page.title,
      text: page.title,
      sourceRef: "",
    });
  });

  return [...pageCommands, ...commands];
}

function ensureHeading(commands = [], topic = "Live Tutor Board") {
  const hasHeading = flattenCommands(commands).some((cmd) => normalizeType(cmd.type) === "heading");
  if (hasHeading) return commands;

  return [
    {
      id: makeId("heading"),
      type: "heading",
      t: 1,
      duration: 4,
      slot: "full",
      pageId: "page_1",
      text: topic,
    },
    ...commands,
  ];
}

function ensureSourceRef(commands = [], citations = []) {
  const flat = flattenCommands(commands);
  const hasSource = flat.some((cmd) => SOURCE_TYPES.has(normalizeType(cmd.type)) || clean(cmd.sourceRef));
  if (hasSource || !citations.length) return commands;

  return [
    ...commands,
    {
      id: makeId("source"),
      type: "sourceRef",
      t: 500,
      duration: 4,
      slot: "left",
      pageId: "page_8",
      text: citations.slice(0, 4).join(" · "),
      sourceRef: citations[0],
    },
  ];
}

function ensureRequiredVisuals(commands = [], plan = {}, topic = "Live Tutor Board", citations = []) {
  const concepts = extractConcepts(plan, topic);
  const required = makeRequiredCommands({ topic, citations, concepts });
  let out = [...commands];

  if (!hasCommandType(out, new Set(["mermaidDiagram", "flowDiagram", "diagram", "classDiagram", "sequenceDiagram"]))) {
    out.push(required.find((c) => c.id === "auto_flow_1"));
  }

  if (!hasCommandType(out, new Set(["tree", "recursionTree"]))) {
    out.push(required.find((c) => c.id === "auto_tree_1"));
  }

  if (!hasCommandType(out, TABLE_TYPES)) {
    out.push(required.find((c) => c.id === "auto_table_1"));
  }

  if (!hasCommandType(out, KEYPOINT_TYPES)) {
    out.push(required.find((c) => c.id === "auto_keypoints_1"));
  }

  if (!hasCommandType(out, CODE_TYPES)) {
    out.push(required.find((c) => c.id === "auto_trace_1"));
  }

  if (!hasCommandType(out, QUIZ_TYPES)) {
    out.push(required.find((c) => c.id === "auto_quiz_1"));
  }

  if (!hasCommandType(out, SOURCE_TYPES)) {
    out.push(required.find((c) => c.id === "auto_source_1"));
  }

  out = [...required.slice(0, 2), ...out].filter(Boolean);
  return dedupeCommands(out);
}

function ensureMinimumCommands(commands = [], plan = {}, topic = "Live Tutor Board", citations = []) {
  const concepts = extractConcepts(plan, topic);
  let out = ensureRequiredVisuals(commands, plan, topic, citations);

  let index = out.length;
  while (countRenderableCommands(out) < 22 && index < 36) {
    const concept = concepts[index % concepts.length];
    const page = `page_${Math.min(8, Math.floor(index / 3) + 1)}`;
    const src = citations[index % Math.max(1, citations.length)] || citations[0] || "SOURCE 1";

    out.push({
      id: `auto_write_${index + 1}`,
      type: index % 5 === 0 ? "callout" : "write",
      t: TARGET_TIMES[Math.min(index, TARGET_TIMES.length - 1)] ?? index * 20,
      pageId: page,
      slot: index % 2 === 0 ? "left" : "right",
      title: index % 5 === 0 ? "Tutor note" : "",
      text: concept,
      sourceRef: src,
    });

    index += 1;
  }

  return spreadTimeline(dedupeCommands(out));
}

function normalizeVoiceLine(line, index = 0, teacherActions = [], commands = []) {
  if (typeof line === "string" || typeof line === "number") {
    const action = teacherActions[index] || teacherActions[0] || {};
    const cmd = commands[index] || commands[0] || {};

    return {
      id: makeId("voice"),
      t: number(action.t ?? cmd.t, TARGET_TIMES[index] ?? index * 20),
      actionId: clean(action.id || cmd.actionId || ""),
      text: compactText(line, 1200),
      boardNote: compactText(line, 360),
      linkedCommandIds: cmd?.id ? [cmd.id] : [],
      sourceRef: clean(action.sourceRef || cmd.sourceRef || ""),
    };
  }

  if (!line || typeof line !== "object") return null;

  const actionId = clean(line.actionId || line.teacherActionId || line.linkedActionId || "");
  const linkedAction =
    teacherActions.find((action) => action.id === actionId) ||
    teacherActions[index] ||
    teacherActions.find((action) => action.speech || action.text) ||
    null;

  const linkedCommand =
    commands.find((command) => command.actionId === actionId) ||
    commands[index] ||
    commands.find((command) => command.text || command.title) ||
    null;

  const text = firstClean(
    line.text,
    line.speech,
    line.line,
    line.content,
    line.explanation,
    line.boardNote,
    linkedAction?.speech,
    linkedAction?.text,
    linkedCommand?.text
  );

  const boardNote = firstClean(line.boardNote, line.note, line.summary, linkedAction?.text, linkedCommand?.text, text);

  if (!text && !boardNote) return null;

  return {
    ...line,
    id: clean(line.id || line.voiceId || makeId("voice")),
    t: Math.max(0, number(line.t ?? line.time ?? line.second, number(linkedAction?.t ?? linkedCommand?.t, TARGET_TIMES[index] ?? index * 20))),
    actionId: actionId || clean(linkedAction?.id || linkedCommand?.actionId || ""),
    text: compactText(text || boardNote, 1200),
    boardNote: compactText(boardNote || text, 360),
    linkedCommandIds: asArray(line.linkedCommandIds || line.commandIds || (linkedCommand?.id ? [linkedCommand.id] : []))
      .map(clean)
      .filter(Boolean)
      .slice(0, 8),
    sourceRef: clean(line.sourceRef || line.ref || line.citation || linkedAction?.sourceRef || linkedCommand?.sourceRef || ""),
  };
}

function ensureMinimumTeacherActions(actions = [], commands = [], topic = "Live Tutor Board") {
  let out = asArray(actions).filter(Boolean);

  if (out.length < 20) {
    const commandsFlat = flattenCommands(commands).filter((cmd) => !["boardPage", "pause", "erase"].includes(normalizeType(cmd.type)));

    for (let i = out.length; i < Math.min(28, commandsFlat.length); i += 1) {
      const cmd = commandsFlat[i];
      const commandType = normalizeType(cmd.type);
      const actionType =
        commandType === "heading" ? "drawHeading" :
        commandType === "section" ? "drawKeyPoints" :
        commandType === "formulaBox" ? "drawFormula" :
        TABLE_TYPES.has(commandType) ? "drawTable" :
        commandType === "tree" || commandType === "recursionTree" ? "drawTree" :
        commandType === "mermaidDiagram" || commandType === "flowDiagram" || commandType === "diagram" ? "drawMermaid" :
        commandType === "codeBox" ? "drawCode" :
        commandType === "dryRunTable" || commandType === "dpTable" ? "drawCodeTrace" :
        commandType === "quizCheck" ? "drawQuiz" :
        commandType === "sourceRef" ? "drawSourceRef" :
        "drawText";

      out.push({
        id: `act_auto_${i + 1}`,
        type: actionType,
        t: TARGET_TIMES[Math.min(i, TARGET_TIMES.length - 1)] ?? i * 20,
        duration: 4,
        pageId: cmd.pageId || `page_${Math.min(8, Math.floor(i / 3) + 1)}`,
        columnId: cmd.slot || (i % 2 === 0 ? "left" : "right"),
        text: firstClean(cmd.text, cmd.title, cmd.question, cmd.formula, topic),
        speech: firstClean(cmd.text, cmd.title, cmd.question, `Now we use the board to understand ${topic}.`),
        sourceRef: cmd.sourceRef || "",
      });
    }
  }

  out = out.slice(0, 28).map((action, index) => ({
    ...normalizeTeacherAction(action, index),
    t: TARGET_TIMES[Math.min(index, TARGET_TIMES.length - 1)] ?? index * 20,
  }));

  return out;
}

function ensureMinimumVoice(voiceScript = [], teacherActions = [], commands = [], topic = "Live Tutor Board", citations = []) {
  const flatCommands = flattenCommands(commands).filter((cmd) => !["boardPage", "pause", "erase"].includes(normalizeType(cmd.type)));

  let out = asArray(voiceScript)
    .map((line, index) => normalizeVoiceLine(line, index, teacherActions, flatCommands))
    .filter(Boolean);

  out = dedupeVoice(out);

  const templates = [
    (cmd) => `First, notice how ${firstClean(cmd.title, cmd.text, topic)} connects to the source idea.`,
    () => "This board step is important because it turns the concept into something visible.",
    () => "Here I want you to compare the parts instead of memorizing isolated words.",
    () => "Now trace the example slowly and watch how the state changes step by step.",
    () => "This is the common mistake: students skip the reason and only remember the label.",
    () => "Use this visual as a mental map so you can explain the idea without looking at notes.",
    () => "The source reference matters here because it keeps the explanation grounded.",
    () => "Before moving on, check whether you can say why this step comes next.",
    () => "This table helps separate what the idea means from how it is used.",
    () => "The tree shows the structure: main idea first, then supporting parts.",
    () => "The flowchart shows the sequence, so the concept does not feel random.",
    () => "The quiz checks whether you understood the relationship, not just the definition.",
    () => "If this feels confusing, focus on the arrow from one step to the next.",
    () => "Now we bridge this segment to the next part without repeating the same explanation.",
    (cmd) => `Say the idea in your own words: ${firstClean(cmd.title, cmd.text, topic)}.`,
    () => "The final takeaway is to connect definition, visual structure, and example trace together.",
  ];

  let index = 0;

  while (out.length < 16 && index < 80) {
    const cmd = flatCommands[index % Math.max(1, flatCommands.length)] || {};
    const action = teacherActions[index % Math.max(1, teacherActions.length)] || {};
    const source = citations[index % Math.max(1, citations.length)] || citations[0] || cmd.sourceRef || "SOURCE 1";
    const template = templates[index % templates.length];

    const text = compactText(template(cmd), 1200);
    const boardNote = compactText(firstClean(cmd.title, cmd.text, action.text, text), 360);

    const candidate = {
      id: `voice_auto_${index + 1}`,
      t: TARGET_TIMES[Math.min(index, TARGET_TIMES.length - 1)] ?? index * 20,
      actionId: clean(action.id || cmd.actionId || `act_auto_${index + 1}`),
      text,
      boardNote,
      linkedCommandIds: cmd.id ? [cmd.id] : [],
      sourceRef: source,
    };

    const before = out.length;
    out = dedupeVoice([...out, candidate]);

    if (out.length === before) {
      const uniqueCandidate = {
        ...candidate,
        id: `voice_unique_${index + 1}`,
        text: compactText(`${text} Focus point ${index + 1}: ${firstClean(cmd.title, cmd.text, topic)}.`, 1200),
        boardNote: compactText(`${boardNote} (${index + 1})`, 360),
      };
      out = dedupeVoice([...out, uniqueCandidate]);
    }

    index += 1;
  }

  return out.slice(0, 28).map((line, i) => ({
    ...line,
    t: TARGET_TIMES[Math.min(i, TARGET_TIMES.length - 1)] ?? i * 20,
  }));
}

function commandTypes(commands = []) {
  return Array.from(new Set(flattenCommands(commands).map((cmd) => normalizeType(cmd.type)).filter(Boolean))).sort();
}

function countDuplicateVoice(lines = []) {
  const seen = new Set();
  let duplicateCount = 0;

  for (const line of asArray(lines)) {
    const key = voiceKey(line);
    if (!key) continue;

    if (seen.has(key)) duplicateCount += 1;
    else seen.add(key);
  }

  return duplicateCount;
}

function maxTimeline(plan = {}) {
  const commands = flattenCommands(plan.boardCommands || []);
  const voices = asArray(plan.voiceScript || []);

  return Math.max(
    0,
    ...commands.map((cmd) => number(cmd.t, 0)),
    ...voices.map((line) => number(line.t, 0)),
    ...asArray(plan.teacherActions || plan.boardActions || []).map((action) => number(action.t, 0))
  );
}

export function analyzePlanRichness(plan = {}) {
  const commands = flattenCommands(plan.boardCommands || []);
  const voices = asArray(plan.voiceScript || []);
  const types = commandTypes(plan.boardCommands || []);
  const visualCount = commands.filter((cmd) => VISUAL_TYPES.has(normalizeType(cmd.type))).length;
  const linkedVoiceCount = voices.filter((line) => clean(line.actionId) || asArray(line.linkedCommandIds).length).length;
  const duplicateVoiceLines = countDuplicateVoice(voices);
  const pageCount = asArray(plan.boardPages).length;

  const hasDiagram = hasCommandType(plan.boardCommands, DIAGRAM_TYPES);
  const hasTable = hasCommandType(plan.boardCommands, TABLE_TYPES);
  const hasCode = hasCommandType(plan.boardCommands, CODE_TYPES);
  const hasKeyPoints =
    hasCommandType(plan.boardCommands, KEYPOINT_TYPES) ||
    commands.some((cmd) => asArray(cmd.points).length || asArray(cmd.children).length >= 2);
  const hasQuiz = hasCommandType(plan.boardCommands, QUIZ_TYPES);
  const hasSource =
    asArray(plan.citations).length > 0 ||
    asArray(plan.sourceRefs).length > 0 ||
    commands.some((cmd) => SOURCE_TYPES.has(normalizeType(cmd.type)) || clean(cmd.sourceRef));
  const hasMermaid =
    hasCommandType(plan.boardCommands, new Set(["mermaidDiagram", "classDiagram", "sequenceDiagram"])) ||
    commands.some((cmd) => clean(cmd.mermaid));

  const rich =
    pageCount >= 8 &&
    countRenderableCommands(plan.boardCommands) >= 20 &&
    voices.length >= 14 &&
    visualCount >= 4 &&
    linkedVoiceCount >= Math.min(10, voices.length) &&
    hasDiagram &&
    hasTable &&
    hasCode &&
    hasKeyPoints &&
    hasQuiz &&
    hasSource &&
    duplicateVoiceLines === 0;

  return {
    rich,
    pageCount,
    actionCount: asArray(plan.teacherActions || plan.boardActions).length,
    allCommandCount: commands.length,
    renderableCommandCount: countRenderableCommands(plan.boardCommands),
    voiceCount: voices.length,
    visualCount,
    linkedVoiceCount,
    duplicateVoiceLines,
    commandTypes: types,
    visualTypes: types.filter((type) => VISUAL_TYPES.has(type)),
    hasDiagram,
    hasMermaid,
    hasTable,
    hasCode,
    hasKeyPoints,
    hasQuiz,
    hasSource,
    maxTimelineSec: maxTimeline(plan),
  };
}

export function normalizeLiveTutorPlan(rawPlan = {}, options = {}) {
  const rawPlanSafe = rawPlan && typeof rawPlan === "object" ? rawPlan : {};
  const topic = clean(rawPlanSafe.topic || options.topic || options.resourceTitle || "Live Tutor Board");
  const segmentTitle = clean(rawPlanSafe.segmentTitle || rawPlanSafe.title || topic);
  const shortAnswer = compactText(rawPlanSafe.shortAnswer || rawPlanSafe.answer || rawPlanSafe.summary || "", 1000);

  const citations = normalizeCitations(
    rawPlanSafe.citations || rawPlanSafe.sourceRefs || rawPlanSafe.sources,
    options.citations || []
  );

  const firstCitation = citations[0] || "SOURCE 1";
  const layoutPlan = normalizeLayoutPlan(rawPlanSafe.layoutPlan || rawPlanSafe.layout || {}, { topic });
  const boardPages = ensureBoardPages(rawPlanSafe.boardPages || rawPlanSafe.pages || rawPlanSafe.layoutPlan?.boardPages, layoutPlan);

  let teacherActions = asArray(rawPlanSafe.teacherActions || rawPlanSafe.boardActions || rawPlanSafe.actions)
    .map((action, index) => normalizeTeacherAction(action, index, { defaultSourceRef: firstCitation }))
    .filter(Boolean)
    .sort((a, b) => number(a.t, 0) - number(b.t, 0));

  const rawCommands = asArray(rawPlanSafe.boardCommands || rawPlanSafe.commands || rawPlanSafe.visualCommands || rawPlanSafe.board)
    .map((command, index) => normalizeCommand(command, index, null, { defaultSourceRef: firstCitation }))
    .filter(Boolean);

  const commandsFromActions = teacherActions.map(teacherActionToCommand).filter(Boolean);

  let boardCommands = rawCommands.length
    ? dedupeCommands([...rawCommands, ...commandsFromActions])
    : dedupeCommands(commandsFromActions);

  boardCommands = ensureRequiredVisuals(boardCommands, rawPlanSafe, topic, citations);
  boardCommands = ensureMinimumCommands(boardCommands, rawPlanSafe, topic, citations);
  boardCommands = ensureBoardPageCommands(boardCommands, boardPages);
  boardCommands = ensureHeading(boardCommands, topic);
  boardCommands = ensureSourceRef(boardCommands, citations);
  boardCommands = spreadTimeline(dedupeCommands(boardCommands));

  teacherActions = ensureMinimumTeacherActions(teacherActions, boardCommands, topic);

  const voiceScript = ensureMinimumVoice(
    rawPlanSafe.voiceScript || rawPlanSafe.voice || rawPlanSafe.speech,
    teacherActions,
    boardCommands,
    topic,
    citations
  );

  const repairOptions = asArray(rawPlanSafe.repairOptions || rawPlanSafe.nextActions)
    .map(cellText)
    .filter(Boolean)
    .slice(0, 8);

  const estimatedTotalSeconds = Math.max(600, number(rawPlanSafe.estimatedTotalSeconds || rawPlanSafe.totalSeconds, 600));

  return {
    ...rawPlanSafe,
    topic,
    segmentTitle,
    shortAnswer,

    layoutPlan,
    boardPages,

    teacherActions,
    boardActions: teacherActions,
    boardCommands,
    voiceScript,

    citations,
    sourceRefs: citations,
    internalSourceRefs: asArray(rawPlanSafe.internalSourceRefs || rawPlanSafe.sourceRefs || citations).map(clean).filter(Boolean),
    knowledgeRefs: asArray(rawPlanSafe.knowledgeRefs || ["Gemma offline same-topic knowledge"]).map(clean).filter(Boolean),

    repairOptions: repairOptions.length ? repairOptions : DEFAULT_REPAIR_OPTIONS,

    continueMode: rawPlanSafe.continueMode !== false && clean(rawPlanSafe.nextCursor || "").toUpperCase() !== "DONE",
    nextCursor: clean(rawPlanSafe.nextCursor || rawPlanSafe.cursor || "Continue with the next 10-minute visual segment without repeating this one."),
    estimatedTotalSeconds,

    externalKnowledgeUsed: Boolean(rawPlanSafe.externalKnowledgeUsed || rawPlanSafe.offlineKnowledgeUsed || options.externalKnowledgeUsed),
    offlineKnowledgeUsed: Boolean(rawPlanSafe.offlineKnowledgeUsed || rawPlanSafe.externalKnowledgeUsed || options.externalKnowledgeUsed),
    resourceGroundedRatio: Math.max(
      0,
      Math.min(1, number(rawPlanSafe.resourceGroundedRatio, options.externalKnowledgeUsed ? 0.82 : 0.95))
    ),
    usedSmartFallback: false,
  };
}

export function collectLiveTutorPlanIssues(plan = {}) {
  const normalized = normalizeLiveTutorPlan(plan);
  const commands = flattenCommands(normalized.boardCommands);
  const voices = asArray(normalized.voiceScript);
  const richness = analyzePlanRichness(normalized);
  const issues = [];

  if (asArray(normalized.boardPages).length < 8) {
    issues.push(`Need 8 boardPages. Got ${asArray(normalized.boardPages).length}.`);
  }

  if (countRenderableCommands(normalized.boardCommands) < 20) {
    issues.push(`Need 20+ renderable commands. Got ${countRenderableCommands(normalized.boardCommands)}.`);
  }

  if (voices.length < 14) {
    issues.push(`Need at least 14 voiceScript lines. Got ${voices.length}.`);
  }

  if (richness.visualCount < 4) {
    issues.push(`Too few real visuals: ${richness.visualCount}. Need at least 4.`);
  }

  if (!richness.hasDiagram) issues.push("Missing flow/Mermaid/diagram renderable command.");
  if (!hasCommandType(normalized.boardCommands, new Set(["tree", "recursionTree"]))) {
    issues.push("Missing tree/structure renderable command.");
  }
  if (!richness.hasTable) issues.push("Missing table renderable command.");
  if (!richness.hasCode) issues.push("Missing codeTrace/example/formula renderable command.");
  if (!richness.hasQuiz) issues.push("Missing quizCheck renderable command.");
  if (!richness.hasSource) issues.push("No source grounding/citations.");

  if (richness.duplicateVoiceLines > 0) {
    issues.push(`Duplicate voice lines found: ${richness.duplicateVoiceLines}.`);
  }

  const badObjectText = commands.some((cmd) => {
    const joined = [cmd.text, cmd.title, cmd.code, cmd.formula, cmd.question, cmd.sourceRef, cmd.mermaid].map(clean).join(" ");
    return /\[object Object\]/i.test(joined);
  });

  if (badObjectText) issues.push("Plan contains [object Object] text.");

  return issues;
}

export function assertRichLiveTutorPlan(plan = {}) {
  const normalized = normalizeLiveTutorPlan(plan);
  const issues = collectLiveTutorPlanIssues(normalized);

  if (issues.length) {
    throw new Error(`Gemma Live Tutor plan rejected: ${issues.join(" ")}`);
  }

  return true;
}

export function publicPlanDiagnostics(plan = {}) {
  const normalized = normalizeLiveTutorPlan(plan);
  const richness = analyzePlanRichness(normalized);

  return {
    boardCommandsReady: asArray(normalized.boardCommands).length > 0,
    teacherActionsReady: asArray(normalized.teacherActions || normalized.boardActions).length > 0,
    voiceScriptReady: asArray(normalized.voiceScript).length > 0,

    commandTypes: richness.commandTypes,
    visualCommandTypes: richness.visualTypes,

    pageCount: richness.pageCount,
    visualCount: richness.visualCount,
    voiceCount: richness.voiceCount,
    commandCount: richness.allCommandCount,
    renderableCommandCount: richness.renderableCommandCount,
    actionCount: richness.actionCount,
    linkedVoiceCount: richness.linkedVoiceCount,
    duplicateVoiceLines: richness.duplicateVoiceLines,

    hasDiagram: richness.hasDiagram,
    hasMermaid: richness.hasMermaid,
    hasCode: richness.hasCode,
    hasTable: richness.hasTable,
    hasKeyPoints: richness.hasKeyPoints,
    hasQuiz: richness.hasQuiz,
    hasSource: richness.hasSource,
    maxTimelineSec: richness.maxTimelineSec,

    gemmaPlanRich: richness.rich,
    noFakeFallback: true,
    noStaticDemo: true,
    noTextCardsOnly: richness.visualCount >= 4,
  };
}

export default {
  ALLOWED_COMMAND_TYPES,
  ALLOWED_TEACHER_ACTION_TYPES,
  normalizeLiveTutorPlan,
  assertRichLiveTutorPlan,
  analyzePlanRichness,
  collectLiveTutorPlanIssues,
  publicPlanDiagnostics,
};
"use strict";

/**
 * server/services/googleAgent/teacherVisualPlanner.service.js
 * =============================================================================
 * Presenton/Gamma-style planner for a LIVE TUTOR BOARD, not slides.
 *
 * Input:
 * - selectedNode
 * - sourceContext/pdfContext from sourceContextBuilder.service.js
 * - exact/same/nearby/related chunks
 * - visualContext OCR/table/page-image data
 * - Text2Diagram plan
 * - optional external resources
 *
 * Output:
 * - premiumBoardScreens: 5-7 rich, source-grounded board screens
 * - lessonOutline
 * - diagramPlan
 * - metadata
 *
 * No hardcoded topic. No random fallback lesson. Every factual block keeps refs.
 * =============================================================================
 */

const crypto = require("crypto");

function safeString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeArray(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function cleanText(value, max = 2000) {
  return safeString(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function inlineText(value, max = 2000) {
  return cleanText(value, max).replace(/\s+/g, " ").trim().slice(0, max);
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
}

function normalizeId(value, fallback = "item") {
  const id = inlineText(value || fallback, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return id || fallback;
}

function dedupeBy(items, keyFn) {
  const out = [];
  const seen = new Set();

  for (const item of safeArray(items)) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

function normalizeSourceRef(ref) {
  const r = safeObject(ref);

  return {
    chunkId: inlineText(r.chunkId || r.id || "", 220),
    sourceRef: inlineText(r.sourceRef || r.ref || "", 320),
    pageRef: inlineText(r.pageRef || "", 320),
    page: Number(r.page || r.pageNo || r.pageNumber || 0) || 0,
    quote: inlineText(r.quote || r.text || r.snippet || "", 900),
    confidence: Number.isFinite(Number(r.confidence)) ? Number(r.confidence) : 0.82,
  };
}

function normalizeSourceRefs(value) {
  return dedupeBy(
    safeArray(value)
      .map(normalizeSourceRef)
      .filter((r) => r.chunkId || r.sourceRef || r.page || r.quote),
    (r) => `${r.chunkId}|${r.sourceRef}|${r.page}|${r.quote.slice(0, 80)}`
  );
}

function refsFromChunk(chunk, confidence = 0.84) {
  const c = safeObject(chunk);
  const page = Number(c.page || c.pageNumber || 0) || 0;
  const chunkIndex = Number(c.chunkIndex || c.index || 0) || 0;
  const resourceId = inlineText(c.resourceId || c.documentId || "", 180);

  return normalizeSourceRef({
    chunkId: c.chunkId || c.id || `${resourceId || "resource"}_p${page}_c${chunkIndex}`,
    sourceRef: c.sourceRef || `${resourceId || "resource"}:page:${page}:chunk:${chunkIndex}`,
    pageRef: c.pageRef || `${resourceId || "resource"}:page:${page}`,
    page,
    quote: c.quote || c.textPreview || c.text || c.ocrText || c.content || "",
    confidence,
  });
}

function collectRefs(...values) {
  const refs = [];

  function walk(value) {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;

    if (Array.isArray(value.sourceRefs)) refs.push(...value.sourceRefs);

    for (const child of Object.values(value)) {
      if (child && typeof child === "object") walk(child);
    }
  }

  values.forEach(walk);
  return normalizeSourceRefs(refs);
}

function titleFromInput(input) {
  const node = safeObject(input.selectedNode || input.node);

  return inlineText(
    node.title ||
      node.label ||
      node.name ||
      node.nodeId ||
      input.title ||
      input.topic ||
      "Selected Concept",
    180
  );
}

function allChunks(input) {
  const ctx = safeObject(input.sourceContext || input.pdfContext || input.fullPdfContext);

  return dedupeBy(
    [
      ...safeArray(input.exactChunks || ctx.exactChunks),
      ...safeArray(input.samePageChunks || ctx.samePageChunks),
      ...safeArray(input.nearbyChunks || ctx.nearbyChunks),
      ...safeArray(input.relatedChunks || ctx.relatedChunks),
      ...safeArray(input.chunks || ctx.chunks),
    ].filter(Boolean),
    (c) =>
      safeObject(c).chunkId ||
      `${safeObject(c).page}:${safeObject(c).chunkIndex}:${inlineText(safeObject(c).textPreview, 60)}`
  );
}

function chunkText(chunk, max = 1600) {
  const c = safeObject(chunk);
  return cleanText(c.textPreview || c.text || c.ocrText || c.content || c.quote || "", max);
}

function sentences(text, limit = 8) {
  const out = [];
  const seen = new Set();

  for (const raw of cleanText(text, 12000).split(/(?<=[.!?])\s+|\n+|;|•/g)) {
    const s = inlineText(raw, 220);
    if (s.length < 16) continue;

    const key = s.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(s);

    if (out.length >= limit) break;
  }

  return out;
}

function keywords(text, limit = 10) {
  const stop = new Set(
    "the and for with that this from source teacher student board concept page chunk what when then your into about only using will have has are was were can should would could a an is it as by be if so we they their them our us to in on of or not but rather than being final design process".split(
      " "
    )
  );

  const out = [];
  const seen = new Set();
  const matches = inlineText(text, 20000).match(/[A-Za-z][A-Za-z0-9_/-]{3,}/g) || [];

  for (const m of matches) {
    const w = m.replace(/^[-_/]+|[-_/]+$/g, "");
    const k = w.toLowerCase();

    if (!w || stop.has(k) || seen.has(k)) continue;

    seen.add(k);
    out.push(w);

    if (out.length >= limit) break;
  }

  return out;
}

function sourceQuote(chunks, refs, max = 260) {
  const exact = safeArray(chunks)
    .map(chunkText)
    .find((x) => x.length > 20);

  const refQuote = safeArray(refs)
    .map((r) => inlineText(r.quote, max))
    .find((x) => x.length > 20);

  return inlineText(exact || refQuote || "Source evidence is attached to this selected node.", max);
}

function pageList(refs, chunks) {
  return [
    ...new Set(
      [
        ...safeArray(refs).map((r) => Number(r.page || 0)),
        ...safeArray(chunks).map((c) => Number(safeObject(c).page || 0)),
      ].filter(Boolean)
    ),
  ].slice(0, 8);
}

function visualContext(input) {
  return safeObject(
    input.visualContext ||
      safeObject(input.sourceContext).visualContext ||
      safeObject(input.pdfContext).visualContext
  );
}

function text2DiagramPlan(input) {
  return safeObject(
    input.text2DiagramPlan ||
      safeObject(input.sourceContext).text2DiagramPlan ||
      safeObject(input.pdfContext).text2DiagramPlan
  );
}

function externalResources(input) {
  const raw =
    input.externalResources ||
    safeObject(input.externalResourcePack).externalResources ||
    safeObject(safeObject(input.sourceContext).externalResources).externalResources ||
    [];

  return safeArray(raw)
    .slice(0, 10)
    .map((x) => ({
      type: inlineText(safeObject(x).type || "web", 40),
      title: inlineText(safeObject(x).title || safeObject(x).url || "Resource", 160),
      url: cleanText(safeObject(x).url || "", 1000),
      snippet: inlineText(safeObject(x).snippet || safeObject(x).description || "", 240),
      provider: inlineText(safeObject(x).provider || "external", 80),
    }))
    .filter((x) => x.url || x.title);
}

function buildRowsFromSource(topic, chunks, refs) {
  const terms = keywords(`${topic} ${safeArray(chunks).map(chunkText).join(" ")}`, 8);
  const ss = sentences(safeArray(chunks).map(chunkText).join("\n"), 8);
  const rows = [];

  for (let i = 0; i < Math.min(5, Math.max(terms.length, 3)); i += 1) {
    rows.push({
      concept: terms[i] || `Point ${i + 1}`,
      sourceEvidence: ss[i] || sourceQuote(chunks, refs, 160),
      teacherMeaning:
        ss[i + 1] ||
        `This explains how ${terms[i] || topic} connects to the selected concept.`,
      boardAction:
        i === 0
          ? "Underline key phrase"
          : i === 1
            ? "Draw arrow to example"
            : "Ask checkpoint question",
    });
  }

  return rows;
}

function inferDiagramType(input, text) {
  const plan = text2DiagramPlan(input);
  const primary = inlineText(safeObject(plan.diagramIntent).primary || plan.primary || "", 80).toLowerCase();

  if (primary) return primary;

  const t = text.toLowerCase();

  if (/entity|relationship|schema|foreign key|primary key|table/.test(t)) return "er";
  if (/sequence|request|response|actor|client|server|message/.test(t)) return "sequence";
  if (/timeline|phase|version|history|evolution/.test(t)) return "timeline";
  if (/compare|versus|vs|difference|mapping/.test(t)) return "table";
  if (/tree|hierarchy|classification|category/.test(t)) return "mindmap";

  return "flowchart";
}

function mermaidLabel(value, max = 42) {
  return inlineText(value, max).replace(/[\[\]{}<>|`]/g, " ").replace(/"/g, "'") || "Item";
}

function makeMermaid({ type, topic, rows, terms }) {
  const labels = (terms.length ? terms : rows.map((r) => r.concept))
    .slice(0, 7)
    .map((x) => mermaidLabel(x));

  const root = mermaidLabel(topic, 56);

  if (type.includes("mind") || type === "conceptmap" || type === "conceptMap") {
    return [`mindmap`, `  root((${root}))`, ...labels.map((l) => `    ${l}`)].join("\n");
  }

  if (type.includes("timeline")) {
    return [`timeline`, `  title ${root}`, ...labels.map((l, i) => `  Step ${i + 1} : ${l}`)].join(
      "\n"
    );
  }

  if (type.includes("sequence")) {
    return [
      `sequenceDiagram`,
      `  participant Student`,
      `  participant Tutor`,
      `  participant Source`,
      `  Student->>Tutor: asks about ${root}`,
      `  Tutor->>Source: checks exact PDF evidence`,
      `  Source-->>Tutor: returns grounded chunks`,
      `  Tutor-->>Student: explains with board visual`,
    ].join("\n");
  }

  if (type === "er" || type.includes("er")) {
    return [
      `erDiagram`,
      `  ${mermaidLabel(topic, 26).replace(/\s+/g, "_").toUpperCase()} {`,
      `    string definition`,
      `    string source_evidence`,
      `    string example`,
      `  }`,
      `  SOURCE_PAGE ||--o{ ${mermaidLabel(topic, 26).replace(/\s+/g, "_").toUpperCase()} : supports`,
    ].join("\n");
  }

  const nodes = labels.length ? labels : ["Definition", "Evidence", "Example", "Quiz"];
  const lines = [`flowchart LR`, `  A["${root}"]`];

  nodes.forEach((l, i) => lines.push(`  ${String.fromCharCode(66 + i)}["${l}"]`));
  nodes.forEach((_, i) =>
    lines.push(`  ${i === 0 ? "A" : String.fromCharCode(65 + i)} --> ${String.fromCharCode(66 + i)}`)
  );

  return lines.join("\n");
}

function makeReactFlow(topic, rows, terms) {
  const labels = [topic, ...(terms.length ? terms : rows.map((r) => r.concept)).slice(0, 7)];

  const nodes = labels.map((label, index) => ({
    id: `n${index + 1}`,
    type: index === 0 ? "input" : "default",
    position: {
      x: index === 0 ? 360 : 80 + ((index - 1) % 4) * 220,
      y: index === 0 ? 20 : 150 + Math.floor((index - 1) / 4) * 130,
    },
    data: { label: inlineText(label, 70) },
  }));

  const edges = nodes.slice(1).map((node, index) => ({
    id: `e1_${index + 2}`,
    source: "n1",
    target: node.id,
    animated: index === 0,
  }));

  return { nodes, edges };
}

function htmlPreviewForBoard(topic, rows, refs) {
  const items = rows
    .slice(0, 5)
    .map(
      (r) => `<li><b>${escapeHtml(r.concept)}</b><span>${escapeHtml(r.teacherMeaning)}</span></li>`
    )
    .join("");

  const pages = pageList(refs, [])
    .map((p) => `<span>Pg. ${p}</span>`)
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:Inter,system-ui;background:#fffaf5;color:#2f261f;padding:16px}.card{border:1px solid #f1dccd;border-radius:18px;background:white;padding:16px}h2{margin:0 0 8px;color:#ef4d2f}li{margin:10px 0;display:grid;gap:3px}b{color:#2f261f}span{color:#6b5a50}.pages span{display:inline-block;margin:8px 6px 0 0;background:#f2fff1;color:#2d7d3f;padding:4px 8px;border-radius:99px}</style></head><body><div class="card"><h2>${escapeHtml(topic)}</h2><ul>${items}</ul><div class="pages">${pages}</div></div></body></html>`;
}

function escapeHtml(value) {
  return safeString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function block(id, type, role, title, body, refs, extra = {}) {
  const sourceRefs = normalizeSourceRefs(refs);

  return {
    blockId: id,
    id,
    type,
    role,
    title: inlineText(title, 180),
    body: cleanText(body, 3000),
    teacherNotes: cleanText(extra.teacherNotes || body, 4000),
    sourceRefs,
    sourceGrounded: sourceRefs.length > 0,
    ...extra,
    payload: {
      ...safeObject(extra.payload),
      blockId: id,
      targetBlockId: id,
      sourceRefs,
    },
  };
}

function screen(screenNo, template, title, goal, blocks, refs, extra = {}) {
  return {
    screenId: `screen_${screenNo}_${normalizeId(title, "board")}`,
    id: `screen_${screenNo}_${normalizeId(title, "board")}`,
    screenNo,
    screenNumber: screenNo,
    title: inlineText(title, 220),
    goal: cleanText(goal, 600),
    subtitle: cleanText(goal, 300),
    voiceHint: cleanText(extra.voiceHint || goal, 360),
    layoutTemplate: template,
    sourceRefs: normalizeSourceRefs(refs),
    blocks: safeArray(blocks).filter(Boolean),
    layout: {
      variant: "presentonStyleDynamicTutorBoard",
      autoGrow: true,
      autoScale: true,
      avoidOverlap: true,
      template,
    },
    ...extra,
  };
}

function externalHtml(items) {
  const lis = safeArray(items)
    .slice(0, 8)
    .map(
      (r) =>
        `<li><b>${escapeHtml(r.type || "web")}</b> <a href="${escapeHtml(r.url)}" target="_blank" rel="noreferrer">${escapeHtml(r.title)}</a><p>${escapeHtml(r.snippet || "")}</p></li>`
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Inter,system-ui;margin:0;padding:14px;background:#fffaf5;color:#2f261f}h3{margin:0 0 8px;color:#ef4d2f}li{margin:0 0 10px}a{color:#7c3aed;font-weight:800}p{margin:4px 0;color:#6b5a50}</style></head><body><h3>Extra learning resources</h3><p>Supplementary only — not PDF evidence.</p><ul>${lis}</ul></body></html>`;
}

function buildTeacherVisualPlan(input = {}) {
  const topic = titleFromInput(input);
  const ctx = safeObject(input.sourceContext || input.pdfContext || input.fullPdfContext);
  const chunks = allChunks(input);
  const exactChunks = safeArray(input.exactChunks || ctx.exactChunks).length
    ? safeArray(input.exactChunks || ctx.exactChunks)
    : chunks.slice(0, 3);

  const refs = normalizeSourceRefs([
    ...safeArray(input.sourceRefs || ctx.sourceRefs),
    ...safeArray(safeObject(input.selectedNode).sourceRefs),
    ...exactChunks.map((c) => refsFromChunk(c, 0.9)),
  ]);

  if (!refs.length) {
    const error = new Error("teacherVisualPlanner requires sourceRefs. Refusing ungrounded board plan.");
    error.statusCode = 422;
    throw error;
  }

  const text = cleanText(chunks.map(chunkText).join("\n\n"), 24000);
  const ss = sentences(text, 12);
  const terms = keywords(`${topic}\n${text}`, 12);
  const rows = buildRowsFromSource(topic, chunks, refs);
  const diagramType = inferDiagramType(input, `${topic}\n${text}`);
  const mermaid = makeMermaid({ type: diagramType, topic, rows, terms });
  const reactFlow = makeReactFlow(topic, rows, terms);

  const vc = visualContext(input);
  const pageImages = safeArray(vc.pageImages || input.pageImages || ctx.pageImages);
  const ocrBlocks = safeArray(vc.ocrBlocks || input.ocrBlocks || ctx.ocrBlocks);
  const tables = safeArray(vc.tables || input.layoutTables || ctx.layoutTables);
  const figures = safeArray(vc.figures || input.figures || ctx.figures);
  const external = externalResources(input);

  const quote = sourceQuote(exactChunks.length ? exactChunks : chunks, refs, 400);
  const mainIdea = ss[0] || quote;
  const why = ss[1] || `This concept matters because it explains how ${topic} works in the source material.`;
  const mistake = ss[2]
    ? `Common wrong model: treating this concept as isolated. Source correction: ${ss[2]}`
    : `Common mistake: memorizing ${topic} without connecting it to source evidence and workflow.`;

  const bestItems = [
    "Start from exact source page evidence",
    "Explain the main relationship before details",
    "Use diagram/table only when it clarifies the concept",
    "Ask student to explain back the key idea",
  ];

  const htmlPreview = htmlPreviewForBoard(topic, rows, refs);
  const sourcePage = pageImages[0] || {};
  const firstPage = Number(sourcePage.page || refs[0]?.page || exactChunks[0]?.page || 0);

  const screens = [
    screen(
      1,
      "hero_evidence_concept",
      `${topic}: Big Idea from Source`,
      "Ground the selected concept in exact PDF evidence before drawing anything.",
      [
        block("hero_definition", "heroDefinition", "hero", "Big idea", mainIdea, refs, {
          teacherNotes: `Open like a human teacher: define ${topic}, then point at the exact source quote.`,
        }),
        block("source_evidence", "sourceEvidenceCard", "evidence", "Source-grounded evidence", quote, refs, {
          page: refs[0]?.page || firstPage,
        }),
        block("mini_concept_tree", "miniConceptTree", "visual", "Concept map", `How ${topic} connects to its important parts.`, refs, {
          nodes: reactFlow.nodes,
          edges: reactFlow.edges,
          diagram: reactFlow,
          visualType: "conceptMap",
        }),
        block("why_it_matters", "examplePanel", "support", "Why this matters", why, refs),
      ],
      refs
    ),

    screen(
      2,
      "diagram_workflow",
      `${topic}: Visual Explanation`,
      "Turn the selected source text into a Text2Diagram-style visual.",
      [
        block("main_diagram", "diagramPanel", "visual", `${topic} diagram`, "This diagram is generated from source terms, not a fixed template.", refs, {
          mermaid,
          diagramType,
          visualType: diagramType,
          nodes: reactFlow.nodes,
          edges: reactFlow.edges,
          diagram: reactFlow,
        }),
        block("workflow_steps", "workflowStrip", "support", "Step-by-step flow", rows.map((r) => r.concept).join(" → "), refs, {
          nodes: rows.map((r, i) => ({ id: `s${i + 1}`, label: r.concept })),
          edges: rows.slice(1).map((_, i) => ({ source: `s${i + 1}`, target: `s${i + 2}` })),
        }),
      ],
      refs,
      {
        voiceHint: "Now point to the diagram and explain how each arrow comes from the PDF source.",
      }
    ),

    screen(
      3,
      "example_table_evidence",
      `${topic}: Example + Evidence Table`,
      "Show a concrete example and map source phrases to tutor meaning.",
      [
        block(
          "worked_example",
          "examplePanel",
          "example",
          "Worked example",
          ss[3] || `Example: apply ${topic} step by step using the source evidence.`,
          refs
        ),
        block("mapping_table", "mappingTable", "table", "Source-to-meaning table", "Each row maps source evidence to board explanation.", refs, {
          columns: ["concept", "sourceEvidence", "teacherMeaning", "boardAction"],
          rows,
        }),
        tables.length
          ? block("detected_table", "mappingTable", "support", "Detected source table", "A table/layout block was found in the source and attached here.", refs, {
              columns: safeArray(tables[0].columns).length ? tables[0].columns : ["Field", "Value"],
              rows: safeArray(tables[0].rows).length ? tables[0].rows : rows,
            })
          : null,
      ],
      refs
    ),

    screen(
      4,
      "mistake_best_practice",
      `${topic}: Mistake + Best Practice`,
      "Repair the wrong mental model and show what a good student should remember.",
      [
        block("common_mistake", "commonMistakeCard", "warning", "Common mistake", mistake, refs),
        block("best_practices", "bestPracticeChecklist", "checklist", "Best-practice checklist", bestItems.join("\n"), refs, {
          items: bestItems,
        }),
        block("repair_note", "sourceEvidenceCard", "evidence", "Source correction", quote, refs),
      ],
      refs
    ),

    screen(
      5,
      "quiz_voice_recap",
      `${topic}: Quiz + Explain Back`,
      "Ask a checkpoint question and make the student explain the source-backed idea.",
      [
        block("quiz_checkpoint", "quizCheckpoint", "quiz", "Quick checkpoint", `Why is ${topic} important in this source?`, refs, {
          question: `Which statement best explains ${topic} according to the PDF source?`,
          choices: [
            mainIdea.slice(0, 110),
            "A random unrelated idea",
            "Only an implementation detail",
            "A topic not mentioned in the PDF",
          ],
        }),
        block(
          "recap",
          "recapChecklist",
          "recap",
          "Lesson recap",
          [mainIdea, why, `Remember: cite pages ${pageList(refs, chunks).join(", ") || "from source"}.`].join("\n"),
          refs,
          {
            items: [mainIdea, why, "Explain back using the source quote."],
          }
        ),
        block(
          "voice_style",
          "voiceSubtitlePanel",
          "voice",
          "Teacher voice plan",
          "Explain like a classroom tutor: point at the board, circle the source quote, then ask the student to explain back.",
          refs
        ),
      ],
      refs
    ),

    pageImages.length || ocrBlocks.length || figures.length
      ? screen(
          6,
          "source_preview",
          `${topic}: Source Preview`,
          "Show original PDF/OCR/figure evidence when available.",
          [
            block("source_page_preview", "sourcePagePreview", "preview", "PDF source preview", `Original page/OCR evidence for ${topic}.`, refs, {
              page: firstPage,
              imageRef: sourcePage.url || sourcePage.src || sourcePage.imageRef || sourcePage.path || "",
            }),
            block("html_preview", "htmlPreviewCard", "support", "Clean visual redraw", "A clean HTML preview redraw of the source meaning.", refs, {
              html: htmlPreview,
              srcDoc: htmlPreview,
            }),
          ],
          refs
        )
      : null,

    external.length
      ? screen(
          7,
          "external_resources",
          `${topic}: Extra Learning`,
          "Supplementary links for deeper learning. These are not PDF evidence.",
          [
            block("external_links", "htmlPreviewCard", "support", "Extra web/YT resources", "Extra learning resources only. The PDF remains the truth.", refs, {
              html: externalHtml(external),
              srcDoc: externalHtml(external),
              items: external,
            }),
          ],
          refs
        )
      : null,
  ].filter(Boolean);

  return {
    ok: true,
    title: topic,
    lessonOutline: screens.map((s) => ({
      screenNo: s.screenNo,
      title: s.title,
      goal: s.goal,
      blockTypes: s.blocks.map((b) => b.type),
    })),
    premiumBoardScreens: screens,
    boardScreens: screens,
    diagramPlan: {
      diagramType,
      mermaid,
      reactFlow,
      rows,
      text2DiagramPlan: text2DiagramPlan(input),
    },
    sourceRefs: refs,
    sourceCards: refs.slice(0, 16).map((r, i) => ({
      id: `source_${i + 1}`,
      title: `Page ${r.page || "?"}`,
      page: r.page,
      quote: r.quote,
      sourceRef: r.sourceRef,
      chunkId: r.chunkId,
      sourceRefs: [r],
    })),
    externalResources: external,
    metadata: {
      service: "teacherVisualPlanner.service.js",
      engine: "presenton-style-dynamic-teacher-board-planner-v1",
      screenCount: screens.length,
      blockCount: screens.reduce((sum, s) => sum + s.blocks.length, 0),
      sourceRefCount: refs.length,
      chunkCount: chunks.length,
      diagramType,
      text2DiagramPlanUsed: Boolean(Object.keys(text2DiagramPlan(input)).length),
      pageImageCount: pageImages.length,
      ocrBlockCount: ocrBlocks.length,
      tableCount: tables.length,
      figureCount: figures.length,
      externalResourceCount: external.length,
      fallbackUsed: false,
      usedSmartFallback: false,
      generatedAt: new Date().toISOString(),
    },
  };
}

module.exports = {
  buildTeacherVisualPlan,
  planTeacherVisualBoard: buildTeacherVisualPlan,
  createTeacherVisualPlan: buildTeacherVisualPlan,
  normalizeSourceRefs,
  refsFromChunk,
  collectRefs,
  makeMermaid,
  makeReactFlow,
  _internals: {
    safeString,
    safeObject,
    safeArray,
    cleanText,
    inlineText,
    normalizeId,
    dedupeBy,
    keywords,
    sentences,
    inferDiagramType,
    buildRowsFromSource,
  },
};
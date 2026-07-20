// server/services/connectLearning/conceptGraph.agent.js

import { callOllamaJson } from "../ollamaCompat.service.js";

const NODE_TYPES = new Set([
  "central_concept",
  "core_concept",
  "sub_concept",
  "procedure",
  "task",
  "skill",
  "example",
  "warning",
  "verification",
  "deliverable",
  "formula",
  "table",
  "script",
  "phase",
  "section",
]);

const EDGE_TYPES = new Set([
  "contains",
  "prerequisite_for",
  "depends_on",
  "supports",
  "applied_to",
  "verifies",
  "produces",
  "example_of",
  "contrasts_with",
  "leads_to",
]);

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalize(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9+# ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeId(value = "") {
  return normalize(value).replace(/\s+/g, "_").slice(0, 80);
}

function truncate(value = "", limit = 22000) {
  const text = String(value || "");
  return text.length > limit ? text.slice(0, limit) : text;
}

function normalizeNodeType(type = "", level = 0) {
  const raw = clean(type).toLowerCase().replace(/\s+/g, "_");
  if (NODE_TYPES.has(raw)) return raw;
  return Number(level) === 0 ? "central_concept" : "core_concept";
}

function normalizeRelation(relation = "") {
  const raw = clean(relation).toLowerCase().replace(/\s+/g, "_");

  if (EDGE_TYPES.has(raw)) return raw;

  const map = {
    requires: "depends_on",
    require: "depends_on",
    uses: "depends_on",
    use: "depends_on",
    needs: "depends_on",
    enables: "supports",
    enable: "supports",
    helps: "supports",
    checks: "verifies",
    validates: "verifies",
    creates: "produces",
    outputs: "produces",
    includes: "contains",
    part_of: "contains",
    child: "contains",
    parent: "contains",
    next: "leads_to",
  };

  return map[raw] || "";
}

function findEvidence(pdfText = "", title = "") {
  const text = String(pdfText || "");
  if (!text) return "";

  const words = normalize(title)
    .split(" ")
    .filter((word) => word.length >= 4);

  const lower = text.toLowerCase();

  for (const word of words) {
    const idx = lower.indexOf(word.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - 700);
      const end = Math.min(text.length, idx + 1800);
      return text.slice(start, end).trim();
    }
  }

  return text.slice(0, 1000).trim();
}

function isWeakTitle(title = "") {
  const t = normalize(title);

  if (!t) return true;
  if (t.length < 4) return true;
  if (/^\d+$/.test(t)) return true;

  const bad = new Set([
    "pdf",
    "page",
    "slide",
    "topic",
    "chapter",
    "document",
    "lecture",
    "note",
    "notes",
    "summary",
    "overview",
    "introduction",
    "concept",
    "learning",
    "data",
    "system",
  ]);

  if (bad.has(t)) return true;
  if (t.split(" ").length > 12) return true;

  return false;
}

function buildRoadmapPrompt({ understanding, pdfText, fileName, studyGoal }) {
  return `
Return ONLY valid JSON. No markdown.

You are Phase 2 of "Connect Your Learning".

Goal:
Create a ROADMAP-STYLE concept graph from the PDF.
The output should be a directed graph, not a simple list.

Important:
- AI decides nodes, tree structure, levels, and meaningful relations from PDF.
- Do NOT use fixed domain templates.
- Do NOT hardcode database/math/biology rules.
- Use only the PDF content and Phase 1 understanding.
- The graph should look like a roadmap: root at top, prerequisites/parallel concepts below, advanced/final concepts later.
- Avoid flat graph where every edge comes from root.
- Avoid all edges being "contains".
- Every node must have PDF evidence.

Allowed node types:
central_concept, core_concept, sub_concept, procedure, task, skill, example, warning, verification, deliverable, formula, table, script, phase, section

Allowed edge relations:
contains, prerequisite_for, depends_on, supports, applied_to, verifies, produces, example_of, contrasts_with, leads_to

Return exact JSON:
{
  "title": "",
  "rootId": "",
  "nodes": [
    {
      "id": "",
      "title": "",
      "type": "",
      "level": 0,
      "order": 1,
      "summary": "",
      "pdfEvidence": "",
      "whyItMatters": "",
      "keyPoints": [],
      "confidence": 0.0
    }
  ],
  "edges": [
    {
      "from": "",
      "to": "",
      "relation": "",
      "label": "",
      "reason": "",
      "confidence": 0.0
    }
  ]
}

Roadmap layout rules:
1. level 0 = only central root concept.
2. level 1 = major learning branches.
3. level 2 = sub concepts / tasks / procedures / examples.
4. level 3+ = detailed items, verification, deliverables, advanced concepts.
5. Create 10 to 35 nodes depending on PDF depth.
6. Use branching like a roadmap, not only one vertical chain.
7. Use at least 3 relation types.
8. Include cross-links where concepts depend on/support/verify each other.
9. Keep node titles short, like roadmap cards.
10. Do not create fake nodes not supported by PDF.

File:
${fileName}

User study goal:
${studyGoal || ""}

Phase 1 understanding:
${JSON.stringify(understanding || {}, null, 2)}

PDF text:
${truncate(pdfText, Number(process.env.CONNECT_LEARNING_PHASE2_TEXT_CHARS || 22000))}
`;
}

function normalizeRoadmap(raw = {}, pdfText = "", understanding = {}) {
  const title =
    clean(raw.title) || `${clean(understanding.detectedSubject) || "PDF"} Roadmap`;

  let nodes = safeArray(raw.nodes).map((node, index) => {
    const nodeTitle = clean(node.title);
    const level = Math.max(0, Math.min(8, Number(node.level ?? 1)));

    return {
      id: clean(node.id) || makeId(nodeTitle),
      title: nodeTitle,
      type: normalizeNodeType(node.type, level),
      level,
      order: Number(node.order || index + 1),
      summary: clean(node.summary),
      pdfEvidence: clean(node.pdfEvidence) || findEvidence(pdfText, nodeTitle),
      whyItMatters: clean(node.whyItMatters),
      keyPoints: safeArray(node.keyPoints).map(clean).filter(Boolean).slice(0, 8),
      confidence: Math.max(0, Math.min(1, Number(node.confidence || 0.75))),
    };
  });

  const seenTitles = new Set();
  nodes = nodes.filter((node) => {
    if (!node.id || !node.title) return false;
    if (isWeakTitle(node.title)) return false;

    const key = normalize(node.title);
    if (seenTitles.has(key)) return false;

    seenTitles.add(key);
    return true;
  });

  const detectedRoot =
    clean(understanding.detectedSubject) ||
    clean(understanding.subject) ||
    clean(title.replace(/roadmap/i, "")) ||
    "PDF Learning Roadmap";

  if (!nodes.some((node) => Number(node.level) === 0)) {
    nodes.unshift({
      id: makeId(detectedRoot),
      title: detectedRoot,
      type: "central_concept",
      level: 0,
      order: 0,
      summary: clean(understanding.summary) || `${detectedRoot} is the central concept.`,
      pdfEvidence: findEvidence(pdfText, detectedRoot),
      whyItMatters: clean(understanding.learningGoal),
      keyPoints: safeArray(understanding.majorConcepts).slice(0, 8),
      confidence: Number(understanding.confidence || 0.85),
    });
  }

  nodes.sort((a, b) => a.level - b.level || a.order - b.order);

  const root = nodes.find((node) => Number(node.level) === 0) || nodes[0];
  root.level = 0;
  root.type = "central_concept";

  const ids = new Set(nodes.map((node) => node.id));

  let edges = safeArray(raw.edges).map((edge) => ({
    from: clean(edge.from),
    to: clean(edge.to),
    relation: normalizeRelation(edge.relation),
    label: clean(edge.label || edge.relation),
    reason: clean(edge.reason),
    confidence: Math.max(0, Math.min(1, Number(edge.confidence || 0.75))),
  }));

  edges = edges.filter((edge) => {
    if (!edge.from || !edge.to || !edge.relation) return false;
    if (edge.from === edge.to) return false;
    if (!ids.has(edge.from)) return false;
    if (!ids.has(edge.to)) return false;
    return true;
  });

  const existingTo = new Set(edges.map((edge) => edge.to));

  for (const node of nodes) {
    if (node.id === root.id) continue;

    if (!existingTo.has(node.id)) {
      const parent =
        [...nodes].reverse().find((candidate) => candidate.level < node.level) || root;

      edges.push({
        from: parent.id,
        to: node.id,
        relation: "contains",
        label: "contains",
        reason: `${parent.title} contains or introduces ${node.title}.`,
        confidence: 0.6,
      });
    }
  }

  const seenEdges = new Set();
  edges = edges.filter((edge) => {
    const key = `${edge.from}:${edge.relation}:${edge.to}`;
    if (seenEdges.has(key)) return false;
    seenEdges.add(key);
    return true;
  });

  return {
    title,
    rootId: clean(raw.rootId) && ids.has(clean(raw.rootId)) ? clean(raw.rootId) : root.id,
    nodes,
    edges,
  };
}

function validateRoadmap(graph = {}) {
  const nodes = safeArray(graph.nodes);
  const edges = safeArray(graph.edges);
  const reasons = [];
  let score = 0;

  const levels = new Set(nodes.map((node) => Number(node.level)));

  if (nodes.length >= 10) score += 15;
  else reasons.push(`Too few nodes: ${nodes.length}. Need roadmap depth.`);

  if (levels.size >= 3) score += 15;
  else reasons.push("Roadmap is too shallow. Need at least 3 levels.");

  const rootEdges = edges.filter((edge) => edge.from === graph.rootId);
  if (rootEdges.length < edges.length) score += 15;
  else reasons.push("Graph is too flat; all edges come from root.");

  const relationTypes = new Set(edges.map((edge) => edge.relation));
  if (relationTypes.size >= 3) score += 15;
  else reasons.push("Need at least 3 meaningful relation types.");

  const nonContains = edges.filter((edge) => edge.relation !== "contains");
  if (nonContains.length >= 3) score += 10;
  else reasons.push("Too many contains-only edges.");

  const evidenceCount = nodes.filter((node) => clean(node.pdfEvidence).length >= 80).length;
  if (evidenceCount >= Math.min(8, nodes.length)) score += 15;
  else reasons.push("Not enough node PDF evidence.");

  const weakNodes = nodes.filter((node) => isWeakTitle(node.title));
  if (weakNodes.length === 0) score += 10;
  else reasons.push(`Weak node titles: ${weakNodes.map((n) => n.title).join(", ")}`);

  if (edges.length >= nodes.length - 1) score += 5;
  else reasons.push("Not enough edges to connect roadmap.");

  return {
    score,
    passed: score >= 80 && reasons.length === 0,
    reasons,
  };
}

function buildRepairPrompt({ graph, quality, understanding, pdfText }) {
  return `
Return ONLY valid JSON. No markdown.

The previous roadmap graph failed quality check.

Reasons:
${safeArray(quality.reasons).map((r) => `- ${r}`).join("\n")}

Repair it into a roadmap-style concept graph.

Rules:
- Keep it domain-independent.
- Use PDF concepts only.
- Create 10 to 35 nodes.
- Use at least 3 levels.
- Do not make all edges from root.
- Do not use only contains.
- Every node needs PDF evidence.
- Output the same JSON shape.

Previous graph:
${JSON.stringify(graph, null, 2).slice(0, 12000)}

Phase 1 understanding:
${JSON.stringify(understanding || {}, null, 2).slice(0, 6000)}

PDF text:
${truncate(pdfText, Number(process.env.CONNECT_LEARNING_PHASE2_TEXT_CHARS || 22000))}
`;
}

export async function buildConceptGraphPhase2({
  understanding = {},
  pdfText = "",
  fileName = "",
  studyGoal = "",
}) {
  if (!clean(pdfText)) {
    throw new Error("Phase 2 failed: PDF text is empty.");
  }

  const repairs = Number(process.env.CONNECT_LEARNING_PHASE2_REPAIRS || 2);

  const raw = await callOllamaJson(
    buildRoadmapPrompt({ understanding, pdfText, fileName, studyGoal }),
    {},
    {
      cloudOnly: true,
      strictJson: true,
      allowFallback: false,
      timeoutMs: process.env.CONNECT_LEARNING_OLLAMA_TIMEOUT_MS || "45m",
      temperature: 0.03,
      num_predict: Number(process.env.CONNECT_LEARNING_PHASE2_NUM_PREDICT || 7500),
      retries: Number(process.env.CONNECT_LEARNING_PHASE2_CALL_RETRIES || 1),
    }
  );

  let graph = normalizeRoadmap(raw, pdfText, understanding);
  let quality = validateRoadmap(graph);

  for (let i = 0; i < repairs && !quality.passed; i += 1) {
    const repaired = await callOllamaJson(
      buildRepairPrompt({ graph, quality, understanding, pdfText }),
      {},
      {
        cloudOnly: true,
        strictJson: true,
        allowFallback: false,
        timeoutMs: process.env.CONNECT_LEARNING_OLLAMA_TIMEOUT_MS || "45m",
        temperature: 0.02,
        num_predict: Number(process.env.CONNECT_LEARNING_PHASE2_NUM_PREDICT || 7500),
        retries: 0,
      }
    );

    graph = normalizeRoadmap(repaired, pdfText, understanding);
    quality = validateRoadmap(graph);
  }

  if (!quality.passed) {
    throw new Error(
      `Phase 2 roadmap quality failed. Not saving wrong/simple graph. Score=${
        quality.score
      }. Reasons=${quality.reasons.join(" | ")}`
    );
  }

  return {
    ...graph,
    phase: 2,
    quality,
  };
}

export function printConceptGraph(graph = {}) {
  console.log("\n==============================");
  console.log("[Roadmap Concept Graph Phase 2]");
  console.log("title=", graph.title);
  console.log("rootId=", graph.rootId);
  console.log("quality=", graph.quality);

  console.log("nodes=");
  safeArray(graph.nodes).forEach((node, index) => {
    console.log(`${index + 1}. L${node.level} [${node.type}] ${node.title}`);
  });

  console.log("edges=");
  safeArray(graph.edges).forEach((edge, index) => {
    const from = graph.nodes.find((n) => n.id === edge.from)?.title || edge.from;
    const to = graph.nodes.find((n) => n.id === edge.to)?.title || edge.to;
    console.log(`${index + 1}. ${from} --${edge.relation}--> ${to}`);
  });

  console.log("==============================\n");
}
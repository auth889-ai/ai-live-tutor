// server/services/connectLearning/learningGraphConnector.service.js

import { callOllamaJson } from "../ollamaCompat.service.js";

const NODE_TYPES = [
  "root",
  "core_concept",
  "practice",
  "process",
  "example",
  "tool",
  "warning",
  "evidence",
];

const RELATION_TYPES = [
  "contains",
  "prerequisite",
  "depends_on",
  "example_of",
  "contrasts_with",
  "leads_to",
  "applied_to",
  "requires",
  "solves_problem",
  "supports",
  "explains",
  "implements",
  "uses_tool",
  "part_of",
  "related",
];

function clean(value = "") {
  return String(value || "").trim();
}

function cleanSpace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function trunc(value = "", max = 1200) {
  const text = String(value || "");
  return text.length > max ? text.slice(0, max) : text;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function uniq(values = []) {
  return [...new Set(list(values).map(clean).filter(Boolean))];
}

function norm(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9+# ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp01(value, fallback = 0.7) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function isCloudRequired() {
  return String(process.env.CONNECT_LEARNING_REQUIRE_CLOUD_TREE || "").toLowerCase() === "true";
}

function safeNodeType(value = "") {
  const type = clean(value).toLowerCase();
  return NODE_TYPES.includes(type) ? type : "core_concept";
}

function safeRelation(value = "") {
  const relation = clean(value).toLowerCase();
  return RELATION_TYPES.includes(relation) ? relation : "related";
}

function makeId(index = 0) {
  return `n${index + 1}`;
}

function candidateForPrompt(candidate = {}) {
  return {
    id: clean(candidate.id),
    title: clean(candidate.title),
    nodeTypeGuess: safeNodeType(candidate.nodeTypeGuess),
    summary: trunc(candidate.summary || candidate.pdfEvidence, 360),
    pdfEvidence: trunc(candidate.pdfEvidence, 900),
    pageNumber: Number(candidate.pageNumber || candidate.pageRefs?.[0]?.pageNumber || 0),
    chunkId: clean(candidate.chunkId || candidate.relatedChunkIds?.[0] || ""),
    relatedChunkIds: uniq(candidate.relatedChunkIds).slice(0, 8),
    visualPageNumbers: list(candidate.visualPageNumbers).slice(0, 6),
    evidenceQuotes: list(candidate.evidenceQuotes)
      .map((e) => ({
        pageNumber: Number(e.pageNumber || candidate.pageNumber || 0),
        chunkId: clean(e.chunkId || candidate.chunkId || ""),
        quote: trunc(e.quote, 500),
        reason: trunc(e.reason, 220),
      }))
      .filter((e) => clean(e.quote))
      .slice(0, 4),
    confidence: clamp01(candidate.confidence, 0.7),
    needsReview: Boolean(candidate.needsReview),
    source: clean(candidate.source),
    tags: uniq(candidate.tags).slice(0, 10),
  };
}

function fallbackTreeFromCandidates({
  candidateBundle = {},
  fileName = "",
  studyGoal = "",
  maxNodes = 12,
} = {}) {
  const candidates = list(candidateBundle.candidates).slice(0, maxNodes);
  const rootTitle =
    clean(studyGoal) ||
    clean(candidateBundle.studyGoal) ||
    clean(fileName).replace(/\.pdf$/i, "") ||
    "PDF Learning Graph";

  const nodes = [
    {
      id: "n1",
      title: rootTitle,
      nodeType: "root",
      level: 0,
      parentId: "",
      summary: `Learning graph for ${rootTitle}.`,
      learningObjective: `Understand the main concepts in ${rootTitle}.`,
      whyImportant: "This root connects the major concepts, practices, examples, and tools found in the PDF.",
      beforeThis: [],
      afterThis: [],
      examples: [],
      commonMistakes: [],
      pdfEvidence: "",
      relatedChunkIds: [],
      pageRefs: [],
      evidenceQuotes: [],
      visualPageNumbers: [],
      confidence: 0.7,
      needsReview: false,
    },
  ];

  const edges = [];

  candidates.forEach((candidate, index) => {
    const nodeId = makeId(index + 1);
    const type = safeNodeType(candidate.nodeTypeGuess);

    nodes.push({
      id: nodeId,
      title: clean(candidate.title),
      nodeType: type,
      level: type === "example" || type === "tool" ? 2 : 1,
      parentId: "n1",
      summary: trunc(candidate.summary || candidate.pdfEvidence, 420),
      learningObjective: `Understand ${candidate.title} using the PDF evidence.`,
      whyImportant: trunc(candidate.pdfEvidence || candidate.summary, 360),
      beforeThis: [],
      afterThis: [],
      examples: [],
      commonMistakes: [],
      pdfEvidence: trunc(candidate.pdfEvidence, 900),
      relatedChunkIds: uniq(candidate.relatedChunkIds).slice(0, 8),
      pageRefs: list(candidate.pageRefs).slice(0, 8),
      evidenceQuotes: list(candidate.evidenceQuotes).slice(0, 4),
      visualPageNumbers: list(candidate.visualPageNumbers).slice(0, 6),
      confidence: clamp01(candidate.confidence, 0.65),
      needsReview: Boolean(candidate.needsReview),
    });

    edges.push({
      from: "n1",
      to: nodeId,
      relation: "contains",
      label: "contains",
      reason: `${rootTitle} contains ${candidate.title} as a PDF-grounded learning concept.`,
      evidenceQuote: clean(candidate.evidenceQuotes?.[0]?.quote || ""),
      pageNumber: Number(candidate.pageNumber || candidate.evidenceQuotes?.[0]?.pageNumber || 0),
      chunkId: clean(candidate.chunkId || candidate.evidenceQuotes?.[0]?.chunkId || ""),
      confidence: clamp01(candidate.confidence, 0.65),
      needsReview: Boolean(candidate.needsReview),
    });
  });

  return {
    treeTitle: rootTitle,
    treeDescription:
      "Evidence-grounded learning graph generated from PDF concept candidates. This fallback only runs when cloud-required mode is disabled.",
    nodes,
    edges,
    graphQuality: "evidence_grounded",
    discoveredSchema: candidateBundle.schema || {
      nodeTypes: NODE_TYPES,
      relationTypes: RELATION_TYPES,
    },
  };
}

function buildPrompt({
  candidateBundle = {},
  fileName = "",
  studyGoal = "",
  maxNodes = 14,
} = {}) {
  const schema = candidateBundle.schema || {
    nodeTypes: NODE_TYPES,
    relationTypes: RELATION_TYPES,
  };

  const candidates = list(candidateBundle.candidates)
    .slice(0, Number(process.env.CONNECT_LEARNING_FAST_TREE_MAX_CANDIDATES || 24))
    .map(candidateForPrompt);

  return `You are building an evidence-grounded learning graph from a PDF.

Your task:
Create a connected concept tree / learning graph from PDF-grounded concept candidates.

IMPORTANT RULES:
1. Use ONLY the candidates and evidence below.
2. Do NOT invent concepts that are not supported by evidence.
3. Do NOT create generic vague topic labels like "Management", "Overview", "Concepts" unless the PDF evidence clearly says so.
4. Separate node types correctly:
   - core_concept = main idea
   - practice = recommendation/principle/best practice
   - process = workflow/steps/phases
   - example = case/example/code/story
   - tool = named framework/tool/platform
   - warning = risk/mistake/problem
   - evidence = supporting artifact
5. Examples must not become top-level concepts unless the whole PDF is about that example.
6. Every edge MUST have:
   relation, reason, evidenceQuote, pageNumber, chunkId, confidence.
7. Every node MUST have:
   nodeType, learningObjective, whyImportant, evidenceQuotes, relatedChunkIds.
8. Prefer a helpful learning hierarchy:
   root → major concepts/practices/process groups → examples/tools/details.
9. If two candidates are duplicates, merge them into one node and keep evidence.
10. Return valid JSON only. No markdown. No commentary.

Allowed nodeTypes:
${JSON.stringify(schema.nodeTypes || NODE_TYPES)}

Allowed relationTypes:
${JSON.stringify(schema.relationTypes || RELATION_TYPES)}

PDF:
${fileName}

Study goal:
${studyGoal}

Candidate extraction stats:
${JSON.stringify(candidateBundle.stats || {}, null, 2)}

PDF-grounded candidates:
${JSON.stringify(candidates, null, 2)}

Return JSON exactly in this shape:
{
  "treeTitle": "short clear title",
  "treeDescription": "what this learning graph teaches",
  "graphQuality": "evidence_grounded",
  "nodes": [
    {
      "id": "n1",
      "title": "Concept title",
      "nodeType": "root|core_concept|practice|process|example|tool|warning|evidence",
      "level": 0,
      "parentId": "",
      "summary": "short student-friendly summary",
      "learningObjective": "what the student should learn",
      "whyImportant": "why this matters in real life or for understanding the PDF",
      "beforeThis": ["concept title to learn before"],
      "afterThis": ["concept title to learn after"],
      "examples": ["example from the PDF"],
      "commonMistakes": ["mistake or misconception"],
      "pdfEvidence": "short synthesis based only on PDF evidence",
      "relatedChunkIds": ["p1_c1"],
      "pageRefs": [
        {
          "pageNumber": 1,
          "chunkId": "p1_c1",
          "source": "pdf",
          "type": "text",
          "confidence": 0.8
        }
      ],
      "evidenceQuotes": [
        {
          "pageNumber": 1,
          "chunkId": "p1_c1",
          "quote": "exact short quote from PDF evidence",
          "reason": "why this quote supports the node"
        }
      ],
      "visualPageNumbers": [1],
      "confidence": 0.85,
      "needsReview": false
    }
  ],
  "edges": [
    {
      "from": "n1",
      "to": "n2",
      "relation": "contains",
      "label": "contains",
      "reason": "why this connection helps learning",
      "evidenceQuote": "exact quote supporting this connection",
      "pageNumber": 1,
      "chunkId": "p1_c1",
      "confidence": 0.85,
      "needsReview": false
    }
  ],
  "reviewSuggestions": [
    {
      "type": "weak_relation|duplicate_candidate|wrong_node_type",
      "message": "short review note",
      "confidence": 0.5
    }
  ]
}

Max nodes: ${maxNodes}.
Make sure the graph is connected and useful for learning.`;
}

function normalizePageRefs(pageRefs = [], fallback = {}) {
  return list(pageRefs)
    .map((ref) => ({
      pageNumber: Number(ref.pageNumber || fallback.pageNumber || 0),
      chunkId: clean(ref.chunkId || fallback.chunkId || ""),
      source: clean(ref.source || "pdf"),
      type: clean(ref.type || ""),
      visualType: clean(ref.visualType || ""),
      imageUrl: clean(ref.imageUrl || ""),
      imagePath: clean(ref.imagePath || ""),
      confidence: clamp01(ref.confidence, 0.7),
    }))
    .filter((ref) => ref.pageNumber || ref.chunkId)
    .slice(0, 12);
}

function normalizeEvidenceQuotes(evidenceQuotes = [], fallback = {}) {
  return list(evidenceQuotes)
    .map((e) => ({
      pageNumber: Number(e.pageNumber || fallback.pageNumber || 0),
      chunkId: clean(e.chunkId || fallback.chunkId || ""),
      quote: trunc(cleanSpace(e.quote || fallback.quote || ""), 800),
      reason: trunc(cleanSpace(e.reason || fallback.reason || ""), 320),
    }))
    .filter((e) => clean(e.quote))
    .slice(0, 8);
}

function normalizeNode(node = {}, index = 0, candidateByTitle = new Map()) {
  const id = clean(node.id) || makeId(index);
  const title = cleanSpace(node.title || `Concept ${index + 1}`);

  const matched =
    candidateByTitle.get(norm(title)) ||
    list(node.aliases)
      .map((alias) => candidateByTitle.get(norm(alias)))
      .find(Boolean) ||
    null;

  const fallbackPageNumber = Number(
    node.pageNumber || matched?.pageNumber || matched?.pageRefs?.[0]?.pageNumber || 0
  );
  const fallbackChunkId = clean(
    node.chunkId || matched?.chunkId || matched?.relatedChunkIds?.[0] || matched?.pageRefs?.[0]?.chunkId || ""
  );

  const evidenceQuotes = normalizeEvidenceQuotes(
    node.evidenceQuotes?.length ? node.evidenceQuotes : matched?.evidenceQuotes,
    {
      pageNumber: fallbackPageNumber,
      chunkId: fallbackChunkId,
      quote: matched?.evidenceQuotes?.[0]?.quote || matched?.pdfEvidence || node.pdfEvidence || "",
      reason: "Evidence attached from the matching PDF candidate.",
    }
  );

  const pageRefs = normalizePageRefs(node.pageRefs?.length ? node.pageRefs : matched?.pageRefs, {
    pageNumber: fallbackPageNumber,
    chunkId: fallbackChunkId,
  });

  const relatedChunkIds = uniq([
    ...list(node.relatedChunkIds),
    ...list(matched?.relatedChunkIds),
    fallbackChunkId,
  ]).filter(Boolean);

  const visualPageNumbers = uniq([
    ...list(node.visualPageNumbers).map(String),
    ...list(matched?.visualPageNumbers).map(String),
  ])
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 8);

  const nodeType = safeNodeType(node.nodeType || matched?.nodeTypeGuess);

  return {
    id,
    title,
    normalizedTitle: norm(title),
    nodeType,
    level: Math.max(0, Number(node.level || 0)),
    parentId: clean(node.parentId || ""),
    summary: trunc(cleanSpace(node.summary || matched?.summary || matched?.pdfEvidence || ""), 700),
    learningObjective: trunc(
      cleanSpace(
        node.learningObjective ||
          `Understand ${title} using the PDF evidence and its connections.`
      ),
      500
    ),
    whyImportant: trunc(cleanSpace(node.whyImportant || matched?.summary || ""), 700),
    beforeThis: uniq(node.beforeThis).slice(0, 8),
    afterThis: uniq(node.afterThis).slice(0, 8),
    examples: uniq(node.examples || matched?.examples).slice(0, 8),
    commonMistakes: uniq(node.commonMistakes).slice(0, 8),
    pdfEvidence: trunc(cleanSpace(node.pdfEvidence || matched?.pdfEvidence || ""), 1200),
    relatedChunkIds,
    pageRefs,
    evidenceQuotes,
    visualPageNumbers,
    concepts: uniq([title, ...list(node.concepts), ...list(matched?.concepts)]).slice(0, 12),
    tags: uniq(["pdf", nodeType, ...list(node.tags), ...list(matched?.tags)]).slice(0, 20),
    confidence: clamp01(node.confidence, matched?.confidence || 0.7),
    needsReview: Boolean(node.needsReview) || clamp01(node.confidence, matched?.confidence || 0.7) < 0.65,
    aiReason: trunc(cleanSpace(node.aiReason || node.reason || ""), 500),
    rawAIOutput: node,
  };
}

function ensureRoot(nodes = [], fileName = "", studyGoal = "") {
  if (!nodes.length) return nodes;

  const hasRoot = nodes.some((node) => node.nodeType === "root" || Number(node.level) === 0);

  if (hasRoot) {
    const rootIndex = nodes.findIndex((node) => node.nodeType === "root" || Number(node.level) === 0);
    nodes[rootIndex] = {
      ...nodes[rootIndex],
      nodeType: "root",
      level: 0,
      parentId: "",
    };
    return nodes;
  }

  const rootTitle = clean(studyGoal) || clean(fileName).replace(/\.pdf$/i, "") || "PDF Learning Graph";

  return [
    {
      id: "n_root",
      title: rootTitle,
      normalizedTitle: norm(rootTitle),
      nodeType: "root",
      level: 0,
      parentId: "",
      summary: `Root learning concept for ${rootTitle}.`,
      learningObjective: `Understand the major concepts in ${rootTitle}.`,
      whyImportant: "This root organizes the PDF into a connected learning map.",
      beforeThis: [],
      afterThis: [],
      examples: [],
      commonMistakes: [],
      pdfEvidence: "",
      relatedChunkIds: [],
      pageRefs: [],
      evidenceQuotes: [],
      visualPageNumbers: [],
      concepts: [rootTitle],
      tags: ["pdf", "root"],
      confidence: 0.75,
      needsReview: false,
      aiReason: "Root node added to keep the graph connected.",
      rawAIOutput: null,
    },
    ...nodes.map((node) => ({
      ...node,
      parentId: node.parentId || "n_root",
      level: Math.max(1, Number(node.level || 1)),
    })),
  ];
}

function repairParentIds(nodes = []) {
  const ids = new Set(nodes.map((node) => node.id));
  const root = nodes.find((node) => node.nodeType === "root" || Number(node.level) === 0) || nodes[0];

  return nodes.map((node) => {
    if (node.id === root.id) {
      return {
        ...node,
        parentId: "",
        level: 0,
        nodeType: "root",
      };
    }

    if (!node.parentId || !ids.has(node.parentId)) {
      return {
        ...node,
        parentId: root.id,
        level: Math.max(1, Number(node.level || 1)),
      };
    }

    return node;
  });
}

function normalizeEdge(edge = {}, index = 0, nodesById = new Map(), nodesByTitle = new Map()) {
  const fromRaw = clean(edge.from || edge.fromId || edge.source || edge.sourceId);
  const toRaw = clean(edge.to || edge.toId || edge.target || edge.targetId);

  const fromNode =
    nodesById.get(fromRaw) ||
    nodesByTitle.get(norm(fromRaw)) ||
    nodesByTitle.get(norm(edge.fromTitle || edge.sourceTitle || ""));

  const toNode =
    nodesById.get(toRaw) ||
    nodesByTitle.get(norm(toRaw)) ||
    nodesByTitle.get(norm(edge.toTitle || edge.targetTitle || ""));

  if (!fromNode || !toNode || fromNode.id === toNode.id) return null;

  const evidenceQuote = trunc(cleanSpace(edge.evidenceQuote || edge.quote || ""), 700);
  const confidence = clamp01(edge.confidence, 0.7);

  return {
    from: fromNode.id,
    to: toNode.id,
    fromTitle: fromNode.title,
    toTitle: toNode.title,
    relation: safeRelation(edge.relation),
    label: clean(edge.label || edge.relation || "related"),
    reason: trunc(
      cleanSpace(
        edge.reason ||
          edge.aiReason ||
          `${fromNode.title} is connected to ${toNode.title} in the PDF learning graph.`
      ),
      700
    ),
    evidenceQuote,
    pageNumber: Number(edge.pageNumber || 0),
    chunkId: clean(edge.chunkId || ""),
    confidence,
    needsReview: Boolean(edge.needsReview) || confidence < 0.65 || !evidenceQuote,
    aiReason: trunc(cleanSpace(edge.aiReason || edge.reason || ""), 500),
    order: index,
  };
}

function addMissingTreeEdges(nodes = [], edges = []) {
  const existing = new Set(edges.map((edge) => `${edge.from}->${edge.to}`));
  const root = nodes.find((node) => node.nodeType === "root" || Number(node.level) === 0) || nodes[0];
  const nextEdges = [...edges];

  for (const node of nodes) {
    if (!root || node.id === root.id) continue;

    const parent = nodes.find((n) => n.id === node.parentId) || root;
    const key = `${parent.id}->${node.id}`;

    if (existing.has(key)) continue;

    nextEdges.push({
      from: parent.id,
      to: node.id,
      fromTitle: parent.title,
      toTitle: node.title,
      relation: node.nodeType === "example" ? "example_of" : node.nodeType === "tool" ? "uses_tool" : "contains",
      label: node.nodeType === "example" ? "example of" : node.nodeType === "tool" ? "uses tool" : "contains",
      reason: `${node.title} is placed under ${parent.title} to keep the PDF learning graph connected.`,
      evidenceQuote: node.evidenceQuotes?.[0]?.quote || "",
      pageNumber: Number(node.evidenceQuotes?.[0]?.pageNumber || node.pageRefs?.[0]?.pageNumber || 0),
      chunkId: clean(node.evidenceQuotes?.[0]?.chunkId || node.pageRefs?.[0]?.chunkId || ""),
      confidence: Math.min(0.8, clamp01(node.confidence, 0.7)),
      needsReview: Boolean(node.needsReview),
      aiReason: "Automatically repaired from parentId hierarchy.",
      order: nextEdges.length,
    });
  }

  return nextEdges;
}

function normalizeGraphResult({
  result = {},
  candidateBundle = {},
  fileName = "",
  studyGoal = "",
  maxNodes = 14,
} = {}) {
  const candidateByTitle = new Map();

  for (const candidate of list(candidateBundle.candidates)) {
    candidateByTitle.set(norm(candidate.title), candidate);
    for (const alias of list(candidate.aliases)) {
      candidateByTitle.set(norm(alias), candidate);
    }
  }

  let nodes = list(result.nodes)
    .map((node, index) => normalizeNode(node, index, candidateByTitle))
    .filter((node) => clean(node.title));

  if (nodes.length > maxNodes) {
    const roots = nodes.filter((node) => node.nodeType === "root" || node.level === 0);
    const nonRoots = nodes.filter((node) => !(node.nodeType === "root" || node.level === 0));

    nonRoots.sort((a, b) => {
      const aScore =
        a.confidence +
        list(a.evidenceQuotes).length * 0.1 +
        (a.nodeType === "core_concept" ? 0.2 : 0) +
        (a.nodeType === "practice" ? 0.12 : 0) +
        (a.nodeType === "process" ? 0.1 : 0);

      const bScore =
        b.confidence +
        list(b.evidenceQuotes).length * 0.1 +
        (b.nodeType === "core_concept" ? 0.2 : 0) +
        (b.nodeType === "practice" ? 0.12 : 0) +
        (b.nodeType === "process" ? 0.1 : 0);

      return bScore - aScore;
    });

    nodes = [...roots.slice(0, 1), ...nonRoots.slice(0, Math.max(1, maxNodes - roots.length))];
  }

  nodes = ensureRoot(nodes, fileName, studyGoal);
  nodes = repairParentIds(nodes);

  // Stable ids after repair.
  const used = new Set();
  nodes = nodes.map((node, index) => {
    let id = clean(node.id) || makeId(index);
    if (used.has(id)) id = makeId(index);
    used.add(id);
    return { ...node, id };
  });

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const nodesByTitle = new Map(nodes.map((node) => [norm(node.title), node]));

  let edges = list(result.edges)
    .map((edge, index) => normalizeEdge(edge, index, nodesById, nodesByTitle))
    .filter(Boolean);

  edges = addMissingTreeEdges(nodes, edges);

  const root = nodes.find((node) => node.nodeType === "root" || node.level === 0) || nodes[0];

  return {
    treeTitle:
      clean(result.treeTitle) ||
      clean(studyGoal) ||
      clean(fileName).replace(/\.pdf$/i, "") ||
      "PDF Learning Graph",
    treeDescription:
      clean(result.treeDescription) ||
      "Evidence-grounded learning graph generated from PDF concepts and relationships.",
    graphQuality: "evidence_grounded",
    discoveredSchema: candidateBundle.schema || {
      nodeTypes: NODE_TYPES,
      relationTypes: RELATION_TYPES,
    },
    rootNodeLocalId: root?.id || "",
    nodes,
    edges,
    reviewSuggestions: list(result.reviewSuggestions).slice(0, 20),
    rawAIOutput: result,
  };
}

export async function buildConnectedLearningGraphWithGemma4({
  candidateBundle = {},
  fileName = "",
  studyGoal = "",
  maxNodes = Number(process.env.CONNECT_LEARNING_MAX_NODES || 14),
} = {}) {
  const candidates = list(candidateBundle.candidates);

  if (!candidates.length) {
    throw new Error("No PDF-grounded concept candidates found. Cannot build learning graph.");
  }

  const fallback = fallbackTreeFromCandidates({
    candidateBundle,
    fileName,
    studyGoal,
    maxNodes,
  });

  const prompt = buildPrompt({
    candidateBundle,
    fileName,
    studyGoal,
    maxNodes,
  });

  let result = null;

  try {
    result = await callOllamaJson(prompt, fallback, {
      temperature: Number(process.env.CONNECT_LEARNING_TREE_TEMPERATURE || 0.1),
      timeoutMs: Number(process.env.CONNECT_LEARNING_TREE_FINAL_TIMEOUT_MS || 600000),
      numPredict: Number(process.env.CONNECT_LEARNING_TREE_NUM_PREDICT || 2200),
      model: process.env.CONNECT_LEARNING_FAST_MODEL || process.env.OLLAMA_CLOUD_MODEL,
    });
  } catch (error) {
    if (isCloudRequired()) {
      throw new Error(
        `Gemma 4 learning graph generation failed. Cloud tree is required, so no fallback/random tree was saved. Original error: ${
          error.message || String(error)
        }`
      );
    }

    result = fallback;
  }

  if (!result || !Array.isArray(result.nodes) || result.nodes.length < 2) {
    if (isCloudRequired()) {
      throw new Error(
        "Gemma 4 returned an empty/weak learning graph. No fallback/random tree was saved."
      );
    }

    result = fallback;
  }

  const normalized = normalizeGraphResult({
    result,
    candidateBundle,
    fileName,
    studyGoal,
    maxNodes,
  });

  if (!normalized.nodes.length || normalized.nodes.length < 2) {
    throw new Error("Learning graph normalization produced too few nodes.");
  }

  return normalized;
}

export default {
  buildConnectedLearningGraphWithGemma4,
};
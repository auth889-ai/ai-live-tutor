// server/services/connectLearning/pdfContext.service.js

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

function tokenize(text = "") {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "this",
    "that",
    "into",
    "your",
    "you",
    "are",
    "was",
    "were",
    "will",
    "shall",
    "can",
    "could",
    "should",
    "would",
    "have",
    "has",
    "had",
    "not",
    "but",
    "about",
    "what",
    "when",
    "where",
    "which",
    "using",
    "used",
    "each",
    "page",
    "slide",
    "section",
    "chapter",
  ]);

  return norm(text)
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3 && !stop.has(x));
}

function scoreTextMatch({ query = "", text = "" } = {}) {
  const queryTokens = tokenize(query);
  const hay = norm(text);

  if (!queryTokens.length || !hay) return 0;

  let score = 0;

  for (const token of queryTokens) {
    if (hay.includes(token)) score += 1;
  }

  return score / queryTokens.length;
}

function normalizeChunk(chunk = {}, index = 0) {
  const pageNumber =
    Number(chunk.pageNumber || chunk.page || chunk.pageStart || chunk.pageIndex || 0) || 0;

  return {
    ...chunk,
    chunkId: clean(chunk.chunkId || chunk.id || `p${pageNumber || 0}_c${index + 1}`),
    index: Number(chunk.index ?? index),
    pageNumber,
    pageStart: Number(chunk.pageStart || pageNumber || 0),
    pageEnd: Number(chunk.pageEnd || pageNumber || 0),
    type: clean(chunk.type || chunk.source || "text"),
    source: clean(chunk.source || chunk.type || "pdf"),
    text: String(chunk.text || chunk.content || chunk.ocrText || chunk.summary || "").trim(),
  };
}

function normalizeVisual(visual = {}, index = 0) {
  const pageNumber =
    Number(visual.pageNumber || visual.page || visual.pageIndex || index + 1) || index + 1;

  const vision = visual.vision || visual.visualAnalysis || visual.analysis || {};

  return {
    pageNumber,
    visualType: clean(
      visual.visualType || visual.visualTypeGuess || vision.visualType || visual.type || ""
    ),
    title: clean(visual.title || vision.title || ""),
    summary: clean(visual.summary || vision.summary || visual.reason || ""),
    ocrText: clean(visual.ocrText || visual.text || ""),
    imageUrl: clean(visual.imageUrl || ""),
    imagePath: clean(visual.imagePath || visual.filePath || ""),
    isMeaningful:
      visual.isMeaningful === true ||
      visual.hasVisualCandidate === true ||
      visual.hasMeaningfulVisual === true ||
      /diagram|workflow|chart|table|code|screenshot|flowchart|architecture|formula|graph/i.test(
        `${visual.visualType || ""} ${visual.title || ""} ${visual.summary || ""} ${
          vision.summary || ""
        }`
      ),
  };
}

function chunksFromTree(tree = {}) {
  const meta = tree.metadata || {};

  const possible = [
    meta.chunks,
    meta.pdfChunks,
    meta.extraction?.chunks,
    meta.pdfExtraction?.chunks,
    meta.extractionSummary?.chunks,
    tree.rawAIOutput?.chunks,
  ];

  for (const value of possible) {
    if (Array.isArray(value) && value.length) {
      return value.map(normalizeChunk).filter((chunk) => clean(chunk.text));
    }
  }

  const fullText =
    meta.fullText ||
    meta.pdfText ||
    meta.extraction?.fullText ||
    meta.pdfExtraction?.fullText ||
    "";

  if (clean(fullText)) {
    return splitTextIntoFallbackChunks(fullText);
  }

  return [];
}

function visualsFromTree(tree = {}) {
  const meta = tree.metadata || {};

  const possible = [
    meta.visualPages,
    meta.visualCandidates,
    meta.pdfVisualCandidates,
    meta.extraction?.visualPages,
    meta.extraction?.visualCandidates,
    meta.pdfExtraction?.visualPages,
    meta.pdfExtraction?.visualCandidates,
  ];

  for (const value of possible) {
    if (Array.isArray(value) && value.length) {
      return value.map(normalizeVisual).filter((visual) => visual.pageNumber);
    }
  }

  return [];
}

function splitTextIntoFallbackChunks(text = "") {
  const chunkSize = Number(process.env.CONNECT_LEARNING_STORE_CHUNK_CHARS || 6000);
  const input = String(text || "");
  const chunks = [];

  for (let i = 0; i < input.length; i += chunkSize) {
    const part = input.slice(i, i + chunkSize);
    chunks.push({
      chunkId: `fulltext_c${chunks.length + 1}`,
      index: chunks.length,
      pageNumber: 0,
      pageStart: 0,
      pageEnd: 0,
      type: "fullText",
      source: "pdf",
      text: part,
    });
  }

  return chunks;
}

function collectNodeQuery({ tree = {}, node = {}, allNodes = [] } = {}) {
  const parent =
    node.parentNodeId &&
    list(allNodes).find((n) => String(n._id || n.id) === String(node.parentNodeId));

  const children = list(allNodes).filter(
    (n) => String(n.parentNodeId || "") === String(node._id || node.id)
  );

  return cleanSpace(
    [
      tree.title,
      tree.studyGoal,
      node.title,
      node.summary,
      node.learningObjective,
      node.whyImportant,
      parent?.title,
      ...children.map((child) => child.title),
      ...list(node.concepts),
      ...list(node.tags),
      ...list(node.examples),
      ...list(node.beforeThis),
      ...list(node.afterThis),
      ...list(node.evidenceQuotes).map((q) => q.quote),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function candidateChunkIds(node = {}) {
  const ids = [
    ...list(node.relatedChunkIds),
    ...list(node.pageRefs).map((ref) => ref.chunkId),
    ...list(node.evidenceQuotes).map((quote) => quote.chunkId),
    ...list(node.sourceRefs).map((ref) => ref.chunkId),
  ];

  return uniq(ids).filter(Boolean);
}

function candidatePages(node = {}) {
  const pages = [
    ...list(node.pageRefs).map((ref) => ref.pageNumber),
    ...list(node.evidenceQuotes).map((quote) => quote.pageNumber),
    ...list(node.sourceRefs).map((ref) => ref.pageNumber),
    ...list(node.visualPageNumbers),
  ];

  return [...new Set(pages.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
}

function chunkScore({ chunk, node, query, chunkIds, pages } = {}) {
  let score = 0;

  if (chunkIds.includes(chunk.chunkId)) score += 10;
  if (pages.includes(Number(chunk.pageNumber))) score += 5;

  const textScore = scoreTextMatch({
    query,
    text: `${chunk.text || ""} ${chunk.chunkId || ""}`,
  });

  score += textScore * 6;

  const titleScore = scoreTextMatch({
    query: node.title,
    text: chunk.text,
  });

  score += titleScore * 5;

  return score;
}

function selectRelevantChunks({ tree = {}, node = {}, allNodes = [] } = {}) {
  const chunks = chunksFromTree(tree);
  if (!chunks.length) return [];

  const query = collectNodeQuery({ tree, node, allNodes });
  const chunkIds = candidateChunkIds(node);
  const pages = candidatePages(node);

  const scored = chunks
    .map((chunk) => ({
      chunk,
      score: chunkScore({ chunk, node, query, chunkIds, pages }),
    }))
    .sort((a, b) => b.score - a.score);

  const contextLimit = Number(process.env.CONNECT_LEARNING_CONTEXT_CHUNKS_PER_NODE || 5);
  const selected = [];

  for (const item of scored) {
    if (selected.length >= contextLimit) break;

    if (item.score > 0 || selected.length < 2) {
      selected.push(item.chunk);
    }
  }

  // Add neighbor chunks from same page for continuity.
  const selectedIds = new Set(selected.map((chunk) => chunk.chunkId));
  const selectedPages = new Set(selected.map((chunk) => Number(chunk.pageNumber)).filter(Boolean));

  for (const chunk of chunks) {
    if (selected.length >= contextLimit + 2) break;
    if (selectedIds.has(chunk.chunkId)) continue;
    if (selectedPages.has(Number(chunk.pageNumber))) {
      selected.push(chunk);
      selectedIds.add(chunk.chunkId);
    }
  }

  return selected.slice(0, contextLimit + 2);
}

function selectVisualRefs({ tree = {}, node = {}, chunks = [] } = {}) {
  const visuals = visualsFromTree(tree);
  if (!visuals.length) return [];

  const nodePages = new Set([
    ...candidatePages(node),
    ...list(chunks).map((chunk) => Number(chunk.pageNumber)).filter(Boolean),
  ]);

  const query = cleanSpace(
    [
      node.title,
      node.summary,
      node.learningObjective,
      node.whyImportant,
      ...list(node.concepts),
      ...list(node.tags),
      ...list(node.examples),
    ]
      .filter(Boolean)
      .join(" ")
  );

  const scored = visuals
    .map((visual) => {
      let score = 0;

      if (nodePages.has(Number(visual.pageNumber))) score += 5;

      score +=
        scoreTextMatch({
          query,
          text: `${visual.title} ${visual.summary} ${visual.ocrText} ${visual.visualType}`,
        }) * 6;

      if (visual.isMeaningful) score += 1;

      return { visual, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored
    .filter((item) => item.score > 0)
    .slice(0, 6)
    .map((item) => item.visual);
}

function normalizeEvidenceQuotesFromNode(node = {}) {
  return list(node.evidenceQuotes)
    .map((quote) => ({
      pageNumber: Number(quote.pageNumber || 0),
      chunkId: clean(quote.chunkId || ""),
      quote: trunc(cleanSpace(quote.quote || ""), 800),
      reason: trunc(cleanSpace(quote.reason || ""), 360),
    }))
    .filter((quote) => clean(quote.quote))
    .slice(0, 10);
}

function evidenceQuotesFromChunks({ node = {}, chunks = [] } = {}) {
  const existing = normalizeEvidenceQuotesFromNode(node);
  const existingKeys = new Set(
    existing.map((quote) => `${quote.pageNumber}:${quote.chunkId}:${norm(quote.quote).slice(0, 80)}`)
  );

  const autoQuotes = [];

  for (const chunk of chunks) {
    const quote = extractBestQuoteForNode({ node, text: chunk.text });

    if (!quote) continue;

    const item = {
      pageNumber: Number(chunk.pageNumber || 0),
      chunkId: clean(chunk.chunkId || ""),
      quote: trunc(quote, 800),
      reason: `Selected from PDF chunk because it matches "${node.title}".`,
    };

    const key = `${item.pageNumber}:${item.chunkId}:${norm(item.quote).slice(0, 80)}`;
    if (existingKeys.has(key)) continue;

    autoQuotes.push(item);
    existingKeys.add(key);
  }

  return [...existing, ...autoQuotes].slice(0, 10);
}

function extractBestQuoteForNode({ node = {}, text = "" } = {}) {
  const input = String(text || "");
  if (!input.trim()) return "";

  const sentences = input
    .split(/(?<=[.!?])\s+|\n+/)
    .map(cleanSpace)
    .filter((s) => s.length > 20 && s.length < 500);

  if (!sentences.length) return trunc(cleanSpace(input), 400);

  const query = cleanSpace(
    [node.title, node.summary, node.learningObjective, ...list(node.concepts)]
      .filter(Boolean)
      .join(" ")
  );

  const best = sentences
    .map((sentence) => ({
      sentence,
      score: scoreTextMatch({ query, text: sentence }),
    }))
    .sort((a, b) => b.score - a.score)[0];

  return best?.sentence || sentences[0] || "";
}

function connectedNodes({ node = {}, tree = {}, allNodes = [] } = {}) {
  const nodeId = String(node._id || node.id || "");
  const title = clean(node.title);

  const edges = list(tree.edges);

  const connectedTitles = [];

  for (const edge of edges) {
    const fromMatches =
      String(edge.fromNodeId || "") === nodeId ||
      norm(edge.fromTitle || "") === norm(title) ||
      norm(edge.from || "") === norm(title);

    const toMatches =
      String(edge.toNodeId || "") === nodeId ||
      norm(edge.toTitle || "") === norm(title) ||
      norm(edge.to || "") === norm(title);

    if (fromMatches) {
      connectedTitles.push({
        title: edge.toTitle || "",
        relation: edge.relation || "related",
        direction: "out",
        reason: edge.reason || "",
      });
    }

    if (toMatches) {
      connectedTitles.push({
        title: edge.fromTitle || "",
        relation: edge.relation || "related",
        direction: "in",
        reason: edge.reason || "",
      });
    }
  }

  const parent =
    node.parentNodeId &&
    list(allNodes).find((n) => String(n._id || n.id) === String(node.parentNodeId));

  const children = list(allNodes).filter(
    (n) => String(n.parentNodeId || "") === String(node._id || node.id)
  );

  return {
    parent: parent
      ? {
          id: String(parent._id || parent.id),
          title: parent.title,
          nodeType: parent.nodeType,
        }
      : null,
    children: children.slice(0, 12).map((child) => ({
      id: String(child._id || child.id),
      title: child.title,
      nodeType: child.nodeType,
    })),
    edges: connectedTitles
      .filter((x) => clean(x.title))
      .slice(0, 20),
  };
}

function buildPromptContext({ tree = {}, node = {}, chunks = [], evidenceQuotes = [], visualRefs = [], allNodes = [] }) {
  const connected = connectedNodes({ node, tree, allNodes });

  return {
    tree: {
      id: String(tree._id || tree.id || ""),
      title: tree.title || "",
      studyGoal: tree.studyGoal || "",
      description: tree.description || "",
      graphQuality: tree.graphQuality || "",
    },
    node: {
      id: String(node._id || node.id || ""),
      title: node.title || "",
      nodeType: node.nodeType || "",
      summary: node.summary || "",
      learningObjective: node.learningObjective || "",
      whyImportant: node.whyImportant || "",
      beforeThis: list(node.beforeThis),
      afterThis: list(node.afterThis),
      examples: list(node.examples),
      commonMistakes: list(node.commonMistakes),
      concepts: list(node.concepts),
      tags: list(node.tags),
    },
    connectedNodes: connected,
    evidenceQuotes,
    chunks: chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      pageNumber: chunk.pageNumber,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      type: chunk.type,
      source: chunk.source,
      text: trunc(chunk.text, Number(process.env.CONNECT_LEARNING_CONTEXT_CHUNK_TEXT_CHARS || 1800)),
    })),
    visualRefs: visualRefs.map((visual) => ({
      pageNumber: visual.pageNumber,
      visualType: visual.visualType,
      title: visual.title,
      summary: visual.summary,
      ocrText: trunc(visual.ocrText, 900),
      imageUrl: visual.imageUrl,
      imagePath: visual.imagePath,
    })),
  };
}

export async function buildPdfContextBundle({
  tree = {},
  node = {},
  allNodes = [],
} = {}) {
  if (!tree || !node) {
    throw new Error("tree and node are required to build PDF context bundle.");
  }

  const chunks = selectRelevantChunks({ tree, node, allNodes });
  const visualRefs = selectVisualRefs({ tree, node, chunks });
  const evidenceQuotes = evidenceQuotesFromChunks({ node, chunks });

  const promptContext = buildPromptContext({
    tree,
    node,
    chunks,
    evidenceQuotes,
    visualRefs,
    allNodes,
  });

  return {
    tree,
    node,
    chunks,
    visualRefs,
    visualCandidates: visualRefs,
    visualPages: visualRefs,
    evidenceQuotes,
    connectedNodes: promptContext.connectedNodes,
    promptContext,
    contextText: buildContextText(promptContext),
  };
}

function buildContextText(promptContext = {}) {
  const node = promptContext.node || {};
  const connected = promptContext.connectedNodes || {};
  const chunks = list(promptContext.chunks);
  const evidenceQuotes = list(promptContext.evidenceQuotes);
  const visualRefs = list(promptContext.visualRefs);

  const evidenceBlock = evidenceQuotes
    .map((quote) => {
      return `Evidence • page ${quote.pageNumber || "?"} • ${quote.chunkId || ""}\n"${quote.quote}"\nReason: ${
        quote.reason || ""
      }`;
    })
    .join("\n\n");

  const chunkBlock = chunks
    .map((chunk) => {
      return `[${chunk.chunkId} | page ${chunk.pageNumber || "?"}]\n${chunk.text}`;
    })
    .join("\n\n---\n\n");

  const visualBlock = visualRefs
    .map((visual) => {
      return `Visual • page ${visual.pageNumber || "?"} • ${visual.visualType || ""}\n${
        visual.title || ""
      }\n${visual.summary || ""}\n${visual.ocrText || ""}`;
    })
    .join("\n\n");

  const relationBlock = [
    connected.parent ? `Parent: ${connected.parent.title}` : "",
    connected.children?.length
      ? `Children: ${connected.children.map((child) => child.title).join(", ")}`
      : "",
    connected.edges?.length
      ? `Edges:\n${connected.edges
          .map((edge) => `${edge.direction}: ${edge.relation} ${edge.title} — ${edge.reason}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    `Selected node: ${node.title}`,
    `Node type: ${node.nodeType}`,
    node.summary ? `Summary: ${node.summary}` : "",
    node.learningObjective ? `Learning objective: ${node.learningObjective}` : "",
    node.whyImportant ? `Why important: ${node.whyImportant}` : "",
    relationBlock ? `Connected concepts:\n${relationBlock}` : "",
    evidenceBlock ? `PDF evidence:\n${evidenceBlock}` : "",
    chunkBlock ? `Relevant PDF chunks:\n${chunkBlock}` : "",
    visualBlock ? `Visual candidates:\n${visualBlock}` : "",
  ]
    .filter(Boolean)
    .join("\n\n====================\n\n");
}

export default {
  buildPdfContextBundle,
};
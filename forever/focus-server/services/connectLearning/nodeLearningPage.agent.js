// server/services/connectLearning/nodeLearningPage.agent.js

import { callOllamaJson } from "../ollamaCompat.service.js";

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function truncate(value = "", limit = 9000) {
  const text = String(value || "");
  return text.length > limit ? text.slice(0, limit) : text;
}

function buildNodePagePrompt({ node, understanding, graph, connectedEdges }) {
  return `
Return ONLY valid JSON. No markdown.

You are Phase 3 of "Connect Your Learning".

Task:
Create a full learning page for ONE roadmap node using ONLY the PDF evidence and document understanding.

Do not invent outside facts.
Do not write generic filler.
Use the exact PDF topic.

Node:
${JSON.stringify(node, null, 2)}

Connected edges:
${JSON.stringify(connectedEdges || [], null, 2)}

Document understanding:
${JSON.stringify(understanding || {}, null, 2)}

Graph title:
${graph?.title || ""}

Return exact JSON:
{
  "simpleExplanation": "",
  "whyItMatters": "",
  "pdfEvidence": "",
  "bookNotes": {
    "title": "",
    "pages": [
      {
        "heading": "",
        "content": ""
      }
    ]
  },
  "teacherLecture": "",
  "keyPoints": [],
  "chart": {
    "title": "",
    "rows": [
      {
        "label": "",
        "value": ""
      }
    ]
  },
  "checklist": [],
  "commonMistakes": [],
  "quiz": [
    {
      "question": "",
      "answer": ""
    }
  ],
  "relatedLinks": [
    {
      "title": "",
      "query": ""
    }
  ],
  "videoQueries": []
}

Book notes rules:
- Make it like readable book pages.
- 4 to 8 pages.
- Each page should have heading + detailed content.
- Use simple language.
- Include PDF evidence.
- Include examples only if PDF supports them.

Video query rules:
- Create 3 exact YouTube search queries.
- Queries must include node title + PDF subject + exact skill/task.
- Do not make generic query like "database tutorial" or "software course".
`;
}

function joinBookPages(bookNotes = {}) {
  const pages = safeArray(bookNotes.pages);
  if (!pages.length) return "";

  return pages
    .map((page, index) => {
      return [
        `# Page ${index + 1}: ${clean(page.heading) || "Study Notes"}`,
        "",
        clean(page.content),
      ].join("\n");
    })
    .join("\n\n---PAGE---\n\n");
}

function normalizePage(raw = {}, node = {}) {
  const bookNotes = raw.bookNotes || {};

  return {
    simpleExplanation: clean(raw.simpleExplanation) || clean(node.summary),
    whyItMatters: clean(raw.whyItMatters) || clean(node.whyItMatters),
    pdfEvidence: clean(raw.pdfEvidence) || clean(node.pdfEvidence),
    bookNotes: {
      title: clean(bookNotes.title) || `${node.title} — Book Notes`,
      pages: safeArray(bookNotes.pages)
        .map((page) => ({
          heading: clean(page.heading),
          content: clean(page.content),
        }))
        .filter((page) => page.heading || page.content),
    },
    teacherLecture: clean(raw.teacherLecture),
    keyPoints: safeArray(raw.keyPoints).map(clean).filter(Boolean),
    chart: {
      title: clean(raw.chart?.title) || `${node.title} — Study Chart`,
      rows: safeArray(raw.chart?.rows)
        .map((row) => ({
          label: clean(row.label),
          value: clean(row.value),
        }))
        .filter((row) => row.label || row.value),
    },
    checklist: safeArray(raw.checklist).map(clean).filter(Boolean),
    commonMistakes: safeArray(raw.commonMistakes).map(clean).filter(Boolean),
    quiz: safeArray(raw.quiz)
      .map((q) => ({
        question: clean(q.question),
        answer: clean(q.answer),
      }))
      .filter((q) => q.question && q.answer),
    relatedLinks: safeArray(raw.relatedLinks)
      .map((x) => ({
        title: clean(x.title),
        query: clean(x.query),
      }))
      .filter((x) => x.title || x.query),
    videoQueries: safeArray(raw.videoQueries).map(clean).filter(Boolean).slice(0, 5),
  };
}

export async function generateSingleNodeLearningPage({
  node = {},
  understanding = {},
  graph = {},
  connectedEdges = [],
}) {
  const raw = await callOllamaJson(
    buildNodePagePrompt({
      node: {
        title: node.title,
        type: node.type || node.rawAIOutput?.type,
        summary: node.summary || node.rawAIOutput?.summary,
        pdfEvidence:
          node.pdfEvidence ||
          node.rawAIOutput?.pdfEvidence ||
          node.rawAIOutput?.excerpt ||
          "",
        whyItMatters: node.whyItMatters || node.rawAIOutput?.whyItMatters || "",
        keyPoints: node.keyPoints || node.rawAIOutput?.keyPoints || [],
      },
      understanding,
      graph,
      connectedEdges,
    }),
    {},
    {
      cloudOnly: true,
      strictJson: true,
      allowFallback: false,
      timeoutMs: process.env.CONNECT_LEARNING_OLLAMA_TIMEOUT_MS || "45m",
      temperature: 0.05,
      num_predict: Number(process.env.CONNECT_LEARNING_PHASE3_NUM_PREDICT || 7500),
      retries: Number(process.env.CONNECT_LEARNING_PHASE3_CALL_RETRIES || 1),
    }
  );

  const normalized = normalizePage(raw, node);

  return {
    ...normalized,
    bookNotesText: joinBookPages(normalized.bookNotes),
  };
}

export function pageToResources({ page, node, tree, userId, deviceId }) {
  const treeId = tree?._id || tree?.id || tree;
  const nodeId = node?._id || node?.id || node;

  const base = {
    userId: userId || "",
    deviceId,
    treeId,
    nodeId,
    concepts: [node.title],
    confidence: 0.85,
    tags: ["ai-generated", "phase-3", "pdf-based"],
  };

  const resources = [];

  resources.push({
    ...base,
    sourceType: "pdf",
    title: `${node.title} — PDF Evidence`,
    summary: page.simpleExplanation,
    extractedText: page.pdfEvidence,
    keyPoints: page.keyPoints,
    rawAIOutput: { page },
  });

  resources.push({
    ...base,
    sourceType: "note",
    title: page.bookNotes?.title || `${node.title} — Book Notes`,
    summary: page.simpleExplanation,
    extractedText: page.bookNotesText,
    keyPoints: page.keyPoints,
    rawAIOutput: page.bookNotes,
  });

  resources.push({
    ...base,
    sourceType: "lecture",
    title: `${node.title} — Teacher Lecture`,
    summary: page.whyItMatters,
    extractedText: page.teacherLecture,
    keyPoints: page.keyPoints,
    rawAIOutput: { lecture: page.teacherLecture },
  });

  resources.push({
    ...base,
    sourceType: "key_points",
    title: `${node.title} — Key Points`,
    summary: `Key points for ${node.title}`,
    extractedText: page.keyPoints.map((x) => `• ${x}`).join("\n"),
    keyPoints: page.keyPoints,
    rawAIOutput: { keyPoints: page.keyPoints },
  });

  resources.push({
    ...base,
    sourceType: "chart",
    title: page.chart?.title || `${node.title} — Chart`,
    summary: `Structured chart for ${node.title}`,
    extractedText: JSON.stringify(page.chart?.rows || [], null, 2),
    keyPoints: page.keyPoints,
    rawAIOutput: page.chart,
  });

  for (const link of page.relatedLinks || []) {
    resources.push({
      ...base,
      sourceType: "related_link",
      title: link.title || link.query,
      summary: link.query,
      extractedText: link.query,
      rawAIOutput: link,
    });
  }

  return resources.filter((r) => clean(r.extractedText) || clean(r.summary) || r.sourceType === "chart");
}
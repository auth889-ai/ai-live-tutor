import crypto from "crypto";

import LiveTutorInteraction from "../../models/LiveTutorInteraction.js";
import LiveTutorBoard from "../../models/LiveTutorBoard.js";

import {
  indexLiveTutorDocuments,
  searchLiveTutorVectorStore,
  getLiveTutorVectorStoreHealth,
} from "./liveTutorVectorStore.service.js";

const LIVE_TUTOR_RAG_LIMIT = Number(process.env.LIVE_TUTOR_RAG_LIMIT || 8);
const LIVE_TUTOR_RAG_POOL = Number(process.env.LIVE_TUTOR_RAG_POOL || 80);

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function longClean(value = "") {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function trimText(value = "", max = 2000) {
  const text = longClean(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}...`;
}

function hashText(value = "") {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeTags(tags = []) {
  return [...new Set(safeArray(tags).map((x) => clean(x).toLowerCase()).filter(Boolean))].slice(
    0,
    40
  );
}

function tokenize(text = "") {
  return clean(text)
    .toLowerCase()
    .split(/[^a-zA-Z0-9\u0980-\u09FF]+/)
    .filter((x) => x.length > 2)
    .slice(0, 160);
}

function lexicalScore(query = "", text = "") {
  const q = tokenize(query);
  const t = String(text || "").toLowerCase();

  if (!q.length || !t) return 0;

  let score = 0;

  for (const term of q) {
    if (t.includes(term)) score += 1;
  }

  return score / Math.max(1, q.length);
}

function buildInteractionText(item = {}) {
  return trimText(
    [
      item.title,
      item.platform,
      item.mode,
      item.userQuestion,
      item.studentAnswer,
      item.selectedText,
      item.currentCaption,
      item.transcriptContext,
      item.visibleText,
      item.pageText,
      item.response?.headline,
      item.response?.shortAnswer,
      item.response?.explanation,
      item.response?.misconceptionCheck?.likelyConfusion,
      item.response?.misconceptionCheck?.wrongMentalModel,
      item.response?.misconceptionCheck?.repairExplanation,
      item.response?.thinkingScore?.reason,
      item.response?.thinkingScore?.nextImprovement,
      safeArray(item.response?.weakConcepts).join(", "),
      safeArray(item.response?.masteredConcepts).join(", "),
    ]
      .filter(Boolean)
      .join("\n"),
    7000
  );
}

function buildBoardText(board = {}) {
  const blocks = safeArray(board.pages).flatMap((page) => page.blocks || []);

  return trimText(
    [
      board.title,
      board.boardMode,
      board.sourceContext?.title,
      board.sourceContext?.currentCaption,
      board.sourceContext?.transcriptBefore,
      board.sourceContext?.transcriptCurrent,
      board.sourceContext?.transcriptAfter,
      board.sourceContext?.selectedText,
      board.sourceContext?.visibleTextPreview,
      safeArray(board.weakConcepts).join(", "),
      ...blocks.map((block) =>
        [
          block.type,
          block.title,
          block.content,
          typeof block.data === "object" ? JSON.stringify(block.data).slice(0, 1800) : "",
        ]
          .filter(Boolean)
          .join(" | ")
      ),
    ]
      .filter(Boolean)
      .join("\n"),
    9000
  );
}

function toContextItem({
  source = "",
  item = {},
  text = "",
  score = 0,
  extra = {},
}) {
  return {
    source,
    score,
    text: trimText(text, 1600),
    preview: trimText(text, 360),
    meta: {
      id: String(item._id || item.id || ""),
      mode: item.mode || item.boardMode || "",
      title: item.title || item.response?.headline || "",
      url: item.url || item.sourceContext?.url || item.sourceUrl || "",
      videoId: item.videoId || item.sourceContext?.videoId || "",
      timestampSeconds: item.timestampSeconds || item.sourceContext?.timestampSeconds || 0,
      createdAt: item.createdAt || null,
      updatedAt: item.updatedAt || null,
      ...extra,
    },
  };
}

async function getCandidateInteractions({
  userId = "guest",
  sessionKey = "",
  url = "",
  videoId = "",
}) {
  const or = [];

  if (sessionKey) or.push({ sessionKey });
  if (userId) or.push({ userId });
  if (videoId) or.push({ videoId });
  if (url) or.push({ url });

  const filter = {
    status: "ready",
    ...(or.length ? { $or: or } : {}),
  };

  return LiveTutorInteraction.find(filter)
    .sort({ createdAt: -1 })
    .limit(LIVE_TUTOR_RAG_POOL)
    .lean();
}

async function getCandidateBoards({
  userId = "guest",
  sessionKey = "",
  url = "",
  videoId = "",
}) {
  const or = [];

  if (sessionKey) or.push({ sessionKey });
  if (userId) or.push({ userId });
  if (videoId) or.push({ "sourceContext.videoId": videoId });
  if (url) or.push({ "sourceContext.url": url });

  const filter = {
    ...(or.length ? { $or: or } : {}),
  };

  return LiveTutorBoard.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(60, LIVE_TUTOR_RAG_POOL))
    .lean();
}

function buildQuery({
  query = "",
  conceptTags = [],
  userQuestion = "",
  selectedText = "",
  currentCaption = "",
  transcriptContext = "",
  markedElements = [],
} = {}) {
  return trimText(
    [
      query,
      userQuestion,
      selectedText,
      currentCaption,
      transcriptContext,
      safeArray(markedElements)
        .map((x) => [x.label, x.text].filter(Boolean).join(" "))
        .join("\n"),
      normalizeTags(conceptTags).join(" "),
    ]
      .filter(Boolean)
      .join("\n"),
    3500
  );
}

function mergeAndDeduplicate(items = [], limit = 8) {
  const seen = new Set();

  return safeArray(items)
    .filter((item) => item && (item.text || item.preview))
    .sort((a, b) => safeNumber(b.score) - safeNumber(a.score))
    .filter((item) => {
      const key = hashText(`${item.source}:${item.meta?.id}:${item.preview}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(1, Math.min(30, safeNumber(limit, 8))));
}

async function retrieveFromMongoMemory({
  query = "",
  userId = "guest",
  sessionKey = "",
  url = "",
  videoId = "",
  limit = 8,
}) {
  const [interactions, boards] = await Promise.all([
    getCandidateInteractions({ userId, sessionKey, url, videoId }),
    getCandidateBoards({ userId, sessionKey, url, videoId }),
  ]);

  const interactionItems = interactions.map((item) => {
    const text = buildInteractionText(item);
    const lexical = lexicalScore(query, text);

    const sameSession = sessionKey && item.sessionKey === sessionKey ? 0.16 : 0;
    const sameVideo = videoId && item.videoId === videoId ? 0.1 : 0;
    const sameUrl = url && item.url === url ? 0.08 : 0;

    return toContextItem({
      source: "interaction_memory",
      item,
      text,
      score: lexical * 0.82 + sameSession + sameVideo + sameUrl,
      extra: {
        interactionId: String(item._id),
        weakConcepts: item.response?.weakConcepts || [],
      },
    });
  });

  const boardItems = boards.map((board) => {
    const text = buildBoardText(board);
    const lexical = lexicalScore(query, text);

    const sameSession = sessionKey && board.sessionKey === sessionKey ? 0.18 : 0;
    const sameVideo = videoId && board.sourceContext?.videoId === videoId ? 0.12 : 0;
    const sameUrl = url && board.sourceContext?.url === url ? 0.1 : 0;

    return toContextItem({
      source: "board_memory",
      item: board,
      text,
      score: lexical * 0.88 + sameSession + sameVideo + sameUrl,
      extra: {
        boardId: String(board._id),
        boardMode: board.boardMode,
        weakConcepts: board.weakConcepts || [],
      },
    });
  });

  return mergeAndDeduplicate([...interactionItems, ...boardItems], limit);
}

function buildDocumentsFromPayload({
  userId = "guest",
  deviceId = "web",
  sessionKey = "",
  url = "",
  title = "",
  platform = "unknown",
  videoId = "",
  timestampSeconds = 0,
  conceptTags = [],
  weakConcepts = [],
  payload = {},
  tutorResponse = null,
  board = null,
} = {}) {
  const common = {
    userId,
    deviceId,
    sessionKey,
    sourceUrl: url,
    sourceTitle: title,
    platform,
    videoId,
    timestampSeconds,
    conceptTags,
    weakConcepts,
  };

  const documents = [];

  const transcriptParts = [
    payload.transcriptWindow?.before,
    payload.transcriptWindow?.current,
    payload.transcriptWindow?.after,
    payload.transcriptContext,
  ]
    .filter(Boolean)
    .join("\n\n");

  if (transcriptParts) {
    documents.push({
      ...common,
      sourceType: "transcript",
      sourceId: `${sessionKey}:transcript:${timestampSeconds}`,
      text: transcriptParts,
      metadata: {
        timestampSeconds,
        startSeconds: payload.transcriptWindow?.startSeconds || 0,
        endSeconds: payload.transcriptWindow?.endSeconds || 0,
      },
    });
  }

  if (payload.selectedText) {
    documents.push({
      ...common,
      sourceType: "selected_text",
      sourceId: `${sessionKey}:selected:${timestampSeconds}`,
      text: payload.selectedText,
      metadata: {
        selectedRect: payload.selectedRect || null,
      },
    });
  }

  if (payload.visibleText) {
    documents.push({
      ...common,
      sourceType: "visible_text",
      sourceId: `${sessionKey}:visible:${timestampSeconds}`,
      text: payload.visibleText,
    });
  }

  if (payload.pageText) {
    documents.push({
      ...common,
      sourceType: "page_text",
      sourceId: `${sessionKey}:page:${timestampSeconds}`,
      text: payload.pageText,
    });
  }

  for (const [index, el] of safeArray(payload.markedElements).slice(0, 12).entries()) {
    const text = [el.label, el.text].filter(Boolean).join("\n");

    if (!text) continue;

    documents.push({
      ...common,
      sourceType: "marked_element",
      sourceId: `${sessionKey}:marked:${timestampSeconds}:${index}`,
      text,
      metadata: {
        tagName: el.tagName || "",
        rect: el.rect || null,
      },
    });
  }

  if (tutorResponse) {
    const responseText = [
      tutorResponse.headline,
      tutorResponse.shortAnswer,
      tutorResponse.explanation,
      tutorResponse.misconceptionCheck?.likelyConfusion,
      tutorResponse.misconceptionCheck?.wrongMentalModel,
      tutorResponse.misconceptionCheck?.repairExplanation,
      tutorResponse.thinkingScore?.reason,
      tutorResponse.followUpQuestion,
      safeArray(tutorResponse.weakConcepts).join(", "),
    ]
      .filter(Boolean)
      .join("\n");

    if (responseText) {
      documents.push({
        ...common,
        sourceType: "interaction",
        sourceId: `${sessionKey}:response:${timestampSeconds}:${hashText(responseText).slice(0, 12)}`,
        text: responseText,
        conceptTags: [
          ...normalizeTags(conceptTags),
          ...normalizeTags(tutorResponse.weakConcepts),
        ],
        weakConcepts: normalizeTags(tutorResponse.weakConcepts),
      });
    }
  }

  if (board) {
    const boardText = buildBoardText(board);

    if (boardText) {
      documents.push({
        ...common,
        sourceType: "board",
        sourceId: String(board._id || board.boardId || `${sessionKey}:board:${timestampSeconds}`),
        text: boardText,
        conceptTags: [
          ...normalizeTags(conceptTags),
          ...normalizeTags(board.weakConcepts),
        ],
        weakConcepts: normalizeTags(board.weakConcepts),
        metadata: {
          boardId: String(board._id || board.boardId || ""),
          boardMode: board.boardMode || "",
        },
      });
    }

    for (const page of safeArray(board.pages)) {
      for (const block of safeArray(page.blocks)) {
        const blockText = [
          block.type,
          block.title,
          block.content,
          typeof block.data === "object" ? JSON.stringify(block.data).slice(0, 2000) : "",
        ]
          .filter(Boolean)
          .join("\n");

        if (!blockText) continue;

        documents.push({
          ...common,
          sourceType: "board_block",
          sourceId: `${String(board._id || board.boardId || "")}:${page.pageId}:${block.blockId}`,
          text: blockText,
          conceptTags: [
            ...normalizeTags(conceptTags),
            ...normalizeTags(board.weakConcepts),
          ],
          weakConcepts: normalizeTags(board.weakConcepts),
          metadata: {
            boardId: String(board._id || board.boardId || ""),
            pageId: page.pageId,
            blockId: block.blockId,
            blockType: block.type,
          },
        });
      }
    }
  }

  return documents.filter((doc) => clean(doc.text));
}

export async function indexLiveTutorContext({
  payload = {},
  tutorResponse = null,
  board = null,
  conceptTags = [],
  weakConcepts = [],
} = {}) {
  const userId = clean(payload.userId) || "guest";
  const deviceId = clean(payload.deviceId) || "web";
  const sessionKey = clean(payload.sessionKey) || "";
  const url = clean(payload.url);
  const title = clean(payload.title);
  const platform = clean(payload.platform) || "unknown";
  const videoId = clean(payload.videoId);
  const timestampSeconds = safeNumber(payload.timestampSeconds);

  const documents = buildDocumentsFromPayload({
    userId,
    deviceId,
    sessionKey,
    url,
    title,
    platform,
    videoId,
    timestampSeconds,
    conceptTags,
    weakConcepts,
    payload,
    tutorResponse,
    board,
  });

  if (!documents.length) {
    return {
      ok: true,
      indexed: 0,
      skipped: true,
      reason: "no dynamic context documents",
    };
  }

  return indexLiveTutorDocuments({
    documents,
  });
}

export async function retrieveLiveTutorContext({
  query = "",
  userId = "guest",
  sessionKey = "",
  url = "",
  sourceUrl = "",
  videoId = "",
  platform = "",
  conceptTags = [],
  userQuestion = "",
  selectedText = "",
  currentCaption = "",
  transcriptContext = "",
  markedElements = [],
  limit = LIVE_TUTOR_RAG_LIMIT,
} = {}) {
  const q = buildQuery({
    query,
    conceptTags,
    userQuestion,
    selectedText,
    currentCaption,
    transcriptContext,
    markedElements,
  });

  if (!q) {
    return [];
  }

  const finalUrl = sourceUrl || url;

  const [vectorResult, memoryResult] = await Promise.all([
    searchLiveTutorVectorStore({
      query: q,
      userId,
      sessionKey,
      sourceUrl: finalUrl,
      videoId,
      platform,
      conceptTags,
      limit,
    }),
    retrieveFromMongoMemory({
      query: q,
      userId,
      sessionKey,
      url: finalUrl,
      videoId,
      limit,
    }),
  ]);

  const vectorItems = safeArray(vectorResult.chunks).map((chunk) =>
    toContextItem({
      source: `vector_${chunk.retrievalMode || vectorResult.mode || "memory"}`,
      item: chunk,
      text: chunk.text,
      score: safeNumber(chunk.score),
      extra: {
        chunkId: chunk.chunkId,
        sourceType: chunk.sourceType,
        sourceId: chunk.sourceId,
        conceptTags: chunk.conceptTags || [],
        weakConcepts: chunk.weakConcepts || [],
        vectorScore: chunk.vectorScore || 0,
        lexicalScore: chunk.lexicalScore || 0,
        retrievalMode: chunk.retrievalMode || vectorResult.mode,
      },
    })
  );

  const merged = mergeAndDeduplicate(
    [
      ...vectorItems,
      ...memoryResult,
    ],
    limit
  );

  return merged;
}

export async function saveLiveTutorMemory({
  userId = "guest",
  deviceId = "web",
  sessionKey = "",
  url = "",
  videoId = "",
  timestampSeconds = 0,
  conceptTags = [],
  weakConcepts = [],
  tutorResponse = {},
  boardPlan = {},
  auditTrail = [],
  payload = {},
  board = null,
} = {}) {
  const finalPayload = {
    ...payload,
    userId: payload.userId || userId,
    deviceId: payload.deviceId || deviceId,
    sessionKey: payload.sessionKey || sessionKey,
    url: payload.url || url,
    videoId: payload.videoId || videoId,
    timestampSeconds: payload.timestampSeconds || timestampSeconds,
  };

  const indexed = await indexLiveTutorContext({
    payload: finalPayload,
    tutorResponse,
    board,
    conceptTags,
    weakConcepts,
  });

  return {
    ok: true,
    memoryHash: hashText(
      JSON.stringify({
        userId,
        sessionKey,
        url,
        videoId,
        timestampSeconds,
        weakConcepts,
        conceptTags,
      })
    ).slice(0, 24),
    savedAs: "live_tutor_vector_memory",
    indexed: indexed.indexed || 0,
    indexResult: indexed,
    userId,
    sessionKey,
    url,
    videoId,
    timestampSeconds,
    conceptTags: normalizeTags(conceptTags),
    weakConcepts: normalizeTags(weakConcepts),
    boardPlanBlocks: safeArray(boardPlan.blocks).length,
    auditNodes: safeArray(auditTrail).map((x) => x.node).filter(Boolean),
  };
}

export function getLiveTutorRagHealth() {
  return {
    ok: true,
    service: "live-tutor-rag",
    vectorStore: getLiveTutorVectorStoreHealth(),
    features: {
      dynamicPayloadIndexing: true,
      transcriptIndexing: true,
      pageTextIndexing: true,
      markedElementIndexing: true,
      boardMemoryIndexing: true,
      interactionMemoryFallback: true,
      hybridVectorLexicalRetrieval: true,
      langchainDocumentCompatible: true,
    },
  };
}

export default {
  retrieveLiveTutorContext,
  saveLiveTutorMemory,
  indexLiveTutorContext,
  getLiveTutorRagHealth,
};
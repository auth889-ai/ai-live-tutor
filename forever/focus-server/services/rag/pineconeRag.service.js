import { Pinecone } from "@pinecone-database/pinecone";
import { studyRuntimeConfig } from "../../config/studyRuntime.config.js";
import { embedText } from "../embedding.service.js";

let indexCache = null;

/**
 * File purpose:
 * Pinecone RAG memory.
 *
 * Real behavior:
 * Retrieves previous related study/feedback memories and saves new memories.
 * Gemma uses this to connect old + new knowledge.
 */
function getIndex() {
  if (!studyRuntimeConfig.pineconeApiKey || !studyRuntimeConfig.pineconeIndex) {
    return null;
  }

  if (!indexCache) {
    const pc = new Pinecone({ apiKey: studyRuntimeConfig.pineconeApiKey });
    indexCache = pc.index(studyRuntimeConfig.pineconeIndex);
  }

  return indexCache;
}

export async function retrieveStudyMemory({ deviceId, goal, pageText }) {
  try {
    const index = getIndex();
    if (!index) return [];

    const vector = await embedText(`${goal}\n${pageText}`);
    if (!vector) return [];

    const result = await index.query({
      vector,
      topK: 5,
      includeMetadata: true,
      filter: { deviceId },
    });

    return (result.matches || []).map((m) => ({
      score: m.score,
      text: m.metadata?.text || "",
      type: m.metadata?.type || "",
      url: m.metadata?.url || "",
      createdAt: m.metadata?.createdAt || "",
    }));
  } catch {
    return [];
  }
}

export async function saveStudyMemory({ deviceId, goal, text, type, url }) {
  try {
    const index = getIndex();
    if (!index || !text) return null;

    const vector = await embedText(text);
    if (!vector) return null;

    const id = `${deviceId}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;

    await index.upsert([
      {
        id,
        values: vector,
        metadata: {
          deviceId,
          goal,
          text: String(text).slice(0, 2000),
          type,
          url,
          createdAt: new Date().toISOString(),
        },
      },
    ]);

    return { id };
  } catch {
    return null;
  }
}
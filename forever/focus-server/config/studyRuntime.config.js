import dotenv from "dotenv";

/**
 * 🔥 VERY IMPORTANT
 * This loads .env into process.env
 */
dotenv.config();

/**
 * File purpose:
 * Reads all runtime settings from .env.
 * Fully dynamic, no hardcoding.
 */
export const studyRuntimeConfig = {
  aiMinIntervalMs: Number(process.env.STUDY_AI_MIN_INTERVAL_MS || 20000),
  screenshotIntervalMs: Number(process.env.STUDY_SCREENSHOT_INTERVAL_MS || 45000),
  maxTextChars: Number(process.env.STUDY_MAX_TEXT_CHARS || 3000),

  // 🌐 Cloud Gemma (PRIMARY)
  cloudGemmaUrl: process.env.OLLAMA_CLOUD_URL || "",
  cloudGemmaModel: process.env.OLLAMA_CLOUD_MODEL || "",

  // 💻 Local fallback
  localGemmaUrl: process.env.OLLAMA_LOCAL_URL || "",
  localGemmaModel: process.env.OLLAMA_LOCAL_MODEL || "",

  // 🔎 Embeddings
  embedUrl: process.env.OLLAMA_EMBED_URL || "",
  embedModel: process.env.OLLAMA_EMBED_MODEL || "",

  // 🧠 RAG
  pineconeApiKey: process.env.PINECONE_API_KEY || "",
  pineconeIndex: process.env.PINECONE_INDEX || "",

  // 🧮 Decision fusion weights are runtime configuration, not hidden constants.
  fusionWeights: {
    ai: Number(process.env.STUDY_FUSION_AI_WEIGHT || 0.55),
    relevance: Number(process.env.STUDY_FUSION_RELEVANCE_WEIGHT || 0.2),
    behavior: Number(process.env.STUDY_FUSION_BEHAVIOR_WEIGHT || 0.15),
    memory: Number(process.env.STUDY_FUSION_MEMORY_WEIGHT || 0.1),
  },

  behaviorRules: {
    longDwellMs: Number(process.env.STUDY_BEHAVIOR_LONG_DWELL_MS || 60000),
    mediumDwellMs: Number(process.env.STUDY_BEHAVIOR_MEDIUM_DWELL_MS || 20000),
    shortDwellMs: Number(process.env.STUDY_BEHAVIOR_SHORT_DWELL_MS || 5000),
    idlePenaltyMs: Number(process.env.STUDY_BEHAVIOR_IDLE_PENALTY_MS || 60000),
    typingActiveCount: Number(process.env.STUDY_BEHAVIOR_TYPING_ACTIVE_COUNT || 10),
    meaningfulScrollDepth: Number(process.env.STUDY_BEHAVIOR_MEANINGFUL_SCROLL_DEPTH || 30),
    fastScrollSpeed: Number(process.env.STUDY_BEHAVIOR_FAST_SCROLL_SPEED || 350),
    calmScrollSpeed: Number(process.env.STUDY_BEHAVIOR_CALM_SCROLL_SPEED || 120),
    manyTabSwitches: Number(process.env.STUDY_BEHAVIOR_MANY_TAB_SWITCHES || 4),
    someTabSwitches: Number(process.env.STUDY_BEHAVIOR_SOME_TAB_SWITCHES || 2),
  },
};
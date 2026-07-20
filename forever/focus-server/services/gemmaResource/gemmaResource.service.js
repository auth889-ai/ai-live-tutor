// server/services/gemmaResource/gemmaResource.service.js

import axios from "axios";
import fs from "fs/promises";
import path from "path";
import mongoose from "mongoose";

import GemmaResource from "../../models/GemmaResource.js";
import GemmaResourceChunk from "../../models/GemmaResourceChunk.js";
import GemmaResourceJob from "../../models/GemmaResourceJob.js";

function clean(value = "") {
  return String(value || "").trim();
}

function boolEnv(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ["true", "1", "yes", "y", "on"].includes(normalized);
}

function getFeatureEnabled() {
  return boolEnv(process.env.GEMMA_RESOURCE_ENABLED, true);
}

function getOfflineMode() {
  return boolEnv(process.env.OFFLINE_MODE, false);
}

function getCacheDir() {
  return (
    clean(process.env.GEMMA_RESOURCE_CACHE_DIR) ||
    clean(process.env.OFFLINE_RESOURCE_CACHE_DIR) ||
    path.join(process.cwd(), "data", "gemma-resource")
  );
}

function getOllamaBaseUrl() {
  const raw =
    clean(process.env.GEMMA_RESOURCE_OLLAMA_URL) ||
    clean(process.env.OFFLINE_RESOURCE_OLLAMA_URL) ||
    clean(process.env.OLLAMA_LOCAL_URL) ||
    "http://localhost:11434";

  return raw.replace(/\/api\/generate\/?$/i, "").replace(/\/+$/, "");
}

function getOllamaGenerateUrl() {
  const raw =
    clean(process.env.GEMMA_RESOURCE_OLLAMA_URL) ||
    clean(process.env.OFFLINE_RESOURCE_OLLAMA_URL) ||
    clean(process.env.OLLAMA_LOCAL_URL) ||
    "http://localhost:11434";

  const value = raw.replace(/\/+$/, "");
  if (value.endsWith("/api/generate")) return value;
  return `${value}/api/generate`;
}

function getGemmaModelName() {
  return (
    clean(process.env.GEMMA_RESOURCE_OLLAMA_MODEL) ||
    clean(process.env.OFFLINE_RESOURCE_LOCAL_MODEL) ||
    clean(process.env.OLLAMA_LOCAL_MODEL) ||
    "gemma4:e4b"
  );
}

function getEmbedModelName() {
  return (
    clean(process.env.GEMMA_RESOURCE_EMBED_MODEL) ||
    clean(process.env.OFFLINE_RESOURCE_EMBED_MODEL) ||
    clean(process.env.OLLAMA_EMBED_MODEL) ||
    "nomic-embed-text"
  );
}

function getMongoUriName() {
  return getOfflineMode() ? "LOCAL_MONGO_URI" : "MONGO_URI";
}

function getMongoStatus() {
  const state = mongoose.connection.readyState;

  const stateText =
    state === 0
      ? "disconnected"
      : state === 1
        ? "connected"
        : state === 2
          ? "connecting"
          : state === 3
            ? "disconnecting"
            : "unknown";

  return {
    ok: state === 1,
    connected: state === 1,
    state,
    stateText,
    dbName: mongoose.connection.name || "",
    host: mongoose.connection.host || "",
    port: mongoose.connection.port || "",
    uriName: getMongoUriName(),
    offlineMode: getOfflineMode(),
    message:
      state === 1
        ? `MongoDB connected to ${mongoose.connection.name || "database"}.`
        : "MongoDB is not connected.",
  };
}

async function checkCacheDir() {
  const cacheDir = getCacheDir();

  try {
    await fs.mkdir(cacheDir, { recursive: true });

    const testFile = path.join(cacheDir, ".gemma-resource-write-test");
    await fs.writeFile(testFile, "ok", "utf8");
    await fs.rm(testFile, { force: true });

    return {
      ok: true,
      path: cacheDir,
      writable: true,
      message: "Local cache folder is ready.",
    };
  } catch (error) {
    return {
      ok: false,
      path: cacheDir,
      writable: false,
      error: error?.message || String(error),
      message: "Local cache folder is not ready or not writable.",
    };
  }
}

async function checkLocalGemma() {
  const baseUrl = getOllamaBaseUrl();
  const generateUrl = getOllamaGenerateUrl();
  const model = getGemmaModelName();
  const embedModel = getEmbedModelName();

  try {
    const response = await axios.get(`${baseUrl}/api/tags`, {
      timeout: 3500,
      headers: {
        Accept: "application/json",
      },
    });

    const models = Array.isArray(response.data?.models)
      ? response.data.models
      : [];

    const modelNames = models
      .map((item) => item?.name || item?.model || "")
      .map((name) => String(name).trim())
      .filter(Boolean);

    const hasModel = (wanted) =>
      modelNames.some((name) => {
        return (
          name === wanted ||
          name.startsWith(`${wanted}:`) ||
          wanted.startsWith(`${name}:`)
        );
      });

    const modelInstalled = hasModel(model);
    const embedModelInstalled = hasModel(embedModel);

    return {
      ok: true,
      reachable: true,
      baseUrl,
      generateUrl,
      model,
      modelInstalled,
      embedModel,
      embedModelInstalled,
      models: modelNames.slice(0, 30),
      message: modelInstalled
        ? "Local Ollama is running and the selected Gemma model is available."
        : "Local Ollama is running, but the selected Gemma model was not found.",
      hint: modelInstalled ? "" : `Run: ollama pull ${model}`,
      embeddingHint: embedModelInstalled ? "" : `Run: ollama pull ${embedModel}`,
    };
  } catch (error) {
    return {
      ok: false,
      reachable: false,
      baseUrl,
      generateUrl,
      model,
      modelInstalled: false,
      embedModel,
      embedModelInstalled: false,
      models: [],
      error: error?.message || String(error),
      message: "Local Gemma/Ollama is not reachable.",
      hint: "Run: ollama serve",
      embeddingHint: `Run: ollama pull ${embedModel}`,
    };
  }
}

function getFeatureFlags() {
  return {
    overview: true,
    saveResource: true,
    offlineLibrary: true,
    studyPack: true,
    askGemma: true,
    semanticRetrieval: true,
    flipableBook: false,
    tutorBoard: false,
    codeTutor: false,
    quizMemory: false,
  };
}

function getSupportedSources() {
  return [
    {
      key: "youtube",
      label: "YouTube",
      status: "enabled",
      description: "Save transcripts and timestamped chunks for offline tutoring.",
    },
    {
      key: "webpage",
      label: "Webpage",
      status: "enabled",
      description: "Extract readable article/page text and turn it into study chunks.",
    },
    {
      key: "pdf",
      label: "PDF",
      status: "enabled",
      description: "Upload PDF files and create page-based offline study packs.",
    },
    {
      key: "text",
      label: "Notes/Text",
      status: "enabled",
      description: "Save pasted notes and class text as offline learning resources.",
    },
    {
      key: "code",
      label: "Code",
      status: "enabled",
      description: "Save code and ask Gemma for explanations, traces, and dry-run style help.",
    },
  ];
}

function buildReadinessSummary({ localGemma, mongo, cache }) {
  const problems = [];

  if (!mongo.ok) problems.push("MongoDB is not connected.");
  if (!cache.ok) problems.push("Local cache folder is not ready.");
  if (!localGemma.reachable) problems.push("Local Ollama/Gemma is not reachable.");
  else if (!localGemma.modelInstalled) problems.push("Selected Gemma model is not installed.");

  return {
    readyForOverview: true,
    readyForOfflineSave:
      mongo.ok && cache.ok && localGemma.reachable && localGemma.modelInstalled,
    readyForAskGemma:
      mongo.ok && cache.ok && localGemma.reachable && localGemma.modelInstalled,
    readyForSemanticSearch:
      mongo.ok &&
      cache.ok &&
      localGemma.reachable &&
      Boolean(localGemma.embedModelInstalled),
    problems,
    message:
      problems.length === 0
        ? "Gemma Resource & Tutor is ready for offline save, library, study packs, and Ask Gemma."
        : "Gemma Resource & Tutor is partially ready, but some local requirements need attention.",
  };
}

async function getResourceStats() {
  if (mongoose.connection.readyState !== 1) {
    return {
      totalResources: 0,
      readyResources: 0,
      processingResources: 0,
      failedResources: 0,
      totalChunks: 0,
      embeddedChunks: 0,
      recentJobs: 0,
    };
  }

  const [
    totalResources,
    readyResources,
    processingResources,
    failedResources,
    totalChunks,
    embeddedChunks,
    recentJobs,
  ] = await Promise.all([
    GemmaResource.countDocuments({ status: { $ne: "archived" } }),
    GemmaResource.countDocuments({ offlineReady: true, status: "ready" }),
    GemmaResource.countDocuments({
      status: { $in: ["queued", "processing", "extracting", "chunking", "building_pack"] },
    }),
    GemmaResource.countDocuments({ status: "failed" }),
    GemmaResourceChunk.countDocuments({}),
    GemmaResourceChunk.countDocuments({
      embedding: { $exists: true, $type: "array", $ne: [] },
    }),
    GemmaResourceJob.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    }),
  ]);

  return {
    totalResources,
    readyResources,
    processingResources,
    failedResources,
    totalChunks,
    embeddedChunks,
    missingEmbeddings: Math.max(0, totalChunks - embeddedChunks),
    embeddingCoverage:
      totalChunks > 0 ? Math.round((embeddedChunks / totalChunks) * 100) : 0,
    recentJobs,
  };
}

export async function getGemmaResourceHealth() {
  const [localGemma, cache, stats] = await Promise.all([
    checkLocalGemma(),
    checkCacheDir(),
    getResourceStats().catch(() => ({
      totalResources: 0,
      readyResources: 0,
      processingResources: 0,
      failedResources: 0,
      totalChunks: 0,
      embeddedChunks: 0,
      missingEmbeddings: 0,
      embeddingCoverage: 0,
      recentJobs: 0,
    })),
  ]);

  const mongo = getMongoStatus();

  const readiness = buildReadinessSummary({
    localGemma,
    mongo,
    cache,
  });

  return {
    service: "gemma-resource-and-tutor",
    label: "Gemma Resource & Tutor",
    enabled: getFeatureEnabled(),
    offlineMode: getOfflineMode(),

    mongo,
    localGemma,
    cache,
    readiness,
    stats,

    supportedSources: getSupportedSources(),
    features: getFeatureFlags(),

    env: {
      mongoUriName: getMongoUriName(),
      cacheDir: getCacheDir(),
      ollamaBaseUrl: getOllamaBaseUrl(),
      ollamaGenerateUrl: getOllamaGenerateUrl(),
      model: getGemmaModelName(),
      embedModel: getEmbedModelName(),
      buildEmbeddings: boolEnv(process.env.GEMMA_RESOURCE_BUILD_EMBEDDINGS, true),
      useEmbeddings: boolEnv(process.env.GEMMA_RESOURCE_USE_EMBEDDINGS, true),
    },

    nextStep:
      readiness.readyForSemanticSearch
        ? "Save a new resource to build a semantic offline study pack, then ask Gemma."
        : "Install the embedding model for best retrieval quality: ollama pull nomic-embed-text",

    at: new Date().toISOString(),
  };
}

export async function getGemmaResourceOverview() {
  const health = await getGemmaResourceHealth();

  return {
    title: "Gemma Resource & Tutor",
    tagline: "Save anything online. Learn it offline with local Gemma.",
    health,
    cards: [
      {
        title: "Offline Resource Hub",
        enabled: health.features.offlineLibrary,
        description:
          "Save YouTube, webpages, PDFs, notes, and code as offline-ready study resources.",
        metric: health.stats.totalResources,
      },
      {
        title: "Ask Gemma",
        enabled: health.features.askGemma && health.readiness.readyForAskGemma,
        description:
          "Ask source-grounded questions from your saved resources using local Gemma.",
        metric: health.stats.readyResources,
      },
      {
        title: "Semantic Retrieval",
        enabled: health.readiness.readyForSemanticSearch,
        description:
          "Use local embeddings to retrieve better chunks across any study subject.",
        metric: `${health.stats.embeddingCoverage || 0}%`,
      },
      {
        title: "Local Cache",
        enabled: health.cache.ok,
        description:
          "Store raw text, chunks, packs, and tutor memory in your local cache.",
        metric: health.cache.writable ? "Ready" : "Issue",
      },
    ],
  };
}
// server/services/gemmaResource/embeddingBuilder.service.js

import axios from "axios";

import GemmaResource from "../../models/GemmaResource.js";
import GemmaResourceChunk from "../../models/GemmaResourceChunk.js";

function clean(value = "") {
  return String(value || "").trim();
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function boolEnv(name, fallback = false) {
  const value = String(process.env[name] || "").trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function getOllamaBaseUrl() {
  const raw =
    clean(process.env.GEMMA_RESOURCE_OLLAMA_URL) ||
    clean(process.env.OFFLINE_RESOURCE_OLLAMA_URL) ||
    clean(process.env.OLLAMA_LOCAL_URL) ||
    "http://localhost:11434";

  return raw.replace(/\/api\/generate\/?$/i, "").replace(/\/+$/, "");
}

function getEmbeddingModel() {
  return (
    clean(process.env.GEMMA_RESOURCE_EMBED_MODEL) ||
    clean(process.env.OFFLINE_RESOURCE_EMBED_MODEL) ||
    clean(process.env.OLLAMA_EMBED_MODEL) ||
    "nomic-embed-text"
  );
}

function shouldBuildGemmaResourceEmbeddings() {
  return boolEnv(process.env.GEMMA_RESOURCE_BUILD_EMBEDDINGS, true);
}

function clampText(text = "", maxChars = 6000) {
  const value = String(text || "").trim();
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars).trim();
}

function buildEmbeddingText(chunk = {}) {
  return [
    chunk.title ? `Title: ${chunk.title}` : "",
    chunk.sourceType ? `Source type: ${chunk.sourceType}` : "",
    chunk.sourceRef ? `Source reference: ${chunk.sourceRef}` : "",
    Array.isArray(chunk.concepts) && chunk.concepts.length
      ? `Concepts: ${chunk.concepts.join(", ")}`
      : "",
    Array.isArray(chunk.keywords) && chunk.keywords.length
      ? `Keywords: ${chunk.keywords.join(", ")}`
      : "",
    "Content:",
    chunk.text || chunk.textPreview || "",
  ]
    .filter(Boolean)
    .join("\n");
}

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedText(text = "") {
  const model = getEmbeddingModel();
  const url = `${getOllamaBaseUrl()}/api/embeddings`;

  const response = await axios.post(
    url,
    {
      model,
      prompt: clampText(
        text,
        numberEnv("GEMMA_RESOURCE_EMBED_TEXT_MAX_CHARS", 6000)
      ),
    },
    {
      timeout: numberEnv("GEMMA_RESOURCE_EMBED_TIMEOUT_MS", 120000),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    }
  );

  const embedding = response.data?.embedding;

  if (!Array.isArray(embedding) || !embedding.length) {
    throw new Error("Ollama embedding response did not include an embedding.");
  }

  return {
    model,
    embedding,
    dimensions: embedding.length,
  };
}

async function embedOneChunk(chunk) {
  const text = buildEmbeddingText(chunk);

  if (!clean(text)) {
    return {
      ok: false,
      chunkId: chunk.chunkId,
      error: "Empty chunk text.",
    };
  }

  const embedded = await embedText(text);

  await GemmaResourceChunk.updateOne(
    { _id: chunk._id },
    {
      $set: {
        embedding: embedded.embedding,
        embeddingModel: embedded.model,
        "metadata.embedding": {
          model: embedded.model,
          dimensions: embedded.dimensions,
          builtAt: new Date().toISOString(),
          source: "ollama-local",
        },
      },
    }
  );

  return {
    ok: true,
    chunkId: chunk.chunkId,
    model: embedded.model,
    dimensions: embedded.dimensions,
  };
}

export async function buildGemmaResourceEmbeddings({
  resourceId,
  force = false,
  onProgress = null,
} = {}) {
  if (!resourceId) {
    throw new Error("resourceId is required for embedding build.");
  }

  const enabled = shouldBuildGemmaResourceEmbeddings();

  if (!enabled && !force) {
    return {
      ok: true,
      skipped: true,
      reason: "GEMMA_RESOURCE_BUILD_EMBEDDINGS=false",
      resourceId: String(resourceId),
      total: 0,
      embedded: 0,
      failed: 0,
      model: getEmbeddingModel(),
    };
  }

  const resource = await GemmaResource.findById(resourceId);

  if (!resource) {
    throw new Error("Resource not found for embedding build.");
  }

  const model = getEmbeddingModel();

  const query = { resourceId: resource._id };

  if (!force) {
    query.$or = [
      { embedding: { $exists: false } },
      { embedding: { $size: 0 } },
      { embeddingModel: { $ne: model } },
    ];
  }

  const chunks = await GemmaResourceChunk.find(query)
    .sort({ index: 1 })
    .limit(numberEnv("GEMMA_RESOURCE_EMBED_MAX_CHUNKS", 2000));

  const total = chunks.length;

  if (!total) {
    const info = {
      ok: true,
      skipped: false,
      alreadyBuilt: true,
      resourceId: String(resource._id),
      total: 0,
      embedded: 0,
      failed: 0,
      model,
      builtAt: new Date().toISOString(),
    };

    resource.metadata = {
      ...(resource.metadata || {}),
      embeddings: info,
    };

    await resource.save();

    return info;
  }

  const delayMs = numberEnv("GEMMA_RESOURCE_EMBED_DELAY_MS", 0);

  let embedded = 0;
  let failed = 0;
  const errors = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];

    try {
      const result = await embedOneChunk(chunk);

      if (result.ok) {
        embedded += 1;
      } else {
        failed += 1;
        errors.push({
          chunkId: result.chunkId,
          error: result.error,
        });
      }
    } catch (error) {
      failed += 1;
      errors.push({
        chunkId: chunk.chunkId,
        error: error.message || String(error),
      });
    }

    if (typeof onProgress === "function") {
      await onProgress({
        current: i + 1,
        total,
        embedded,
        failed,
        model,
      });
    }

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  const ok = embedded > 0 && failed < total;

  const info = {
    ok,
    skipped: false,
    resourceId: String(resource._id),
    total,
    embedded,
    failed,
    errors: errors.slice(0, 10),
    model,
    builtAt: new Date().toISOString(),
  };

  resource.metadata = {
    ...(resource.metadata || {}),
    embeddings: info,
  };

  await resource.save();

  return info;
}

export async function getGemmaResourceEmbeddingStats(resourceId) {
  const total = await GemmaResourceChunk.countDocuments({ resourceId });
  const embedded = await GemmaResourceChunk.countDocuments({
    resourceId,
    embedding: { $exists: true, $type: "array", $ne: [] },
  });

  return {
    total,
    embedded,
    missing: Math.max(0, total - embedded),
    model: getEmbeddingModel(),
    ready: total > 0 && embedded === total,
  };
}
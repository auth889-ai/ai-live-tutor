// server/services/gemmaResource/graphs/saveResource.graph.js

import crypto from "crypto";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import GemmaResource from "../../../models/GemmaResource.js";
import GemmaResourceJob from "../../../models/GemmaResourceJob.js";
import GemmaResourceChunk from "../../../models/GemmaResourceChunk.js";

import {
  detectGemmaResourceSource,
  getDefaultTitleForSource,
  getDomain,
} from "../sourceDetector.service.js";

import { extractGemmaResourceContent } from "../contentExtractor.service.js";
import { chunkExtractedResource } from "../chunker.service.js";
import {
  buildGemmaStudyPack,
  getGemmaPackClientInfo,
} from "../gemmaPack.service.js";

import { buildGemmaResourceEmbeddings } from "../embeddingBuilder.service.js";

import {
  ensureResourceCacheDir,
  getGemmaResourceCachePaths,
  saveCompleteResourceCache,
} from "../localCache.service.js";

function clean(value = "") {
  return String(value || "").trim();
}

function safeArray(value = []) {
  return Array.isArray(value) ? value : [];
}

function makeJobId() {
  return `grj_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function normalizeTags(tags = []) {
  if (Array.isArray(tags)) {
    return [
      ...new Set(tags.map((item) => clean(item)).filter(Boolean)),
    ].slice(0, 40);
  }

  if (typeof tags === "string") {
    return [
      ...new Set(
        tags
          .split(",")
          .map((item) => clean(item))
          .filter(Boolean)
      ),
    ].slice(0, 40);
  }

  return [];
}

function publicJob(job) {
  if (!job) return null;
  return typeof job.toClient === "function" ? job.toClient() : job;
}

function publicResource(resource) {
  if (!resource) return null;
  return typeof resource.toClient === "function" ? resource.toClient() : resource;
}

async function updateJob(jobId, update = {}) {
  if (!jobId) return null;

  const {
    status = "",
    stage = "",
    message = "",
    progress = null,
    resourceId = null,
    output = null,
    error = "",
    metadata = null,
  } = update;

  const job = await GemmaResourceJob.updateProgress(jobId, {
    status,
    stage,
    message,
    progress,
    resourceId,
    output,
    error,
    metadata,
  });

  return job;
}

function validateInput(input = {}) {
  const deviceId = clean(input.deviceId || input.device || "local-device");
  const userId = clean(input.userId || "");

  const url = clean(input.url || input.sourceUrl || "");
  const text = clean(
    input.text || input.content || input.notes || input.pastedText || ""
  );
  const title = clean(input.title || "");
  const sourceType = clean(input.sourceType || "");
  const studyGoal = clean(input.studyGoal || input.goal || "");
  const tags = normalizeTags(input.tags || []);

  if (!url && !text && !input.hasFile) {
    throw new Error("Provide a URL, pasted text/code, or uploaded file.");
  }

  return {
    ...input,
    deviceId,
    userId,
    url,
    sourceUrl: url,
    text,
    title,
    sourceType,
    studyGoal,
    tags,
  };
}

const SaveResourceState = Annotation.Root({
  jobId: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => "",
  }),

  input: Annotation({
    reducer: (current, update) => ({ ...(current || {}), ...(update || {}) }),
    default: () => ({}),
  }),

  file: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => null,
  }),

  detection: Annotation({
    reducer: (current, update) => ({ ...(current || {}), ...(update || {}) }),
    default: () => ({}),
  }),

  resourceId: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => "",
  }),

  resource: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => null,
  }),

  fetched: Annotation({
    reducer: (current, update) => ({ ...(current || {}), ...(update || {}) }),
    default: () => ({}),
  }),

  chunks: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => [],
  }),

  embeddings: Annotation({
    reducer: (current, update) => ({ ...(current || {}), ...(update || {}) }),
    default: () => ({}),
  }),

  pack: Annotation({
    reducer: (current, update) => ({ ...(current || {}), ...(update || {}) }),
    default: () => ({}),
  }),

  result: Annotation({
    reducer: (current, update) => ({ ...(current || {}), ...(update || {}) }),
    default: () => ({}),
  }),
});

async function detectSourceNode(state) {
  const input = validateInput({
    ...(state.input || {}),
    hasFile: Boolean(state.file),
  });

  await updateJob(state.jobId, {
    status: "detecting_source",
    stage: "Detecting source",
    message: "Understanding what kind of resource this is.",
    progress: 8,
  });

  const detection = detectGemmaResourceSource({
    sourceType: input.sourceType,
    url: input.url,
    text: input.text,
    file: state.file,
  });

  return {
    input,
    detection,
  };
}

async function createResourceNode(state) {
  const input = state.input || {};
  const detection = state.detection || {};

  const sourceType = detection.sourceType || input.sourceType || "notes";
  const sourceUrl = clean(input.url || input.sourceUrl || detection.url || "");
  const title =
    clean(input.title) ||
    getDefaultTitleForSource({
      sourceType,
      url: sourceUrl,
      file: state.file,
      text: input.text,
    });

  await updateJob(state.jobId, {
    status: "fetching_content",
    stage: "Creating resource",
    message: "Creating your offline resource record.",
    progress: 14,
  });

  const gemmaInfo = getGemmaPackClientInfo();

  const resource = await GemmaResource.create({
    deviceId: input.deviceId,
    userId: input.userId,
    title,
    sourceType,
    sourceUrl,
    domain: sourceUrl ? getDomain(sourceUrl) : "",
    originalFileName: state.file?.originalname || "",
    mimeType: state.file?.mimetype || "",
    studyGoal: input.studyGoal || "",
    tags: input.tags || [],
    status: "processing",
    offlineReady: false,
    progress: 14,
    processingStartedAt: new Date(),
    localGemma: {
      baseUrl: gemmaInfo.baseUrl,
      model: gemmaInfo.model,
    },
    metadata: {
      detection,
      inputMode: state.file ? "upload" : sourceUrl ? "url" : "text",
    },
  });

  await ensureResourceCacheDir(resource);

  await updateJob(state.jobId, {
    status: "fetching_content",
    stage: "Fetching content",
    message: "Fetching and preparing the source content.",
    progress: 18,
    resourceId: resource._id,
    output: {
      resourceId: String(resource._id),
      title: resource.title,
      sourceType: resource.sourceType,
    },
  });

  return {
    resourceId: String(resource._id),
    resource,
  };
}

async function extractContentNode(state) {
  const input = state.input || {};
  const resource = state.resource;

  await updateJob(state.jobId, {
    status: "extracting_text",
    stage: "Extracting content",
    message: "Extracting transcript, article text, PDF text, notes, or code.",
    progress: 28,
  });

  if (resource) {
    resource.status = "extracting";
    resource.progress = 28;
    await resource.save();
  }

  const fetched = await extractGemmaResourceContent({
    input,
    file: state.file,
  });

  if (!fetched?.text) {
    throw new Error("No content could be extracted from this resource.");
  }

  if (resource) {
    resource.title = fetched.title || resource.title;
    resource.sourceType = fetched.sourceType || resource.sourceType;
    resource.sourceUrl = fetched.sourceUrl || resource.sourceUrl;
    resource.domain = fetched.domain || resource.domain;
    resource.rawTextPreview = clean(fetched.text).slice(0, 1200);
    resource.rawTextChars = String(fetched.text || "").length;
    resource.pageCount = fetched.pageCount || 0;
    resource.durationSeconds = fetched.durationSeconds || 0;
    resource.originalFileName = fetched.originalFileName || resource.originalFileName;
    resource.mimeType = fetched.mimeType || resource.mimeType;
    resource.metadata = {
      ...(resource.metadata || {}),
      fetchedMetadata: fetched.metadata || {},
    };
    resource.progress = 38;
    await resource.save();
  }

  await updateJob(state.jobId, {
    status: "cleaning_content",
    stage: "Cleaning content",
    message: "Cleaning extracted content for offline study.",
    progress: 38,
    output: {
      title: fetched.title,
      sourceType: fetched.sourceType,
      rawTextChars: String(fetched.text || "").length,
    },
  });

  return { fetched };
}

async function chunkContentNode(state) {
  const fetched = state.fetched || {};
  const resource = state.resource;

  await updateJob(state.jobId, {
    status: "chunking",
    stage: "Creating chunks",
    message: "Splitting the resource into focused learning chunks.",
    progress: 50,
  });

  if (resource) {
    resource.status = "chunking";
    resource.progress = 50;
    await resource.save();
  }

  const chunks = await chunkExtractedResource({
    sourceType: fetched.sourceType,
    title: fetched.title,
    text: fetched.text,
    transcriptSegments: fetched.transcriptSegments || [],
    pages: fetched.pages || [],
    url: fetched.sourceUrl,
    domain: fetched.domain,
    metadata: fetched.metadata || {},
  });

  if (!chunks.length) {
    throw new Error("No study chunks could be created from this resource.");
  }

  await updateJob(state.jobId, {
    status: "chunking",
    stage: "Chunks created",
    message: `${chunks.length} learning chunks created.`,
    progress: 58,
    output: {
      chunkCount: chunks.length,
    },
  });

  return { chunks };
}

async function saveChunksNode(state) {
  const input = state.input || {};
  const fetched = state.fetched || {};
  const resource = state.resource;
  const chunks = safeArray(state.chunks);

  if (!resource?._id) {
    throw new Error("Resource record is missing before saving chunks.");
  }

  await updateJob(state.jobId, {
    status: "chunking",
    stage: "Saving chunks",
    message: "Saving chunks into local MongoDB.",
    progress: 64,
  });

  await GemmaResourceChunk.deleteMany({ resourceId: resource._id });

  const docs = chunks.map((chunk, index) => ({
    resourceId: resource._id,
    deviceId: input.deviceId,
    userId: input.userId,
    chunkId: chunk.chunkId || `chunk_${index + 1}`,
    index,
    sourceType: fetched.sourceType || resource.sourceType,
    title: fetched.title || resource.title,
    text: chunk.text,
    textPreview: chunk.textPreview,
    textChars: chunk.textChars,
    tokenCountEstimate: chunk.tokenCountEstimate,
    timestampStart: chunk.timestampStart || "",
    timestampEnd: chunk.timestampEnd || "",
    startSeconds: chunk.startSeconds ?? null,
    endSeconds: chunk.endSeconds ?? null,
    pageNumber: chunk.pageNumber ?? null,
    pageStart: chunk.pageStart ?? null,
    pageEnd: chunk.pageEnd ?? null,
    lineStart: chunk.lineStart ?? null,
    lineEnd: chunk.lineEnd ?? null,
    keywords: chunk.keywords || [],
    concepts: chunk.concepts || [],
    sourceRef: chunk.sourceRef || `Chunk ${index + 1}`,
    metadata: chunk.metadata || {},
  }));

  const savedChunks = await GemmaResourceChunk.insertMany(docs);

  resource.chunkCount = savedChunks.length;
  resource.progress = 66;
  await resource.save();

  return {
    chunks: savedChunks.map((doc) =>
      typeof doc.toClient === "function"
        ? doc.toClient({ includeText: true })
        : doc
    ),
  };
}

async function buildEmbeddingsNode(state) {
  const resource = state.resource;

  if (!resource?._id) {
    throw new Error("Resource record is missing before building embeddings.");
  }

  await updateJob(state.jobId, {
    status: "building_semantic_index",
    stage: "Building semantic index",
    message:
      "Creating local semantic index for better offline Ask Gemma retrieval.",
    progress: 68,
    resourceId: resource._id,
  });

  resource.status = "building_semantic_index";
  resource.progress = 68;
  await resource.save();

  let embeddingInfo = null;

  try {
    embeddingInfo = await buildGemmaResourceEmbeddings({
      resourceId: resource._id,
      force: false,
      onProgress: async ({ current, total, embedded, failed, model }) => {
        const ratio = total ? current / total : 1;
        const progress = Math.min(74, Math.max(68, Math.round(68 + ratio * 6)));

        await updateJob(state.jobId, {
          status: "building_semantic_index",
          stage: "Building semantic index",
          message: `Creating local semantic index ${current}/${total}.`,
          progress,
          resourceId: resource._id,
          metadata: {
            embeddings: {
              current,
              total,
              embedded,
              failed,
              model,
            },
          },
        });
      },
    });
  } catch (error) {
    embeddingInfo = {
      ok: false,
      skipped: false,
      error: error?.message || String(error),
      model: process.env.GEMMA_RESOURCE_EMBED_MODEL || "nomic-embed-text",
    };
  }

  resource.metadata = {
    ...(resource.metadata || {}),
    embeddings: embeddingInfo,
  };

  resource.progress = 74;
  await resource.save();

  await updateJob(state.jobId, {
    status: "building_semantic_index",
    stage: "Semantic index ready",
    message: embeddingInfo?.ok
      ? "Semantic search index is ready."
      : "Semantic index was skipped or failed. Keyword retrieval will still work.",
    progress: 74,
    resourceId: resource._id,
    metadata: {
      embeddings: embeddingInfo,
    },
  });

  return {
    embeddings: embeddingInfo || {},
  };
}

async function buildStudyPackNode(state) {
  const fetched = state.fetched || {};
  const chunks = safeArray(state.chunks);
  const resource = state.resource;
  const input = state.input || {};
  const embeddings = state.embeddings || {};

  await updateJob(state.jobId, {
    status: "building_pack",
    stage: "Building study pack",
    message: "Local Gemma is creating the offline study pack.",
    progress: 78,
    metadata: {
      embeddings,
    },
  });

  if (resource) {
    resource.status = "building_pack";
    resource.progress = 78;
    await resource.save();
  }

  const pack = await buildGemmaStudyPack({
    fetched,
    chunks,
    studyGoal: input.studyGoal || fetched.studyGoal || "",
  });

  await updateJob(state.jobId, {
    status: "building_pack",
    stage: "Study pack created",
    message: "Study pack created from your saved content.",
    progress: 88,
    output: {
      summary: pack.summary || "",
      sectionCount: safeArray(pack.sections).length,
      estimatedStudyMinutes: resource?.estimatedStudyMinutes || 0,
    },
    metadata: {
      ai: pack.ai || {},
      embeddings,
    },
  });

  return { pack };
}

async function finalizeResourceNode(state) {
  const resource = state.resource;
  const fetched = state.fetched || {};
  const chunks = safeArray(state.chunks);
  const pack = state.pack || {};
  const embeddings = state.embeddings || {};

  if (!resource?._id) {
    throw new Error("Resource record is missing before finalization.");
  }

  await updateJob(state.jobId, {
    status: "saving_cache",
    stage: "Saving offline pack",
    message: "Saving raw content, chunks, study pack, and semantic metadata locally.",
    progress: 94,
  });

  const cacheInfo = await saveCompleteResourceCache({
    resource,
    fetched,
    chunks,
    pack,
    extra: {
      jobId: state.jobId,
      finalizedAt: new Date().toISOString(),
      embeddings,
    },
  });

  const paths = getGemmaResourceCachePaths(resource);

  resource.title = fetched.title || resource.title;
  resource.sourceType = fetched.sourceType || resource.sourceType;
  resource.sourceUrl = fetched.sourceUrl || resource.sourceUrl;
  resource.domain = fetched.domain || resource.domain;
  resource.summary = pack.summary || "";
  resource.deepExplanation = pack.deepExplanation || "";
  resource.sections = safeArray(pack.sections);
  resource.keyPoints = safeArray(pack.keyPoints);
  resource.concepts = safeArray(pack.concepts);
  resource.tags = [
    ...new Set([
      ...safeArray(resource.tags),
      ...safeArray(pack.tags),
      fetched.sourceType,
    ].filter(Boolean)),
  ].slice(0, 40);
  resource.quickRevision = safeArray(pack.quickRevision);
  resource.roadmap = safeArray(pack.roadmap);
  resource.practiceQuestions = safeArray(pack.practiceQuestions);
  resource.rawTextPreview = clean(fetched.text).slice(0, 1200);
  resource.rawTextChars = String(fetched.text || "").length;
  resource.chunkCount = chunks.length;
  resource.pageCount = fetched.pageCount || 0;
  resource.durationSeconds = fetched.durationSeconds || 0;
  resource.cacheDir = paths.dir;
  resource.rawTextPath = cacheInfo.rawTextPath;
  resource.chunksPath = cacheInfo.chunksPath;
  resource.packPath = cacheInfo.packPath;
  resource.status = "ready";
  resource.offlineReady = true;
  resource.progress = 100;
  resource.error = "";
  resource.processingCompletedAt = new Date();
  resource.metadata = {
    ...(resource.metadata || {}),
    ai: pack.ai || {},
    embeddings,
    cache: {
      rawInfo: cacheInfo.rawInfo,
      chunkInfo: cacheInfo.chunkInfo,
      packInfo: cacheInfo.packInfo,
    },
  };

  await resource.save();

  const job = await updateJob(state.jobId, {
    status: "ready",
    stage: "Offline pack ready",
    message: "Your resource is saved and ready for offline learning.",
    progress: 100,
    resourceId: resource._id,
    output: {
      resourceId: String(resource._id),
      title: resource.title,
      sourceType: resource.sourceType,
      summary: resource.summary,
      chunkCount: resource.chunkCount,
      sectionCount: resource.sectionCount,
      rawTextChars: resource.rawTextChars,
      estimatedStudyMinutes: resource.estimatedStudyMinutes,
    },
    metadata: {
      embeddings,
    },
  });

  return {
    result: {
      ok: true,
      job: publicJob(job),
      resource: publicResource(resource),
    },
  };
}

const saveResourceWorkflow = new StateGraph(SaveResourceState)
  .addNode("detectSource", detectSourceNode)
  .addNode("createResource", createResourceNode)
  .addNode("extractContent", extractContentNode)
  .addNode("chunkContent", chunkContentNode)
  .addNode("saveChunks", saveChunksNode)
  .addNode("buildEmbeddings", buildEmbeddingsNode)
  .addNode("buildStudyPack", buildStudyPackNode)
  .addNode("finalizeResource", finalizeResourceNode)
  .addEdge(START, "detectSource")
  .addEdge("detectSource", "createResource")
  .addEdge("createResource", "extractContent")
  .addEdge("extractContent", "chunkContent")
  .addEdge("chunkContent", "saveChunks")
  .addEdge("saveChunks", "buildEmbeddings")
  .addEdge("buildEmbeddings", "buildStudyPack")
  .addEdge("buildStudyPack", "finalizeResource")
  .addEdge("finalizeResource", END);

const compiledSaveResourceGraph = saveResourceWorkflow.compile();

export async function createGemmaResourceJob({
  input = {},
  file = null,
} = {}) {
  const normalizedInput = validateInput({
    ...input,
    hasFile: Boolean(file),
  });

  const jobId = makeJobId();

  const job = await GemmaResourceJob.create({
    jobId,
    deviceId: normalizedInput.deviceId,
    userId: normalizedInput.userId,
    sourceType: normalizedInput.sourceType || "",
    title: normalizedInput.title || "",
    status: "queued",
    stage: "Queued",
    message: "Your resource is queued for offline pack creation.",
    progress: 0,
    input: {
      deviceId: normalizedInput.deviceId,
      userId: normalizedInput.userId,
      sourceType: normalizedInput.sourceType,
      url: normalizedInput.url,
      title: normalizedInput.title,
      studyGoal: normalizedInput.studyGoal,
      textChars: String(normalizedInput.text || "").length,
      fileName: file?.originalname || "",
      mimeType: file?.mimetype || "",
      tags: normalizedInput.tags || [],
    },
  });

  await job.addLog({
    status: "queued",
    stage: "Queued",
    message: "Your resource is queued for processing.",
    progress: 0,
  });

  return job;
}

export async function runSaveResourceGraph({
  jobId,
  input = {},
  file = null,
} = {}) {
  if (!jobId) throw new Error("jobId is required.");

  try {
    const finalState = await compiledSaveResourceGraph.invoke({
      jobId,
      input: {
        ...input,
        hasFile: Boolean(file),
      },
      file,
    });

    return finalState.result;
  } catch (error) {
    const message = error?.message || String(error);

    const job = await GemmaResourceJob.findOne({ jobId });

    let resource = null;

    if (job?.resourceId) {
      resource = await GemmaResource.findById(job.resourceId);
    }

    if (resource) {
      resource.status = "failed";
      resource.offlineReady = false;
      resource.progress = 100;
      resource.error = message;
      resource.processingCompletedAt = new Date();
      await resource.save();
    }

    let failedJob = job;

    if (job) {
      failedJob = await updateJob(jobId, {
        status: "failed",
        stage: "Failed",
        message,
        progress: 100,
        error: message,
      });
    }

    return {
      ok: false,
      error: message,
      job: publicJob(failedJob),
      resource: publicResource(resource),
    };
  }
}

export async function createAndRunSaveResourceGraph({
  input = {},
  file = null,
  runInBackground = true,
} = {}) {
  const job = await createGemmaResourceJob({
    input,
    file,
  });

  if (runInBackground) {
    setTimeout(() => {
      runSaveResourceGraph({
        jobId: job.jobId,
        input,
        file,
      }).catch((error) => {
        console.error("[GemmaResourceGraph] background failure:", error);
      });
    }, 0);

    return {
      ok: true,
      background: true,
      job: publicJob(job),
    };
  }

  const result = await runSaveResourceGraph({
    jobId: job.jobId,
    input,
    file,
  });

  return {
    ok: result?.ok !== false,
    background: false,
    job: result?.job || publicJob(job),
    resource: result?.resource || null,
    error: result?.error || "",
  };
}

export async function getSaveResourceGraphJob(jobId) {
  const job = await GemmaResourceJob.findOne({ jobId });

  if (!job) {
    throw new Error(`Gemma Resource job not found: ${jobId}`);
  }

  let resource = null;

  if (job.resourceId) {
    resource = await GemmaResource.findById(job.resourceId).select(
      GemmaResource.publicFields()
    );
  }

  return {
    job: publicJob(job),
    resource: publicResource(resource),
  };
}

export { compiledSaveResourceGraph };
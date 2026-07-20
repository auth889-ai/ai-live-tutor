import axios from "axios";
import mongoose from "mongoose";

import GoodContentJob from "../models/GoodContentJob.js";
import GoodContentChunk from "../models/GoodContentChunk.js";
import GoodContentConversation from "../models/GoodContentConversation.js";

import { callOllamaJson, callOllamaText } from "./ollamaCompat.service.js";
import { getYouTubeTranscript, isYouTubeUrl } from "./youtubeTranscript.service.js";
import { emitStudyEvent } from "../config/realtime.js";

const DEFAULT_CHUNK_SECONDS = Number(process.env.GOOD_CONTENT_CHUNK_SECONDS || 60);
const DIRECT_MAX_SECONDS = Number(process.env.GOOD_CONTENT_DIRECT_MAX_SECONDS || 1800);
const PARALLEL_MAX_SECONDS = Number(process.env.GOOD_CONTENT_PARALLEL_MAX_SECONDS || 7200);
const DEFAULT_CONCURRENCY = Math.max(1, Number(process.env.GOOD_CONTENT_CONCURRENCY || 1));
const GEMMA_TIMEOUT_MS = Number(process.env.GOOD_CONTENT_GEMMA_TIMEOUT_MS || 240000);
const MAX_CHUNK_CHARS = Number(process.env.GOOD_CONTENT_MAX_CHUNK_CHARS || 7000);
const FINAL_SECTIONS_LIMIT = Number(process.env.GOOD_CONTENT_FINAL_SECTIONS || 12);

const runningJobs = new Set();

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function clampNumber(value, min, max, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function formatTime(seconds = 0) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(
      s
    ).padStart(2, "0")}`;
  }

  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function parseTimeString(value = "") {
  const text = String(value || "").trim();
  const parts = text.split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

function normalizeTimeValue(value = 0, source = "") {
  if (typeof value === "string" && value.includes(":")) {
    return parseTimeString(value);
  }

  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;

  const src = String(source || "").toLowerCase();

  if (
    src.includes("offset") ||
    src.includes("duration_ms") ||
    src.includes("offset_ms") ||
    src.includes("millisecond") ||
    src === "ms"
  ) {
    return Math.round(n / 1000);
  }

  if (n > 1000) return Math.round(n / 1000);

  return n;
}

function detectPlatform(url = "") {
  if (isYouTubeUrl(url)) return "youtube";
  if (url && /^https?:\/\//i.test(url)) return "webpage";
  return "text";
}

function pickStrategy(durationSeconds = 0, totalChunks = 0) {
  if (durationSeconds > PARALLEL_MAX_SECONDS || totalChunks > 40) return "long_background";
  if (durationSeconds > DIRECT_MAX_SECONDS || totalChunks > 8) return "parallel";
  return "direct";
}

function getApiSafeJob(job) {
  return {
    id: String(job._id),
    jobId: String(job._id),
    userId: job.userId,
    deviceId: job.deviceId,
    url: job.url,
    title: job.title,
    platform: job.platform,
    userGoal: job.userGoal,
    userLevel: job.userLevel,
    contentNeed: job.contentNeed,
    extraRequirement: job.extraRequirement,
    timeAvailableMinutes: job.timeAvailableMinutes,
    status: job.status,
    phase: job.phase,
    message: job.message,
    durationSeconds: job.durationSeconds,
    transcriptSource: job.transcriptSource,
    transcriptChars: job.transcriptChars,
    totalChunks: job.totalChunks,
    processedChunks: job.processedChunks,
    failedChunks: job.failedChunks,
    progress: job.progress,
    strategy: job.strategy,
    fitScore: job.fitScore,
    recommendation: job.recommendation,
    finalRoadmap: job.finalRoadmap,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  };
}

function emitProgress(job, extra = {}) {
  try {
    emitStudyEvent(
      { deviceId: job.deviceId, userId: job.userId },
      extra.type || "good-content:progress",
      {
        type: extra.type || "good-content:progress",
        job: getApiSafeJob(job),
        ...extra,
      }
    );
  } catch (err) {
    console.warn("[GoodContentReach] socket emit skipped:", err?.message || err);
  }
}

async function updateJob(jobId, patch = {}) {
  const job = await GoodContentJob.findByIdAndUpdate(jobId, patch, { new: true });
  if (job) emitProgress(job);
  return job;
}

function inferDurationFromSegments(segments = []) {
  return Math.max(...segments.map((seg) => Number(seg.endSeconds || seg.startSeconds || 0)), 0);
}

function normalizeTranscriptSegments(rawSegments = [], knownDurationSeconds = 0) {
  const normalized = safeArray(rawSegments)
    .map((seg, index) => {
      const hasOffset = seg.offset !== undefined || seg.offsetMs !== undefined;
      const hasDurationMs =
        seg.durationMs !== undefined ||
        seg.dDurationMs !== undefined ||
        (seg.duration !== undefined && seg.durationSeconds === undefined);

      const rawStart =
        seg.startSeconds ??
        seg.startTimeSeconds ??
        seg.start ??
        seg.offsetMs ??
        seg.offset ??
        seg.tStartMs ??
        seg.time ??
        seg.startTime ??
        0;

      const rawDuration =
        seg.durationSeconds ??
        seg.durationMs ??
        seg.dDurationMs ??
        seg.dur ??
        seg.length ??
        seg.duration ??
        0;

      const rawEnd =
        seg.endSeconds ??
        seg.endTimeSeconds ??
        seg.end ??
        null;

      const startSource =
        seg.tStartMs !== undefined || seg.offsetMs !== undefined || hasOffset
          ? "offset_ms"
          : "seconds";

      const durationSource = hasDurationMs ? "duration_ms" : "seconds";

      let start = normalizeTimeValue(rawStart, startSource);
      let duration = normalizeTimeValue(rawDuration, durationSource);

      let end =
        rawEnd !== null && rawEnd !== undefined
          ? normalizeTimeValue(rawEnd, "seconds")
          : duration > 0
          ? start + duration
          : start + 8;

      start = Math.max(0, start);
      end = Math.max(start + 1, end);

      if (knownDurationSeconds > 0) {
        start = Math.min(start, knownDurationSeconds);
        end = Math.min(end, knownDurationSeconds);
        if (end <= start) end = Math.min(knownDurationSeconds, start + 1);
      }

      return {
        index,
        startSeconds: start,
        endSeconds: end,
        text: clean(seg.text || seg.caption || seg.content || ""),
      };
    })
    .filter((seg) => seg.text);

  return normalized.sort((a, b) => a.startSeconds - b.startSeconds);
}

function segmentsToText(segments = []) {
  return safeArray(segments)
    .map((seg) => `[${formatTime(seg.startSeconds)}] ${seg.text}`)
    .join("\n");
}

async function fetchWebpageText(url = "") {
  const response = await axios.get(url, {
    timeout: 20000,
    maxContentLength: 3 * 1024 * 1024,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; GoodContentReachBot/1.0)",
      Accept: "text/html,application/xhtml+xml,text/plain",
    },
  });

  const html = String(response.data || "");
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  const title = clean(
    titleMatch?.[1]
      ?.replace(/&amp;/g, "&")
      ?.replace(/&lt;/g, "<")
      ?.replace(/&gt;/g, ">") || ""
  );

  const text = clean(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/h[1-6]>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
  );

  return { title, text };
}

async function resolveContent(job) {
  const platform = detectPlatform(job.url);
  const knownDurationSeconds = Number(job.durationSeconds || 0);

  if (safeArray(job.requestSegments).length > 0) {
    const segments = normalizeTranscriptSegments(job.requestSegments, knownDurationSeconds);
    const durationSeconds = knownDurationSeconds || inferDurationFromSegments(segments);

    return {
      platform,
      title: job.title,
      durationSeconds,
      source: "provided_segments",
      text: segmentsToText(segments),
      segments,
    };
  }

  if (job.requestTranscript) {
    return {
      platform,
      title: job.title,
      durationSeconds: knownDurationSeconds,
      source: "provided_transcript",
      text: clean(job.requestTranscript),
      segments: [],
    };
  }

  if (platform === "youtube") {
    try {
      const transcriptResult = await getYouTubeTranscript(job.url);
      const segments = normalizeTranscriptSegments(
        transcriptResult?.segments || [],
        knownDurationSeconds
      );

      const plainTranscript = clean(
        transcriptResult?.text ||
          transcriptResult?.transcriptText ||
          transcriptResult?.transcript ||
          ""
      );

      const text = segments.length > 0 ? segmentsToText(segments) : plainTranscript;
      const durationSeconds =
        knownDurationSeconds ||
        transcriptResult?.durationSeconds ||
        inferDurationFromSegments(segments);

      if (text) {
        return {
          platform: "youtube",
          title: clean(transcriptResult?.title || job.title),
          durationSeconds,
          source: transcriptResult?.source || "youtube_transcript",
          text,
          segments,
        };
      }
    } catch (err) {
      console.warn("[GoodContentReach] YouTube transcript fetch failed:", err?.message || err);
    }

    if (job.requestPageText) {
      return {
        platform: "youtube",
        title: job.title,
        durationSeconds: knownDurationSeconds,
        source: "provided_youtube_page_text_fallback",
        text: clean(job.requestPageText),
        segments: [],
      };
    }
  }

  if (job.requestPageText) {
    return {
      platform,
      title: job.title,
      durationSeconds: knownDurationSeconds,
      source: "provided_page_text",
      text: clean(job.requestPageText),
      segments: [],
    };
  }

  const page = await fetchWebpageText(job.url);

  return {
    platform: "webpage",
    title: clean(page.title || job.title),
    durationSeconds: 0,
    source: "webpage_fetch",
    text: page.text,
    segments: [],
  };
}

function chunkBySegments(segments, chunkSeconds = DEFAULT_CHUNK_SECONDS, durationSeconds = 0) {
  if (!segments.length) return [];

  const chunks = [];
  let current = null;

  for (const seg of segments) {
    const safeStart =
      durationSeconds > 0
        ? Math.min(Number(seg.startSeconds || 0), durationSeconds)
        : Number(seg.startSeconds || 0);

    const safeEnd =
      durationSeconds > 0
        ? Math.min(Number(seg.endSeconds || safeStart + 1), durationSeconds)
        : Number(seg.endSeconds || safeStart + 1);

    const bucket = Math.floor(safeStart / chunkSeconds);
    const startSeconds = bucket * chunkSeconds;

    if (!current || current.startSeconds !== startSeconds) {
      if (current) chunks.push(current);

      current = {
        chunkIndex: chunks.length,
        startSeconds,
        endSeconds:
          durationSeconds > 0
            ? Math.min(startSeconds + chunkSeconds, durationSeconds)
            : startSeconds + chunkSeconds,
        textParts: [],
      };
    }

    current.textParts.push(`[${formatTime(safeStart)}] ${seg.text}`);
    current.endSeconds = Math.max(current.endSeconds, safeEnd);

    if (durationSeconds > 0) {
      current.endSeconds = Math.min(current.endSeconds, durationSeconds);
    }
  }

  if (current) chunks.push(current);

  return chunks.map((chunk, index) => ({
    chunkIndex: index,
    startSeconds: chunk.startSeconds,
    endSeconds: Math.max(chunk.startSeconds + 1, chunk.endSeconds),
    text: clean(chunk.textParts.join("\n")).slice(0, MAX_CHUNK_CHARS),
  }));
}

function chunkPlainText(text, chunkSeconds = DEFAULT_CHUNK_SECONDS, durationSeconds = 0) {
  const cleaned = clean(text);
  if (!cleaned) return [];

  const approxChars = Math.min(MAX_CHUNK_CHARS, 6500);
  const chunks = [];

  for (let i = 0; i < cleaned.length; i += approxChars) {
    const part = cleaned.slice(i, i + approxChars);
    const chunkIndex = chunks.length;

    let startSeconds = chunkIndex * chunkSeconds;
    let endSeconds = (chunkIndex + 1) * chunkSeconds;

    if (durationSeconds > 0) {
      startSeconds = Math.min(startSeconds, durationSeconds);
      endSeconds = Math.min(endSeconds, durationSeconds);
      if (endSeconds <= startSeconds) endSeconds = Math.min(durationSeconds, startSeconds + 1);
    }

    chunks.push({
      chunkIndex,
      startSeconds,
      endSeconds,
      text: part,
    });
  }

  return chunks;
}

function makeChunks(content, chunkSeconds = DEFAULT_CHUNK_SECONDS) {
  if (content.segments?.length) {
    return chunkBySegments(content.segments, chunkSeconds, content.durationSeconds || 0);
  }

  return chunkPlainText(content.text, chunkSeconds, content.durationSeconds || 0);
}

async function createChunkDocs(job, chunks) {
  await GoodContentChunk.deleteMany({ jobId: job._id });

  if (!chunks.length) return [];

  const docs = chunks.map((chunk) => ({
    jobId: job._id,
    userId: job.userId,
    deviceId: job.deviceId,
    chunkIndex: chunk.chunkIndex,
    startSeconds: chunk.startSeconds,
    endSeconds: chunk.endSeconds,
    text: chunk.text,
    textChars: chunk.text.length,
    status: "pending",
  }));

  await GoodContentChunk.insertMany(docs, { ordered: true });

  return GoodContentChunk.find({ jobId: job._id }).sort({ chunkIndex: 1 });
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value || "");
  }
}

async function callGemmaJson(prompt, options = {}) {
  return callOllamaJson({
    prompt,
    timeoutMs: options.timeoutMs || GEMMA_TIMEOUT_MS,
    temperature: options.temperature ?? 0.15,
    num_predict: options.num_predict || 4096,
    num_ctx: options.num_ctx || 8192,
    attempts: options.attempts || 1,
  });
}

async function callGemmaText(prompt, options = {}) {
  const result = await callOllamaText({
    prompt,
    timeoutMs: options.timeoutMs || GEMMA_TIMEOUT_MS,
    temperature: options.temperature ?? 0.35,
    num_predict: options.num_predict || 4096,
    num_ctx: options.num_ctx || 8192,
    attempts: options.attempts || 1,
  });

  return clean(result?.text || result?.response || result || "");
}

async function analyzeChunkWithGemma(job, chunk) {
  await GoodContentChunk.findByIdAndUpdate(chunk._id, {
    status: "processing",
    error: "",
  });

  const prompt = `
You are Good Content Reach AI.

Analyze ONE section of a video/webpage for a student.

Student:
- Goal: ${job.userGoal}
- Level: ${job.userLevel}
- Need: ${job.contentNeed}
- Extra requirement: ${job.extraRequirement || "none"}
- Available time: ${job.timeAvailableMinutes || "not specified"} minutes

Content:
- Title: ${job.title}
- URL: ${job.url}
- Real duration: ${formatTime(job.durationSeconds || 0)}
- This section: ${formatTime(chunk.startSeconds)} - ${formatTime(chunk.endSeconds)}

Section transcript/text:
${chunk.text}

Strict rules:
- Do not invent timestamps.
- Judge the section for the given student level.
- Clearly say if it is beginner friendly or not.
- Mention prerequisites needed for this section.
- Mention similar problems/topics if the section is about coding/DSA.
- If the content teaches a useful problem pattern, explain that.

Return JSON only:
{
  "topic": "short section topic",
  "difficulty": "beginner | intermediate | advanced | mixed | unknown",
  "goalMatch": 0,
  "usefulness": "low | medium | high | unknown",
  "shouldWatch": true,
  "summary": "2-4 sentence section summary",
  "reason": "why this section matters or should be skipped",
  "levelFit": "Beginner friendly / Needs prerequisites / Too advanced / Mixed / Unknown",
  "beginnerFriendly": true,
  "prerequisites": ["prerequisite 1"],
  "missingBasics": ["basic concept user should learn first"],
  "similarProblems": ["similar problem or topic"],
  "practiceIdeas": ["practice task"],
  "keywords": ["keyword1", "keyword2"]
}
`;

  try {
    const ai = await callGemmaJson(prompt, {
      timeoutMs: GEMMA_TIMEOUT_MS,
      temperature: 0.12,
      num_predict: 2048,
    });

    const goalMatch = clampNumber(ai?.goalMatch, 0, 100, 0);

    const difficulty = ["beginner", "intermediate", "advanced", "mixed", "unknown"].includes(
      ai?.difficulty
    )
      ? ai.difficulty
      : "unknown";

    const usefulness = ["low", "medium", "high", "unknown"].includes(ai?.usefulness)
      ? ai.usefulness
      : goalMatch >= 75
      ? "high"
      : goalMatch >= 45
      ? "medium"
      : "low";

    const shouldWatch =
      typeof ai?.shouldWatch === "boolean" ? ai.shouldWatch : goalMatch >= 55;

    const reasonParts = [
      clean(ai?.reason || ""),
      ai?.levelFit ? `Level fit: ${clean(ai.levelFit)}` : "",
      safeArray(ai?.prerequisites).length
        ? `Prerequisites: ${safeArray(ai.prerequisites).map(clean).filter(Boolean).join(", ")}`
        : "",
      safeArray(ai?.missingBasics).length
        ? `Missing basics: ${safeArray(ai.missingBasics).map(clean).filter(Boolean).join(", ")}`
        : "",
    ].filter(Boolean);

    return GoodContentChunk.findByIdAndUpdate(
      chunk._id,
      {
        status: "done",
        topic: clean(ai?.topic || "Untitled section"),
        difficulty,
        goalMatch,
        usefulness,
        shouldWatch,
        summary: clean(ai?.summary || ""),
        reason: clean(reasonParts.join(" ")),
        keywords: safeArray(ai?.keywords).map(clean).filter(Boolean).slice(0, 12),
        aiRaw: ai,
        error: "",
      },
      { new: true }
    );
  } catch (err) {
    console.warn(`[GoodContentReach] chunk ${chunk.chunkIndex} failed:`, err?.message || err);

    return GoodContentChunk.findByIdAndUpdate(
      chunk._id,
      {
        status: "failed",
        error: err?.message || "Chunk analysis failed",
      },
      { new: true }
    );
  }
}

async function refreshProgress(jobId, message = "") {
  const totalChunks = await GoodContentChunk.countDocuments({ jobId });
  const processedChunks = await GoodContentChunk.countDocuments({
    jobId,
    status: { $in: ["done", "failed"] },
  });
  const failedChunks = await GoodContentChunk.countDocuments({ jobId, status: "failed" });

  const progress = totalChunks > 0 ? 10 + Math.round((processedChunks / totalChunks) * 78) : 10;

  return updateJob(jobId, {
    totalChunks,
    processedChunks,
    failedChunks,
    progress: Math.min(88, progress),
    ...(message ? { message } : {}),
  });
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = [];
  let index = 0;

  async function runOne() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;

      try {
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      } catch (err) {
        results[currentIndex] = { error: err?.message || "Worker failed" };
      }
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    () => runOne()
  );

  await Promise.all(workers);
  return results;
}

function compactSection(chunk) {
  const raw = chunk.aiRaw || {};

  return {
    chunkId: String(chunk._id),
    index: chunk.chunkIndex,
    startSeconds: chunk.startSeconds,
    endSeconds: chunk.endSeconds,
    start: formatTime(chunk.startSeconds),
    end: formatTime(chunk.endSeconds),
    topic: chunk.topic,
    difficulty: chunk.difficulty,
    goalMatch: chunk.goalMatch,
    usefulness: chunk.usefulness,
    shouldWatch: chunk.shouldWatch,
    summary: chunk.summary,
    reason: chunk.reason,
    levelFit: raw.levelFit || "",
    beginnerFriendly: raw.beginnerFriendly,
    prerequisites: safeArray(raw.prerequisites),
    missingBasics: safeArray(raw.missingBasics),
    similarProblems: safeArray(raw.similarProblems),
    practiceIdeas: safeArray(raw.practiceIdeas),
    keywords: chunk.keywords,
  };
}

function sanitizeRoadmapSection(section, sourceChunks, durationSeconds, type = "best") {
  const startSeconds = normalizeTimeValue(section?.startSeconds ?? section?.start ?? 0);
  let matched =
    sourceChunks.find((chunk) => {
      const s = Number(chunk.startSeconds || 0);
      const e = Number(chunk.endSeconds || 0);
      return startSeconds >= s && startSeconds < e;
    }) || null;

  if (!matched && section?.topic) {
    const topic = clean(section.topic).toLowerCase();
    matched =
      sourceChunks.find((chunk) => {
        const chunkTopic = clean(chunk.topic).toLowerCase();
        return chunkTopic.includes(topic) || topic.includes(chunkTopic);
      }) || null;
  }

  if (!matched) matched = sourceChunks[0];

  if (!matched) {
    const safeStart = durationSeconds > 0 ? Math.min(startSeconds, durationSeconds) : startSeconds;
    const safeEnd =
      durationSeconds > 0
        ? Math.min(Math.max(safeStart + 1, startSeconds + DEFAULT_CHUNK_SECONDS), durationSeconds)
        : Math.max(safeStart + 1, startSeconds + DEFAULT_CHUNK_SECONDS);

    return {
      startSeconds: safeStart,
      endSeconds: safeEnd,
      start: formatTime(safeStart),
      end: formatTime(safeEnd),
      topic: clean(section?.topic || "Section"),
      [type === "skip" ? "whySkip" : "whyWatch"]: clean(
        section?.whySkip || section?.whyWatch || section?.reason || ""
      ),
    };
  }

  return {
    startSeconds: matched.startSeconds,
    endSeconds: matched.endSeconds,
    start: formatTime(matched.startSeconds),
    end: formatTime(matched.endSeconds),
    topic: clean(section?.topic || matched.topic || "Section"),
    [type === "skip" ? "whySkip" : "whyWatch"]: clean(
      section?.whySkip ||
        section?.whyWatch ||
        section?.reason ||
        matched.reason ||
        matched.summary ||
        ""
    ),
  };
}

function uniqueClean(items = [], limit = 10) {
  return Array.from(new Set(safeArray(items).map(clean).filter(Boolean))).slice(0, limit);
}

function collectFromChunks(chunks = [], field = "", limit = 10) {
  const values = [];
  for (const chunk of chunks) {
    const raw = chunk.aiRaw || {};
    values.push(...safeArray(raw[field]));
  }
  return uniqueClean(values, limit);
}

function sanitizeRoadmap(roadmap, job, chronologicalBest, skipChunks, allChunks, avgTop) {
  const durationSeconds = Number(job.durationSeconds || 0);

  const fitScore = clampNumber(roadmap?.fitScore, 0, 100, avgTop);

  const recommendation = ["watch", "partial_watch", "skip"].includes(roadmap?.recommendation)
    ? roadmap.recommendation
    : fitScore >= 75
    ? "watch"
    : fitScore >= 45
    ? "partial_watch"
    : "skip";

  const bestSource = chronologicalBest.length ? chronologicalBest : allChunks;
  const skipSource = skipChunks.length ? skipChunks : allChunks;

  const collectedPrereq = collectFromChunks(allChunks, "prerequisites", 12);
  const collectedMissing = collectFromChunks(allChunks, "missingBasics", 12);
  const collectedSimilar = collectFromChunks(allChunks, "similarProblems", 12);
  const collectedPractice = collectFromChunks(allChunks, "practiceIdeas", 8);

  return {
    fitScore,
    recommendation,
    shortVerdict:
      clean(roadmap?.shortVerdict) ||
      (fitScore >= 75
        ? "This content fits your goal well."
        : fitScore >= 45
        ? "This content is partially useful. Watch selected sections."
        : "This content is weakly matched with your goal."),
    levelFit:
      clean(roadmap?.levelFit) ||
      (job.userLevel === "beginner"
        ? "Beginner friendly only if the student knows the listed prerequisites."
        : "Mixed level fit."),
    fitReason:
      clean(roadmap?.fitReason) ||
      "The score is based on topic match, level match, usefulness, prerequisites, and section quality.",
    prerequisites: uniqueClean(
      safeArray(roadmap?.prerequisites).length ? roadmap.prerequisites : collectedPrereq,
      12
    ),
    missingPrerequisites: uniqueClean(
      safeArray(roadmap?.missingPrerequisites).length
        ? roadmap.missingPrerequisites
        : collectedMissing,
      12
    ),
    whyContentFits: uniqueClean(roadmap?.whyContentFits || roadmap?.why || [], 8),
    whyItMayBeHard: uniqueClean(roadmap?.whyItMayBeHard || [], 8),
    similarProblems: uniqueClean(
      safeArray(roadmap?.similarProblems).length ? roadmap.similarProblems : collectedSimilar,
      12
    ),
    bestSections: safeArray(roadmap?.bestSections)
      .slice(0, 8)
      .map((section) => sanitizeRoadmapSection(section, bestSource, durationSeconds, "best"))
      .filter((section) => section.topic),
    skipSections: safeArray(roadmap?.skipSections)
      .slice(0, 8)
      .map((section) => sanitizeRoadmapSection(section, skipSource, durationSeconds, "skip"))
      .filter((section) => section.topic),
    studyPlan: uniqueClean(roadmap?.studyPlan || [], 8),
    practicePlan: uniqueClean(
      safeArray(roadmap?.practicePlan).length ? roadmap.practicePlan : collectedPractice,
      8
    ),
    practiceTasks: uniqueClean(
      safeArray(roadmap?.practiceTasks).length ? roadmap.practiceTasks : collectedPractice,
      8
    ),
    quickNotes: uniqueClean(roadmap?.quickNotes || [], 10),
    quiz: safeArray(roadmap?.quiz).slice(0, 5),
    generatedAt: new Date().toISOString(),
    fallbackUsed: false,
  };
}

async function buildFinalRoadmap(job) {
  const chunks = await GoodContentChunk.find({ jobId: job._id, status: "done" }).sort({
    goalMatch: -1,
    chunkIndex: 1,
  });

  if (!chunks.length) {
    return {
      fitScore: 0,
      recommendation: "skip",
      shortVerdict: "Gemma could not analyze enough sections from this content.",
      levelFit: "Unknown",
      fitReason: "No successful chunk analysis was created.",
      prerequisites: [],
      missingPrerequisites: [],
      whyContentFits: [],
      whyItMayBeHard: [],
      similarProblems: [],
      bestSections: [],
      skipSections: [],
      studyPlan: [],
      practicePlan: [],
      practiceTasks: [],
      quickNotes: [],
      quiz: [],
      fallbackUsed: true,
      generatedAt: new Date().toISOString(),
    };
  }

  const bestChunks = chunks
    .filter((chunk) => chunk.shouldWatch || Number(chunk.goalMatch) >= 55)
    .slice(0, FINAL_SECTIONS_LIMIT);

  const skipChunks = chunks
    .filter((chunk) => !chunk.shouldWatch || Number(chunk.goalMatch) < 45)
    .slice(0, 12);

  const chronologicalBest = [...bestChunks].sort((a, b) => a.startSeconds - b.startSeconds);

  const avgTop =
    chronologicalBest.length > 0
      ? Math.round(
          chronologicalBest.reduce((sum, chunk) => sum + Number(chunk.goalMatch || 0), 0) /
            chronologicalBest.length
        )
      : 0;

  const prompt = `
You are Good Content Reach AI.

Create the FINAL personalized roadmap.

Student:
- Goal: ${job.userGoal}
- Level: ${job.userLevel}
- Need: ${job.contentNeed}
- Extra requirement: ${job.extraRequirement || "none"}
- Available time: ${job.timeAvailableMinutes || "not specified"} minutes

Content:
- Title: ${job.title}
- URL: ${job.url}
- Platform: ${job.platform}
- Real duration: ${formatTime(job.durationSeconds || 0)}

Allowed analyzed sections only:
${safeJsonStringify(chunks.map(compactSection))}

Strict rules:
- Do NOT invent timestamps.
- Use only timestamps from allowed sections.
- Clearly explain whether it is beginner friendly, intermediate, advanced, or too fast.
- Clearly mention prerequisites.
- Clearly mention missing basics.
- Clearly mention why the content fits.
- Clearly mention why it may be hard.
- If coding/DSA/problem-solving content, give similar problems.
- Give a practical study/practice plan.
- If the video is about LeetCode 217 Contains Duplicate, similar problems may include Contains Duplicate II, Valid Anagram, Two Sum, Group Anagrams, Intersection of Two Arrays, but only include them if relevant.
- The fit score should not be random. Score based on topic match, level fit, prerequisite burden, clarity, timestamp usefulness, and available time.

Return JSON only:
{
  "fitScore": 0,
  "recommendation": "watch | partial_watch | skip",
  "shortVerdict": "short verdict",
  "levelFit": "Beginner friendly, but ... / Intermediate / Advanced / Not beginner friendly",
  "fitReason": "why this exact score",
  "prerequisites": ["prerequisite 1"],
  "missingPrerequisites": ["missing basic 1"],
  "whyContentFits": ["reason 1", "reason 2"],
  "whyItMayBeHard": ["hard reason 1", "hard reason 2"],
  "bestSections": [
    {
      "startSeconds": 0,
      "endSeconds": 60,
      "start": "00:00",
      "end": "01:00",
      "topic": "Problem statement",
      "whyWatch": "why useful"
    }
  ],
  "skipSections": [
    {
      "startSeconds": 0,
      "endSeconds": 60,
      "start": "00:00",
      "end": "01:00",
      "topic": "topic",
      "whySkip": "why skip"
    }
  ],
  "similarProblems": ["problem 1", "problem 2"],
  "studyPlan": ["step 1", "step 2"],
  "practicePlan": ["practice step 1", "practice step 2"],
  "practiceTasks": ["task 1", "task 2"],
  "quickNotes": ["note 1", "note 2"],
  "quiz": [
    {
      "question": "question",
      "answer": "answer"
    }
  ]
}
`;

  try {
    const roadmap = await callGemmaJson(prompt, {
      timeoutMs: GEMMA_TIMEOUT_MS,
      temperature: 0.12,
      num_predict: 4096,
    });

    return sanitizeRoadmap(roadmap, job, chronologicalBest, skipChunks, chunks, avgTop);
  } catch (err) {
    const similar = collectFromChunks(chunks, "similarProblems", 12);
    const prereq = collectFromChunks(chunks, "prerequisites", 12);
    const missing = collectFromChunks(chunks, "missingBasics", 12);
    const practice = collectFromChunks(chunks, "practiceIdeas", 8);

    return {
      fitScore: avgTop,
      recommendation: avgTop >= 75 ? "watch" : avgTop >= 45 ? "partial_watch" : "skip",
      shortVerdict:
        avgTop >= 75
          ? "This content is useful for your goal."
          : avgTop >= 45
          ? "This content is partially useful. Watch selected sections."
          : "This content is weakly matched with your goal.",
      levelFit:
        job.userLevel === "beginner"
          ? "Beginner friendly only if you understand the listed prerequisites."
          : "Mixed level fit.",
      fitReason:
        "Fallback roadmap was created from chunk-level analysis because final Gemma merge timed out.",
      prerequisites: prereq,
      missingPrerequisites: missing,
      whyContentFits: [
        "Some sections directly match the requested topic.",
        "The selected timestamps contain the most useful explanations from the content.",
      ],
      whyItMayBeHard: missing.length
        ? missing.map((x) => `You may struggle if you do not know: ${x}`)
        : ["Some explanations may be fast or assume prior basics."],
      similarProblems: similar,
      bestSections: chronologicalBest.map((chunk) => ({
        startSeconds: chunk.startSeconds,
        endSeconds: chunk.endSeconds,
        start: formatTime(chunk.startSeconds),
        end: formatTime(chunk.endSeconds),
        topic: chunk.topic,
        whyWatch: chunk.reason || chunk.summary,
      })),
      skipSections: skipChunks.map((chunk) => ({
        startSeconds: chunk.startSeconds,
        endSeconds: chunk.endSeconds,
        start: formatTime(chunk.startSeconds),
        end: formatTime(chunk.endSeconds),
        topic: chunk.topic,
        whySkip: chunk.reason || "Low match with your current goal.",
      })),
      studyPlan: [
        "Watch the highest-matching sections first.",
        "Pause after each selected section and write 3 bullet notes.",
        "Use the Ask box for confusing parts.",
      ],
      practicePlan: practice.length
        ? practice
        : [
            "Try to solve the problem once without watching again.",
            "Write the brute-force solution first.",
            "Then write the optimized solution.",
            "Compare time and space complexity.",
          ],
      practiceTasks: practice,
      quickNotes: chronologicalBest.slice(0, 5).map((chunk) => chunk.summary).filter(Boolean),
      quiz: [],
      generatedAt: new Date().toISOString(),
      fallbackUsed: true,
      error: err?.message || "Final roadmap failed",
    };
  }
}

async function processJob(jobId) {
  if (runningJobs.has(String(jobId))) return;
  runningJobs.add(String(jobId));

  try {
    let job = await updateJob(jobId, {
      status: "fetching",
      phase: "fetching_content",
      message: "Fetching transcript or page content...",
      startedAt: new Date(),
      progress: 3,
      error: "",
    });

    const content = await resolveContent(job);

    if (!content.text || content.text.length < 80) {
      throw new Error(
        "Not enough transcript/page text found. For private/dynamic pages, use Chrome extension so it can send pageText."
      );
    }

    job = await updateJob(jobId, {
      status: "chunking",
      phase: "creating_sections",
      message: "Creating study sections...",
      platform: content.platform || job.platform,
      title: content.title || job.title,
      durationSeconds: content.durationSeconds || job.durationSeconds || 0,
      transcriptSource: content.source,
      transcriptChars: content.text.length,
      progress: 8,
    });

    const chunks = makeChunks(content, job.chunkSeconds || DEFAULT_CHUNK_SECONDS);

    if (!chunks.length) throw new Error("Could not create chunks from this content.");

    const strategy = pickStrategy(job.durationSeconds, chunks.length);
    const chunkDocs = await createChunkDocs(job, chunks);

    job = await updateJob(jobId, {
      status: "processing",
      phase: "analyzing_sections",
      message: `Analyzing ${chunkDocs.length} sections with Gemma...`,
      totalChunks: chunkDocs.length,
      processedChunks: 0,
      failedChunks: 0,
      progress: 10,
      strategy,
      concurrency: DEFAULT_CONCURRENCY,
    });

    await runWithConcurrency(chunkDocs, DEFAULT_CONCURRENCY, async (chunk) => {
      const result = await analyzeChunkWithGemma(job, chunk);
      await refreshProgress(
        job._id,
        `Analyzing sections... ${formatTime(chunk.startSeconds)} - ${formatTime(chunk.endSeconds)}`
      );
      return result;
    });

    job = await updateJob(jobId, {
      status: "merging",
      phase: "building_roadmap",
      message: "Building personalized roadmap...",
      progress: 90,
    });

    const roadmap = await buildFinalRoadmap(job);

    job = await updateJob(jobId, {
      status: "ready",
      phase: "ready",
      message: "Good Content Reach roadmap is ready.",
      progress: 100,
      finalRoadmap: roadmap,
      fitScore: roadmap.fitScore,
      recommendation: roadmap.recommendation,
      completedAt: new Date(),
    });

    emitProgress(job, { type: "good-content:ready" });
  } catch (err) {
    const job = await updateJob(jobId, {
      status: "failed",
      phase: "failed",
      message: "Good Content Reach analysis failed.",
      error: err?.message || "Unknown error",
      completedAt: new Date(),
    });

    if (job) emitProgress(job, { type: "good-content:failed" });
  } finally {
    runningJobs.delete(String(jobId));
  }
}

export async function createGoodContentAnalysis(payload = {}) {
  const url = clean(payload.url);
  const userGoal = clean(payload.userGoal || payload.goal);

  if (!url && !payload.pageText && !payload.transcript) {
    throw new Error("URL, pageText, or transcript is required.");
  }

  if (!userGoal) throw new Error("userGoal is required.");

  const userLevel = ["beginner", "intermediate", "advanced"].includes(payload.userLevel)
    ? payload.userLevel
    : "beginner";

  const platform = detectPlatform(url);

  const job = await GoodContentJob.create({
    userId: clean(payload.userId || "guest"),
    deviceId: clean(payload.deviceId || "web"),
    url: url || "manual-text",
    title: clean(payload.title || "Untitled content"),
    platform,
    userGoal,
    userLevel,
    contentNeed: clean(payload.contentNeed || "full explanation"),
    extraRequirement: clean(payload.extraRequirement || ""),
    timeAvailableMinutes: clampNumber(payload.timeAvailableMinutes, 0, 100000, 0),
    durationSeconds: clampNumber(payload.durationSeconds, 0, 10000000, 0),
    chunkSeconds: DEFAULT_CHUNK_SECONDS,
    concurrency: DEFAULT_CONCURRENCY,
    requestPageText: clean(payload.pageText || ""),
    requestTranscript: clean(payload.transcript || ""),
    requestSegments: safeArray(payload.segments),
    status: "queued",
    phase: "queued",
    message: "Queued for Good Content Reach analysis.",
    progress: 0,
  });

  setImmediate(() => {
    processJob(job._id).catch((err) => {
      console.error("[GoodContentReach] processJob failed:", err);
    });
  });

  return getApiSafeJob(job);
}

export async function getGoodContentJob(jobId) {
  if (!mongoose.Types.ObjectId.isValid(String(jobId))) throw new Error("Invalid jobId");

  const job = await GoodContentJob.findById(jobId);
  if (!job) throw new Error("Good Content job not found.");

  const chunks = await GoodContentChunk.find({ jobId: job._id })
    .sort({ chunkIndex: 1 })
    .select(
      "chunkIndex startSeconds endSeconds status topic difficulty goalMatch usefulness shouldWatch summary reason keywords error aiRaw"
    );

  const conversations = await GoodContentConversation.find({ jobId: job._id })
    .sort({ createdAt: -1 })
    .limit(20);

  return {
    job: getApiSafeJob(job),
    chunks: chunks.map((chunk) => ({
      id: String(chunk._id),
      chunkIndex: chunk.chunkIndex,
      startSeconds: chunk.startSeconds,
      endSeconds: chunk.endSeconds,
      start: formatTime(chunk.startSeconds),
      end: formatTime(chunk.endSeconds),
      status: chunk.status,
      topic: chunk.topic,
      difficulty: chunk.difficulty,
      goalMatch: chunk.goalMatch,
      usefulness: chunk.usefulness,
      shouldWatch: chunk.shouldWatch,
      summary: chunk.summary,
      reason: chunk.reason,
      keywords: chunk.keywords,
      error: chunk.error,
      levelFit: chunk.aiRaw?.levelFit || "",
      prerequisites: safeArray(chunk.aiRaw?.prerequisites),
      missingBasics: safeArray(chunk.aiRaw?.missingBasics),
      similarProblems: safeArray(chunk.aiRaw?.similarProblems),
      practiceIdeas: safeArray(chunk.aiRaw?.practiceIdeas),
    })),
    conversations: conversations.map((item) => ({
      id: String(item._id),
      question: item.question,
      answer: item.answer,
      selectedStartSeconds: item.selectedStartSeconds,
      selectedEndSeconds: item.selectedEndSeconds,
      createdAt: item.createdAt,
      error: item.error,
    })),
  };
}

export async function listGoodContentJobs(query = {}) {
  const userId = clean(query.userId || "");
  const deviceId = clean(query.deviceId || "");

  const filter = {};
  if (userId) filter.userId = userId;
  if (deviceId) filter.deviceId = deviceId;

  const jobs = await GoodContentJob.find(filter).sort({ createdAt: -1 }).limit(30);
  return jobs.map(getApiSafeJob);
}

export async function askGoodContentQuestion(jobId, payload = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(jobId))) throw new Error("Invalid jobId");

  const job = await GoodContentJob.findById(jobId);
  if (!job) throw new Error("Good Content job not found.");

  const question = clean(payload.question);
  if (!question) throw new Error("question is required.");

  const selectedStartSeconds =
    payload.selectedStartSeconds === undefined || payload.selectedStartSeconds === null
      ? null
      : Number(payload.selectedStartSeconds);

  const selectedEndSeconds =
    payload.selectedEndSeconds === undefined || payload.selectedEndSeconds === null
      ? null
      : Number(payload.selectedEndSeconds);

  let chunkFilter = { jobId: job._id, status: "done" };

  if (Number.isFinite(selectedStartSeconds) && Number.isFinite(selectedEndSeconds)) {
    chunkFilter = {
      ...chunkFilter,
      startSeconds: { $lte: selectedEndSeconds },
      endSeconds: { $gte: selectedStartSeconds },
    };
  }

  let chunks = await GoodContentChunk.find(chunkFilter).sort({ startSeconds: 1 }).limit(8);

  if (!chunks.length) {
    chunks = await GoodContentChunk.find({ jobId: job._id, status: "done" })
      .sort({ goalMatch: -1 })
      .limit(8);
  }

  const context = chunks
    .map(
      (chunk) => `
[${formatTime(chunk.startSeconds)} - ${formatTime(chunk.endSeconds)}]
Topic: ${chunk.topic}
Difficulty: ${chunk.difficulty}
Goal match: ${chunk.goalMatch}%
Summary: ${chunk.summary}
Reason: ${chunk.reason}
Level fit: ${chunk.aiRaw?.levelFit || ""}
Prerequisites: ${safeArray(chunk.aiRaw?.prerequisites).join(", ")}
Similar problems: ${safeArray(chunk.aiRaw?.similarProblems).join(", ")}
Transcript:
${chunk.text.slice(0, 2500)}
`
    )
    .join("\n---\n");

  const prompt = `
You are Good Content Reach tutor.

Student goal: ${job.userGoal}
Student level: ${job.userLevel}
Student need: ${job.contentNeed}
Extra requirement: ${job.extraRequirement || "none"}

Content title: ${job.title}
Question: ${question}

Relevant sections:
${context}

Answer in the user's preferred language if clear.
Be timestamp-aware, level-aware, prerequisite-aware, and practical.
Mention similar problems/topics when helpful.
`;

  let answer = "";

  try {
    answer = await callGemmaText(prompt, {
      timeoutMs: GEMMA_TIMEOUT_MS,
      temperature: 0.35,
      num_predict: 4096,
    });
  } catch (err) {
    answer = `I could not generate a deep answer right now. Error: ${
      err?.message || "unknown"
    }`;
  }

  const conversation = await GoodContentConversation.create({
    jobId: job._id,
    userId: job.userId,
    deviceId: job.deviceId,
    question,
    answer,
    selectedStartSeconds,
    selectedEndSeconds,
    relatedChunkIds: chunks.map((chunk) => chunk._id),
  });

  return {
    id: String(conversation._id),
    question,
    answer,
    selectedStartSeconds,
    selectedEndSeconds,
    createdAt: conversation.createdAt,
  };
}

export function getGoodContentHealth() {
  return {
    ok: true,
    feature: "good-content-reach",
    status: "ready",
    config: {
      chunkSeconds: DEFAULT_CHUNK_SECONDS,
      directMaxSeconds: DIRECT_MAX_SECONDS,
      parallelMaxSeconds: PARALLEL_MAX_SECONDS,
      concurrency: DEFAULT_CONCURRENCY,
      finalSectionsLimit: FINAL_SECTIONS_LIMIT,
    },
  };
}
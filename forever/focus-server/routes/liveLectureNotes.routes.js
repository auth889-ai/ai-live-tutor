import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { spawn } from "child_process";

import LiveLectureNote from "../models/LiveLectureNote.js";
import { callOllamaText } from "../services/ollamaCompat.service.js";

const router = express.Router();

const FEATURE = "separate-live-lecture-notes";

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function keepText(value = "") {
  return String(value ?? "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeArray(value, max = 60) {
  if (!Array.isArray(value)) return [];

  return [...new Set(value.map((item) => clean(item)).filter(Boolean))].slice(
    0,
    max
  );
}

function safeSections(value, max = 30) {
  if (!Array.isArray(value)) return [];

  return value
    .map((section) => {
      if (typeof section === "string") {
        return {
          heading: "",
          bullets: [clean(section)].filter(Boolean),
        };
      }

      return {
        heading: clean(section?.heading),
        bullets: safeArray(section?.bullets, 25),
      };
    })
    .filter((section) => section.heading || section.bullets.length)
    .slice(0, max);
}

function normalizeLanguage(value = "en") {
  const lang = clean(value).toLowerCase();

  if (["bn", "bangla", "bengali"].includes(lang)) return "bn";
  if (["hi", "hindi"].includes(lang)) return "hi";
  if (["auto", "detect"].includes(lang)) return "auto";
  if (["mixed", "bn-en", "bangla-english", "mixed-bn-en"].includes(lang)) {
    return "mixed-bn-en";
  }

  return "en";
}

function languageInstruction(language = "en") {
  const lang = normalizeLanguage(language);

  if (lang === "bn") {
    return "Output language: Bangla. Keep necessary technical terms in English.";
  }

  if (lang === "mixed-bn-en") {
    return "Output language: natural Bangla-English mixed. Keep important technical terms in English.";
  }

  if (lang === "hi") {
    return "Output language: Hindi. Keep necessary technical terms in English.";
  }

  if (lang === "auto") {
    return "Output language: same language as the lecture transcript.";
  }

  return "Output language: English.";
}

function header(req, name) {
  const lower = String(name || "").toLowerCase();
  return clean(req.headers?.[name] || req.headers?.[lower] || "");
}

function normalizeOfflineUserId(value = "") {
  const raw = clean(value);
  if (!raw) return "";
  return raw.startsWith("offline:") ? raw.slice("offline:".length) : raw;
}

function unsafeDeviceId(value = "") {
  const id = clean(value).toLowerCase();

  return (
    !id ||
    id.length < 8 ||
    [
      "web",
      "guest",
      "anonymous",
      "default",
      "local",
      "local-device",
      "device",
      "browser",
      "unknown",
    ].includes(id)
  );
}

function resolveOwner(req) {
  const offlineUserId = normalizeOfflineUserId(
    req.body?.offlineUserId ||
      req.query?.offlineUserId ||
      header(req, "x-offline-user-id") ||
      header(req, "x-gemma-offline-user-id") ||
      ""
  );

  const explicitOwnerKey = clean(
    req.body?.ownerKey ||
      req.query?.ownerKey ||
      header(req, "x-owner-key") ||
      ""
  );

  const rawUserId = clean(
    req.body?.userId ||
      req.query?.userId ||
      header(req, "x-user-id") ||
      req.user?._id ||
      req.user?.id ||
      ""
  );

  const rawDeviceId = clean(
    req.body?.deviceId || req.query?.deviceId || header(req, "x-device-id") || ""
  );

  const deviceId = unsafeDeviceId(rawDeviceId) ? "" : rawDeviceId;

  if (offlineUserId) {
    return {
      ownerType: "offline",
      ownerKey: explicitOwnerKey || `offline:${offlineUserId}`,
      offlineUserId,
      userId: `offline:${offlineUserId}`,
      deviceId,
    };
  }

  if (rawUserId) {
    return {
      ownerType: "user",
      ownerKey: explicitOwnerKey || `user:${rawUserId}`,
      offlineUserId: "",
      userId: rawUserId,
      deviceId,
    };
  }

  if (deviceId) {
    return {
      ownerType: "device",
      ownerKey: explicitOwnerKey || `device:${deviceId}`,
      offlineUserId: "",
      userId: "",
      deviceId,
    };
  }

  const error = new Error(
    "Privacy protection: send x-offline-user-id + x-owner-key, a logged-in user, or a unique x-device-id."
  );
  error.statusCode = 401;
  throw error;
}

function ownerQuery(owner) {
  return { ownerKey: owner.ownerKey };
}

function sendOk(res, data, status = 200) {
  return res.status(status).json({ ok: true, data });
}

function sendError(res, error, fallbackStatus = 400) {
  const status = error?.statusCode || error?.status || fallbackStatus;

  console.error("[live-lecture-notes]", error?.message || error);

  return res.status(status).json({
    ok: false,
    feature: FEATURE,
    message: error?.message || "Live Lecture Notes request failed.",
    error:
      process.env.NODE_ENV === "production"
        ? undefined
        : {
            name: error?.name || "Error",
            stack: error?.stack || "",
          },
  });
}

function extractJsonCandidate(text = "") {
  const raw = String(text || "").trim();

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start >= 0 && end > start) return raw.slice(start, end + 1);

  return raw;
}

function parseJsonStrict(text = "") {
  const candidate = extractJsonCandidate(text);

  try {
    return JSON.parse(candidate);
  } catch (firstError) {
    const repaired = candidate
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");

    try {
      return JSON.parse(repaired);
    } catch {
      const error = new Error(
        `Gemma returned invalid JSON: ${firstError.message}`
      );
      error.raw = text;
      throw error;
    }
  }
}

function normalizeNote(parsed = {}, topic = "Live Lecture") {
  return {
    title: clean(parsed.title) || clean(topic) || "Live Lecture Notes",
    lectureTopic: clean(parsed.lectureTopic) || clean(topic),
    overview: clean(parsed.overview),
    learningObjectives: safeArray(parsed.learningObjectives, 30),
    keyConcepts: safeArray(parsed.keyConcepts, 50),
    definitions: safeSections(parsed.definitions),
    detailedNotes: safeSections(parsed.detailedNotes || parsed.details),
    stepByStepExplanation: safeSections(parsed.stepByStepExplanation),
    examples: safeSections(parsed.examples),
    formulas: safeArray(parsed.formulas, 40),
    summary: clean(parsed.summary),
    examFocus: safeArray(parsed.examFocus, 40),
    questionsToReview: safeArray(parsed.questionsToReview, 40),
    possibleExamQuestions: safeArray(parsed.possibleExamQuestions, 40),
    uncertainParts: safeArray(parsed.uncertainParts, 40),
  };
}

function buildGemmaPrompt({ topic, transcript, language }) {
  const maxChars = Number(process.env.LIVE_LECTURE_MAX_TRANSCRIPT_CHARS || 22000);
  const safeTranscript = keepText(transcript).slice(-maxChars);

  return `
You are the Live Lecture Notes AI inside a study app.

Task: Convert the lecture transcript into book-quality notes for students.

${languageInstruction(language)}

STRICT ACCURACY RULES:
- Use ONLY the transcript.
- Do not invent facts.
- Do not use external knowledge.
- If the transcript is unclear or missing detail, write that in uncertainParts.
- Return ONLY valid JSON.
- No markdown.
- No text outside JSON.
- Make the note useful for later study, revision, and exam preparation.

Lecture topic:
${clean(topic) || "Live Lecture"}

Transcript:
"""
${safeTranscript}
"""

Return this exact JSON shape:
{
  "title": "string",
  "lectureTopic": "string",
  "overview": "string",
  "learningObjectives": ["string"],
  "keyConcepts": ["string"],
  "definitions": [{ "heading": "string", "bullets": ["string"] }],
  "detailedNotes": [{ "heading": "string", "bullets": ["string"] }],
  "stepByStepExplanation": [{ "heading": "string", "bullets": ["string"] }],
  "examples": [{ "heading": "string", "bullets": ["string"] }],
  "formulas": ["string"],
  "summary": "string",
  "examFocus": ["string"],
  "questionsToReview": ["string"],
  "possibleExamQuestions": ["string"],
  "uncertainParts": ["string"]
}`;
}

async function generateNoteWithGemma({ topic, transcript, language }) {
  const started = Date.now();

  const response = await callOllamaText({
    prompt: buildGemmaPrompt({ topic, transcript, language }),
    json: true,
    format: "json",
    temperature: Number(process.env.LIVE_LECTURE_TEMPERATURE || 0.1),
    num_ctx: Number(
      process.env.LIVE_LECTURE_NUM_CTX || process.env.OLLAMA_NUM_CTX || 8192
    ),
    num_predict: Number(process.env.LIVE_LECTURE_NUM_PREDICT || 4500),
    timeoutMs: Number(
      process.env.LIVE_LECTURE_OLLAMA_TIMEOUT_MS ||
        process.env.OLLAMA_CLOUD_TIMEOUT_MS ||
        900000
    ),
    attempts: Number(process.env.LIVE_LECTURE_OLLAMA_RETRIES || 1),
    allowLocalFallback: process.env.LIVE_LECTURE_ALLOW_LOCAL_FALLBACK === "true",
  });

  const parsed = parseJsonStrict(response.text);

  return {
    note: normalizeNote(parsed, topic),
    ai: {
      provider: "ollama",
      model:
        response.model ||
        process.env.OLLAMA_CLOUD_MODEL ||
        process.env.OLLAMA_MODEL ||
        "",
      url: response.url || "",
      latencyMs: response.latencyMs || Date.now() - started,
      confidence: 0.86,
      generatedAt: new Date(),
      strictTranscriptOnly: true,
      fakeFallbackUsed: false,
    },
  };
}

async function transcribeAudio(filePath, language = "auto") {
  const pythonBin = process.env.PYTHON_BIN || "python3";
  const model = process.env.WHISPER_MODEL || "base";
  const device = process.env.WHISPER_DEVICE || "cpu";
  const computeType = process.env.WHISPER_COMPUTE_TYPE || "int8";

  const lang = normalizeLanguage(language);
  const whisperLang = ["auto", "mixed-bn-en"].includes(lang) ? "" : lang;

  const pythonCode = String.raw`
import argparse, json, sys

parser = argparse.ArgumentParser()
parser.add_argument("--audio", required=True)
parser.add_argument("--model", default="base")
parser.add_argument("--device", default="cpu")
parser.add_argument("--compute_type", default="int8")
parser.add_argument("--language", default="")
args = parser.parse_args()

try:
    from faster_whisper import WhisperModel
except Exception as e:
    print(json.dumps({"ok": False, "message": "faster-whisper is not installed: " + str(e)}))
    sys.exit(2)

try:
    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    kwargs = {}
    if args.language:
        kwargs["language"] = args.language

    segments, info = model.transcribe(args.audio, beam_size=5, vad_filter=True, **kwargs)

    out_segments = []
    transcript_parts = []

    for seg in segments:
        text = (seg.text or "").strip()
        if not text:
            continue

        transcript_parts.append(text)
        out_segments.append({
            "start": float(seg.start or 0),
            "end": float(seg.end or 0),
            "text": text
        })

    print(json.dumps({
        "ok": True,
        "transcript": " ".join(transcript_parts).strip(),
        "segments": out_segments,
        "language": getattr(info, "language", "") or "",
        "duration": float(getattr(info, "duration", 0) or 0)
    }, ensure_ascii=False))
except Exception as e:
    print(json.dumps({"ok": False, "message": str(e)}))
    sys.exit(1)
`;

  return new Promise((resolve, reject) => {
    const args = [
      "-c",
      pythonCode,
      "--audio",
      filePath,
      "--model",
      model,
      "--device",
      device,
      "--compute_type",
      computeType,
    ];

    if (whisperLang) args.push("--language", whisperLang);

    const child = spawn(pythonBin, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(new Error(`Could not start Whisper: ${error.message}`));
    });

    child.on("close", (code) => {
      let parsed = null;

      try {
        parsed = JSON.parse(stdout || "{}");
      } catch {
        return reject(
          new Error(
            `Whisper returned invalid JSON. stderr=${stderr.slice(
              0,
              600
            )} stdout=${stdout.slice(0, 600)}`
          )
        );
      }

      if (code !== 0 || parsed.ok === false) {
        return reject(
          new Error(
            parsed?.message || stderr || `Whisper failed with exit code ${code}`
          )
        );
      }

      resolve({
        transcript: keepText(parsed.transcript || ""),
        segments: Array.isArray(parsed.segments) ? parsed.segments : [],
        language: clean(parsed.language),
        duration: Number(parsed.duration || 0),
      });
    });
  });
}

async function createBaseNote({ owner, topic, language, sourceType, file }) {
  const sessionId = crypto.randomUUID
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");

  return LiveLectureNote.create({
    sessionId,
    ownerKey: owner.ownerKey,
    offlineUserId: owner.offlineUserId,
    userId: owner.userId,
    deviceId: owner.deviceId,
    ownerType: owner.ownerType,
    topic: clean(topic) || "Live Lecture",
    language: normalizeLanguage(language),
    sourceType,
    status: sourceType === "audio" ? "transcribing" : "generating",
    audio: file
      ? {
          originalName: file.originalname || "",
          filename: file.filename || "",
          path: file.path || "",
          mimeType: file.mimetype || "",
          sizeBytes: file.size || 0,
        }
      : undefined,
    startedAt: new Date(),
  });
}

async function completeNote({
  doc,
  transcript,
  segments,
  detectedLanguage,
  duration,
  note,
  ai,
}) {
  doc.status = "completed";
  doc.transcript = transcript;
  doc.transcriptSegments = segments || [];
  doc.detectedLanguage = detectedLanguage || "";
  doc.audio.durationSeconds = Number(duration || 0);
  doc.note = note;
  doc.ai = ai;
  doc.error = "";
  doc.completedAt = new Date();

  await doc.save();
  return doc;
}

async function failNote(doc, error) {
  if (!doc) return;

  doc.status = "failed";
  doc.error = error?.message || "Live lecture note failed.";

  await doc.save();
}

const uploadDir =
  process.env.LIVE_LECTURE_UPLOAD_DIR ||
  path.join(process.cwd(), "uploads", "live-lecture-notes");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir);
  },

  filename(req, file, cb) {
    const ext = path.extname(file.originalname || "") || ".webm";
    const safeExt = ext.replace(/[^a-z0-9.]/gi, "").slice(0, 12) || ".webm";

    cb(
      null,
      `lecture-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`
    );
  },
});

const uploadAudio = multer({
  storage,
  limits: {
    fileSize:
      Number(process.env.LIVE_LECTURE_MAX_AUDIO_MB || process.env.MAX_AUDIO_MB || 100) *
      1024 *
      1024,
  },

  fileFilter(req, file, cb) {
    const mime = String(file.mimetype || "").toLowerCase();

    if (
      mime.startsWith("audio/") ||
      mime === "video/webm" ||
      mime === "application/octet-stream"
    ) {
      cb(null, true);
      return;
    }

    cb(new Error("Only audio files are allowed for Live Lecture Notes."));
  },
});

router.get("/health", (req, res) => {
  res.json({
    ok: true,
    feature: FEATURE,
    route: "/api/live-lecture-notes",
    separateFromGemmaResource: true,
    whisper: "faster-whisper via Python",
    gemma: "Ollama strict transcript-only JSON",
    fakeFallback: false,
  });
});

router.get("/", async (req, res) => {
  try {
    const owner = resolveOwner(req);
    const limit = Math.max(1, Math.min(80, Number(req.query.limit || 30)));

    const notes = await LiveLectureNote.find(ownerQuery(owner))
      .sort({ createdAt: -1 })
      .limit(limit)
      .select(LiveLectureNote.publicFields())
      .lean();

    return sendOk(
      res,
      notes.map((note) => ({
        ...note,
        id: String(note._id),
      }))
    );
  } catch (error) {
    return sendError(res, error, 500);
  }
});

router.get("/:id", async (req, res) => {
  try {
    const owner = resolveOwner(req);

    const note = await LiveLectureNote.findOne({
      _id: req.params.id,
      ...ownerQuery(owner),
    })
      .select(LiveLectureNote.publicFields())
      .lean();

    if (!note) {
      const error = new Error("Live lecture note not found for this profile.");
      error.statusCode = 404;
      throw error;
    }

    return sendOk(res, {
      ...note,
      id: String(note._id),
    });
  } catch (error) {
    return sendError(res, error, error?.statusCode || 404);
  }
});

router.post("/from-transcript", async (req, res) => {
  let doc = null;

  try {
    const owner = resolveOwner(req);
    const topic = clean(req.body?.topic || "Live Lecture");
    const language = normalizeLanguage(req.body?.language || "en");
    const transcript = keepText(req.body?.transcript || "");

    if (transcript.length < 20) {
      const error = new Error("Transcript must be at least 20 characters.");
      error.statusCode = 400;
      throw error;
    }

    doc = await createBaseNote({
      owner,
      topic,
      language,
      sourceType: "transcript",
      file: null,
    });

    const { note, ai } = await generateNoteWithGemma({
      topic,
      transcript,
      language,
    });

    const saved = await completeNote({
      doc,
      transcript,
      segments: [],
      detectedLanguage: "",
      duration: 0,
      note,
      ai,
    });

    return sendOk(res, saved.toClient(), 201);
  } catch (error) {
    await failNote(doc, error);
    return sendError(res, error, error?.statusCode || 400);
  }
});

router.post("/from-audio", uploadAudio.single("audio"), async (req, res) => {
  let doc = null;

  try {
    const owner = resolveOwner(req);
    const topic = clean(req.body?.topic || "Live Lecture");
    const language = normalizeLanguage(req.body?.language || "auto");

    if (!req.file?.path) {
      const error = new Error(
        "Audio file is required. Upload field name must be audio."
      );
      error.statusCode = 400;
      throw error;
    }

    doc = await createBaseNote({
      owner,
      topic,
      language,
      sourceType: "audio",
      file: req.file,
    });

    const transcription = await transcribeAudio(req.file.path, language);

    if (!transcription.transcript || transcription.transcript.length < 20) {
      const error = new Error(
        "Transcript is too short. Record clearer audio for at least 20-30 seconds."
      );
      error.statusCode = 400;
      throw error;
    }

    doc.status = "generating";
    doc.transcript = transcription.transcript;
    doc.transcriptSegments = transcription.segments;
    doc.detectedLanguage = transcription.language;
    doc.audio.durationSeconds = transcription.duration;
    await doc.save();

    const { note, ai } = await generateNoteWithGemma({
      topic,
      transcript: transcription.transcript,
      language,
    });

    const saved = await completeNote({
      doc,
      transcript: transcription.transcript,
      segments: transcription.segments,
      detectedLanguage: transcription.language,
      duration: transcription.duration,
      note,
      ai,
    });

    return sendOk(res, saved.toClient(), 201);
  } catch (error) {
    await failNote(doc, error);
    return sendError(res, error, error?.statusCode || 400);
  }
});

router.use((error, req, res, next) => {
  if (!error) return next();
  return sendError(res, error, error?.statusCode || 400);
});

export default router;
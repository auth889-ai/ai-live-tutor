import crypto from "crypto";

const VOICE_BRIDGE_URL =
  process.env.LIVE_TUTOR_VOICE_BRIDGE_URL ||
  process.env.READINESS_VOICE_BRIDGE_URL ||
  process.env.OLLAMA_VOICE_BRIDGE_URL ||
  "http://localhost:5057";

const VOICE_TIMEOUT_MS = Number(
  process.env.LIVE_TUTOR_VOICE_TIMEOUT_MS ||
    process.env.READINESS_VOICE_TIMEOUT_MS ||
    180000
);

const DEFAULT_TTS_VOICE =
  process.env.LIVE_TUTOR_TTS_VOICE ||
  process.env.PIPER_VOICE ||
  "auto";

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function trimText(value = "", max = 4000) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}...`;
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function hashText(value = "") {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function normalizeBridgeBase(url = "") {
  return String(url || "").replace(/\/+$/, "");
}

function detectLanguage(text = "") {
  const value = String(text || "");

  if (/[\u0980-\u09FF]/.test(value)) return "bangla";

  if (
    /\b(ami|amar|amake|bujhi|bujhini|bujhte|kivabe|kibhabe|keno|eta|eita|ki|theke|chai|lagbe|bolo|dao)\b/i.test(
      value
    )
  ) {
    return "bangla";
  }

  if (/[a-z]/i.test(value)) return "english";

  return "auto";
}

function normalizeLanguage(value = "", fallbackText = "") {
  const lang = clean(value).toLowerCase();

  if (["auto", "english", "bangla", "mixed", "en", "bn", "en-us", "bn-bd"].includes(lang)) {
    if (lang === "en" || lang === "en-us") return "english";
    if (lang === "bn" || lang === "bn-bd") return "bangla";
    return lang;
  }

  return detectLanguage(fallbackText);
}

function dataUrlToBase64(dataUrl = "") {
  const value = String(dataUrl || "").trim();
  if (!value) return "";

  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  return match?.[2] || value;
}

function dataUrlMime(dataUrl = "") {
  const value = String(dataUrl || "").trim();
  const match = value.match(/^data:([^;]+);base64,/);
  return match?.[1] || "audio/webm";
}

function base64ToBuffer(base64 = "") {
  const value = dataUrlToBase64(base64);
  if (!value) return Buffer.alloc(0);
  return Buffer.from(value, "base64");
}

function bufferToDataUrl(buffer, mime = "audio/wav") {
  if (!buffer || !buffer.length) return "";
  return `data:${mime};base64,${Buffer.from(buffer).toString("base64")}`;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = safeNumber(options.timeoutMs, VOICE_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function tryJsonPost(path, body = {}, options = {}) {
  const base = normalizeBridgeBase(options.bridgeUrl || VOICE_BRIDGE_URL);
  const url = `${base}${path}`;

  const response = await fetchWithTimeout(url, {
    method: "POST",
    timeoutMs: options.timeoutMs || VOICE_TIMEOUT_MS,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { ok: false, raw: text };
  }

  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Voice bridge failed: ${response.status}`);
  }

  return data;
}

async function tryMultipartAudioPost(path, audioBuffer, fields = {}, options = {}) {
  const base = normalizeBridgeBase(options.bridgeUrl || VOICE_BRIDGE_URL);
  const url = `${base}${path}`;

  const form = new FormData();

  const mime = fields.mimeType || "audio/webm";
  const filename = fields.filename || `voice-${Date.now()}.webm`;

  const blob = new Blob([audioBuffer], { type: mime });
  form.append("file", blob, filename);
  form.append("audio", blob, filename);

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) {
      form.append(key, String(value));
    }
  }

  const response = await fetchWithTimeout(url, {
    method: "POST",
    timeoutMs: options.timeoutMs || VOICE_TIMEOUT_MS,
    body: form,
  });

  const contentType = response.headers.get("content-type") || "";
  const arrayBuffer = await response.arrayBuffer();

  if (!response.ok) {
    const text = Buffer.from(arrayBuffer).toString("utf8");
    throw new Error(text || `Voice bridge failed: ${response.status}`);
  }

  if (contentType.includes("application/json")) {
    const text = Buffer.from(arrayBuffer).toString("utf8");
    return JSON.parse(text || "{}");
  }

  return {
    ok: true,
    audioDataUrl: bufferToDataUrl(Buffer.from(arrayBuffer), contentType || "audio/wav"),
    mimeType: contentType || "audio/wav",
  };
}

function normalizeTranscriptionResult(result = {}) {
  const text =
    result.text ||
    result.transcript ||
    result.transcription ||
    result.result?.text ||
    result.result?.transcript ||
    "";

  const language =
    result.language ||
    result.lang ||
    result.detectedLanguage ||
    result.result?.language ||
    detectLanguage(text);

  const segments =
    Array.isArray(result.segments)
      ? result.segments
      : Array.isArray(result.result?.segments)
        ? result.result.segments
        : [];

  return {
    ok: Boolean(text || result.ok),
    text: trimText(text, 8000),
    language: normalizeLanguage(language, text),
    segments,
    confidence: result.confidence || result.score || result.result?.confidence || null,
    raw: result,
  };
}

function normalizeTtsResult(result = {}) {
  const audioDataUrl =
    result.audioDataUrl ||
    result.audio ||
    result.audio_base64 ||
    result.audioBase64 ||
    result.result?.audioDataUrl ||
    "";

  const mimeType =
    result.mimeType ||
    result.mime ||
    result.contentType ||
    result.result?.mimeType ||
    "audio/wav";

  const normalizedAudio =
    audioDataUrl && !String(audioDataUrl).startsWith("data:")
      ? `data:${mimeType};base64,${audioDataUrl}`
      : audioDataUrl;

  return {
    ok: Boolean(normalizedAudio || result.ok),
    audioDataUrl: normalizedAudio,
    mimeType,
    durationSeconds: safeNumber(result.durationSeconds || result.duration || 0),
    voice: result.voice || result.result?.voice || "",
    raw: result,
  };
}

export async function getLiveTutorVoiceHealth() {
  const base = normalizeBridgeBase(VOICE_BRIDGE_URL);

  const candidatePaths = ["/health", "/api/health", "/voice/health", "/ready"];

  for (const path of candidatePaths) {
    try {
      const response = await fetchWithTimeout(`${base}${path}`, {
        method: "GET",
        timeoutMs: 8000,
      });

      const text = await response.text();

      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }

      if (response.ok) {
        return {
          ok: true,
          service: "live-tutor-voice",
          bridgeOnline: true,
          bridgeUrl: base,
          bridgeHealthPath: path,
          bridge: data,
          features: {
            stt: true,
            tts: true,
            fasterWhisperCompatible: true,
            piperCompatible: true,
            browserFallbackCompatible: true,
          },
        };
      }
    } catch {
      // try next path
    }
  }

  return {
    ok: true,
    service: "live-tutor-voice",
    bridgeOnline: false,
    bridgeUrl: base,
    message:
      "Voice bridge is not reachable. Browser Web Speech API can still work; backend Whisper/Piper requires the local bridge.",
    features: {
      stt: false,
      tts: false,
      fasterWhisperCompatible: true,
      piperCompatible: true,
      browserFallbackCompatible: true,
    },
  };
}

export async function transcribeLiveTutorAudio({
  audioBase64 = "",
  audioDataUrl = "",
  mimeType = "",
  filename = "",
  language = "auto",
  mode = "question",
  userId = "guest",
  sessionKey = "",
  metadata = {},
} = {}) {
  const audioInput = audioDataUrl || audioBase64;
  const finalMime = mimeType || dataUrlMime(audioInput) || "audio/webm";
  const audioBuffer = base64ToBuffer(audioInput);

  if (!audioBuffer.length) {
    return {
      ok: false,
      message: "audioBase64 or audioDataUrl is required.",
    };
  }

  const payload = {
    audioBase64: dataUrlToBase64(audioInput),
    audioDataUrl: audioInput.startsWith("data:") ? audioInput : `data:${finalMime};base64,${audioInput}`,
    mimeType: finalMime,
    filename: filename || `live-tutor-${Date.now()}.webm`,
    language: normalizeLanguage(language),
    mode,
    userId,
    sessionKey,
    metadata,
  };

  const paths = [
    "/api/voice/transcribe",
    "/voice/transcribe",
    "/transcribe",
    "/stt",
    "/api/stt",
  ];

  let lastError = null;

  for (const path of paths) {
    try {
      const result = await tryJsonPost(path, payload);
      return {
        ...normalizeTranscriptionResult(result),
        bridgePath: path,
      };
    } catch (error) {
      lastError = error;
    }
  }

  const multipartPaths = ["/transcribe", "/stt", "/api/voice/transcribe", "/voice/transcribe"];

  for (const path of multipartPaths) {
    try {
      const result = await tryMultipartAudioPost(
        path,
        audioBuffer,
        {
          mimeType: finalMime,
          filename: payload.filename,
          language: payload.language,
          mode,
          userId,
          sessionKey,
        }
      );

      return {
        ...normalizeTranscriptionResult(result),
        bridgePath: path,
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    ok: false,
    message:
      lastError?.message ||
      "Could not transcribe audio. Make sure faster-whisper voice bridge is running.",
    bridgeUrl: normalizeBridgeBase(VOICE_BRIDGE_URL),
  };
}

export async function synthesizeLiveTutorSpeech({
  text = "",
  language = "auto",
  voice = DEFAULT_TTS_VOICE,
  speed = 1,
  userId = "guest",
  sessionKey = "",
  metadata = {},
} = {}) {
  const finalText = trimText(text, 8000);

  if (!finalText) {
    return {
      ok: false,
      message: "text is required.",
    };
  }

  const finalLanguage = normalizeLanguage(language, finalText);

  const payload = {
    text: finalText,
    language: finalLanguage,
    lang: finalLanguage === "bangla" ? "bn" : finalLanguage === "english" ? "en" : "auto",
    voice,
    speed: safeNumber(speed, 1),
    userId,
    sessionKey,
    metadata,
  };

  const paths = [
    "/api/voice/speak",
    "/voice/speak",
    "/speak",
    "/tts",
    "/api/tts",
  ];

  let lastError = null;

  for (const path of paths) {
    try {
      const result = await tryJsonPost(path, payload);
      return {
        ...normalizeTtsResult(result),
        bridgePath: path,
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    ok: false,
    message:
      lastError?.message ||
      "Could not synthesize speech. Make sure Piper TTS voice bridge is running.",
    bridgeUrl: normalizeBridgeBase(VOICE_BRIDGE_URL),
    fallback: {
      browserSpeechSynthesis: true,
      text: finalText,
      language: finalLanguage,
    },
  };
}

export async function buildVoiceTutorPayload({
  transcript = "",
  mode = "interrupt",
  userQuestion = "",
  studentAnswer = "",
  payload = {},
} = {}) {
  const text = trimText(transcript || userQuestion || studentAnswer, 8000);
  const language = normalizeLanguage(payload.languageHint || payload.language || "auto", text);

  const nextPayload = {
    ...payload,
    languageHint: language,
    voiceTranscript: text,
  };

  if (mode === "explain_back") {
    nextPayload.mode = "explain_back";
    nextPayload.studentAnswer = studentAnswer || text;
    nextPayload.userQuestion =
      userQuestion ||
      "Evaluate my spoken explain-back. Tell me correct, missing, wrong, and repair my weak concept.";
  } else if (mode === "interrupt") {
    nextPayload.mode = "interrupt";
    nextPayload.userQuestion = userQuestion || text;
  } else {
    nextPayload.mode = mode || "explain_frame";
    nextPayload.userQuestion = userQuestion || text;
  }

  return {
    ok: true,
    payload: nextPayload,
    transcript: text,
    language,
    transcriptHash: hashText(text).slice(0, 24),
  };
}

export function getLiveTutorVoiceConfig() {
  return {
    ok: true,
    service: "live-tutor-voice",
    bridgeUrl: normalizeBridgeBase(VOICE_BRIDGE_URL),
    timeoutMs: VOICE_TIMEOUT_MS,
    defaultVoice: DEFAULT_TTS_VOICE,
    endpointsTried: {
      stt: [
        "/api/voice/transcribe",
        "/voice/transcribe",
        "/transcribe",
        "/stt",
        "/api/stt",
      ],
      tts: [
        "/api/voice/speak",
        "/voice/speak",
        "/speak",
        "/tts",
        "/api/tts",
      ],
    },
    features: {
      fasterWhisperBridge: true,
      piperTtsBridge: true,
      base64AudioInput: true,
      browserFallbackCompatible: true,
      interruptPayloadBuilder: true,
      explainBackPayloadBuilder: true,
    },
  };
}

export default {
  getLiveTutorVoiceHealth,
  getLiveTutorVoiceConfig,
  transcribeLiveTutorAudio,
  synthesizeLiveTutorSpeech,
  buildVoiceTutorPayload,
};
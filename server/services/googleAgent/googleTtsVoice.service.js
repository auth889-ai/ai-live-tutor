"use strict";

/**
 * server/services/googleAgent/googleTtsVoice.service.js
 * =============================================================================
 * Google TTS Voice Renderer for Stage 2 Live Tutor
 *
 * Purpose:
 * - Convert source-grounded voiceScript[] into real Google Text-to-Speech audio.
 * - Keep voice line ↔ board command sync.
 * - Return audioContent/dataUrl per line so frontend can play immediately.
 * - Never fake audio. If Google TTS is not configured, returns ttsUsed:false.
 *
 * Env:
 *   GOOGLE_TTS_API_KEY=...
 *   or GOOGLE_CLOUD_TTS_API_KEY=...
 *   or GOOGLE_API_KEY=...
 *
 * Optional:
 *   GOOGLE_TTS_LANGUAGE_CODE=en-US
 *   GOOGLE_TTS_VOICE_NAME=en-US-Neural2-F
 *   GOOGLE_TTS_SSML_GENDER=FEMALE
 *   GOOGLE_TTS_AUDIO_ENCODING=MP3
 *   GOOGLE_TTS_SPEAKING_RATE=0.95
 *   GOOGLE_TTS_PITCH=0
 *   GOOGLE_TTS_VOLUME_GAIN_DB=0
 *   GOOGLE_TTS_MAX_LINES=40
 * =============================================================================
 */

const crypto = require("crypto");

function safeString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanText(value, max = 5000) {
  return safeString(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "y", "on"].includes(String(raw).trim().toLowerCase());
}

function envNumber(name, fallback, min = -Infinity, max = Infinity) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

function getApiKey() {
  return (
    process.env.GOOGLE_TTS_API_KEY ||
    process.env.GOOGLE_CLOUD_TTS_API_KEY ||
    process.env.GOOGLE_TEXT_TO_SPEECH_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ""
  );
}

function getVoiceConfig(input = {}) {
  const body = safeObject(input.body || input);

  return {
    languageCode:
      cleanText(body.languageCode, 40) ||
      cleanText(process.env.GOOGLE_TTS_LANGUAGE_CODE, 40) ||
      "en-US",

    name:
      cleanText(body.voiceName, 80) ||
      cleanText(process.env.GOOGLE_TTS_VOICE_NAME, 80) ||
      "en-US-Neural2-F",

    ssmlGender:
      cleanText(body.ssmlGender, 20) ||
      cleanText(process.env.GOOGLE_TTS_SSML_GENDER, 20) ||
      "FEMALE",
  };
}

function getAudioConfig(input = {}) {
  const body = safeObject(input.body || input);

  return {
    audioEncoding:
      cleanText(body.audioEncoding, 20) ||
      cleanText(process.env.GOOGLE_TTS_AUDIO_ENCODING, 20) ||
      "MP3",

    speakingRate: Number.isFinite(Number(body.speakingRate))
      ? Math.max(0.25, Math.min(4.0, Number(body.speakingRate)))
      : envNumber("GOOGLE_TTS_SPEAKING_RATE", 0.95, 0.25, 4.0),

    pitch: Number.isFinite(Number(body.pitch))
      ? Math.max(-20, Math.min(20, Number(body.pitch)))
      : envNumber("GOOGLE_TTS_PITCH", 0, -20, 20),

    volumeGainDb: Number.isFinite(Number(body.volumeGainDb))
      ? Math.max(-96, Math.min(16, Number(body.volumeGainDb)))
      : envNumber("GOOGLE_TTS_VOLUME_GAIN_DB", 0, -96, 16),
  };
}

function normalizeVoiceLine(line, index) {
  const item = safeObject(line);
  const text = cleanText(item.text || item.spokenText || item.voiceText || item.body, 4800);

  return {
    lineId: cleanText(item.lineId || item.voiceId || `voice_${index + 1}`, 120),
    voiceId: cleanText(item.voiceId || item.lineId || `voice_${index + 1}`, 120),
    commandId: cleanText(item.commandId || item.boardCommandId || "", 160),
    screenNo: Number(item.screenNo || item.screen || 1),
    startMs: Number(item.startMs || 0),
    endMs: Number(item.endMs || item.startMs || 0),
    durationMs: Number(item.durationMs || 0),
    text,
    tone: cleanText(item.tone || "teacher-clear", 80),
    emotion: cleanText(item.emotion || "teacher-clear", 80),
    sourceRefs: safeArray(item.sourceRefs),
    metadata: safeObject(item.metadata),
  };
}

function getMimeType(audioEncoding) {
  const enc = String(audioEncoding || "MP3").toUpperCase();

  if (enc === "LINEAR16") return "audio/wav";
  if (enc === "OGG_OPUS") return "audio/ogg";
  if (enc === "MULAW") return "audio/basic";
  return "audio/mpeg";
}

function buildTeacherText(line, index, total) {
  const text = cleanText(line.text, 4800);
  if (!text) return "";

  const intro =
    index === 0
      ? "Let's start. "
      : "";

  return cleanText(`${intro}${text}`, 4800);
}

async function synthesizeOneLine({ line, index, total, apiKey, voice, audioConfig, timeoutMs }) {
  const text = buildTeacherText(line, index, total);

  if (!text) {
    return {
      ok: false,
      lineId: line.lineId,
      commandId: line.commandId,
      error: "Empty voice text.",
      fallbackUsed: false,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        input: { text },
        voice,
        audioConfig,
      }),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        ok: false,
        lineId: line.lineId,
        commandId: line.commandId,
        status: response.status,
        error: body?.error?.message || `Google TTS failed with HTTP ${response.status}`,
        googleError: body?.error || body,
        fallbackUsed: false,
      };
    }

    const audioContent = cleanText(body.audioContent, 20_000_000);
    if (!audioContent) {
      return {
        ok: false,
        lineId: line.lineId,
        commandId: line.commandId,
        error: "Google TTS returned no audioContent.",
        fallbackUsed: false,
      };
    }

    const mimeType = getMimeType(audioConfig.audioEncoding);

    return {
      ok: true,
      lineId: line.lineId,
      voiceId: line.voiceId,
      commandId: line.commandId,
      screenNo: line.screenNo,
      startMs: line.startMs,
      endMs: line.endMs,
      durationMs: line.durationMs,
      text,
      mimeType,
      audioEncoding: audioConfig.audioEncoding,
      audioContent,
      dataUrl: `data:${mimeType};base64,${audioContent}`,
      byteLength: Buffer.from(audioContent, "base64").length,
      sourceRefs: line.sourceRefs,
      metadata: {
        fallbackUsed: false,
        googleTtsUsed: true,
        syncedToCommand: Boolean(line.commandId),
      },
    };
  } catch (error) {
    return {
      ok: false,
      lineId: line.lineId,
      commandId: line.commandId,
      error: error?.name === "AbortError"
        ? `Google TTS timed out after ${timeoutMs}ms.`
        : error?.message || "Google TTS request failed.",
      fallbackUsed: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

function summarizeLines(lines) {
  return lines.map((line) => ({
    lineId: line.lineId,
    commandId: line.commandId,
    screenNo: line.screenNo,
    startMs: line.startMs,
    endMs: line.endMs,
    durationMs: line.durationMs,
    textPreview: cleanText(line.text, 180),
    sourceRefCount: safeArray(line.sourceRefs).length,
  }));
}

async function synthesizeLessonVoice(input = {}) {
  const apiKey = getApiKey();
  const voiceScript = safeArray(input.voiceScript).map(normalizeVoiceLine).filter((line) => line.text);
  const sessionId = cleanText(input.sessionId || `tts_session_${Date.now()}`, 160);
  const requireRealTts = Boolean(input.requireRealTts || envBool("GOOGLE_TTS_REQUIRE_REAL", false));

  const requestedMaxLines = Number(input.maxLines || input.maxVoiceLines);
  const maxLines = Number.isFinite(requestedMaxLines)
    ? Math.max(1, Math.min(200, requestedMaxLines))
    : envNumber("GOOGLE_TTS_MAX_LINES", 40, 1, 200);

  const selectedLines = voiceScript.slice(0, maxLines);
  const voice = getVoiceConfig(input);
  const audioConfig = getAudioConfig(input);
  const timeoutMs = Number(input.timeoutMs || process.env.GOOGLE_TTS_TIMEOUT_MS || 45000);

  if (!selectedLines.length) {
    const result = {
      ok: false,
      ttsUsed: false,
      enabled: false,
      sessionId,
      error: "No voiceScript lines were provided to Google TTS.",
      fallbackUsed: false,
      voiceLines: [],
      audioClips: [],
      metadata: {
        fallbackUsed: false,
        googleTtsUsed: false,
        reason: "empty_voice_script",
      },
    };

    if (requireRealTts) {
      const err = new Error(result.error);
      err.statusCode = 500;
      err.stage2 = result;
      throw err;
    }

    return result;
  }

  if (!apiKey) {
    const result = {
      ok: false,
      ttsUsed: false,
      enabled: false,
      sessionId,
      error: "Google TTS API key missing. Set GOOGLE_TTS_API_KEY or GOOGLE_CLOUD_TTS_API_KEY.",
      fallbackUsed: false,
      voiceLines: summarizeLines(selectedLines),
      audioClips: [],
      metadata: {
        fallbackUsed: false,
        googleTtsUsed: false,
        reason: "missing_api_key",
      },
    };

    if (requireRealTts) {
      const err = new Error(result.error);
      err.statusCode = 500;
      err.stage2 = result;
      throw err;
    }

    return result;
  }

  const clips = [];
  const errors = [];

  for (let i = 0; i < selectedLines.length; i += 1) {
    const clip = await synthesizeOneLine({
      line: selectedLines[i],
      index: i,
      total: selectedLines.length,
      apiKey,
      voice,
      audioConfig,
      timeoutMs,
    });

    if (clip.ok) clips.push(clip);
    else errors.push(clip);

    if (errors.length >= 5 && clips.length === 0) {
      break;
    }
  }

  const audioManifestId = `tts_${crypto
    .createHash("sha1")
    .update(`${sessionId}:${Date.now()}:${clips.length}`)
    .digest("hex")
    .slice(0, 12)}`;

  const result = {
    ok: clips.length > 0,
    ttsUsed: clips.length > 0,
    enabled: true,
    sessionId,
    audioManifestId,
    provider: "google-cloud-text-to-speech",
    voice,
    audioConfig,
    totalVoiceLines: voiceScript.length,
    requestedLines: selectedLines.length,
    synthesizedCount: clips.length,
    failedCount: errors.length,
    voiceLines: summarizeLines(selectedLines),
    audioClips: clips,
    errors,
    fallbackUsed: false,
    metadata: {
      fallbackUsed: false,
      googleTtsUsed: clips.length > 0,
      commandSynced: clips.every((clip) => Boolean(clip.commandId)),
      sourceGrounded: selectedLines.every((line) => safeArray(line.sourceRefs).length > 0),
      maxLines,
      generatedAt: new Date().toISOString(),
    },
  };

  if (requireRealTts && !result.ttsUsed) {
    const err = new Error(errors[0]?.error || "Google TTS failed to synthesize audio.");
    err.statusCode = 500;
    err.stage2 = result;
    throw err;
  }

  return result;
}

module.exports = {
  synthesizeLessonVoice,
};
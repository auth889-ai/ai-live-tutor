import { Blob } from "buffer";

import { voiceCoachTurn, getVoiceConversation } from "../readinessCoach.service.js";
import { clean, makeError, requireUserId } from "./readinessDate.util.js";

const DEFAULT_BRIDGE_URL = "http://127.0.0.1:8765";

function bridgeUrl() {
  return String(process.env.READINESS_OFFLINE_VOICE_URL || DEFAULT_BRIDGE_URL).replace(/\/+$/, "");
}

async function parseBridgeJson(response) {
  const text = await response.text();
  let json = {};

  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!response.ok || json.ok === false) {
    throw makeError(
      json.error || json.message || json.raw || `Offline voice bridge failed: ${response.status}`,
      response.status || 502,
      "offline_voice_bridge_error"
    );
  }

  return json;
}

async function callBridge(path, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs || process.env.READINESS_OFFLINE_VOICE_TIMEOUT_MS || 120000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${bridgeUrl()}${path}`, {
      method: options.method || "GET",
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });

    return await parseBridgeJson(response);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw makeError(
        "Offline voice bridge timed out. Start ollama-STT-TTS readiness_voice_api.py and try again.",
        504,
        "offline_voice_timeout"
      );
    }

    if (error?.code) throw error;

    throw makeError(
      `Offline voice bridge is not reachable at ${bridgeUrl()}. Start it with: python readiness_voice_api.py`,
      503,
      "offline_voice_unreachable"
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function offlineVoiceHealth() {
  return callBridge("/health", { timeoutMs: 15000 });
}

export async function offlineVoiceSpeak(payload = {}) {
  const text = clean(payload.text || payload.speakText || payload.assistantText);

  if (!text) {
    throw makeError("text is required for offline voice speak.", 400, "voice_text_required");
  }

  return callBridge("/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    timeoutMs: 60000,
  });
}

export async function offlineVoiceTranscribe({ file, language = "bn" } = {}) {
  if (!file?.buffer?.length) {
    throw makeError("Audio file is required.", 400, "audio_required");
  }

  const form = new FormData();
  const filename = file.originalname || "voice.webm";
  const mimeType = file.mimetype || "audio/webm";

  form.append("audio", new Blob([file.buffer], { type: mimeType }), filename);
  form.append("language", clean(language, "bn"));

  const result = await callBridge("/transcribe", {
    method: "POST",
    body: form,
    timeoutMs: 180000,
  });

  return {
    text: clean(result.text),
    language: result.language || language,
    raw: result,
  };
}

export async function offlineVoiceCheckin(payload = {}, file = null) {
  const userId = requireUserId(payload);

  let text = clean(payload.text);
  let transcription = null;

  if (!text && file) {
    transcription = await offlineVoiceTranscribe({
      file,
      language: payload.language || payload.lang || "bn",
    });
    text = clean(transcription.text);
  }

  if (!text) {
    throw makeError("No voice text found. Speak again or type your answer.", 400, "empty_voice_text");
  }

  const turn = await voiceCoachTurn({
    ...payload,
    userId,
    text,
    source: "offline_voice",
  });

  const speakText = clean(turn.speakText || turn.assistantText || turn.aiText);
  let spoken = null;

  if (speakText && payload.speak !== "false") {
    try {
      spoken = await offlineVoiceSpeak({ text: speakText });
    } catch (error) {
      spoken = {
        ok: false,
        error: error.message,
        code: error.code || "offline_tts_failed",
      };
    }
  }

  const conversation = await getVoiceConversation({ userId, sessionId: turn.sessionId });

  return {
    mode: "offline_voice",
    bridgeUrl: bridgeUrl(),
    transcribedText: text,
    transcription,
    assistantText: turn.assistantText,
    speakText,
    spoken,
    turn,
    conversation: conversation.conversation,
    memory: conversation.memory,
  };
}
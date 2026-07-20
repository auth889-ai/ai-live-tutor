import { YoutubeTranscript } from "youtube-transcript";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function isYouTubeUrl(url = "") {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.includes("youtube.com") || host.includes("youtu.be");
  } catch {
    return false;
  }
}

export function getYouTubeVideoId(url = "") {
  try {
    const u = new URL(url);

    if (u.hostname.includes("youtu.be")) {
      return u.pathname.replace(/^\//, "").split("/")[0];
    }

    const v = u.searchParams.get("v");
    if (v) return v;

    const shorts = u.pathname.match(/\/shorts\/([^/?]+)/);
    if (shorts) return shorts[1];

    const embed = u.pathname.match(/\/embed\/([^/?]+)/);
    if (embed) return embed[1];

    const live = u.pathname.match(/\/live\/([^/?]+)/);
    if (live) return live[1];
  } catch {
    // ignore
  }

  return "";
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} failed (${code}): ${stderr || stdout}`));
      }
    });
  });
}

function toSecondsMaybeMs(value = 0, source = "") {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;

  const src = String(source || "").toLowerCase();

  if (
    src.includes("ms") ||
    src.includes("offset") ||
    src.includes("duration") ||
    n > 1000
  ) {
    return Math.round(n / 1000);
  }

  return n;
}

function normalizeYoutubeTranscriptRows(rows = []) {
  return rows
    .map((row, index) => {
      const rawStart =
        row.startSeconds ??
        row.startTimeSeconds ??
        row.start ??
        row.offsetMs ??
        row.offset ??
        row.time ??
        0;

      const rawDuration =
        row.durationSeconds ??
        row.durationMs ??
        row.duration ??
        row.dur ??
        row.length ??
        0;

      const startSeconds = Math.max(0, toSecondsMaybeMs(rawStart, "offset_ms"));
      const durationSeconds = Math.max(
        1,
        toSecondsMaybeMs(rawDuration, "duration_ms") || 8
      );

      return {
        index,
        startSeconds,
        endSeconds: startSeconds + durationSeconds,
        offsetMs: Number(row.offset ?? row.offsetMs ?? 0) || 0,
        durationMs: Number(row.duration ?? row.durationMs ?? 0) || 0,
        text: clean(row.text || row.caption || row.content || ""),
      };
    })
    .filter((row) => row.text)
    .sort((a, b) => a.startSeconds - b.startSeconds);
}

function segmentsToTranscript(segments = []) {
  return segments.map((segment) => segment.text).filter(Boolean).join(" ");
}

export async function fetchCaptionsWithYoutubeTranscript(url) {
  const videoId = getYouTubeVideoId(url);
  if (!videoId) throw new Error("Invalid YouTube URL");

  const rows = await YoutubeTranscript.fetchTranscript(videoId);
  const segments = normalizeYoutubeTranscriptRows(rows);
  const transcript = segmentsToTranscript(segments);

  if (!transcript) throw new Error("No captions found");

  const durationSeconds = Math.max(
    ...segments.map((segment) => Number(segment.endSeconds || 0)),
    0
  );

  return {
    source: "youtube-transcript",
    videoId,
    transcript,
    text: transcript,
    segments,
    durationSeconds,
  };
}

function parseJson3Caption(jsonText = "") {
  const data = JSON.parse(jsonText);
  const events = Array.isArray(data?.events) ? data.events : [];

  return events
    .filter((event) => Array.isArray(event.segs))
    .map((event, index) => {
      const text = event.segs
        .map((seg) => seg.utf8 || "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();

      const startSeconds = Math.max(0, Math.round(Number(event.tStartMs || 0) / 1000));
      const durationSeconds = Math.max(
        1,
        Math.round(Number(event.dDurationMs || 8000) / 1000)
      );

      return {
        index,
        startSeconds,
        endSeconds: startSeconds + durationSeconds,
        text,
      };
    })
    .filter((segment) => segment.text);
}

function decodeXmlText(value = "") {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseXmlCaption(xmlText = "") {
  const rows = Array.from(
    xmlText.matchAll(
      /<text[^>]*start="([^"]+)"[^>]*?(?:dur="([^"]+)")?[^>]*>([\s\S]*?)<\/text>/g
    )
  );

  return rows
    .map((match, index) => {
      const startSeconds = Math.max(0, Number(match[1] || 0));
      const durationSeconds = Math.max(1, Number(match[2] || 8));
      const text = clean(decodeXmlText(match[3] || "").replace(/<[^>]+>/g, " "));

      return {
        index,
        startSeconds,
        endSeconds: startSeconds + durationSeconds,
        text,
      };
    })
    .filter((segment) => segment.text);
}

function parseVttTime(value = "") {
  const cleanValue = String(value || "").split(/\s+/)[0].replace(",", ".");
  const parts = cleanValue.split(":").map(Number);

  if (parts.length === 3) {
    return Math.floor(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  }

  if (parts.length === 2) {
    return Math.floor(parts[0] * 60 + parts[1]);
  }

  return Math.floor(Number(cleanValue) || 0);
}

function parseVttCaption(vttText = "") {
  const blocks = String(vttText || "")
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean);

  const segments = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const timingLine = lines.find((line) => line.includes("-->"));
    if (!timingLine) continue;

    const [startRaw, endRaw] = timingLine.split("-->").map((part) => part.trim());
    const startSeconds = parseVttTime(startRaw);
    const endSeconds = parseVttTime(endRaw);

    const text = clean(
      lines
        .filter(
          (line) =>
            !line.includes("-->") &&
            !/^WEBVTT/i.test(line) &&
            !/^\d+$/.test(line)
        )
        .join(" ")
        .replace(/<[^>]+>/g, " ")
    );

    if (!text) continue;

    segments.push({
      index: segments.length,
      startSeconds,
      endSeconds: Math.max(startSeconds + 1, endSeconds),
      text,
    });
  }

  return segments;
}

async function fetchSubtitleUrl(url) {
  const { stdout } = await runCommand("yt-dlp", [
    "--skip-download",
    "--dump-json",
    "--write-auto-subs",
    "--write-subs",
    "--sub-langs",
    "en.*,en",
    "--sub-format",
    "json3/vtt/srv3/best",
    url,
  ]);

  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const info = JSON.parse(lines[lines.length - 1]);

  const subtitles = {
    ...(info.subtitles || {}),
    ...(info.automatic_captions || {}),
  };

  const lang =
    Object.keys(subtitles).find((key) => key === "en") ||
    Object.keys(subtitles).find((key) => key.startsWith("en")) ||
    Object.keys(subtitles)[0];

  const formats = subtitles?.[lang] || [];

  const picked =
    formats.find((item) => item.ext === "json3") ||
    formats.find((item) => item.ext === "srv3") ||
    formats.find((item) => item.ext === "vtt") ||
    formats[0];

  if (!picked?.url) throw new Error("yt-dlp found no subtitle URL");

  return {
    videoId: info.id || getYouTubeVideoId(url),
    subtitleUrl: picked.url,
    ext: picked.ext || "",
  };
}

async function fetchCaptionsWithYtDlp(url) {
  const { videoId, subtitleUrl, ext } = await fetchSubtitleUrl(url);

  const response = await fetch(subtitleUrl);
  if (!response.ok) {
    throw new Error(`subtitle URL fetch failed: ${response.status}`);
  }

  const captionText = await response.text();

  let segments = [];

  if (ext === "json3" || captionText.trim().startsWith("{")) {
    segments = parseJson3Caption(captionText);
  } else if (captionText.includes("<text")) {
    segments = parseXmlCaption(captionText);
  } else {
    segments = parseVttCaption(captionText);
  }

  const transcript = segmentsToTranscript(segments);

  if (!transcript) throw new Error("yt-dlp subtitles were empty");

  return {
    source: "yt-dlp-subtitles",
    videoId,
    transcript,
    text: transcript,
    segments,
    durationSeconds: Math.max(...segments.map((segment) => segment.endSeconds || 0), 0),
  };
}

export async function transcribeWithLocalWhisper(url) {
  const id = crypto.randomBytes(8).toString("hex");
  const dir = path.join(os.tmpdir(), `yt-${id}`);

  await fs.mkdir(dir, { recursive: true });

  const outTemplate = path.join(dir, "audio.%(ext)s");
  const wavPath = path.join(dir, "audio.wav");
  const txtPath = path.join(dir, "audio.txt");

  try {
    await runCommand("yt-dlp", [
      "-f",
      "bestaudio/best",
      "--extract-audio",
      "--audio-format",
      "wav",
      "-o",
      outTemplate,
      url,
    ]);

    const files = await fs.readdir(dir);
    const wav = files.find((file) => file.endsWith(".wav"));

    if (!wav) throw new Error("yt-dlp did not create wav audio");

    if (path.join(dir, wav) !== wavPath) {
      await fs.rename(path.join(dir, wav), wavPath);
    }

    const py = `
from faster_whisper import WhisperModel

model = WhisperModel("base", device="cpu", compute_type="int8")
segments, info = model.transcribe(r"${wavPath}", beam_size=5)

lines = []
for i, s in enumerate(segments):
    start = int(s.start)
    end = int(s.end)
    text = s.text.strip()
    lines.append(f"{start}|{end}|{text}")

open(r"${txtPath}", "w", encoding="utf-8").write("\\n".join(lines))
`;

    await runCommand("python3", ["-c", py]);

    const raw = await fs.readFile(txtPath, "utf8");

    const segments = raw
      .split("\n")
      .map((line, index) => {
        const [start, end, ...rest] = line.split("|");

        return {
          index,
          startSeconds: Number(start || 0),
          endSeconds: Math.max(Number(start || 0) + 1, Number(end || 0)),
          text: clean(rest.join("|")),
        };
      })
      .filter((segment) => segment.text);

    const transcript = segmentsToTranscript(segments);

    return {
      source: "yt-dlp+faster-whisper",
      transcript,
      text: transcript,
      segments,
      durationSeconds: Math.max(...segments.map((segment) => segment.endSeconds || 0), 0),
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function isLocalWhisperDisabled() {
  const values = [
    process.env.CONNECT_LEARNING_YOUTUBE_LOCAL_WHISPER,
    process.env.GOOD_CONTENT_YOUTUBE_LOCAL_WHISPER,
  ];

  return values.some((value) => String(value || "").toLowerCase() === "false");
}

export async function getYouTubeTranscript(url) {
  const errors = [];

  try {
    const result = await fetchCaptionsWithYoutubeTranscript(url);

    console.log("[YouTubeTranscript] success via youtube-transcript", {
      videoId: result.videoId,
      segments: result.segments.length,
      chars: result.transcript.length,
    });

    return result;
  } catch (err) {
    errors.push(`youtube-transcript: ${err?.message || err}`);
    console.warn("[YouTubeTranscript] youtube-transcript failed:", err?.message || err);
  }

  try {
    const result = await fetchCaptionsWithYtDlp(url);

    console.log("[YouTubeTranscript] success via yt-dlp subtitles", {
      videoId: result.videoId,
      segments: result.segments.length,
      chars: result.transcript.length,
    });

    return result;
  } catch (err) {
    errors.push(`yt-dlp-subtitles: ${err?.message || err}`);
    console.warn("[YouTubeTranscript] yt-dlp subtitles failed:", err?.message || err);
  }

  if (isLocalWhisperDisabled()) {
    throw new Error(errors.join(" | "));
  }

  try {
    const result = await transcribeWithLocalWhisper(url);

    console.log("[YouTubeTranscript] success via local whisper", {
      segments: result.segments.length,
      chars: result.transcript.length,
    });

    return {
      ...result,
      captionError: errors.join(" | "),
    };
  } catch (err) {
    errors.push(`local-whisper: ${err?.message || err}`);
    throw new Error(errors.join(" | "));
  }
}
import crypto from "crypto";

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function trimText(value = "", max = 1200) {
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

function compactHash(value = "") {
  return hashText(value).slice(0, 24);
}

function parseDataUrl(dataUrl = "") {
  const value = String(dataUrl || "").trim();

  if (!value) {
    return {
      ok: false,
      mime: "",
      base64: "",
      buffer: null,
      hash: "",
      message: "empty image",
    };
  }

  const match = value.match(/^data:([^;]+);base64,(.+)$/);

  const mime = match?.[1] || "image/png";
  const base64 = match?.[2] || value;

  try {
    const buffer = Buffer.from(base64, "base64");

    return {
      ok: Boolean(buffer.length),
      mime,
      base64,
      buffer,
      hash: compactHash(base64),
      message: "",
    };
  } catch (error) {
    return {
      ok: false,
      mime,
      base64: "",
      buffer: null,
      hash: "",
      message: error.message,
    };
  }
}

function normalizeRect(rect = {}) {
  return {
    x: safeNumber(rect.x),
    y: safeNumber(rect.y),
    width: safeNumber(rect.width),
    height: safeNumber(rect.height),
    pageWidth: safeNumber(rect.pageWidth),
    pageHeight: safeNumber(rect.pageHeight),
    viewportWidth: safeNumber(rect.viewportWidth),
    viewportHeight: safeNumber(rect.viewportHeight),
    scrollX: safeNumber(rect.scrollX),
    scrollY: safeNumber(rect.scrollY),
    devicePixelRatio: safeNumber(rect.devicePixelRatio, 1),
  };
}

function hasUsableRect(rect = {}) {
  return safeNumber(rect.width) >= 16 && safeNumber(rect.height) >= 16;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function loadSharpOptional() {
  try {
    const mod = await import("sharp");
    return mod.default || mod;
  } catch {
    return null;
  }
}

async function cropWithSharp({ imageBuffer, selectedRect }) {
  const sharp = await loadSharpOptional();

  if (!sharp) {
    return {
      ok: false,
      message: "sharp is not installed; using full screenshot fallback",
    };
  }

  const image = sharp(imageBuffer);
  const meta = await image.metadata();

  const imgW = safeNumber(meta.width);
  const imgH = safeNumber(meta.height);

  if (!imgW || !imgH) {
    return {
      ok: false,
      message: "could not read screenshot dimensions",
    };
  }

  const rect = normalizeRect(selectedRect);
  const dpr = rect.devicePixelRatio || 1;

  let left = Math.round(rect.x * dpr);
  let top = Math.round(rect.y * dpr);
  let width = Math.round(rect.width * dpr);
  let height = Math.round(rect.height * dpr);

  left = clamp(left, 0, imgW - 1);
  top = clamp(top, 0, imgH - 1);
  width = clamp(width, 1, imgW - left);
  height = clamp(height, 1, imgH - top);

  const cropped = await sharp(imageBuffer)
    .extract({
      left,
      top,
      width,
      height,
    })
    .png()
    .toBuffer();

  const base64 = cropped.toString("base64");

  return {
    ok: true,
    mime: "image/png",
    base64,
    buffer: cropped,
    hash: compactHash(base64),
    cropBox: {
      left,
      top,
      width,
      height,
      imageWidth: imgW,
      imageHeight: imgH,
      devicePixelRatio: dpr,
    },
  };
}

function buildMarkedElementsText(markedElements = []) {
  const list = Array.isArray(markedElements) ? markedElements.slice(0, 12) : [];

  if (!list.length) return "No DOM elements were captured inside the marked box.";

  return list
    .map((item, index) => {
      return [
        `ELEMENT_${index + 1}`,
        `tag: ${clean(item.tagName || "")}`,
        `label: ${trimText(item.label || "", 240)}`,
        `text: ${trimText(item.text || "", 900)}`,
        `rect: ${JSON.stringify(item.rect || {})}`,
      ].join("\n");
    })
    .join("\n\n");
}

function buildFocusText({
  selectedRect = {},
  markedElements = [],
  platform = "unknown",
  timestampSeconds = 0,
  usedCrop = false,
  cropHash = "",
  screenshotHash = "",
  cropBox = null,
  cropMessage = "",
} = {}) {
  const rect = normalizeRect(selectedRect);

  return [
    "LIVE_TUTOR_VISION_FOCUS",
    `platform: ${platform}`,
    `timestampSeconds: ${timestampSeconds}`,
    `usedMarkedCrop: ${usedCrop}`,
    `screenshotHash: ${screenshotHash || "none"}`,
    `cropHash: ${cropHash || "none"}`,
    `cropMessage: ${cropMessage || "none"}`,
    "",
    "MARKED_RECT_CSS_VIEWPORT_COORDINATES",
    JSON.stringify(rect, null, 2),
    "",
    "CROP_BOX_IMAGE_PIXELS",
    cropBox ? JSON.stringify(cropBox, null, 2) : "(crop not available)",
    "",
    "DOM_ELEMENTS_INSIDE_MARKED_RECT",
    buildMarkedElementsText(markedElements),
    "",
    "Instruction for vision model:",
    usedCrop
      ? "The first image is the marked crop. Focus on it first. Use the full screenshot only as backup context."
      : "No crop was produced. Use the full screenshot, selectedRect coordinates, and DOM elements to infer the marked area.",
  ].join("\n");
}

export async function buildLiveTutorVisionPack({
  screenshotDataUrl = "",
  selectedRect = {},
  markedElements = [],
  platform = "unknown",
  timestampSeconds = 0,
} = {}) {
  const screenshot = parseDataUrl(screenshotDataUrl);
  const rect = normalizeRect(selectedRect);

  if (!screenshot.ok) {
    return {
      ok: false,
      hasImage: false,
      usedCrop: false,
      images: [],
      cropHash: "",
      screenshotHash: "",
      cropBox: null,
      focusText: buildFocusText({
        selectedRect: rect,
        markedElements,
        platform,
        timestampSeconds,
        usedCrop: false,
        cropMessage: screenshot.message || "no screenshot",
      }),
      message: screenshot.message || "No screenshot image was provided.",
    };
  }

  let crop = null;

  if (hasUsableRect(rect)) {
    crop = await cropWithSharp({
      imageBuffer: screenshot.buffer,
      selectedRect: rect,
    }).catch((error) => ({
      ok: false,
      message: error.message,
    }));
  }

  const usedCrop = Boolean(crop?.ok && crop.base64);

  const images = usedCrop
    ? [crop.base64, screenshot.base64]
    : [screenshot.base64];

  return {
    ok: true,
    hasImage: true,
    usedCrop,
    images,
    cropHash: usedCrop ? crop.hash : "",
    screenshotHash: screenshot.hash,
    cropBox: usedCrop ? crop.cropBox : null,
    focusText: buildFocusText({
      selectedRect: rect,
      markedElements,
      platform,
      timestampSeconds,
      usedCrop,
      cropHash: usedCrop ? crop.hash : "",
      screenshotHash: screenshot.hash,
      cropBox: usedCrop ? crop.cropBox : null,
      cropMessage: usedCrop ? "crop generated" : crop?.message || "crop unavailable",
    }),
    message: usedCrop
      ? "Marked crop generated."
      : crop?.message || "Using full screenshot fallback.",
  };
}

export default {
  buildLiveTutorVisionPack,
};
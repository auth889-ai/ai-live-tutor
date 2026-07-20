import { clean } from "./readinessDate.util.js";

export function inferMaterialKind({ title = "", url = "", mimeType = "", raw = {} } = {}) {
  const lowerTitle = clean(title).toLowerCase();
  const lowerUrl = clean(url).toLowerCase();
  const lowerMime = clean(mimeType).toLowerCase();

  if (lowerMime.includes("pdf") || lowerUrl.endsWith(".pdf") || lowerTitle.endsWith(".pdf")) {
    return "pdf";
  }

  if (
    lowerMime.includes("presentation") ||
    lowerMime.includes("powerpoint") ||
    lowerUrl.includes("/presentation/") ||
    lowerTitle.endsWith(".ppt") ||
    lowerTitle.endsWith(".pptx")
  ) {
    return "slide";
  }

  if (
    lowerMime.includes("spreadsheet") ||
    lowerUrl.includes("/spreadsheets/") ||
    lowerTitle.endsWith(".xls") ||
    lowerTitle.endsWith(".xlsx")
  ) {
    return "sheet";
  }

  if (
    lowerMime.includes("document") ||
    lowerMime.includes("word") ||
    lowerUrl.includes("/document/") ||
    lowerTitle.endsWith(".doc") ||
    lowerTitle.endsWith(".docx")
  ) {
    return "doc";
  }

  if (lowerMime.includes("image") || /\.(png|jpe?g|webp|gif)$/i.test(lowerUrl)) {
    return "image";
  }

  if (lowerUrl.includes("youtube.com") || lowerUrl.includes("youtu.be")) {
    return "youtube";
  }

  if (lowerUrl.includes("docs.google.com/forms") || raw?.form) {
    return "form";
  }

  if (raw?.driveFile || lowerUrl.includes("drive.google.com")) {
    return "drive_file";
  }

  if (lowerUrl) return "link";

  return "unknown";
}

export function normalizeClassroomMaterial(material = {}) {
  if (material.link) {
    const title = clean(material.link.title || material.link.url, "Classroom link");
    const url = clean(material.link.url);
    return {
      kind: inferMaterialKind({ title, url, raw: material }),
      title,
      url,
      alternateLink: url,
      driveFileId: "",
      mimeType: "",
      thumbnailUrl: clean(material.link.thumbnailUrl),
      source: "google_classroom",
      extractionStatus: "metadata_only",
      raw: material,
    };
  }

  if (material.youtubeVideo) {
    const title = clean(material.youtubeVideo.title, "YouTube video");
    const url = clean(material.youtubeVideo.alternateLink);
    return {
      kind: "youtube",
      title,
      url,
      alternateLink: url,
      driveFileId: "",
      mimeType: "",
      thumbnailUrl: clean(material.youtubeVideo.thumbnailUrl),
      source: "google_classroom",
      extractionStatus: "metadata_only",
      raw: material,
    };
  }

  if (material.driveFile?.driveFile) {
    const file = material.driveFile.driveFile;
    const title = clean(file.title || file.name, "Drive file");
    const url = clean(file.alternateLink || file.webViewLink);
    const mimeType = clean(file.mimeType);
    return {
      kind: inferMaterialKind({ title, url, mimeType, raw: material }),
      title,
      url,
      alternateLink: url,
      driveFileId: clean(file.id),
      mimeType,
      thumbnailUrl: clean(file.thumbnailUrl),
      source: "google_classroom",
      extractionStatus: "metadata_only",
      raw: material,
    };
  }

  if (material.form) {
    const title = clean(material.form.title, "Google Form");
    const url = clean(material.form.formUrl || material.form.responseUrl);
    return {
      kind: "form",
      title,
      url,
      alternateLink: url,
      driveFileId: "",
      mimeType: "",
      thumbnailUrl: clean(material.form.thumbnailUrl),
      source: "google_classroom",
      extractionStatus: "metadata_only",
      raw: material,
    };
  }

  return {
    kind: "unknown",
    title: "Unknown material",
    url: "",
    alternateLink: "",
    driveFileId: "",
    mimeType: "",
    thumbnailUrl: "",
    source: "google_classroom",
    extractionStatus: "metadata_only",
    raw: material,
  };
}

export function normalizeClassroomMaterials(materials = []) {
  if (!Array.isArray(materials)) return [];

  const normalized = materials.map(normalizeClassroomMaterial);

  const seen = new Set();
  return normalized.filter((item) => {
    const key = `${item.kind}:${item.driveFileId || item.url || item.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return item.title || item.url || item.driveFileId;
  });
}

export function buildMaterialsText(materials = []) {
  if (!Array.isArray(materials) || !materials.length) return "";

  return materials
    .map((item, index) => {
      const title = clean(item.title, `Material ${index + 1}`);
      const kind = clean(item.kind, "material");
      const url = clean(item.url || item.alternateLink);
      const extracted = clean(item.extractedText);

      const parts = [`${index + 1}. [${kind}] ${title}`];

      if (url) parts.push(`URL: ${url}`);
      if (extracted) parts.push(`Content: ${extracted.slice(0, 3000)}`);

      return parts.join("\n");
    })
    .join("\n\n");
}

export function mergeMaterials(existing = [], incoming = []) {
  const output = [];
  const seen = new Set();

  for (const item of [...existing, ...incoming]) {
    const key = `${item.kind || "unknown"}:${item.driveFileId || item.url || item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }

  return output;
}

export function extractRubricFromClassroomWork(work = {}) {
  const rubric = work.rubric || work.gradeCategory || null;

  if (!rubric) {
    return {
      title: "",
      points: Number(work.maxPoints || 0) || 0,
      criteria: [],
      raw: {},
    };
  }

  return {
    title: clean(rubric.title || work.title || "Rubric"),
    points: Number(work.maxPoints || rubric.points || 0) || 0,
    criteria: Array.isArray(rubric.criteria) ? rubric.criteria : [],
    raw: rubric,
  };
}
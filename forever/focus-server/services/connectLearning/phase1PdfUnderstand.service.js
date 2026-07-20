// server/services/connectLearning/phase1PdfUnderstand.service.js

import { extractPdfLearningContent } from "../pdfLearningExtractor.service.js";
import { compilePhase1Understanding } from "./learningCompiler.service.js";

function clean(value = "") {
  return String(value || "").trim();
}

function truncate(value = "", limit = 18000) {
  const text = String(value || "");
  return text.length > limit ? text.slice(0, limit) : text;
}

export async function runPhase1PdfUnderstand(input = {}) {
  const deviceId = clean(input.deviceId);
  const userId = clean(input.userId);
  const studyGoal = clean(input.studyGoal);
  const fileName = clean(input.fileName) || "Uploaded PDF";

  if (!deviceId) throw new Error("deviceId is required.");
  if (!input.buffer) throw new Error("PDF buffer is required.");

  const extracted = await extractPdfLearningContent(input.buffer, { fileName });

  const fullText = truncate(
    extracted.combinedText || extracted.text || "",
    Number(process.env.CONNECT_LEARNING_MAX_TEXT_CHARS || 18000)
  );

  if (!clean(fullText)) {
    throw new Error("PDF has no readable text. Use a text-based PDF or add OCR later.");
  }

  const compiled = await compilePhase1Understanding({
    text: fullText,
    fileName,
    studyGoal,
  });

  return {
    deviceId,
    userId,
    studyGoal,
    fileName,
    fileSize: Number(input.fileSize || 0),
    pdf: {
      fileName,
      fileSize: Number(input.fileSize || 0),
      pageCount: extracted.pageCount,
    },
    phase: 1,
    understanding: compiled.understanding,
    treePlan: compiled.plan,
    finalAnswer: "Phase 1 complete: document understanding generated.",
  };
}
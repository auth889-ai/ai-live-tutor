// server/services/pdfTree.graph.js

import { extractPdfLearningContent } from "./pdfLearningExtractor.service.js";
import { understandDocument } from "./connectLearning/documentUnderstanding.agent.js";
import {
  buildConceptGraphPhase2,
  printConceptGraph,
} from "./connectLearning/conceptGraph.agent.js";

function clean(value = "") {
  return String(value || "").trim();
}

function truncate(value = "", limit = 22000) {
  const text = String(value || "");
  return text.length > limit ? text.slice(0, limit) : text;
}

export async function runPdfTreeGraph(input = {}) {
  const deviceId = clean(input.deviceId);
  const userId = clean(input.userId);
  const studyGoal = clean(input.studyGoal);
  const fileName = clean(input.fileName) || "Uploaded PDF";

  if (!deviceId) throw new Error("deviceId is required.");
  if (!input.buffer) throw new Error("PDF buffer is required.");

  const extracted = await extractPdfLearningContent(input.buffer, { fileName });

  const pdfText = truncate(
    extracted.combinedText || extracted.text || "",
    Number(process.env.CONNECT_LEARNING_MAX_TEXT_CHARS || 22000)
  );

  if (!clean(pdfText)) {
    throw new Error("PDF has no readable text. Use text-based PDF or OCR later.");
  }

  const understanding = await understandDocument({
    text: pdfText,
    fileName,
    studyGoal,
  });

  const graph = await buildConceptGraphPhase2({
    understanding,
    pdfText,
    fileName,
    studyGoal,
  });

  printConceptGraph(graph);

  return {
    deviceId,
    userId,
    studyGoal,
    fileName,
    fileSize: Number(input.fileSize || 0),
    pdf: {
      fileName,
      fileSize: Number(input.fileSize || 0),
      pageCount: extracted.pageCount || 0,
    },
    pdfText,
    extracted,
    understanding,
    graph,
  };
}
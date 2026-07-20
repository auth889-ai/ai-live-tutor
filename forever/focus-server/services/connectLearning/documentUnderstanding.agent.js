// server/services/connectLearning/documentUnderstanding.agent.js

import { callOllamaJson } from "../ollamaCompat.service.js";

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function truncate(value = "", limit = 12000) {
  const text = String(value || "");
  return text.length > limit ? text.slice(0, limit) : text;
}

function keywordFallback(text = "", max = 20) {
  const stop = new Set([
    "this",
    "that",
    "with",
    "from",
    "into",
    "your",
    "will",
    "must",
    "have",
    "there",
    "their",
    "which",
    "where",
    "about",
    "after",
    "before",
    "using",
    "should",
    "would",
    "could",
    "page",
    "section",
    "chapter",
    "example",
    "figure",
    "table",
  ]);

  const freq = new Map();

  String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9+#\s-]/g, " ")
    .split(/\s+/)
    .map(clean)
    .filter((w) => w.length >= 4 && !stop.has(w))
    .forEach((w) => freq.set(w, (freq.get(w) || 0) + 1));

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([word]) => word);
}

function fallbackUnderstanding({ text = "", fileName = "", studyGoal = "" }) {
  const title =
    clean(studyGoal) ||
    clean(fileName.replace(/\.pdf$/i, "")) ||
    "Uploaded document";

  const keywords = keywordFallback(text, 20);

  return {
    detectedSubject: title,
    documentType: "academic learning document",
    studentLevel: "student",
    learningGoal: `Understand and study ${title}`,
    summary:
      "The AI could not fully infer the document yet, so this fallback uses extracted keywords and PDF text.",
    mainSkills: keywords.slice(0, 8),
    majorConcepts: keywords.slice(0, 12),
    assessmentTasks: [],
    importantTerms: keywords,
    prerequisiteConcepts: [],
    practicalOutputs: [],
    confidence: 0.35,
    needsBetterModelOrMoreText: true,
  };
}

function buildPrompt({ text = "", fileName = "", studyGoal = "" }) {
  return `
Return ONLY valid JSON. No markdown. No commentary.

You are Phase 1 of an advanced learning connector.

Your ONLY job:
Understand what this uploaded document is really about.

Do NOT create a tree.
Do NOT create videos.
Do NOT create resources.
Do NOT use fixed domain categories.
Infer the real subject naturally from the PDF itself.

Return this exact JSON shape:
{
  "detectedSubject": "",
  "documentType": "",
  "studentLevel": "",
  "learningGoal": "",
  "summary": "",
  "mainSkills": [],
  "majorConcepts": [],
  "assessmentTasks": [],
  "importantTerms": [],
  "prerequisiteConcepts": [],
  "practicalOutputs": [],
  "confidence": 0.0,
  "needsBetterModelOrMoreText": false
}

Quality rules:
1. detectedSubject must be specific, not generic.
2. learningGoal must describe what the student should learn.
3. mainSkills must be actionable skills.
4. majorConcepts must be concepts from the PDF, not random keywords.
5. assessmentTasks should include assignments, deliverables, scripts, questions, lab tasks, exam topics, or practice tasks if present.
6. practicalOutputs should include what the student must produce, implement, solve, write, design, or explain.

File name:
${fileName}

User study goal:
${studyGoal}

PDF text:
${truncate(text, 12000)}
`;
}

export async function understandDocument({ text = "", fileName = "", studyGoal = "" }) {
  const fallback = fallbackUnderstanding({ text, fileName, studyGoal });

  const result = await callOllamaJson(
    buildPrompt({ text, fileName, studyGoal }),
    fallback,
    {
      timeoutMs: process.env.CONNECT_LEARNING_OLLAMA_TIMEOUT_MS || "45m",
      temperature: 0.04,
      num_predict: 1800,
    }
  );

  return {
    detectedSubject: clean(result.detectedSubject) || fallback.detectedSubject,
    documentType: clean(result.documentType) || fallback.documentType,
    studentLevel: clean(result.studentLevel) || fallback.studentLevel,
    learningGoal: clean(result.learningGoal) || fallback.learningGoal,
    summary: clean(result.summary) || fallback.summary,
    mainSkills: safeList(result.mainSkills).map(clean).filter(Boolean).slice(0, 20),
    majorConcepts: safeList(result.majorConcepts).map(clean).filter(Boolean).slice(0, 30),
    assessmentTasks: safeList(result.assessmentTasks).map(clean).filter(Boolean).slice(0, 20),
    importantTerms: safeList(result.importantTerms).map(clean).filter(Boolean).slice(0, 30),
    prerequisiteConcepts: safeList(result.prerequisiteConcepts).map(clean).filter(Boolean).slice(0, 20),
    practicalOutputs: safeList(result.practicalOutputs).map(clean).filter(Boolean).slice(0, 20),
    confidence: Math.max(0, Math.min(1, Number(result.confidence || fallback.confidence))),
    needsBetterModelOrMoreText: Boolean(result.needsBetterModelOrMoreText),
  };
}

export function logDocumentUnderstanding(understanding = {}) {
  console.log("\n==============================");
  console.log("[DocumentUnderstanding]");
  console.log("subject=", understanding.detectedSubject);
  console.log("documentType=", understanding.documentType);
  console.log("studentLevel=", understanding.studentLevel);
  console.log("learningGoal=", understanding.learningGoal);
  console.log("confidence=", understanding.confidence);
  console.log("mainSkills=", understanding.mainSkills);
  console.log("majorConcepts=", understanding.majorConcepts);
  console.log("assessmentTasks=", understanding.assessmentTasks);
  console.log("practicalOutputs=", understanding.practicalOutputs);
  console.log("==============================\n");
}
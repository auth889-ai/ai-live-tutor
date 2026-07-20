import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import {
  callOllamaJson,
  checkOllamaHealth,
} from "./ollamaCompat.service.js";
import SyllabusCourse from "../models/SyllabusCourse.js";
import SyllabusDocument from "../models/SyllabusDocument.js";
import SyllabusDraft from "../models/SyllabusDraft.js";
import SyllabusCalendar from "../models/SyllabusCalendar.js";
import SyllabusPublicCalendar from "../models/SyllabusPublicCalendar.js";

let mammothModule = null;

async function getMammoth() {
  if (mammothModule) return mammothModule;
  try {
    mammothModule = await import("mammoth");
    return mammothModule;
  } catch {
    return null;
  }
}

const EVENT_TYPES = new Set([
  "assignment",
  "quiz",
  "exam",
  "final",
  "project",
  "office_hour",
  "class",
  "topic",
  "resource",
  "other",
]);

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function id(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function clamp01(value, fallback = 0.5) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function safeDate(value = "") {
  const text = clean(value);
  if (!text) return "";

  const m = text.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(
      m[3]
    ).padStart(2, "0")}`;
  }

  const d = new Date(text);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  return text;
}

function safeTime(value = "") {
  const text = clean(value);
  if (!text) return "";

  const m24 = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m24) return `${String(m24[1]).padStart(2, "0")}:${m24[2]}`;

  const m12 = text.match(
    /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(AM|PM|am|pm)\b/
  );

  if (m12) {
    let h = Number(m12[1]);
    const min = m12[2] || "00";
    const ap = m12[3].toLowerCase();

    if (ap === "pm" && h !== 12) h += 12;
    if (ap === "am" && h === 12) h = 0;

    return `${String(h).padStart(2, "0")}:${min}`;
  }

  return text;
}

function defaultReminderPlan(type = "other") {
  if (["exam", "final", "project"].includes(type)) {
    return ["14 days before", "7 days before", "3 days before", "1 day before"];
  }

  if (["assignment", "quiz"].includes(type)) {
    return ["7 days before", "3 days before", "1 day before"];
  }

  return ["1 day before"];
}

function normalizeEvent(event = {}, index = 0) {
  const type = EVENT_TYPES.has(String(event.type || "").toLowerCase())
    ? String(event.type).toLowerCase()
    : "other";

  const date = safeDate(event.date || event.startDate || event.dueDate || "");

  return {
    uid: clean(event.uid) || id("evt"),
    title: clean(event.title || event.name || `Syllabus Event ${index + 1}`),
    type,
    date,
    time: safeTime(event.time || event.startTime || ""),
    endDate: safeDate(event.endDate || ""),
    endTime: safeTime(event.endTime || ""),
    location: clean(event.location || ""),
    description: clean(event.description || event.details || ""),
    confidence: clamp01(event.confidence, date ? 0.72 : 0.45),
    sourceText: String(event.sourceText || event.evidence || "").slice(0, 900),
    reminderPlan: Array.isArray(event.reminderPlan)
      ? event.reminderPlan.map(clean).filter(Boolean).slice(0, 6)
      : defaultReminderPlan(type),
    needsReview: Boolean(
      event.needsReview || !date || clamp01(event.confidence, 0.5) < 0.72
    ),
  };
}

function normalizeParsed(ai = {}, fallback = {}) {
  const events = Array.isArray(ai.events) ? ai.events : [];
  const grading = Array.isArray(ai.grading) ? ai.grading : [];
  const officeHours = Array.isArray(ai.officeHours) ? ai.officeHours : [];
  const weeklyTopics = Array.isArray(ai.weeklyTopics) ? ai.weeklyTopics : [];
  const resources = Array.isArray(ai.resources) ? ai.resources : [];

  return {
    course: ai.course && typeof ai.course === "object" ? ai.course : fallback.course || {},

    events: events.map(normalizeEvent).filter((e) => e.title),

    grading: grading
      .map((g) => ({
        name: clean(g.name || g.title),
        weight: clean(g.weight || g.percent),
        sourceText: String(g.sourceText || "").slice(0, 700),
      }))
      .filter((g) => g.name || g.weight),

    officeHours: officeHours
      .map((o) => ({
        day: clean(o.day),
        time: clean(o.time),
        location: clean(o.location),
        sourceText: String(o.sourceText || "").slice(0, 700),
      }))
      .filter((o) => o.day || o.time),

    weeklyTopics: weeklyTopics
      .map((w, i) => ({
        week: Number(w.week) || i + 1,
        date: safeDate(w.date || ""),
        topic: clean(w.topic || w.title),
        sourceText: String(w.sourceText || "").slice(0, 700),
      }))
      .filter((w) => w.topic),

    resources: resources
      .map((r) => ({
        label: clean(r.label || r.title || r.url),
        url: clean(r.url || r.link),
        sourceText: String(r.sourceText || "").slice(0, 700),
      }))
      .filter((r) => r.label || r.url),

    warnings: Array.isArray(ai.warnings)
      ? ai.warnings.map(clean).filter(Boolean).slice(0, 12)
      : [],
  };
}

function makeCourseSnapshot(course = {}) {
  return {
    id: String(course._id || course.id || ""),
    university: course.university || "",
    department: course.department || "",
    courseCode: course.courseCode || "",
    courseTitle: course.courseTitle || "",
    semester: course.semester || "",
    section: course.section || "",
    instructor: course.instructor || "",
    timezone: course.timezone || "Asia/Dhaka",
  };
}

function monthNameToNumber(name = "") {
  const months = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };

  return months[String(name).toLowerCase()] || 0;
}

function inferYear(text = "", semester = "") {
  const match = `${text} ${semester}`.match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : new Date().getFullYear();
}

function fallbackParse(text = "", course = {}) {
  const raw = String(text || "");
  const year = inferYear(raw, course.semester);
  const lines = raw.split(/\n+/).map(clean).filter(Boolean);

  const events = [];
  const grading = [];
  const weeklyTopics = [];
  const officeHours = [];
  const resources = [];

  const datePatterns = [
    /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/g,
    /\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/g,
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s*(20\d{2})?\b/gi,
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s*(20\d{2})?\b/gi,
  ];

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (/https?:\/\//i.test(line)) {
      const url = line.match(/https?:\/\/\S+/i)?.[0] || "";
      resources.push({
        label: line.replace(url, "").trim() || url,
        url,
        sourceText: line,
      });
    }

    const grade = line.match(
      /([A-Za-z][A-Za-z\s\-/]{2,40})\s*[:\-]?\s*(\d{1,3})\s*%/
    );

    if (grade) {
      grading.push({
        name: clean(grade[1]),
        weight: `${grade[2]}%`,
        sourceText: line,
      });
    }

    if (/office\s*hours?|consultation/.test(lower)) {
      officeHours.push({
        day: "",
        time: line,
        location: "",
        sourceText: line,
      });
    }

    const week = line.match(/\bweek\s*(\d{1,2})\b[:\-]?\s*(.+)$/i);

    if (week) {
      weeklyTopics.push({
        week: Number(week[1]),
        topic: clean(week[2]),
        sourceText: line,
      });
    }

    let foundDate = "";

    for (const pattern of datePatterns) {
      pattern.lastIndex = 0;

      const m = pattern.exec(line);
      if (!m) continue;

      if (pattern.source.startsWith("\\b(20")) {
        foundDate = `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(
          m[3]
        ).padStart(2, "0")}`;
      } else if (pattern.source.startsWith("\\b(\\d")) {
        if (monthNameToNumber(m[2])) {
          foundDate = `${m[3] || year}-${String(
            monthNameToNumber(m[2])
          ).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
        } else {
          foundDate = `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(
            m[1]
          ).padStart(2, "0")}`;
        }
      } else {
        foundDate = `${m[3] || year}-${String(
          monthNameToNumber(m[1])
        ).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
      }

      break;
    }

    if (
      foundDate &&
      /(assign|quiz|exam|midterm|final|project|due|deadline|presentation|test|lab)/i.test(
        line
      )
    ) {
      let type = "other";

      if (/assign|due|deadline/i.test(line)) type = "assignment";
      if (/quiz/i.test(line)) type = "quiz";
      if (/exam|midterm|test/i.test(line)) type = "exam";
      if (/final/i.test(line)) type = "final";
      if (/project|presentation/i.test(line)) type = "project";

      events.push(
        normalizeEvent({
          title: line.slice(0, 90),
          type,
          date: foundDate,
          time: safeTime(line),
          confidence: 0.55,
          sourceText: line,
          needsReview: true,
        })
      );
    }
  }

  return normalizeParsed({
    course: makeCourseSnapshot(course),
    events,
    grading,
    weeklyTopics,
    officeHours,
    resources,
    warnings: events.length
      ? ["Fallback parser used. Please review all dates carefully."]
      : [
          "AI parser failed and fallback found few/no calendar dates. Paste clearer syllabus text or edit events manually.",
        ],
  });
}

async function extractTextFromFile(file = {}) {
  const mime = String(file.mimetype || "").toLowerCase();
  const ext = path.extname(file.originalname || file.path || "").toLowerCase();
  const buffer = await fs.readFile(file.path);

  if (mime.includes("pdf") || ext === ".pdf") {
    const parsed = await pdfParse(buffer);
    return { inputType: "pdf", rawText: parsed.text || "" };
  }

  if (mime.includes("word") || ext === ".docx") {
    const mammoth = await getMammoth();

    if (!mammoth) {
      throw new Error("DOCX support needs mammoth. Run: npm install mammoth");
    }

    const result = await mammoth.extractRawText({ buffer });
    return { inputType: "docx", rawText: result.value || "" };
  }

  const rawText = buffer.toString("utf8");
  return { inputType: "txt", rawText };
}

function buildParsePrompt({ course, text }) {
  return [
    "You are Syllabus Relay, an accurate university syllabus extraction agent.",
    "Extract structured calendar and course planning information from the syllabus text.",
    "Use only evidence from the provided syllabus. Do not invent deadlines.",
    "Dates must be ISO YYYY-MM-DD when possible. Times should be HH:mm 24-hour when possible.",
    "If a date/time is ambiguous, still include the item but set confidence below 0.72 and needsReview true.",
    "Return JSON only with this exact shape:",
    JSON.stringify({
      course: {
        courseCode: "",
        courseTitle: "",
        instructor: "",
        semester: "",
        section: "",
      },
      events: [
        {
          title: "",
          type: "assignment|quiz|exam|final|project|office_hour|class|topic|resource|other",
          date: "YYYY-MM-DD",
          time: "HH:mm",
          endDate: "",
          endTime: "",
          location: "",
          description: "",
          confidence: 0.9,
          sourceText: "exact evidence",
          needsReview: false,
        },
      ],
      grading: [
        {
          name: "Assignments",
          weight: "30%",
          sourceText: "exact evidence",
        },
      ],
      officeHours: [
        {
          day: "Wednesday",
          time: "14:00-16:00",
          location: "Room 302",
          sourceText: "exact evidence",
        },
      ],
      weeklyTopics: [
        {
          week: 1,
          date: "",
          topic: "Arrays and Lists",
          sourceText: "exact evidence",
        },
      ],
      resources: [
        {
          label: "Canvas",
          url: "https://...",
          sourceText: "exact evidence",
        },
      ],
      warnings: ["short user-facing warning if needed"],
    }),
    "Course profile supplied by student:",
    JSON.stringify(makeCourseSnapshot(course)),
    "Syllabus text:",
    String(text || "").slice(
      0,
      Number(process.env.SYLLABUS_RELAY_MAX_TEXT_CHARS || 55000)
    ),
  ].join("\n\n");
}

async function parseWithGemma({ course, text }) {
  const prompt = buildParsePrompt({ course, text });

  return callOllamaJson({
    prompt,
    system:
      "You extract university syllabus data into strict JSON for calendar generation.",
    model: process.env.SYLLABUS_RELAY_OLLAMA_MODEL || process.env.OLLAMA_MODEL,
    timeoutMs: Number(
      process.env.SYLLABUS_RELAY_OLLAMA_TIMEOUT_MS ||
        process.env.OLLAMA_TIMEOUT_MS ||
        300000
    ),
    num_ctx: Number(process.env.SYLLABUS_RELAY_NUM_CTX || 32768),
    num_predict: Number(process.env.SYLLABUS_RELAY_NUM_PREDICT || 8192),
    temperature: 0.05,
    allowLocalFallback: process.env.SYLLABUS_RELAY_LOCAL_FALLBACK !== "false",
    attempts: Number(process.env.SYLLABUS_RELAY_OLLAMA_RETRIES || 1),
  });
}

export async function health() {
  const ollama = await checkOllamaHealth({ timeoutMs: 5000 }).catch((e) => ({
    ok: false,
    error: e.message,
  }));

  return {
    feature: "syllabus-relay",
    mode: "hybrid-offline-online",
    localFirst: true,
    ollama,
    integrations: {
      googleCalendar: Boolean(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ),
      googleDrive: Boolean(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ),
      twilio: Boolean(
        process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
      ),
    },
  };
}

export async function createCourse(input = {}) {
  const course = await SyllabusCourse.create({
    userId: clean(input.userId),
    userEmail: clean(input.userEmail || input.email).toLowerCase(),
    university: clean(input.university),
    department: clean(input.department),
    courseCode: clean(input.courseCode),
    courseTitle: clean(input.courseTitle),
    semester: clean(input.semester),
    section: clean(input.section),
    instructor: clean(input.instructor),
    timezone: clean(input.timezone) || "Asia/Dhaka",
  });

  return { course };
}

export async function listCourses({ userId = "", q = "", limit = 30 } = {}) {
  const filter = {};

  if (userId) filter.userId = clean(userId);
  if (q) filter.$text = { $search: clean(q) };

  const courses = await SyllabusCourse.find(filter)
    .sort({ updatedAt: -1 })
    .limit(Math.min(Number(limit) || 30, 100))
    .lean();

  return { courses };
}

export async function getCourse(courseId) {
  const course = await SyllabusCourse.findById(courseId).lean();
  if (!course) throw new Error("Course not found.");

  const document = await SyllabusDocument.findOne({ courseId })
    .sort({ createdAt: -1 })
    .lean();

  const draft = await SyllabusDraft.findOne({ courseId })
    .sort({ version: -1, createdAt: -1 })
    .lean();

  const calendar = await SyllabusCalendar.findOne({ courseId }).lean();
  const publicCalendar = await SyllabusPublicCalendar.findOne({
    courseId,
  }).lean();

  return { course, document, draft, calendar, publicCalendar };
}

export async function uploadDocument({
  courseId,
  userId = "",
  file,
  text = "",
} = {}) {
  const course = await SyllabusCourse.findById(courseId);
  if (!course) throw new Error("Course not found.");

  let inputType = "text";
  let rawText = String(text || "");

  let docPayload = {
    courseId,
    userId: clean(userId),
    originalName: "pasted-syllabus.txt",
    filename: "",
    path: "",
    mimeType: "text/plain",
    sizeBytes: Buffer.byteLength(rawText),
    inputType,
  };

  if (file?.path) {
    const extracted = await extractTextFromFile(file);
    inputType = extracted.inputType;
    rawText = extracted.rawText;

    docPayload = {
      courseId,
      userId: clean(userId),
      originalName: file.originalname || "syllabus",
      filename: file.filename || "",
      path: file.path,
      mimeType: file.mimetype || "",
      sizeBytes: file.size || 0,
      inputType,
    };
  }

  if (!clean(rawText)) throw new Error("No readable syllabus text found.");

  const document = await SyllabusDocument.create({
    ...docPayload,
    rawText,
    textPreview: clean(rawText).slice(0, 1200),
    extractionStatus: "success",
  });

  course.status = "uploaded";
  await course.save();

  return { document, textPreview: document.textPreview };
}

export async function parseDocument({ documentId, userId = "" } = {}) {
  const document = await SyllabusDocument.findById(documentId);
  if (!document) throw new Error("Document not found.");

  const course = await SyllabusCourse.findById(document.courseId);
  if (!course) throw new Error("Course not found.");

  let parsed;
  let parseMode = "ai";
  let parseMeta = {};

  try {
    const ai = await parseWithGemma({ course, text: document.rawText });
    parseMeta = ai._meta || {};
    parsed = normalizeParsed(ai, { course: makeCourseSnapshot(course) });

    if (
      !parsed.events.length &&
      !parsed.grading.length &&
      !parsed.weeklyTopics.length
    ) {
      throw new Error("AI returned empty syllabus extraction.");
    }
  } catch (error) {
    const fallback = fallbackParse(document.rawText, course);
    parsed = fallback;
    parseMode = "fallback";
    parseMeta = { error: error.message, fallback: true };
  }

  const previous = await SyllabusDraft.findOne({ courseId: course._id }).sort({
    version: -1,
  });

  const version = previous ? previous.version + 1 : 1;
  const courseSnapshot = { ...makeCourseSnapshot(course), ...parsed.course };

  const draft = await SyllabusDraft.create({
    courseId: course._id,
    documentId: document._id,
    userId: clean(userId || document.userId),
    version,
    parseMode,
    parseMeta,
    courseSnapshot,
    events: parsed.events,
    grading: parsed.grading,
    officeHours: parsed.officeHours,
    weeklyTopics: parsed.weeklyTopics,
    resources: parsed.resources,
    warnings: parsed.warnings,
  });

  course.status = "draft";

  if (!course.courseCode && courseSnapshot.courseCode) {
    course.courseCode = courseSnapshot.courseCode;
  }

  if (!course.courseTitle && courseSnapshot.courseTitle) {
    course.courseTitle = courseSnapshot.courseTitle;
  }

  if (!course.instructor && courseSnapshot.instructor) {
    course.instructor = courseSnapshot.instructor;
  }

  await course.save();

  return { draft };
}

export async function getDraft(documentId) {
  const draft = await SyllabusDraft.findOne({ documentId })
    .sort({ version: -1 })
    .lean();

  if (!draft) throw new Error("Draft not found. Parse the document first.");

  return { draft };
}

export async function updateDraftEvent({ draftId, eventId, patch = {} } = {}) {
  const draft = await SyllabusDraft.findById(draftId);
  if (!draft) throw new Error("Draft not found.");

  const idx = draft.events.findIndex((e) => e.uid === eventId);
  if (idx < 0) throw new Error("Event not found.");

  const current = draft.events[idx].toObject
    ? draft.events[idx].toObject()
    : draft.events[idx];

  draft.events[idx] = normalizeEvent({ ...current, ...patch, uid: eventId }, idx);
  draft.status = "draft";

  await draft.save();

  return { draft };
}

export async function deleteDraftEvent({ draftId, eventId } = {}) {
  const draft = await SyllabusDraft.findById(draftId);
  if (!draft) throw new Error("Draft not found.");

  draft.events = draft.events.filter((e) => e.uid !== eventId);
  draft.status = "draft";

  await draft.save();

  return { draft };
}

export async function addDraftEvent({ draftId, event = {} } = {}) {
  const draft = await SyllabusDraft.findById(draftId);
  if (!draft) throw new Error("Draft not found.");

  draft.events.push(
    normalizeEvent(
      {
        ...event,
        uid: event.uid || id("evt"),
        confidence: event.confidence ?? 1,
        needsReview: false,
      },
      draft.events.length
    )
  );

  draft.status = "draft";

  await draft.save();

  return { draft };
}

export async function confirmDraft({ draftId } = {}) {
  const draft = await SyllabusDraft.findById(draftId);
  if (!draft) throw new Error("Draft not found.");

  draft.status = "confirmed";
  draft.confirmedAt = new Date();

  draft.events = draft.events.map((e, i) =>
    normalizeEvent(
      {
        ...(e.toObject ? e.toObject() : e),
        needsReview: false,
      },
      i
    )
  );

  await draft.save();

  await SyllabusCourse.findByIdAndUpdate(draft.courseId, {
    status: "confirmed",
  });

  return { draft };
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";

  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function generateTasks(events = []) {
  const tasks = [];

  for (const event of events) {
    if (
      !event.date ||
      !["assignment", "project", "exam", "final", "quiz"].includes(event.type)
    ) {
      continue;
    }

    const plan =
      event.type === "assignment"
        ? [
            [-7, "Read requirement and collect materials"],
            [-5, "Create solution outline"],
            [-3, "Finish first working draft"],
            [-1, "Final check and submit"],
          ]
        : event.type === "project"
        ? [
            [-14, "Break project into milestones"],
            [-10, "Build core part"],
            [-5, "Test and polish"],
            [-1, "Final review"],
          ]
        : [
            [-10, "Create revision checklist"],
            [-7, "Review weak topics"],
            [-3, "Practice questions"],
            [-1, "Light review and sleep early"],
          ];

    for (const [offset, label] of plan) {
      const date = addDays(event.date, offset);
      if (!date) continue;

      tasks.push({
        uid: id("task"),
        eventUid: event.uid,
        title: `${event.title}: ${label}`,
        date,
        type: "study_task",
        priority: offset >= -3 ? "high" : "medium",
        description: `Generated from ${event.type} deadline on ${event.date}.`,
      });
    }
  }

  return tasks.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function workloadSummary(events = [], tasks = []) {
  const weeks = new Map();

  for (const item of [...events, ...tasks]) {
    if (!item.date) continue;

    const d = new Date(`${item.date}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) continue;

    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - day);

    const key = d.toISOString().slice(0, 10);

    const current = weeks.get(key) || {
      weekStart: key,
      eventCount: 0,
      taskCount: 0,
      heavyReasons: [],
    };

    if (item.uid?.startsWith?.("task")) {
      current.taskCount += 1;
    } else {
      current.eventCount += 1;

      if (
        ["assignment", "quiz", "exam", "final", "project"].includes(item.type)
      ) {
        current.heavyReasons.push(`${item.type}: ${item.title}`);
      }
    }

    weeks.set(key, current);
  }

  const byWeek = [...weeks.values()]
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .map((w) => {
      const score = w.eventCount * 2 + w.taskCount;

      return {
        ...w,
        load: score >= 8 ? "Heavy" : score >= 4 ? "Medium" : "Light",
      };
    });

  return {
    byWeek,
    nextHeavyWeek: byWeek.find((w) => w.load === "Heavy") || null,
  };
}

function escapeIcs(text = "") {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function icsDate(date = "", time = "") {
  if (!date) return "";

  const cleanTime = safeTime(time);

  if (!cleanTime) return date.replace(/-/g, "");

  return `${date.replace(/-/g, "")}T${cleanTime.replace(":", "")}00`;
}

function buildIcs({ course, events = [], tasks = [] }) {
  const now = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

  const calName = escapeIcs(
    `${course.courseCode || "Course"} ${
      course.courseTitle || "Syllabus Relay"
    }`.trim()
  );

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//StudyLife//Syllabus Relay//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${calName}`,
  ];

  const add = (item, prefix = "event") => {
    if (!item.date) return;

    const start = icsDate(item.date, item.time);
    const end = item.endDate ? icsDate(item.endDate, item.endTime) : "";

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${prefix}-${item.uid}@syllabus-relay.local`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`${item.time ? "DTSTART" : "DTSTART;VALUE=DATE"}:${start}`);

    if (end) {
      lines.push(`${item.endTime ? "DTEND" : "DTEND;VALUE=DATE"}:${end}`);
    }

    lines.push(`SUMMARY:${escapeIcs(item.title)}`);

    if (item.description || item.sourceText) {
      lines.push(
        `DESCRIPTION:${escapeIcs(item.description || item.sourceText)}`
      );
    }

    if (item.location) lines.push(`LOCATION:${escapeIcs(item.location)}`);

    lines.push(`CATEGORIES:${escapeIcs(item.type || prefix)}`);
    lines.push("END:VEVENT");
  };

  events.forEach((e) => add(e, "event"));
  tasks.forEach((t) => add(t, "task"));

  lines.push("END:VCALENDAR");

  return `${lines.join("\r\n")}\r\n`;
}

export async function generateCalendar({ courseId } = {}) {
  const course = await SyllabusCourse.findById(courseId);
  if (!course) throw new Error("Course not found.");

  const draft = await SyllabusDraft.findOne({
    courseId,
    status: "confirmed",
  }).sort({ version: -1 });

  if (!draft) {
    throw new Error("Confirm the AI draft before generating calendar.");
  }

  const events = draft.events
    .map((e, i) => normalizeEvent(e.toObject ? e.toObject() : e, i))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const tasks = generateTasks(events);
  const workload = workloadSummary(events, tasks);
  const icsText = buildIcs({ course, events, tasks });

  const existing = await SyllabusCalendar.findOne({ courseId });
  const version = existing ? existing.version + 1 : 1;

  const calendar = await SyllabusCalendar.findOneAndUpdate(
    { courseId },
    {
      courseId,
      draftId: draft._id,
      userId: draft.userId,
      version,
      events,
      tasks,
      workload,
      icsText,
      generatedAt: new Date(),
    },
    { new: true, upsert: true }
  );

  return { calendar };
}

export async function getCalendar(courseId) {
  const calendar = await SyllabusCalendar.findOne({ courseId }).lean();
  if (!calendar) throw new Error("Calendar not generated yet.");

  return { calendar };
}

export async function getTasks(courseId) {
  const calendar = await SyllabusCalendar.findOne({ courseId }).lean();
  if (!calendar) throw new Error("Calendar not generated yet.");

  return {
    tasks: calendar.tasks || [],
    workload: calendar.workload || {},
  };
}

export async function exportIcs(courseId) {
  const course = await SyllabusCourse.findById(courseId).lean();
  const calendar = await SyllabusCalendar.findOne({ courseId }).lean();

  if (!calendar) throw new Error("Calendar not generated yet.");

  const filename = `${
    clean(course?.courseCode || "course").replace(/[^\w.-]+/g, "_") || "course"
  }-${
    clean(course?.semester || "calendar").replace(/[^\w.-]+/g, "_")
  }.ics`;

  return {
    icsText: calendar.icsText,
    filename,
  };
}

function trustLevel(count = 0) {
  if (count >= 10) return "High";
  if (count >= 3) return "Medium";
  return "Low";
}

function publicLookup(publicId = "") {
  const value = clean(publicId);
  const clauses = [{ publicSlug: value }];

  if (/^[a-f\d]{24}$/i.test(value)) clauses.push({ _id: value });

  return { $or: clauses };
}

function buildSearchText(course = {}) {
  return [
    course.university,
    course.department,
    course.courseCode,
    course.courseTitle,
    course.semester,
    course.section,
    course.instructor,
  ]
    .map(clean)
    .filter(Boolean)
    .join(" ");
}

export async function publishCourse({ courseId, userId = "" } = {}) {
  const course = await SyllabusCourse.findById(courseId);
  if (!course) throw new Error("Course not found.");

  const calendar = await SyllabusCalendar.findOne({ courseId });
  if (!calendar) throw new Error("Generate calendar before publishing.");

  const draft = await SyllabusDraft.findById(calendar.draftId);

  if (!draft || draft.status !== "confirmed") {
    throw new Error("Only confirmed calendars can be published.");
  }

  const slugBase =
    [course.university, course.courseCode, course.semester, course.section]
      .map(clean)
      .filter(Boolean)
      .join("-")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || id("course");

  const publicSlug = `${slugBase}-${String(course._id).slice(-6)}`;

  const payload = {
    courseId: course._id,
    calendarId: calendar._id,
    draftId: draft._id,
    ownerUserId: clean(userId || course.userId),
    publicSlug,
    version: calendar.version,
    status: "published",
    trustLevel: "Low",
    searchText: buildSearchText(course),
    courseSnapshot: makeCourseSnapshot(course),
    events: calendar.events,
    tasks: calendar.tasks,
    workload: calendar.workload,
    icsText: calendar.icsText,
  };

  const publicCalendar = await SyllabusPublicCalendar.findOneAndUpdate(
    { courseId },
    payload,
    { upsert: true, new: true }
  );

  course.status = "published";
  await course.save();

  return { publicCalendar };
}

export async function searchPublic({ q = "", limit = 20 } = {}) {
  const query = clean(q);
  const filter = query ? { $text: { $search: query } } : {};

  const calendars = await SyllabusPublicCalendar.find(filter)
    .sort({ vouchCount: -1, updatedAt: -1 })
    .limit(Math.min(Number(limit) || 20, 100))
    .lean();

  return { calendars };
}

export async function getPublic(publicId) {
  const publicCalendar = await SyllabusPublicCalendar.findOne(
    publicLookup(publicId)
  ).lean();

  if (!publicCalendar) throw new Error("Public calendar not found.");

  return { publicCalendar };
}

export async function downloadPublicIcs(publicId) {
  const { publicCalendar } = await getPublic(publicId);

  const filename = `${
    clean(publicCalendar.courseSnapshot?.courseCode || "course").replace(
      /[^\w.-]+/g,
      "_"
    ) || "course"
  }-public.ics`;

  return {
    icsText: publicCalendar.icsText,
    filename,
  };
}

export async function vouchPublic({
  publicId,
  userId = "",
  userEmail = "",
} = {}) {
  if (!clean(userId) && !clean(userEmail)) {
    throw new Error("Sign in is required to vouch.");
  }

  const publicCalendar = await SyllabusPublicCalendar.findOne(
    publicLookup(publicId)
  );

  if (!publicCalendar) throw new Error("Public calendar not found.");

  const key = clean(userId || userEmail).toLowerCase();

  const exists = publicCalendar.vouches.some(
    (v) => clean(v.userId || v.userEmail).toLowerCase() === key
  );

  if (!exists) {
    publicCalendar.vouches.push({
      userId: clean(userId),
      userEmail: clean(userEmail).toLowerCase(),
      vouchedAt: new Date(),
    });
  }

  publicCalendar.vouchCount = publicCalendar.vouches.length;
  publicCalendar.trustLevel = trustLevel(publicCalendar.vouchCount);

  if (publicCalendar.status === "needs_reverification") {
    publicCalendar.status = "published";
  }

  await publicCalendar.save();

  return { publicCalendar };
}

export async function editPublicEvent({
  publicId,
  eventId,
  patch = {},
  editor = {},
} = {}) {
  const publicCalendar = await SyllabusPublicCalendar.findOne(
    publicLookup(publicId)
  );

  if (!publicCalendar) throw new Error("Public calendar not found.");

  const idx = publicCalendar.events.findIndex((e) => e.uid === eventId);
  if (idx < 0) throw new Error("Event not found.");

  const before = publicCalendar.events[idx];

  publicCalendar.events[idx] = normalizeEvent(
    {
      ...before,
      ...patch,
      uid: eventId,
    },
    idx
  );

  publicCalendar.version += 1;
  publicCalendar.vouches = [];
  publicCalendar.vouchCount = 0;
  publicCalendar.trustLevel = "Low";
  publicCalendar.status = "needs_reverification";

  publicCalendar.editHistory.push({
    at: new Date(),
    eventId,
    before,
    after: publicCalendar.events[idx],
    editor,
  });

  publicCalendar.icsText = buildIcs({
    course: publicCalendar.courseSnapshot,
    events: publicCalendar.events,
    tasks: publicCalendar.tasks,
  });

  await publicCalendar.save();

  return { publicCalendar };
}

export async function googleSync({ courseId } = {}) {
  if (!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)) {
    return {
      ok: false,
      code: "integration_not_configured",
      message: "Google Calendar is not configured yet.",
    };
  }

  return {
    ok: false,
    code: "oauth_not_connected",
    message:
      "Google OAuth token connection is not implemented in this MVP yet. ICS export is ready now.",
  };
}

export async function driveCreateFolders({ courseId } = {}) {
  if (!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)) {
    return {
      ok: false,
      code: "integration_not_configured",
      message: "Google Drive is not configured yet.",
    };
  }

  const course = await SyllabusCourse.findById(courseId).lean();

  return {
    ok: false,
    code: "oauth_not_connected",
    message: "Google Drive OAuth token connection is not implemented yet.",
    plannedFolders: [
      "StudyLife",
      course?.semester || "Semester",
      `${course?.courseCode || "Course"} - ${
        course?.courseTitle || "Syllabus"
      }`,
      "Syllabus",
      "Assignments",
      "Exams",
      "Notes",
      "Resources",
    ],
  };
}

export async function smsSchedule({ courseId } = {}) {
  if (!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)) {
    return {
      ok: false,
      code: "integration_not_configured",
      message: "Twilio SMS is not configured yet.",
    };
  }

  const calendar = await SyllabusCalendar.findOne({ courseId }).lean();

  return {
    ok: false,
    code: "sms_worker_not_enabled",
    message:
      "Twilio credentials exist, but reminder worker is not enabled yet.",
    remindersPlanned: calendar?.events?.length || 0,
  };
}
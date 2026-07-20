import crypto from "crypto";
import { google } from "googleapis";

import ReadinessDeadline from "../../models/ReadinessDeadline.js";
import ReadinessGoogleToken from "../../models/ReadinessGoogleToken.js";

import {
  normalizeTimezone,
  zonedDateTimeToDate,
  formatDateInTimezone,
} from "../readiness/readinessTimezone.util.js";

const DEFAULT_TIMEZONE = process.env.READINESS_DEFAULT_TIMEZONE || "Asia/Dhaka";
const DEFAULT_CLASS_TIME = process.env.READINESS_DEFAULT_CLASS_TIME || "10:00";
const DEFAULT_IMPORT_YEAR = Number(process.env.READINESS_IMPORT_YEAR || new Date().getFullYear());

const CLASSROOM_SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.students.readonly",
  "https://www.googleapis.com/auth/classroom.announcements.readonly",
  "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

const MONTHS = {
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

function clean(value = "", fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function makeError(message, status = 500, code = "google_classroom_error") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizeText(text = "") {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function compactText(text = "") {
  return normalizeText(text).replace(/\s+/g, " ").trim();
}

function base64UrlEncodeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function base64UrlDecodeJson(value = "") {
  try {
    return JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function createOAuthClient() {
  if (!process.env.GOOGLE_CLIENT_ID) {
    throw makeError("GOOGLE_CLIENT_ID missing in .env", 500, "google_config_missing");
  }

  if (!process.env.GOOGLE_CLIENT_SECRET) {
    throw makeError("GOOGLE_CLIENT_SECRET missing in .env", 500, "google_config_missing");
  }

  if (!process.env.GOOGLE_REDIRECT_URI) {
    throw makeError("GOOGLE_REDIRECT_URI missing in .env", 500, "google_config_missing");
  }

  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

async function getOAuthClientForUser(userId) {
  const token = await ReadinessGoogleToken.findOne({ userId });

  if (!token?.accessToken && !token?.refreshToken) {
    throw makeError(
      "Google Classroom is not connected. Connect Google first.",
      401,
      "google_not_connected"
    );
  }

  const client = createOAuthClient();

  client.setCredentials({
    access_token: token.accessToken || undefined,
    refresh_token: token.refreshToken || undefined,
    expiry_date: token.expiryDate || undefined,
    token_type: token.tokenType || "Bearer",
    scope: token.scope || undefined,
  });

  client.on("tokens", async (tokens) => {
    const patch = {};

    if (tokens.access_token) patch.accessToken = tokens.access_token;
    if (tokens.refresh_token) patch.refreshToken = tokens.refresh_token;
    if (tokens.expiry_date) patch.expiryDate = tokens.expiry_date;
    if (tokens.token_type) patch.tokenType = tokens.token_type;
    if (tokens.scope) patch.scope = tokens.scope;

    if (Object.keys(patch).length) {
      await ReadinessGoogleToken.updateOne(
        { userId },
        {
          $set: {
            ...patch,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );
    }
  });

  return client;
}

async function getTokenScopeDebug(client) {
  try {
    const access = await client.getAccessToken();
    const token = typeof access === "string" ? access : access?.token;

    if (!token) {
      return {
        ok: false,
        scopes: [],
        message: "Could not read Google access token for scope debug.",
      };
    }

    const info = await client.getTokenInfo(token);

    return {
      ok: true,
      scopes: String(info.scopes || "")
        .split(/\s+/)
        .map((scope) => scope.trim())
        .filter(Boolean),
      expiryDate: info.expiry_date || null,
    };
  } catch (error) {
    return {
      ok: false,
      scopes: [],
      message: error.message,
    };
  }
}

function currentYearForImport(referenceDate = new Date()) {
  const year = Number(referenceDate.getFullYear());
  return Number.isFinite(year) ? year : DEFAULT_IMPORT_YEAR;
}

function googleDateToDate(dueDate, dueTime, timezone = DEFAULT_TIMEZONE) {
  if (!dueDate?.year || !dueDate?.month || !dueDate?.day) return null;

  const safeTimezone = normalizeTimezone(timezone, DEFAULT_TIMEZONE);
  const hours = safeNumber(dueTime?.hours, 23);
  const minutes = safeNumber(dueTime?.minutes, 59);

  const dateText = `${dueDate.year}-${String(dueDate.month).padStart(2, "0")}-${String(
    dueDate.day
  ).padStart(2, "0")}`;

  const timeText = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

  return zonedDateTimeToDate(dateText, timeText, safeTimezone);
}

function dueTimeText(dueTime, fallback = "23:59") {
  if (!dueTime) return fallback;

  const hours = Number.isFinite(Number(dueTime.hours)) ? Number(dueTime.hours) : 23;
  const minutes = Number.isFinite(Number(dueTime.minutes)) ? Number(dueTime.minutes) : 59;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function startOfDateInTimezone(date, timezone = DEFAULT_TIMEZONE) {
  const safeTimezone = normalizeTimezone(timezone, DEFAULT_TIMEZONE);
  const ymd = formatDateInTimezone(date, safeTimezone);
  return zonedDateTimeToDate(ymd, "00:00", safeTimezone);
}

function endOfDateInTimezone(date, timezone = DEFAULT_TIMEZONE) {
  const safeTimezone = normalizeTimezone(timezone, DEFAULT_TIMEZONE);
  const ymd = formatDateInTimezone(date, safeTimezone);
  return zonedDateTimeToDate(ymd, "23:59", safeTimezone);
}

function inferCourseCodeFromText(text = "") {
  const value = compactText(text);

  const patterns = [
    /\b([A-Z]{2,5}\s*[-]?\s*\d{3,4})\b/i,
    /\b(CSE|SWE|EEE|BBA|CEE|MPE|MAT|PHY|CHEM|HUM)\s*[-]?\s*(\d{3,4})\b/i,
    /\bCourse\s*Code\s*[:\-]\s*([A-Z]{2,5}\s*[-]?\s*\d{3,4})\b/i,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1] && match?.[2]) {
      return `${String(match[1]).toUpperCase()} ${match[2]}`.replace(/\s+/g, " ").trim();
    }
    if (match?.[1]) {
      return String(match[1]).toUpperCase().replace(/\s+/g, " ").trim();
    }
  }

  return "";
}

function normalizeCourseCode(course = {}, sourceText = "") {
  const fromText = inferCourseCodeFromText(sourceText);
  if (fromText) return fromText;

  const section = clean(course.section);
  const sectionCode = inferCourseCodeFromText(section);
  if (sectionCode) return sectionCode;

  const name = clean(course.name);
  const nameCode = inferCourseCodeFromText(name);
  if (nameCode) return nameCode;

  if (name.includes(":")) {
    const beforeColon = name.split(":")[0].trim();
    const beforeColonCode = inferCourseCodeFromText(beforeColon);
    if (beforeColonCode) return beforeColonCode;
    if (beforeColon.length <= 20) return beforeColon;
  }

  return section || clean(course.id, "Google Classroom");
}

function normalizeCourseTitle(course = {}, sourceText = "") {
  const text = compactText(sourceText);

  const titlePatterns = [
    /\bCourse\s*Title\s*[:\-]\s*([^,;\n]+)/i,
    /\bSubject\s*[:\-]\s*([^,;\n]+)/i,
  ];

  for (const pattern of titlePatterns) {
    const match = text.match(pattern);
    if (match?.[1]) return clean(match[1]);
  }

  return clean(course.name, clean(course.descriptionHeading, "Google Classroom Course"));
}

function inferTypeFromText(text = "", fallback = "assignment") {
  const value = String(text || "").toLowerCase();

  if (/\b(final|midterm|mid term|exam|examination)\b/.test(value)) return "exam";
  if (/\b(quiz|mcq|test|assessment|viva|class test|ct)\b/.test(value)) return "quiz";
  if (/\b(lab|practical)\b/.test(value)) return "lab";
  if (/\b(project)\b/.test(value)) return "project";
  if (/\b(presentation|slide deck)\b/.test(value)) return "presentation";
  if (/\b(assignment|homework|task|submission|submit|due)\b/.test(value)) return "assignment";

  return fallback;
}

function inferTypeFromCourseWork(work = {}) {
  const type = String(work.workType || "").toUpperCase();
  const title = `${work.title || ""} ${work.description || ""}`;

  if (type.includes("MULTIPLE_CHOICE") || type.includes("SHORT_ANSWER")) {
    return inferTypeFromText(title, "quiz");
  }

  return inferTypeFromText(title, "assignment");
}

function extractTitleFromText(text = "", fallback = "Google Classroom deadline") {
  const source = normalizeText(text);
  const compact = compactText(source);

  const lines = source
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const first = lines[0] || fallback;

  const patterns = [
    /\b(quiz\s*[-#:]?\s*\d+)\b/i,
    /\b(class\s*test\s*[-#:]?\s*\d+)\b/i,
    /\b(ct\s*[-#:]?\s*\d+)\b/i,
    /\b(test\s*[-#:]?\s*\d+)\b/i,
    /\b(midterm|mid term)\b/i,
    /\b(final\s*(exam)?)\b/i,
    /\b(exam\s*[-#:]?\s*\d*)\b/i,
    /\b(assignment\s*[-#:]?\s*\d+)\b/i,
    /\b(project\s*[-#:]?\s*\d*)\b/i,
    /\b(lab\s*[-#:]?\s*\d*)\b/i,
    /\b(presentation\s*[-#:]?\s*\d*)\b/i,
  ];

  for (const pattern of patterns) {
    const match = first.match(pattern) || compact.match(pattern);
    if (match?.[1]) {
      return clean(match[1], fallback).replace(/\s+/g, " ").trim();
    }
  }

  const heldMatch = compact.match(/\b(.{0,45}?(quiz|test|exam|assignment|lab|project|presentation).{0,25}?)\s+(will be held|will be taken|is scheduled|due|deadline)/i);
  if (heldMatch?.[1]) {
    return clean(heldMatch[1], fallback).slice(0, 80);
  }

  if (first.length <= 80) return first;
  return first.slice(0, 77).trim() + "...";
}

function extractTopics(text = "", title = "") {
  const source = normalizeText(text);
  const lines = source
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const topics = [];
  let topicMode = false;

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (/^(syllabus|topics?|covered topics?|chapters?|lectures?|materials?|slides?)\s*:?\s*$/i.test(line)) {
      topicMode = true;
      continue;
    }

    if (/^(syllabus|topics?|covered topics?|chapters?|lectures?|materials?|slides?)\s*:/i.test(line)) {
      const afterColon = line.split(":").slice(1).join(":").trim();

      if (afterColon) {
        afterColon
          .split(/[,;|]/)
          .map((item) => item.trim())
          .filter(Boolean)
          .forEach((item) => topics.push(item));
      }

      topicMode = true;
      continue;
    }

    if (topicMode) {
      const looksTopic =
        /\b(week|chapter|slide|slides|lecture|module|unit|topic|verification|validation|testing|intro|introduction|recursion|array|tree|graph|uml|srs|design|requirement)\b/i.test(
          line
        ) || /^[*-]\s+/.test(line);

      if (looksTopic) {
        topics.push(line.replace(/^[*-]\s+/, "").trim());
        continue;
      }

      if (/^(due|deadline|submit|quiz|exam|test|assignment|project|class|date|time)\b/i.test(lower)) {
        topicMode = false;
      }
    }

    const inlineMatches = line.match(
      /\b(Week\s*\d+\s*(slide|slides|lecture|chapter)?|Chapter\s*\d+|Lecture\s*\d+|Slide\s*\d+)\b/gi
    );

    if (inlineMatches) {
      inlineMatches.forEach((match) => topics.push(match.trim()));
    }
  }

  const compact = compactText(source);

  const syllabusInline = compact.match(/\bSyllabus\s*[:\-]\s*(.{1,220})/i);
  if (syllabusInline?.[1]) {
    syllabusInline[1]
      .split(/[,;|]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => topics.push(item));
  }

  const cleaned = [...new Set(topics.map((topic) => clean(topic)).filter(Boolean))];

  if (cleaned.length) return cleaned.slice(0, 20);

  if (title && /\bweek\s*\d+/i.test(title)) return [title];

  return [];
}

function parseMonthNameDate(text = "", referenceDate = new Date()) {
  const value = compactText(text);
  const fallbackYear = currentYearForImport(referenceDate);

  const dayMonthYear = value.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?[\s,(/.-]+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:[\s,)/.-]+(\d{4}))?\b/i
  );

  if (dayMonthYear) {
    const day = Number(dayMonthYear[1]);
    const month = MONTHS[String(dayMonthYear[2]).toLowerCase()];
    const year = Number(dayMonthYear[3] || fallbackYear);

    if (day >= 1 && day <= 31 && month && year) {
      return new Date(year, month - 1, day, 23, 59, 0, 0);
    }
  }

  const monthDayYear = value.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[\s,(/.-]+(\d{1,2})(?:st|nd|rd|th)?(?:[\s,)/.-]+(\d{4}))?\b/i
  );

  if (monthDayYear) {
    const month = MONTHS[String(monthDayYear[1]).toLowerCase()];
    const day = Number(monthDayYear[2]);
    const year = Number(monthDayYear[3] || fallbackYear);

    if (day >= 1 && day <= 31 && month && year) {
      return new Date(year, month - 1, day, 23, 59, 0, 0);
    }
  }

  return null;
}

function parseNumericDate(text = "", referenceDate = new Date()) {
  const value = compactText(text);
  const fallbackYear = currentYearForImport(referenceDate);

  const ymdMatch = value.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);

  if (ymdMatch) {
    const year = Number(ymdMatch[1]);
    const month = Number(ymdMatch[2]);
    const day = Number(ymdMatch[3]);

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(year, month - 1, day, 23, 59, 0, 0);
    }
  }

  const dmyWithYear = value.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/);

  if (dmyWithYear) {
    const day = Number(dmyWithYear[1]);
    const month = Number(dmyWithYear[2]);
    const year = Number(dmyWithYear[3]);

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(year, month - 1, day, 23, 59, 0, 0);
    }
  }

  const dmyNoYear = value.match(/\b(\d{1,2})[-/](\d{1,2})\b/);

  if (dmyNoYear) {
    const day = Number(dmyNoYear[1]);
    const month = Number(dmyNoYear[2]);
    const year = fallbackYear;

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(year, month - 1, day, 23, 59, 0, 0);
    }
  }

  return null;
}

function parseDateFromText(text = "", referenceDate = new Date()) {
  return parseMonthNameDate(text, referenceDate) || parseNumericDate(text, referenceDate);
}

function parseTime(text = "", fallback = "23:59") {
  const value = compactText(text);

  const ampm = value.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/i);

  if (ampm) {
    let hour = Number(ampm[1]);
    const minute = Number(ampm[2] || 0);
    const marker = ampm[3].toLowerCase();

    if (marker === "pm" && hour < 12) hour += 12;
    if (marker === "am" && hour === 12) hour = 0;

    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  const time24 = value.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);

  if (time24) {
    return `${String(Number(time24[1])).padStart(2, "0")}:${time24[2]}`;
  }

  if (/\b(during class time|in class|class hour|class time|during lecture|regular class)\b/i.test(value)) {
    return DEFAULT_CLASS_TIME;
  }

  return fallback;
}

function shouldTreatTextAsDeadline(text = "") {
  const value = compactText(text);

  if (!parseDateFromText(value)) return false;

  return /\b(quiz|test|class test|ct|exam|midterm|mid term|final|assignment|homework|project|lab|deadline|due|held|scheduled|submission|submit|presentation|viva|will be held|will be taken|syllabus)\b/i.test(
    value
  );
}

function buildDescriptionFromPost({ kind, text, course, raw, topics = [] }) {
  return [
    `Imported from Google Classroom ${kind}.`,
    `Course: ${course?.name || ""}`,
    topics.length ? `Topics/Syllabus: ${topics.join(", ")}` : "",
    "",
    clean(text),
    "",
    raw?.alternateLink ? `Link: ${raw.alternateLink}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function deadlineQuery({ userId, source, courseCode, title, dueDate, timezone }) {
  const safeTimezone = normalizeTimezone(timezone, DEFAULT_TIMEZONE);

  return {
    userId,
    source,
    courseCode,
    title,
    dueDate: {
      $gte: startOfDateInTimezone(dueDate, safeTimezone),
      $lte: endOfDateInTimezone(dueDate, safeTimezone),
    },
  };
}

async function upsertCalendar1Deadline(payload) {
  const dueDate =
    payload.dueDate instanceof Date ? payload.dueDate : new Date(payload.dueDate);

  if (!dueDate || Number.isNaN(dueDate.getTime())) {
    return {
      created: false,
      updated: false,
      skipped: true,
      reason: "invalid_due_date",
      deadline: null,
    };
  }

  const source = "google_classroom";
  const timezone = normalizeTimezone(payload.timezone, DEFAULT_TIMEZONE);
  const courseCode = clean(payload.courseCode, "Google Classroom");
  const title = clean(payload.title, "Google Classroom deadline");

  const existing = await ReadinessDeadline.findOne(
    deadlineQuery({
      userId: payload.userId,
      source,
      courseCode,
      title,
      dueDate,
      timezone,
    })
  );

  const patch = {
    userId: payload.userId,
    source,
    university: clean(payload.university),
    department: clean(payload.department),
    courseCode,
    courseTitle: clean(payload.courseTitle),
    section: clean(payload.section),
    instructor: clean(payload.instructor),
    title,
    type: clean(payload.type, "assignment"),
    dueDate,
    dueTime: clean(payload.dueTime, "23:59"),
    timezone,
    topics: Array.isArray(payload.topics) ? payload.topics.filter(Boolean) : [],
    difficulty: safeNumber(payload.difficulty, 3),
    estimatedHours: safeNumber(payload.estimatedHours, 3),
    weightPercent: safeNumber(payload.weightPercent, 0),
    description: clean(payload.description),
    materialsText: clean(payload.materialsText),
    url: clean(payload.url),
    status: "active",
  };

  if (existing) {
    Object.assign(existing, patch);
    await existing.save();

    return {
      created: false,
      updated: true,
      skipped: false,
      reason: "",
      deadline: existing,
    };
  }

  const deadline = await ReadinessDeadline.create(patch);

  return {
    created: true,
    updated: false,
    skipped: false,
    reason: "",
    deadline,
  };
}

async function listAllCourses(classroom, options = {}) {
  const courses = [];
  let pageToken = undefined;

  do {
    const response = await classroom.courses.list({
      pageSize: 100,
      pageToken,
      courseStates: options.courseStates || ["ACTIVE"],
    });

    courses.push(...(response.data.courses || []));
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return courses;
}

async function listAllCourseWork(classroom, courseId) {
  const items = [];
  let pageToken = undefined;

  do {
    const response = await classroom.courses.courseWork.list({
      courseId,
      pageSize: 100,
      pageToken,
      courseWorkStates: ["PUBLISHED"],
      orderBy: "updateTime desc",
    });

    items.push(...(response.data.courseWork || []));
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return items;
}

async function listAllAnnouncementsViaGoogleApis(classroom, courseId) {
  const items = [];
  let pageToken = undefined;

  do {
    const response = await classroom.courses.announcements.list({
      courseId,
      pageSize: 100,
      pageToken,
      orderBy: "updateTime desc",
    });

    items.push(...(response.data.announcements || []));
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return items;
}

async function listAllAnnouncementsViaRest(client, courseId) {
  const items = [];
  let pageToken = "";

  do {
    const response = await client.request({
      url: `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(
        courseId
      )}/announcements`,
      method: "GET",
      params: {
        pageSize: 100,
        pageToken: pageToken || undefined,
        orderBy: "updateTime desc",
      },
    });

    items.push(...(response.data.announcements || []));
    pageToken = response.data.nextPageToken || "";
  } while (pageToken);

  return items;
}

async function listAllAnnouncements({ classroom, client, courseId }) {
  const errors = [];

  try {
    const items = await listAllAnnouncementsViaGoogleApis(classroom, courseId);
    return { items, method: "googleapis", errors };
  } catch (error) {
    errors.push({
      method: "googleapis",
      message: error.message,
      code: error.code,
      status: error.status,
    });
  }

  try {
    const items = await listAllAnnouncementsViaRest(client, courseId);
    return { items, method: "rest", errors };
  } catch (error) {
    errors.push({
      method: "rest",
      message: error.message,
      code: error.code,
      status: error.status,
    });
  }

  return { items: [], method: "failed", errors };
}

async function listAllMaterialsViaGoogleApis(classroom, courseId) {
  const items = [];
  let pageToken = undefined;

  do {
    const response = await classroom.courses.courseWorkMaterials.list({
      courseId,
      pageSize: 100,
      pageToken,
      orderBy: "updateTime desc",
    });

    items.push(...(response.data.courseWorkMaterial || []));
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return items;
}

async function listAllMaterialsViaRest(client, courseId) {
  const items = [];
  let pageToken = "";

  do {
    const response = await client.request({
      url: `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(
        courseId
      )}/courseWorkMaterials`,
      method: "GET",
      params: {
        pageSize: 100,
        pageToken: pageToken || undefined,
        orderBy: "updateTime desc",
      },
    });

    items.push(...(response.data.courseWorkMaterial || []));
    pageToken = response.data.nextPageToken || "";
  } while (pageToken);

  return items;
}

async function listAllCourseWorkMaterials({ classroom, client, courseId }) {
  const errors = [];

  try {
    const items = await listAllMaterialsViaGoogleApis(classroom, courseId);
    return { items, method: "googleapis", errors };
  } catch (error) {
    errors.push({
      method: "googleapis",
      message: error.message,
      code: error.code,
      status: error.status,
    });
  }

  try {
    const items = await listAllMaterialsViaRest(client, courseId);
    return { items, method: "rest", errors };
  } catch (error) {
    errors.push({
      method: "rest",
      message: error.message,
      code: error.code,
      status: error.status,
    });
  }

  return { items: [], method: "failed", errors };
}

function normalizeCourseWorkDeadline({ userId, course, work, timezone }) {
  const safeTimezone = normalizeTimezone(timezone, DEFAULT_TIMEZONE);
  const dueDate = googleDateToDate(work.dueDate, work.dueTime, safeTimezone);

  if (!dueDate) return null;

  const title = clean(work.title, "Google Classroom coursework");
  const text = `${work.title || ""}\n${work.description || ""}`;
  const type = inferTypeFromCourseWork(work);
  const topics = extractTopics(text, title);

  return {
    userId,
    source: "google_classroom",
    university: "",
    department: "",
    courseCode: normalizeCourseCode(course, text),
    courseTitle: normalizeCourseTitle(course, text),
    section: clean(course.section),
    instructor: "",
    title,
    type,
    dueDate,
    dueTime: dueTimeText(work.dueTime),
    timezone: safeTimezone,
    topics,
    difficulty: type === "exam" || type === "quiz" ? 4 : 3,
    estimatedHours: type === "exam" ? 6 : type === "quiz" ? 3 : 4,
    weightPercent: 0,
    description: buildDescriptionFromPost({
      kind: "coursework",
      text: work.description || title,
      course,
      raw: work,
      topics,
    }),
    materialsText: work.description || "",
    url: work.alternateLink || "",
  };
}

function normalizeAnnouncementDeadline({ userId, course, announcement, timezone }) {
  const text = normalizeText(announcement.text);

  if (!shouldTreatTextAsDeadline(text)) return null;

  const safeTimezone = normalizeTimezone(timezone, DEFAULT_TIMEZONE);
  const referenceDate = announcement.updateTime ? new Date(announcement.updateTime) : new Date();
  const parsedDate = parseDateFromText(text, referenceDate);

  if (!parsedDate) return null;

  const type = inferTypeFromText(text, "quiz");
  const dueTime = parseTime(
    text,
    type === "quiz" || type === "exam" ? DEFAULT_CLASS_TIME : "23:59"
  );

  const dateOnlyText = `${parsedDate.getFullYear()}-${String(
    parsedDate.getMonth() + 1
  ).padStart(2, "0")}-${String(parsedDate.getDate()).padStart(2, "0")}`;

  const dueDate = zonedDateTimeToDate(dateOnlyText, dueTime, safeTimezone);
  const title = extractTitleFromText(
    text,
    type === "quiz" ? "Quiz" : "Google Classroom announcement"
  );
  const topics = extractTopics(text, title);

  return {
    userId,
    source: "google_classroom",
    university: "",
    department: "",
    courseCode: normalizeCourseCode(course, text),
    courseTitle: normalizeCourseTitle(course, text),
    section: clean(course.section),
    instructor: "",
    title,
    type,
    dueDate,
    dueTime,
    timezone: safeTimezone,
    topics,
    difficulty: type === "exam" || type === "quiz" ? 4 : 3,
    estimatedHours: type === "exam" ? 6 : type === "quiz" ? 3 : 4,
    weightPercent: 0,
    description: buildDescriptionFromPost({
      kind: "announcement",
      text,
      course,
      raw: announcement,
      topics,
    }),
    materialsText: text,
    url: announcement.alternateLink || "",
  };
}

function normalizeMaterialDeadline({ userId, course, material, timezone }) {
  const text = normalizeText(`${material.title || ""}\n${material.description || ""}`.trim());

  if (!shouldTreatTextAsDeadline(text)) return null;

  const safeTimezone = normalizeTimezone(timezone, DEFAULT_TIMEZONE);
  const referenceDate = material.updateTime ? new Date(material.updateTime) : new Date();
  const parsedDate = parseDateFromText(text, referenceDate);

  if (!parsedDate) return null;

  const type = inferTypeFromText(text, "assignment");
  const dueTime = parseTime(
    text,
    type === "quiz" || type === "exam" ? DEFAULT_CLASS_TIME : "23:59"
  );

  const dateOnlyText = `${parsedDate.getFullYear()}-${String(
    parsedDate.getMonth() + 1
  ).padStart(2, "0")}-${String(parsedDate.getDate()).padStart(2, "0")}`;

  const dueDate = zonedDateTimeToDate(dateOnlyText, dueTime, safeTimezone);
  const title = clean(material.title, extractTitleFromText(text, "Google Classroom material"));
  const topics = extractTopics(text, title);

  return {
    userId,
    source: "google_classroom",
    university: "",
    department: "",
    courseCode: normalizeCourseCode(course, text),
    courseTitle: normalizeCourseTitle(course, text),
    section: clean(course.section),
    instructor: "",
    title,
    type,
    dueDate,
    dueTime,
    timezone: safeTimezone,
    topics,
    difficulty: type === "exam" || type === "quiz" ? 4 : 3,
    estimatedHours: type === "exam" ? 6 : type === "quiz" ? 3 : 4,
    weightPercent: 0,
    description: buildDescriptionFromPost({
      kind: "course material",
      text,
      course,
      raw: material,
      topics,
    }),
    materialsText: text,
    url: material.alternateLink || "",
  };
}

function matchesCourseFilter(course, payload = {}) {
  const courseId = clean(payload.courseId);
  const courseName = clean(payload.courseName).toLowerCase();
  const courseCode = clean(payload.courseCode).toLowerCase();

  if (courseId && String(course.id) !== courseId) return false;

  if (courseName && !String(course.name || "").toLowerCase().includes(courseName)) {
    return false;
  }

  if (
    courseCode &&
    !String(course.name || "").toLowerCase().includes(courseCode) &&
    !String(course.section || "").toLowerCase().includes(courseCode)
  ) {
    return false;
  }

  return true;
}

function summarizeImportResults(results = []) {
  const created = results.filter((item) => item.created).length;
  const updated = results.filter((item) => item.updated).length;
  const skipped = results.filter((item) => item.skipped).length;

  return {
    created,
    updated,
    skipped,
    totalTouched: created + updated,
  };
}

export async function getGoogleClassroomAuthUrl(payload = {}) {
  const userId = clean(payload.userId);

  if (!userId) {
    throw makeError("userId is required for Google Classroom auth.", 401, "user_missing");
  }

  const client = createOAuthClient();

  const state = base64UrlEncodeJson({
    userId,
    nonce: crypto.randomUUID(),
    createdAt: Date.now(),
    returnTo: clean(payload.returnTo),
  });

  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: false,
    scope: CLASSROOM_SCOPES,
    state,
  });

  return {
    url,
    authUrl: url,
    scopes: CLASSROOM_SCOPES,
    message: "Open this URL and approve all Classroom scopes.",
  };
}

export async function exchangeGoogleClassroomCode(payload = {}) {
  const userId = clean(payload.userId);
  const code = clean(payload.code);

  if (!userId) throw makeError("userId is required.", 401, "user_missing");
  if (!code) throw makeError("Google auth code is required.", 400, "code_missing");

  const client = createOAuthClient();
  const result = await client.getToken(code);
  const tokens = result.tokens || {};

  const existing = await ReadinessGoogleToken.findOne({ userId });

  await ReadinessGoogleToken.findOneAndUpdate(
    { userId },
    {
      $set: {
        userId,
        accessToken: tokens.access_token || existing?.accessToken || "",
        refreshToken: tokens.refresh_token || existing?.refreshToken || "",
        expiryDate: tokens.expiry_date || existing?.expiryDate || null,
        tokenType: tokens.token_type || existing?.tokenType || "Bearer",
        scope: tokens.scope || CLASSROOM_SCOPES.join(" "),
        connectedAt: new Date(),
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  return {
    connected: true,
    message: "Google Classroom connected.",
  };
}

export async function handleGoogleClassroomCallback(payload = {}) {
  if (payload.error) {
    throw makeError(
      clean(payload.error_description, payload.error),
      400,
      "google_oauth_failed"
    );
  }

  const code = clean(payload.code);
  const state = base64UrlDecodeJson(payload.state);

  if (!code) {
    throw makeError("Google OAuth callback missing code.", 400, "code_missing");
  }

  if (!state.userId) {
    throw makeError("Google OAuth callback missing user state.", 400, "state_missing");
  }

  const exchanged = await exchangeGoogleClassroomCode({
    userId: state.userId,
    code,
  });

  return {
    ...exchanged,
    userId: state.userId,
    returnTo: state.returnTo || "",
  };
}

export async function importGoogleClassroom(payload = {}) {
  const userId = clean(payload.userId);

  if (!userId) throw makeError("userId is required.", 401, "user_missing");

  const timezone = normalizeTimezone(payload.timezone || payload.country || DEFAULT_TIMEZONE);
  const includeCourseWork = payload.includeCourseWork !== false;
  const includeAnnouncements = payload.includeAnnouncements !== false;
  const includeMaterials = payload.includeMaterials !== false;

  const client = await getOAuthClientForUser(userId);
  const tokenDebug = await getTokenScopeDebug(client);

  const classroom = google.classroom({
    version: "v1",
    auth: client,
  });

  const courses = (
    await listAllCourses(classroom, {
      courseStates: payload.courseStates || ["ACTIVE"],
    })
  ).filter((course) => matchesCourseFilter(course, payload));

  const results = [];
  const errors = [];
  const debug = [];

  for (const course of courses) {
    const courseDebug = {
      courseId: course.id,
      courseName: course.name,
      section: course.section || "",
      inferredCourseCode: normalizeCourseCode(course),
      courseWorkFetched: 0,
      announcementsFetched: 0,
      announcementsMethod: "",
      announcementsErrors: [],
      materialsFetched: 0,
      materialsMethod: "",
      materialsErrors: [],
      deadlinesFound: 0,
      parsedFromCourseWork: 0,
      parsedFromAnnouncements: 0,
      parsedFromMaterials: 0,
      announcementSamples: [],
      materialSamples: [],
    };

    try {
      if (includeCourseWork) {
        try {
          const courseWork = await listAllCourseWork(classroom, course.id);
          courseDebug.courseWorkFetched = courseWork.length;

          for (const work of courseWork) {
            const normalized = normalizeCourseWorkDeadline({
              userId,
              course,
              work,
              timezone,
            });

            if (!normalized) continue;

            courseDebug.deadlinesFound += 1;
            courseDebug.parsedFromCourseWork += 1;
            courseDebug.inferredCourseCode = normalized.courseCode || courseDebug.inferredCourseCode;

            results.push(await upsertCalendar1Deadline(normalized));
          }
        } catch (error) {
          errors.push({
            courseId: course.id,
            courseName: course.name,
            source: "coursework",
            error: error.message,
            code: error.code,
            status: error.status,
          });
        }
      }

      if (includeAnnouncements) {
        const announcementResult = await listAllAnnouncements({
          classroom,
          client,
          courseId: course.id,
        });

        const announcements = announcementResult.items || [];
        courseDebug.announcementsFetched = announcements.length;
        courseDebug.announcementsMethod = announcementResult.method;
        courseDebug.announcementsErrors = announcementResult.errors || [];
        courseDebug.announcementSamples = announcements.slice(0, 5).map((announcement) => ({
          id: announcement.id,
          state: announcement.state,
          updateTime: announcement.updateTime,
          parsedDate: parseDateFromText(
            announcement.text || "",
            announcement.updateTime ? new Date(announcement.updateTime) : new Date()
          ),
          parsedTime: parseTime(announcement.text || "", DEFAULT_CLASS_TIME),
          text: clean(announcement.text).slice(0, 700),
        }));

        for (const announcement of announcements) {
          const normalized = normalizeAnnouncementDeadline({
            userId,
            course,
            announcement,
            timezone,
          });

          if (!normalized) continue;

          courseDebug.deadlinesFound += 1;
          courseDebug.parsedFromAnnouncements += 1;
          courseDebug.inferredCourseCode = normalized.courseCode || courseDebug.inferredCourseCode;

          results.push(await upsertCalendar1Deadline(normalized));
        }

        if (announcementResult.errors?.length) {
          errors.push({
            courseId: course.id,
            courseName: course.name,
            source: "announcement",
            error: "Announcement fetch used fallback or failed.",
            details: announcementResult.errors,
          });
        }
      }

      if (includeMaterials) {
        const materialResult = await listAllCourseWorkMaterials({
          classroom,
          client,
          courseId: course.id,
        });

        const materials = materialResult.items || [];
        courseDebug.materialsFetched = materials.length;
        courseDebug.materialsMethod = materialResult.method;
        courseDebug.materialsErrors = materialResult.errors || [];
        courseDebug.materialSamples = materials.slice(0, 5).map((material) => {
          const text = `${material.title || ""}\n${material.description || ""}`.trim();

          return {
            id: material.id,
            state: material.state,
            updateTime: material.updateTime,
            title: clean(material.title).slice(0, 180),
            description: clean(material.description).slice(0, 700),
            parsedDate: parseDateFromText(
              text,
              material.updateTime ? new Date(material.updateTime) : new Date()
            ),
            parsedTime: parseTime(text, "23:59"),
          };
        });

        for (const material of materials) {
          const normalized = normalizeMaterialDeadline({
            userId,
            course,
            material,
            timezone,
          });

          if (!normalized) continue;

          courseDebug.deadlinesFound += 1;
          courseDebug.parsedFromMaterials += 1;
          courseDebug.inferredCourseCode = normalized.courseCode || courseDebug.inferredCourseCode;

          results.push(await upsertCalendar1Deadline(normalized));
        }

        if (materialResult.errors?.length) {
          errors.push({
            courseId: course.id,
            courseName: course.name,
            source: "course_material",
            error: "Material fetch used fallback or failed.",
            details: materialResult.errors,
          });
        }
      }
    } finally {
      debug.push(courseDebug);
    }
  }

  const summary = summarizeImportResults(results);

  await ReadinessGoogleToken.updateOne(
    { userId },
    {
      $set: {
        lastClassroomImportedAt: new Date(),
        lastClassroomImportSummary: {
          ...summary,
          coursesChecked: courses.length,
          errorsCount: errors.length,
          timezone,
        },
      },
    },
    { upsert: true }
  );

  return {
    ...summary,
    coursesChecked: courses.length,
    timezone,
    tokenDebug: {
      ok: tokenDebug.ok,
      scopes: tokenDebug.scopes,
      hasAnnouncementsScope: tokenDebug.scopes?.includes(
        "https://www.googleapis.com/auth/classroom.announcements.readonly"
      ),
      hasMaterialsScope: tokenDebug.scopes?.includes(
        "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly"
      ),
      message: tokenDebug.message || "",
    },
    errors,
    debug,
    results: results.map((item) => ({
      created: item.created,
      updated: item.updated,
      skipped: item.skipped,
      reason: item.reason,
      deadline: item.deadline
        ? {
            id: item.deadline._id,
            title: item.deadline.title,
            type: item.deadline.type,
            courseCode: item.deadline.courseCode,
            courseTitle: item.deadline.courseTitle,
            dueDate: item.deadline.dueDate,
            dueTime: item.deadline.dueTime,
            timezone: item.deadline.timezone,
            source: item.deadline.source,
            topics: item.deadline.topics,
          }
        : null,
    })),
    message: `Google Classroom import finished. Created ${summary.created}, updated ${summary.updated}, skipped ${summary.skipped}.`,
  };
}
import mongoose from "mongoose";

export const MS_DAY = 24 * 60 * 60 * 1000;

export function makeError(message, status = 400, code = "readiness_error") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export function clean(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

export function requireUserId(payload = {}) {
  const userId = clean(payload.userId || payload.uid || payload.email);

  if (!userId) {
    throw makeError(
      "userId is required. Readiness Coach does not use demo-user fallback.",
      400,
      "user_required"
    );
  }

  return userId;
}

export function requireObjectId(id, name = "id") {
  if (!mongoose.Types.ObjectId.isValid(String(id || ""))) {
    throw makeError(`Invalid ${name}.`, 400, "invalid_object_id");
  }

  return id;
}

export function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => clean(item)).filter(Boolean);
  }

  return clean(value)
    .split(/[,\n;]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function uniqueCleanList(value, limit = 50) {
  const seen = new Set();
  const items = normalizeList(value);

  const output = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
    if (output.length >= limit) break;
  }

  return output;
}

export function dateOnly(value = new Date()) {
  const date = value instanceof Date ? new Date(value) : new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  date.setHours(0, 0, 0, 0);
  return date;
}

export function endOfDay(value = new Date()) {
  const date = dateOnly(value);
  if (!date) return null;

  date.setHours(23, 59, 59, 999);
  return date;
}

export function addDays(value, days) {
  const date = dateOnly(value);
  if (!date) return null;

  date.setDate(date.getDate() + Number(days || 0));
  return date;
}

export function addMinutes(value, minutes) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date();

  date.setMinutes(date.getMinutes() + Number(minutes || 0));
  return date;
}

export function daysBetween(start, end) {
  const startDate = dateOnly(start);
  const endDate = dateOnly(end);

  if (!startDate || !endDate) return 0;

  return Math.ceil((endDate.getTime() - startDate.getTime()) / MS_DAY);
}

export function parseDueDate(dateValue, timeValue = "23:59") {
  const raw = clean(dateValue);

  if (!raw) {
    throw makeError("dueDate is required.", 400, "due_date_required");
  }

  let date;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const safeTime = normalizeStartTime(timeValue, "23:59");
    date = new Date(`${raw}T${safeTime}:00`);
  } else {
    date = new Date(raw);
  }

  if (Number.isNaN(date.getTime())) {
    throw makeError("Invalid dueDate. Use YYYY-MM-DD or ISO date.", 400, "invalid_due_date");
  }

  return date;
}

export function ymd(value = new Date()) {
  const date = dateOnly(value);
  if (!date) return "";

  return date.toISOString().slice(0, 10);
}

export function icsDate(date) {
  return new Date(date).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function normalizeStartTime(value, fallback = "19:00") {
  const time = clean(value, fallback);

  if (/^\d{1,2}:\d{2}$/.test(time)) {
    const [h, m] = time.split(":").map(Number);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
  }

  return fallback;
}

export function minutesToTime(totalMinutes) {
  const minutes = clamp(totalMinutes, 0, 23 * 60 + 59);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function timeToMinutes(timeValue = "19:00") {
  const time = normalizeStartTime(timeValue);
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function addMinutesToTime(timeValue = "19:00", minutes = 25) {
  return minutesToTime(timeToMinutes(timeValue) + Number(minutes || 0));
}

export function applyTimeToDate(dateValue, timeValue = "19:00") {
  const date = dateOnly(dateValue) || dateOnly(new Date());
  const [hh, mm] = normalizeStartTime(timeValue).split(":").map(Number);

  date.setHours(hh || 19, mm || 0, 0, 0);

  return date;
}

export function startOfWeek(value = new Date(), weekStartsOn = 1) {
  const date = dateOnly(value) || dateOnly(new Date());
  const day = date.getDay();
  const diff = (day < weekStartsOn ? 7 : 0) + day - weekStartsOn;
  date.setDate(date.getDate() - diff);
  return date;
}

export function endOfWeek(value = new Date(), weekStartsOn = 1) {
  const start = startOfWeek(value, weekStartsOn);
  const end = addDays(start, 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function getWeekRange(value = new Date(), weekStartsOn = 1) {
  return {
    start: startOfWeek(value, weekStartsOn),
    end: endOfWeek(value, weekStartsOn),
  };
}

export function isSameDay(a, b) {
  return ymd(a) === ymd(b);
}

export function isPastDay(value, now = new Date()) {
  const target = dateOnly(value);
  const today = dateOnly(now);
  if (!target || !today) return false;
  return target.getTime() < today.getTime();
}

export function isToday(value, now = new Date()) {
  return ymd(value) === ymd(now);
}

export function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
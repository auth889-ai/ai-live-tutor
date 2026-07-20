const COUNTRY_TIMEZONE_MAP = {
  BD: "Asia/Dhaka",
  Bangladesh: "Asia/Dhaka",
  bangladesh: "Asia/Dhaka",

  IN: "Asia/Kolkata",
  India: "Asia/Kolkata",
  india: "Asia/Kolkata",

  UK: "Europe/London",
  GB: "Europe/London",
  "United Kingdom": "Europe/London",
  "united kingdom": "Europe/London",

  US: "America/New_York",
  USA: "America/New_York",
  "United States": "America/New_York",
  "united states": "America/New_York",
  "USA - Eastern": "America/New_York",
  "USA - Central": "America/Chicago",
  "USA - Pacific": "America/Los_Angeles",
};

export function normalizeTimezone(value, fallback = "Asia/Dhaka") {
  const raw = String(value || "").trim();

  if (!raw) return fallback;

  if (COUNTRY_TIMEZONE_MAP[raw]) {
    return COUNTRY_TIMEZONE_MAP[raw];
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw }).format(new Date());
    return raw;
  } catch {
    return fallback;
  }
}

export function countryFromTimezone(timezone = "Asia/Dhaka") {
  const tz = normalizeTimezone(timezone);

  if (tz === "Asia/Dhaka") return "BD";
  if (tz === "Asia/Kolkata") return "IN";
  if (tz === "Europe/London") return "GB";
  if (tz.startsWith("America/")) return "US";

  return "BD";
}

export function timezoneDateParts(date = new Date(), timezone = "Asia/Dhaka") {
  const tz = normalizeTimezone(timezone);
  const d = new Date(date);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    ymd: `${map.year}-${map.month}-${map.day}`,
  };
}

export function timezoneTimeParts(date = new Date(), timezone = "Asia/Dhaka") {
  const tz = normalizeTimezone(timezone);
  const d = new Date(date);

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);

  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  return {
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    time: `${map.hour}:${map.minute}`,
  };
}

export function zonedDateTimeToDate(dateInput, timeInput = "23:59", timezone = "Asia/Dhaka") {
  const tz = normalizeTimezone(timezone);

  const dateText =
    dateInput instanceof Date
      ? timezoneDateParts(dateInput, tz).ymd
      : String(dateInput || "").trim();

  const dateMatch = dateText.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);

  if (!dateMatch) {
    const fallback = new Date(dateInput);
    if (Number.isNaN(fallback.getTime())) return null;
    return fallback;
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);

  const timeMatch = String(timeInput || "23:59").match(/^(\d{1,2}):(\d{2})/);
  const hour = timeMatch ? Number(timeMatch[1]) : 23;
  const minute = timeMatch ? Number(timeMatch[2]) : 59;

  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  const localParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(utcGuess);

  const map = {};
  for (const part of localParts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  const localAsUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second || 0)
  );

  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const offset = localAsUtc - utcGuess.getTime();

  return new Date(targetAsUtc - offset);
}

export function formatDateInTimezone(date, timezone = "Asia/Dhaka") {
  if (!date) return "";

  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";

  return timezoneDateParts(d, timezone).ymd;
}

export function formatTimeInTimezone(date, timezone = "Asia/Dhaka") {
  if (!date) return "";

  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";

  return timezoneTimeParts(d, timezone).time;
}

export function startOfDayInTimezone(dateInput = new Date(), timezone = "Asia/Dhaka") {
  const ymd = formatDateInTimezone(dateInput, timezone);
  return zonedDateTimeToDate(ymd, "00:00", timezone);
}

export function endOfDayInTimezone(dateInput = new Date(), timezone = "Asia/Dhaka") {
  const ymd = formatDateInTimezone(dateInput, timezone);
  return zonedDateTimeToDate(ymd, "23:59", timezone);
}

export function addDaysByTimezone(dateInput = new Date(), days = 0, timezone = "Asia/Dhaka") {
  const start = startOfDayInTimezone(dateInput, timezone);
  const parts = timezoneDateParts(start, timezone);

  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  utc.setUTCDate(utc.getUTCDate() + Number(days || 0));

  const nextYmd = `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}-${String(utc.getUTCDate()).padStart(2, "0")}`;

  return zonedDateTimeToDate(nextYmd, "00:00", timezone);
}
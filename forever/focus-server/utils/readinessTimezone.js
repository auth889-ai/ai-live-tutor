import { DateTime } from "luxon";

export const TIMEZONE_OPTIONS = [
  { country: "BD", label: "Bangladesh", timezone: "Asia/Dhaka" },
  { country: "IN", label: "India", timezone: "Asia/Kolkata" },
  { country: "US_EAST", label: "USA Eastern", timezone: "America/New_York" },
  { country: "US_CENTRAL", label: "USA Central", timezone: "America/Chicago" },
  { country: "US_PACIFIC", label: "USA Pacific", timezone: "America/Los_Angeles" },
  { country: "UK", label: "United Kingdom", timezone: "Europe/London" },
];

export function normalizeTimezone(input) {
  if (!input) return "Asia/Dhaka";

  const direct = DateTime.now().setZone(input);
  if (direct.isValid) return input;

  const found = TIMEZONE_OPTIONS.find(
    (x) =>
      x.country.toLowerCase() === String(input).toLowerCase() ||
      x.label.toLowerCase() === String(input).toLowerCase()
  );

  return found?.timezone || "Asia/Dhaka";
}

export function classroomDueToUtcDate(dueDate, dueTime) {
  if (!dueDate?.year || !dueDate?.month || !dueDate?.day) return null;

  const dt = DateTime.utc(
    dueDate.year,
    dueDate.month,
    dueDate.day,
    dueTime?.hours ?? 23,
    dueTime?.minutes ?? 59,
    dueTime?.seconds ?? 0
  );

  return dt.isValid ? dt.toJSDate() : null;
}

export function formatCalendarDateFields(dateValue, timezoneInput) {
  if (!dateValue) {
    return {
      dateKey: null,
      displayTime: "",
      displayDate: "",
      zonedIso: null,
    };
  }

  const timezone = normalizeTimezone(timezoneInput);
  const dt = DateTime.fromJSDate(new Date(dateValue), { zone: "utc" }).setZone(timezone);

  if (!dt.isValid) {
    return {
      dateKey: null,
      displayTime: "",
      displayDate: "",
      zonedIso: null,
    };
  }

  return {
    dateKey: dt.toFormat("yyyy-MM-dd"),
    displayTime: dt.toFormat("HH:mm"),
    displayDate: dt.toFormat("dd LLL yyyy"),
    zonedIso: dt.toISO(),
  };
}
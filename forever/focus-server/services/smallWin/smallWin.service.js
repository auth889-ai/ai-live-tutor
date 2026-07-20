/* eslint-disable no-console */

import crypto from "crypto";

const CACHE = new Map();

const CACHE_TTL_MS = Number(process.env.SMALL_WIN_CACHE_TTL_MS || 15 * 60 * 1000);
const DEFAULT_TIMEOUT_MS = Number(process.env.SMALL_WIN_FETCH_TIMEOUT_MS || 22000);

/**
 * Small-Win Opportunity Finder v3.3
 * ---------------------------------
 *
 * Goal:
 * Not roadmap.
 * Real opportunity/resource/challenge fetcher + strict verifier + small-win matcher.
 *
 * v3.3 keeps:
 * - all-category field registry
 * - Codeforces official API
 * - Tavily verified-domain search
 * - YouTube learning/practice resources
 * - Eventbrite events/workshops
 * - strict programming verifier
 * - relaxed official application verifier for scholarship/research/internship
 * - dynamic rule motivation
 * - optional Cloud Gemma motivation
 *
 * v3.3 fixes:
 * - date-missing programming pages rejected unless official API / known listing
 * - CodeChef guide/workshops/wiki/static pages rejected
 * - HackerRank old/no-date CodeSprint pages rejected
 * - Codeforces /contests/with/<user> history pages rejected
 * - AtCoder homepage/upcoming listing allowed
 * - Codeforces official API always allowed
 * - scholarship/research/internship official pages accepted as "verify deadline first"
 * - “verify date” results are not top priority
 */

/* -------------------------------------------------------------------------- */
/* Field registry                                                              */
/* -------------------------------------------------------------------------- */

export const SMALL_WIN_FIELDS = {
  programming: {
    label: "Programming Contest",
    realThings: ["Upcoming contests", "Coding challenges", "Practice contests"],
    trustedDomains: [
      "codeforces.com",
      "atcoder.jp",
      "leetcode.com",
      "codechef.com",
      "hackerrank.com",
      "hackerearth.com",
      "topcoder.com",
    ],
    tavilyQueries: [
      "site:atcoder.jp upcoming contests AtCoder Beginner Contest start time",
      "site:codeforces.com/contests upcoming Codeforces contest",
      "site:leetcode.com/contest weekly contest upcoming",
      "site:codechef.com/contests upcoming CodeChef contest starters",
      "site:hackerearth.com/challenges upcoming programming challenge",
    ],
  },

  hackathon: {
    label: "Hackathon",
    realThings: ["Student hackathons", "Online hackathons", "Build challenges"],
    trustedDomains: [
      "devpost.com",
      "mlh.io",
      "events.mlh.io",
      "ghw.mlh.io",
      "dorahacks.io",
      "lablab.ai",
      "hackclub.com",
      "eventbrite.com",
      "f6s.com",
    ],
    tavilyQueries: [
      "site:devpost.com/hackathons online student hackathon upcoming",
      "site:events.mlh.io/events hackathon students upcoming",
      "site:ghw.mlh.io Global Hack Week upcoming",
      "site:dorahacks.io hackathon upcoming student",
      "site:lablab.ai hackathon upcoming AI student",
      "site:hackclub.com hackathon students upcoming",
    ],
  },

  scholarship: {
    label: "Scholarship",
    realThings: ["Scholarships", "Funding", "Application deadlines"],
    trustedDomains: [
      ".edu",
      ".ac.uk",
      ".org",
      "daad.de",
      "chevening.org",
      "fulbrightprogram.org",
      "erasmus-plus.ec.europa.eu",
      "gatescambridge.org",
      "rhodeshouse.ox.ac.uk",
      "schwarzmanscholars.org",
      "scholars4dev.com",
    ],
    tavilyQueries: [
      "site:daad.de scholarship application deadline students international",
      "site:chevening.org scholarships application deadline",
      "site:erasmus-plus.ec.europa.eu scholarship students application deadline",
      "site:fulbrightprogram.org scholarship students application deadline",
      "site:.edu scholarship application deadline international students computer science",
      "site:.ac.uk scholarship application deadline international students",
      "official scholarship application deadline international students",
    ],
  },

  ielts_english: {
    label: "IELTS / English",
    realThings: ["Practice tests", "Speaking practice", "Writing resources"],
    trustedDomains: [
      "ielts.org",
      "britishcouncil.org",
      "takeielts.britishcouncil.org",
      "cambridgeenglish.org",
      "youtube.com",
    ],
    tavilyQueries: [
      "site:ielts.org IELTS practice test official",
      "site:takeielts.britishcouncil.org IELTS free practice test",
      "site:cambridgeenglish.org IELTS practice official",
      "site:britishcouncil.org IELTS speaking practice",
    ],
  },

  research: {
    label: "Research",
    realThings: ["Research programs", "Research internships", "Calls for papers"],
    trustedDomains: [
      ".edu",
      ".ac.uk",
      ".org",
      "research.google",
      "acm.org",
      "ieee.org",
      "mit.edu",
      "stanford.edu",
      "cmu.edu",
    ],
    tavilyQueries: [
      "site:.edu undergraduate research program students application deadline computer science",
      "site:.edu summer research program students application deadline",
      "site:research.google student research program application",
      "site:acm.org student research competition call for papers",
      "site:ieee.org student research competition call for papers",
      "student research program application deadline official",
    ],
  },

  math_science: {
    label: "Math / Science",
    realThings: ["Olympiads", "Science contests", "Practice resources"],
    trustedDomains: [
      "maa.org",
      "imo-official.org",
      "ipho-official.org",
      "icho-official.org",
      "khanacademy.org",
      "brilliant.org",
      ".edu",
      "youtube.com",
    ],
    tavilyQueries: [
      "site:maa.org math contest students upcoming",
      "site:imo-official.org olympiad students",
      "site:ipho-official.org physics olympiad students",
      "site:khanacademy.org math practice students",
      "site:brilliant.org math challenge students",
    ],
  },

  design_creative: {
    label: "Design / Creative",
    realThings: ["Design challenges", "Portfolio tasks", "Creative competitions"],
    trustedDomains: [
      "adobe.com",
      "behance.net",
      "dribbble.com",
      "figma.com",
      "awwwards.com",
      "eventbrite.com",
      "youtube.com",
    ],
    tavilyQueries: [
      "site:adobe.com design challenge students",
      "site:behance.net design challenge students",
      "site:dribbble.com design challenge",
      "site:figma.com community design challenge",
      "student UI UX design challenge upcoming official",
    ],
  },

  writing: {
    label: "Writing",
    realThings: ["Writing competitions", "Essay contests", "Calls for submissions"],
    trustedDomains: [
      "submittable.com",
      ".edu",
      ".org",
      "poets.org",
      "writersandartists.co.uk",
      "eventbrite.com",
    ],
    tavilyQueries: [
      "site:submittable.com student writing competition deadline",
      "site:.edu student essay competition deadline",
      "site:poets.org student writing contest",
      "student writing competition deadline official",
    ],
  },

  business_startup: {
    label: "Business / Startup",
    realThings: ["Startup competitions", "Pitch events", "Incubator calls"],
    trustedDomains: [
      "ycombinator.com",
      "techstars.com",
      "startupgrind.com",
      "eventbrite.com",
      "f6s.com",
      ".edu",
      "youtube.com",
    ],
    tavilyQueries: [
      "site:.edu student startup competition deadline",
      "site:techstars.com startup weekend student",
      "site:startupgrind.com startup competition students",
      "site:f6s.com startup competition students",
      "student pitch competition deadline official",
    ],
  },

  internship: {
    label: "Internship",
    realThings: ["Student internships", "Summer programs", "Early career roles"],
    trustedDomains: [
      ".edu",
      ".ac.uk",
      "linkedin.com",
      "wellfound.com",
      "simplify.jobs",
      "google.com",
      "microsoft.com",
      "amazon.jobs",
      "github.com",
      "jobs.apple.com",
      "careers.google.com",
    ],
    tavilyQueries: [
      "student internship computer science application deadline official",
      "site:simplify.jobs internship student software",
      "site:wellfound.com internship startup student",
      "site:.edu internship program students application deadline",
      "site:careers.google.com/students internship application",
      "site:microsoft.com university internship application students",
    ],
  },

  workshop_course: {
    label: "Workshop / Course",
    realThings: ["Free workshops", "Short courses", "Certificates"],
    trustedDomains: [
      "eventbrite.com",
      "coursera.org",
      "edx.org",
      "classcentral.com",
      "khanacademy.org",
      "freecodecamp.org",
      "youtube.com",
    ],
    tavilyQueries: [
      "free student workshop online certificate upcoming",
      "site:eventbrite.com student workshop online free",
      "site:coursera.org free course students beginner",
      "site:edx.org free course students beginner",
      "site:classcentral.com free course students",
    ],
  },

  general: {
    label: "General Small Win",
    realThings: ["Student opportunities", "Beginner challenges", "Free resources"],
    trustedDomains: [
      ".edu",
      ".org",
      "eventbrite.com",
      "coursera.org",
      "edx.org",
      "classcentral.com",
      "khanacademy.org",
      "freecodecamp.org",
      "youtube.com",
    ],
    tavilyQueries: [
      "free online student challenge beginner friendly",
      "student opportunity online beginner deadline",
      "free workshop students online upcoming",
      "student competition beginner official deadline",
    ],
  },
};

/* -------------------------------------------------------------------------- */
/* Basic helpers                                                               */
/* -------------------------------------------------------------------------- */

function nowIso() {
  return new Date().toISOString();
}

function sha(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function makeId(...parts) {
  return sha(parts.filter(Boolean).join("|")).slice(0, 24);
}

function clean(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function clamp(value, min, max, fallback = min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeUrl(value) {
  const raw = clean(value);
  if (!raw) return "";

  try {
    const u = new URL(raw);
    u.hash = "";
    return u.toString();
  } catch {
    return "";
  }
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function getUrlPath(url) {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function domainMatches(domain, trustedDomains = []) {
  const d = lower(domain);
  if (!d) return false;

  return trustedDomains.some((trusted) => {
    const t = lower(trusted);

    if (t === ".edu") return d.endsWith(".edu");
    if (t === ".org") return d.endsWith(".org");
    if (t === ".ac.uk") return d.endsWith(".ac.uk");

    return d === t || d.endsWith(`.${t}`);
  });
}

function safeDate(value) {
  if (!value) return null;

  const raw = clean(value);
  if (!raw) return null;

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;

  return d.toISOString();
}

function daysUntil(dateIso) {
  if (!dateIso) return null;

  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;

  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function hasAny(text, words = []) {
  const t = lower(text);
  return words.some((word) => t.includes(lower(word)));
}

function extractYearCandidates(text) {
  const years = String(text || "").match(/\b(20\d{2})\b/g) || [];
  return years.map((y) => Number(y)).filter((y) => Number.isFinite(y));
}

function currentYear() {
  return new Date().getUTCFullYear();
}

function hasPastYearOnly(item) {
  const years = extractYearCandidates(`${item?.title || ""} ${item?.description || ""}`);

  if (!years.length) return false;

  const nowYear = currentYear();
  const futureOrCurrent = years.some((y) => y >= nowYear);

  return !futureOrCurrent;
}

function extractDateFromRelativeText(text) {
  const t = lower(text);
  const now = new Date();

  const dayMatch = t.match(/\b(\d{1,3})\s+days?\s+left\b/);
  if (dayMatch?.[1]) return addDays(now, Number(dayMatch[1]));

  const weekMatch = t.match(/\b(\d{1,2})\s+weeks?\s+left\b/);
  if (weekMatch?.[1]) return addDays(now, Number(weekMatch[1]) * 7);

  if (t.includes("about 1 month left") || t.includes("one month left")) {
    return addDays(now, 30);
  }

  const monthMatch = t.match(/\b(\d{1,2})\s+months?\s+left\b/);
  if (monthMatch?.[1]) return addDays(now, Number(monthMatch[1]) * 30);

  return null;
}

function extractDateFromText(text) {
  const source = clean(text);
  const relative = extractDateFromRelativeText(source);
  if (relative) return relative;

  const month =
    "(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";

  const patterns = [
    new RegExp(
      `(?:deadline|apply by|applications due|due|closes|last date|registration closes|ends|end date)\\s*[:\\-]?\\s*(${month}\\.?\\s+\\d{1,2},?\\s+\\d{4})`,
      "i"
    ),
    new RegExp(`\\b(${month}\\.?\\s+\\d{1,2},?\\s+\\d{4})\\b`, "i"),
    /\b(\d{4}-\d{2}-\d{2})\b/i,
    /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/i,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) {
      const parsed = safeDate(match[1]);
      if (parsed) return parsed;
    }
  }

  return null;
}

function inferLevel(text) {
  const t = lower(text);

  if (
    t.includes("beginner") ||
    t.includes("starter") ||
    t.includes("intro") ||
    t.includes("easy") ||
    t.includes("newbie") ||
    t.includes("div. 4") ||
    t.includes("div 4") ||
    t.includes("abc") ||
    t.includes("beginner friendly")
  ) {
    return "beginner";
  }

  if (
    t.includes("intermediate") ||
    t.includes("medium") ||
    t.includes("div. 3") ||
    t.includes("div 3") ||
    t.includes("arc")
  ) {
    return "intermediate";
  }

  if (
    t.includes("advanced") ||
    t.includes("expert") ||
    t.includes("hard") ||
    t.includes("div. 1") ||
    t.includes("div 1") ||
    t.includes("agc")
  ) {
    return "advanced";
  }

  return "unknown";
}

function inferType(field, text) {
  const t = lower(text);

  if (field === "programming" || t.includes("contest")) return "contest";
  if (field === "hackathon" || t.includes("hackathon")) return "hackathon";
  if (field === "scholarship" || t.includes("scholarship")) return "scholarship";
  if (field === "research" || t.includes("research") || t.includes("call for papers")) return "research";
  if (field === "ielts_english" || t.includes("ielts")) return "practice";
  if (field === "design_creative" || t.includes("design")) return "design_challenge";
  if (field === "writing" || t.includes("essay") || t.includes("writing")) return "writing_call";
  if (field === "business_startup" || t.includes("startup") || t.includes("pitch")) return "startup";
  if (field === "internship" || t.includes("internship")) return "internship";

  if (field === "workshop_course" || t.includes("course") || t.includes("workshop")) {
    return "course_workshop";
  }

  return "opportunity";
}

function getEventbriteToken() {
  return (
    process.env.EVENTBRITE_TOKEN ||
    process.env.EVENTBRITE_PRIVATE_TOKEN ||
    process.env.EVENTBRITE_API_TOKEN ||
    ""
  );
}

function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;

  if (Date.now() > hit.expiresAt) {
    CACHE.delete(key);
    return null;
  }

  return hit.value;
}

function cacheSet(key, value) {
  CACHE.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body,
      signal: controller.signal,
    });

    const text = await res.text();

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: clean(text).slice(0, 1200),
      };
    }

    try {
      return {
        ok: true,
        status: res.status,
        data: JSON.parse(text),
      };
    } catch {
      return {
        ok: false,
        status: res.status,
        error: "Invalid JSON response",
        raw: text.slice(0, 1200),
      };
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error:
        err?.name === "AbortError"
          ? `Timeout after ${timeoutMs}ms`
          : err?.message || "Fetch failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                     */
/* -------------------------------------------------------------------------- */

export function normalizeSmallWinProfile(input = {}) {
  const field = SMALL_WIN_FIELDS[input.field] ? input.field : "general";

  return {
    field,
    level: ["beginner", "intermediate", "advanced"].includes(input.level)
      ? input.level
      : "beginner",
    goal: clean(input.goal || ""),
    feeling: clean(input.feeling || "confused").toLowerCase(),
    locationMode: ["online", "country", "hybrid"].includes(input.locationMode)
      ? input.locationMode
      : "online",
    country: clean(input.country || ""),
    city: clean(input.city || ""),
    dailyTimeMinutes: clamp(input.dailyTimeMinutes, 5, 600, 30),
    maxDaysAhead: clamp(input.maxDaysAhead, 1, 365, 180),
    limit: clamp(input.limit, 1, 60, 24),
    strictOnly: input.strictOnly !== false,
    includeVideos: input.includeVideos !== false,
    includeExpired: input.includeExpired === true,
  };
}

function buildTavilyQueries(profile) {
  const fieldConfig = SMALL_WIN_FIELDS[profile.field] || SMALL_WIN_FIELDS.general;

  const countryPart =
    profile.locationMode === "country" && profile.country
      ? ` ${profile.country}`
      : " online global";

  const levelPart = ` ${profile.level} student`;
  const goalPart = profile.goal ? ` ${profile.goal}` : "";

  return fieldConfig.tavilyQueries
    .map((query) => `${query}${levelPart}${countryPart}${goalPart}`.trim())
    .slice(0, 8);
}

/* -------------------------------------------------------------------------- */
/* Initial scoring and mission generation                                      */
/* -------------------------------------------------------------------------- */

function scoreOpportunity(item, profile) {
  let score = 0;
  const reasons = [];
  const problems = [];

  if (item.real && item.url) {
    score += 20;
    reasons.push("real source URL আছে");
  } else {
    problems.push("missing URL/title");
  }

  if (item.verifiedDomain) {
    score += 25;
    reasons.push("trusted/official domain match করেছে");
  } else {
    problems.push("trusted domain না");
  }

  if (item.deadlineAt || item.startAt) {
    score += 12;
    reasons.push("date পাওয়া গেছে");
  } else {
    problems.push("deadline/start date missing");
  }

  if (item.level === profile.level) {
    score += 10;
    reasons.push("level match করেছে");
  } else if (item.level === "unknown") {
    score += 4;
    reasons.push("level unknown, manually verify");
  } else if (profile.level === "beginner" && item.level === "advanced") {
    score -= 12;
    problems.push("beginner-এর জন্য advanced হতে পারে");
  }

  const text = lower(`${item.title} ${item.description} ${(item.tags || []).join(" ")}`);
  const goalWords = lower(profile.goal)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);

  const goalHits = goalWords.filter((w) => text.includes(w)).length;

  if (goalHits > 0) {
    score += Math.min(14, goalHits * 4);
    reasons.push("goal keyword match করেছে");
  }

  const d = item.daysUntilDeadline ?? item.daysUntilStart;

  if (typeof d === "number") {
    if (d < 0) {
      score -= 28;
      problems.push("date passed হতে পারে");
    } else if (d <= 7) {
      score += 10;
      reasons.push("urgent কিন্তু actionable");
    } else if (d <= 30) {
      score += 9;
      reasons.push("prepare করার মতো সময় আছে");
    } else if (d <= profile.maxDaysAhead) {
      score += 5;
      reasons.push("future opportunity, save করা যাবে");
    }
  }

  const feeling = lower(profile.feeling);

  if (["failed", "demotivated", "confused", "scared"].includes(feeling)) {
    if (
      text.includes("beginner") ||
      text.includes("student") ||
      text.includes("free") ||
      text.includes("practice") ||
      ["practice", "course_workshop", "contest"].includes(item.type)
    ) {
      score += 10;
      reasons.push("small-win friendly");
    }
  }

  if (profile.dailyTimeMinutes <= 30) {
    if (
      ["practice", "contest", "course_workshop", "opportunity"].includes(item.type) ||
      text.includes("short") ||
      text.includes("beginner") ||
      text.includes("practice")
    ) {
      score += 7;
      reasons.push("short daily time-এর সাথে fit করে");
    } else if (item.type === "hackathon") {
      score -= 4;
      problems.push("hackathon-এর জন্য বেশি time লাগতে পারে");
    }
  }

  const trustLevel = item.verifiedDomain ? "high" : item.url ? "medium" : "low";

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    matchScore: score,
    matchLabel:
      score >= 85
        ? "Excellent small win"
        : score >= 70
          ? "Strong match"
          : score >= 55
            ? "Good possibility"
            : score >= 40
              ? "Verify first"
              : "Weak match",
    sourceTrust: trustLevel,
    matchReasons: reasons.slice(0, 7),
    verificationProblems: problems.slice(0, 7),
  };
}

function baseRecoveryMessage(profile) {
  const feeling = lower(profile.feeling);

  if (feeling === "failed") {
    return "Fail করা মানে তুমি শেষ না। আজ শুধু একটা visible proof বানাও — attempt, checklist, draft, বা registration.";
  }

  if (feeling === "demotivated") {
    return "Motivation আসার জন্য wait করো না। 10-30 মিনিটের tiny action motivation তৈরি করবে.";
  }

  if (feeling === "confused") {
    return "Confusion কমানোর best way হলো one clear action. এই mission-এ next action fixed.";
  }

  if (feeling === "scared") {
    return "Scared হলে goal ছোট করো। আজ apply/compete না, শুধু source verify + first step.";
  }

  return "আজ huge success না, শুধু one small proof of progress.";
}

function makeSmallWinMission(item, profile) {
  const minutes = Math.min(profile.dailyTimeMinutes, 30);

  const base = {
    todayMinutes: minutes,
    proofRequired: true,
    recoveryMessage: baseRecoveryMessage(profile),
  };

  if (item.type === "contest") {
    return {
      ...base,
      missionTitle: "Attempt one easiest problem",
      exactAction: `Open the real contest/source page. Spend ${minutes} minutes choosing one easiest problem and make one attempt.`,
      proofOfWin: "one submission screenshot / one attempted problem / one weak-topic note",
      nextStep: "Tomorrow upsolve one problem or practice the weak topic.",
      checklist: [
        "Open source link",
        "Check contest/start time",
        "Attempt one easiest problem",
        "Save one weak topic",
      ],
    };
  }

  if (item.type === "hackathon") {
    return {
      ...base,
      missionTitle: "Create one tiny project idea",
      exactAction: `Open the hackathon page. Spend ${minutes} minutes writing: problem + user + one tiny feature.`,
      proofOfWin: "3-line idea / GitHub README / Figma rough sketch",
      nextStep: "Tomorrow create the smallest prototype skeleton.",
      checklist: [
        "Open hackathon page",
        "Check deadline/theme",
        "Write problem + user + feature",
        "Create repo/Figma/note",
      ],
    };
  }

  if (item.type === "scholarship") {
    return {
      ...base,
      missionTitle: "Verify eligibility and documents",
      exactAction: `Open the official scholarship page. Spend ${minutes} minutes checking eligibility, deadline, and required documents.`,
      proofOfWin: "deadline saved + required document checklist",
      nextStep: "Tomorrow draft first SOP paragraph or update CV.",
      checklist: [
        "Open official scholarship page",
        "Check eligibility",
        "Save deadline",
        "Create document checklist",
      ],
    };
  }

  if (item.type === "research") {
    return {
      ...base,
      missionTitle: "Write one research interest line",
      exactAction: `Open the research/call page. Spend ${minutes} minutes reading scope and write one research interest sentence.`,
      proofOfWin: "saved program/call + one research interest line",
      nextStep: "Tomorrow find one professor/lab/paper related to the topic.",
      checklist: [
        "Open source page",
        "Check eligibility/deadline",
        "Write one research interest sentence",
        "Save one lab/topic keyword",
      ],
    };
  }

  if (item.type === "practice") {
    return {
      ...base,
      missionTitle: "Complete one practice task",
      exactAction: `Open the official practice resource. Spend ${minutes} minutes doing one speaking/writing/practice task.`,
      proofOfWin: "one recording / one paragraph / one corrected mistake",
      nextStep: "Tomorrow repeat the same task better.",
      checklist: [
        "Open practice resource",
        "Choose one tiny task",
        "Complete one attempt",
        "Write one mistake to fix",
      ],
    };
  }

  if (item.type === "design_challenge") {
    return {
      ...base,
      missionTitle: "Make one rough design draft",
      exactAction: `Open the design challenge/source. Spend ${minutes} minutes making one rough sketch or moodboard.`,
      proofOfWin: "Figma frame / rough sketch / moodboard",
      nextStep: "Tomorrow improve layout or color system.",
      checklist: [
        "Open design source",
        "Read challenge brief",
        "Create rough sketch",
        "Save one improvement note",
      ],
    };
  }

  if (item.type === "writing_call") {
    return {
      ...base,
      missionTitle: "Write one outline",
      exactAction: `Open the writing call/source. Spend ${minutes} minutes writing a 5-line outline.`,
      proofOfWin: "outline / opening paragraph / submission checklist",
      nextStep: "Tomorrow write first draft paragraph.",
      checklist: [
        "Open writing source",
        "Check prompt/deadline",
        "Write 5-line outline",
        "Save submission requirement",
      ],
    };
  }

  if (item.type === "startup") {
    return {
      ...base,
      missionTitle: "Write a tiny pitch",
      exactAction: `Open the startup/pitch source. Spend ${minutes} minutes writing problem + customer + solution in 3 lines.`,
      proofOfWin: "3-line pitch / competitor note / pitch skeleton",
      nextStep: "Tomorrow create 1-slide pitch draft.",
      checklist: [
        "Open startup source",
        "Check eligibility/deadline",
        "Write problem + customer + solution",
        "Save one competitor/example",
      ],
    };
  }

  if (item.type === "internship") {
    return {
      ...base,
      missionTitle: "Check one role fit",
      exactAction: `Open the internship page. Spend ${minutes} minutes checking requirements and saving one skill gap.`,
      proofOfWin: "role link + requirement checklist + one skill gap note",
      nextStep: "Tomorrow update CV or practice one required skill.",
      checklist: [
        "Open internship source",
        "Check eligibility/deadline",
        "Save requirement checklist",
        "Write one skill gap",
      ],
    };
  }

  return {
    ...base,
    missionTitle: "Start one tiny action",
    exactAction: `Open the verified source. Spend ${minutes} minutes checking requirements and completing one tiny first step.`,
    proofOfWin: "saved source + one completed checklist item",
    nextStep: "Tomorrow continue the next smallest step.",
    checklist: [
      "Open source link",
      "Check deadline/start date",
      "Do one tiny action",
      "Save proof",
    ],
  };
}

function normalizeOpportunity(raw, profile) {
  const url = normalizeUrl(raw.url);
  const domain = getDomain(url);
  const fieldConfig = SMALL_WIN_FIELDS[profile.field] || SMALL_WIN_FIELDS.general;

  const title = clean(raw.title);
  const description = clean(raw.description);
  const text = `${title}. ${description}`;

  const deadlineAt = safeDate(raw.deadlineAt) || extractDateFromText(text);
  const startAt = safeDate(raw.startAt);
  const verifiedDomain = raw.verifiedDomain === true || domainMatches(domain, fieldConfig.trustedDomains);

  const item = {
    id: makeId(profile.field, raw.source, title, url),
    field: profile.field,
    fieldLabel: fieldConfig.label,
    type: raw.type || inferType(profile.field, text),
    title,
    description,
    url,
    domain,
    platform: raw.platform || domain || raw.source || "Unknown",
    source: raw.source || "Unknown",
    sourceMode: raw.sourceMode || "unknown",
    verifiedDomain,
    real: Boolean(url && title),
    startAt,
    deadlineAt,
    daysUntilStart: daysUntil(startAt),
    daysUntilDeadline: daysUntil(deadlineAt),
    level: raw.level || inferLevel(text),
    tags: Array.isArray(raw.tags) ? raw.tags.map(clean).filter(Boolean) : [],
    rawScore: Number(raw.rawScore || 0),
    fetchedAt: nowIso(),
  };

  return {
    ...item,
    ...scoreOpportunity(item, profile),
    mission: makeSmallWinMission(item, profile),
  };
}

/* -------------------------------------------------------------------------- */
/* Strict verifier                                                             */
/* -------------------------------------------------------------------------- */

const ENDED_SIGNALS = [
  "contest is over",
  "contest has ended",
  "has ended",
  "is over",
  "applications closed",
  "registration closed",
  "deadline passed",
  "no longer accepting",
  "submissions are closed",
  "event ended",
  "ended on",
  "closed on",
];

const BLOG_PATH_SIGNALS = [
  "/blog",
  "/blogs",
  "/news",
  "/writing",
  "/article",
  "/articles",
  "/post",
  "/posts",
];

const GENERIC_PAGE_SIGNALS = [
  "privacy policy",
  "terms of service",
  "cookie",
  "career paths",
  "roadmaps",
  "what is it?",
  "tell me more",
  "company",
  "about us",
  "pricing",
  "request a demo",
  "all rights reserved",
];

const POSITIVE_OPPORTUNITY_SIGNALS = [
  "upcoming",
  "register",
  "registration",
  "apply",
  "application",
  "deadline",
  "starts",
  "start time",
  "ends",
  "days left",
  "month left",
  "open",
  "can participate",
  "schedule",
  "event",
  "hackathon",
  "contest",
  "challenge",
  "scholarship",
  "internship",
  "workshop",
  "course",
  "call for papers",
  "submissions",
  "free",
  "eligibility",
  "requirements",
  "funding",
  "fellowship",
  "student program",
  "summer program",
];

const OFFICIAL_SOURCE_MODES = [
  "official_public_api",
  "official_api_event",
  "official_api_learning_resource",
];

function isOfficialApi(item) {
  return OFFICIAL_SOURCE_MODES.some((mode) =>
    String(item?.sourceMode || "").includes(mode)
  );
}

function itemText(item) {
  return `${item?.title || ""} ${item?.description || ""}`;
}

function isClearlyEnded(item) {
  return hasAny(itemText(item), ENDED_SIGNALS);
}

function isBlogPath(item) {
  const path = getUrlPath(item?.url);
  return hasAny(path, BLOG_PATH_SIGNALS);
}

function isGenericStaticPage(item) {
  return hasAny(itemText(item), GENERIC_PAGE_SIGNALS);
}

function hasOpportunitySignal(item) {
  return hasAny(itemText(item), POSITIVE_OPPORTUNITY_SIGNALS);
}

function hasFutureDate(item) {
  const d = item?.daysUntilDeadline ?? item?.daysUntilStart;
  return typeof d === "number" && d >= 0;
}

function hasDate(item) {
  return Boolean(item?.deadlineAt || item?.startAt);
}

function isOfficialEducationalOrApplicationDomain(item) {
  const domain = lower(item?.domain || getDomain(item?.url));

  return (
    domain.endsWith(".edu") ||
    domain.endsWith(".ac.uk") ||
    domain.endsWith(".org") ||
    domain.includes("daad.de") ||
    domain.includes("chevening.org") ||
    domain.includes("fulbrightprogram.org") ||
    domain.includes("erasmus-plus.ec.europa.eu") ||
    domain.includes("gatescambridge.org") ||
    domain.includes("rhodeshouse.ox.ac.uk") ||
    domain.includes("schwarzmanscholars.org") ||
    domain.includes("scholars4dev.com") ||
    domain.includes("research.google") ||
    domain.includes("acm.org") ||
    domain.includes("ieee.org") ||
    domain.includes("simplify.jobs") ||
    domain.includes("wellfound.com") ||
    domain.includes("careers.google.com") ||
    domain.includes("microsoft.com") ||
    domain.includes("amazon.jobs") ||
    domain.includes("jobs.apple.com")
  );
}

function hasApplicationSignal(item) {
  return hasAny(itemText(item), [
    "apply",
    "application",
    "deadline",
    "eligibility",
    "requirements",
    "admission",
    "funding",
    "scholarship",
    "fellowship",
    "program",
    "student",
    "students",
    "internship",
    "research",
    "call for papers",
    "submission",
    "submit",
    "candidate",
    "summer",
    "undergraduate",
    "graduate",
    "international",
  ]);
}

function isRelaxableApplicationField(profile) {
  return ["scholarship", "research", "internship"].includes(profile.field);
}

function isKnownUpcomingListingPage(item) {
  const domain = lower(item?.domain || getDomain(item?.url));
  const path = getUrlPath(item?.url);
  const text = lower(itemText(item));

  if (domain === "atcoder.jp" && (path === "/" || path === "")) {
    return hasAny(text, [
      "upcoming contests",
      "next contest",
      "atcoder beginner contest",
      "start time",
      "daily contests",
    ]);
  }

  if (domain === "codeforces.com") {
    return path === "/contests" || path === "/contests/";
  }

  if (domain === "devpost.com" && path.includes("/hackathons")) {
    return hasAny(text, ["new & upcoming", "days left", "month left", "all hackathons"]);
  }

  if (domain === "events.mlh.io" && path.includes("/events/")) {
    return hasAny(text, ["hackathon", "upcoming", "register", "event"]);
  }

  if (domain === "ghw.mlh.io") {
    return hasAny(text, ["upcoming", "register", "global hack week", "june", "july", "august"]);
  }

  return false;
}

function isDirectOpportunityUrl(item) {
  const domain = lower(item?.domain || getDomain(item?.url));
  const path = getUrlPath(item?.url);
  const type = lower(item?.type);

  if (domain.includes("codeforces.com")) {
    return path === "/contests" || path === "/contests/";
  }

  if (domain.includes("atcoder.jp")) {
    if (path === "/" || path === "") return isKnownUpcomingListingPage(item);
    return path.startsWith("/contests/") && !path.includes("/editorial");
  }

  if (domain.includes("leetcode.com")) return path.includes("/contest");
  if (domain.includes("codechef.com")) return path === "/contests" || path === "/contests/";
  if (domain.includes("devpost.com")) return path.includes("/hackathons");
  if (domain.includes("events.mlh.io")) return path.includes("/events/");
  if (domain.includes("ghw.mlh.io")) return true;
  if (domain.includes("dorahacks.io")) return true;
  if (domain.includes("lablab.ai")) return true;
  if (domain.includes("eventbrite.com")) return path.includes("/e/");

  if (domain.endsWith(".edu") && hasAny(itemText(item), ["deadline", "apply", "application"])) {
    return true;
  }

  return [
    "contest",
    "hackathon",
    "scholarship",
    "research",
    "internship",
    "course_workshop",
    "design_challenge",
    "writing_call",
    "startup",
    "practice",
  ].includes(type);
}

function isProgrammingNoDateAllowed(item) {
  return isOfficialApi(item) || isKnownUpcomingListingPage(item);
}

function isProgrammingLearningOrStaticUrl(item) {
  const domain = lower(item?.domain || getDomain(item?.url));
  const path = getUrlPath(item?.url);
  const text = lower(itemText(item));

  if (domain.includes("codeforces.com")) {
    if (path.includes("/contests/with/")) return true;
    if (path.includes("/profile/")) return true;
    if (path.includes("/blog/entry/")) return true;
    if (path.includes("/problemset/status")) return true;
  }

  if (domain.includes("codechef.com")) {
    if (
      path === "/" ||
      path.includes("/guide") ||
      path.includes("/workshops") ||
      path.includes("/wiki") ||
      path.includes("/ratings") ||
      path.includes("/learn") ||
      path.includes("/practice") ||
      path.includes("/roadmap") ||
      path.includes("/our-initiatives")
    ) {
      return true;
    }
  }

  if (domain.includes("hackerrank.com")) {
    if (
      path.includes("/writing") ||
      path.includes("/blog") ||
      path.includes("/domains") ||
      path.includes("/skills-verification") ||
      path.includes("/codestorm")
    ) {
      return true;
    }

    if (hasAny(text, ["land your dream job", "killer prizes", "starts october 29th"])) {
      return true;
    }
  }

  if (domain.includes("atcoder.jp")) {
    if (
      path.includes("/editorial") ||
      path.includes("/submissions") ||
      path.includes("/tasks") ||
      path.includes("/standings") ||
      path.includes("/contests/archive")
    ) {
      return true;
    }
  }

  return false;
}

function isStrongProgrammingOpportunity(item) {
  if (isOfficialApi(item)) return true;
  if (hasFutureDate(item) && isDirectOpportunityUrl(item)) return true;
  if (isKnownUpcomingListingPage(item)) return true;

  return false;
}

function verifySmallWinOpportunity(item, profile) {
  const problems = [];
  const boosts = [];

  let qualityScore = Number(item.matchScore || 0);
  const text = itemText(item);
  const rawScore = Number(item.rawScore || 0);

  if (!item.url || !item.title) {
    problems.push("missing_url_or_title");
    qualityScore -= 100;
  }

  if (item.verifiedDomain || isOfficialApi(item)) {
    boosts.push("verified_or_official_source");
    qualityScore += 6;
  } else {
    problems.push("not_verified_domain");
    qualityScore -= 40;
  }

  if (isOfficialApi(item)) {
    boosts.push("official_api");
    qualityScore += 30;
  }

  if (hasFutureDate(item)) {
    boosts.push("future_date_confirmed");
    qualityScore += 24;
  }

  if (hasDate(item) && !hasFutureDate(item)) {
    problems.push("date_passed_or_invalid");
    qualityScore -= 60;
  }

  if (!hasDate(item) && !isOfficialApi(item)) {
    problems.push("date_missing_verify_first");
    qualityScore -= 35;
  }

  if (isClearlyEnded(item)) {
    problems.push("ended_or_closed_signal");
    qualityScore -= 100;
  }

  if (hasPastYearOnly(item)) {
    problems.push("past_year_only");
    qualityScore -= 70;
  }

  if (isBlogPath(item) && !hasFutureDate(item)) {
    problems.push("blog_article_page");
    qualityScore -= 70;
  }

  if (isGenericStaticPage(item) && !hasFutureDate(item)) {
    problems.push("generic_static_page");
    qualityScore -= 65;
  }

  if (hasOpportunitySignal(item)) {
    boosts.push("opportunity_signal_found");
    qualityScore += 4;
  } else if (!isOfficialApi(item)) {
    problems.push("no_opportunity_signal");
    qualityScore -= 35;
  }

  if (isDirectOpportunityUrl(item)) {
    boosts.push("direct_opportunity_url");
    qualityScore += 4;
  } else if (!isOfficialApi(item)) {
    problems.push("not_direct_opportunity_url");
    qualityScore -= 25;
  }

  if (rawScore > 0 && rawScore < 0.08 && !isOfficialApi(item) && !hasFutureDate(item)) {
    problems.push("low_search_confidence");
    qualityScore -= 25;
  }

  if (profile.field === "programming") {
    const domain = lower(item?.domain || getDomain(item?.url));
    const path = getUrlPath(item?.url);

    if (domain.includes("codeforces.com") && path.includes("/contests/with/")) {
      problems.push("codeforces_user_contest_history_page");
      qualityScore -= 120;
    }

    if (isProgrammingLearningOrStaticUrl(item)) {
      problems.push("programming_learning_or_static_page");
      qualityScore -= 100;
    }

    if (
      hasAny(text, [
        "hiring",
        "screening",
        "developer screening",
        "interview",
        "guide to competitive programming",
        "learn and practice",
        "workshops",
        "past workshops",
        "career fair",
        "job",
        "land your dream job",
      ]) &&
      !hasFutureDate(item)
    ) {
      problems.push("programming_article_not_contest");
      qualityScore -= 95;
    }

    if (
      hasAny(text, [
        "contest is over",
        "recent contests",
        "contest archive",
        "editorial",
        "past contests",
        "post archive",
      ]) &&
      !hasFutureDate(item)
    ) {
      problems.push("programming_old_contest_page");
      qualityScore -= 95;
    }

    if (!hasFutureDate(item) && !isProgrammingNoDateAllowed(item)) {
      problems.push("programming_date_missing_rejected");
      qualityScore -= 110;
    }

    if (isStrongProgrammingOpportunity(item)) {
      boosts.push("strong_programming_opportunity");
      qualityScore += 20;
    }
  }

  if (profile.field === "hackathon") {
    if (
      hasAny(text, ["api to use", "how to", "related posts", "blog"]) &&
      !hasFutureDate(item)
    ) {
      problems.push("hackathon_blog_not_event");
      qualityScore -= 65;
    }

    if (lower(item.domain).startsWith("news.") && !hasFutureDate(item)) {
      problems.push("hackathon_news_not_event");
      qualityScore -= 65;
    }
  }

  if (profile.field === "scholarship") {
    if (
      !hasAny(text, [
        "scholarship",
        "funding",
        "fellowship",
        "financial aid",
        "apply",
        "deadline",
        "eligibility",
        "students",
        "international",
      ])
    ) {
      problems.push("scholarship_signal_missing");
      qualityScore -= 50;
    }
  }

  if (profile.field === "research") {
    if (
      !hasAny(text, [
        "research",
        "program",
        "student",
        "undergraduate",
        "graduate",
        "call for papers",
        "submission",
        "lab",
        "internship",
        "fellowship",
      ])
    ) {
      problems.push("research_signal_missing");
      qualityScore -= 45;
    }
  }

  if (profile.field === "internship") {
    if (
      !hasAny(text, [
        "intern",
        "internship",
        "student program",
        "early career",
        "apply",
        "university",
        "summer",
        "role",
      ])
    ) {
      problems.push("internship_signal_missing");
      qualityScore -= 45;
    }
  }

  const officialRelaxedAccepted =
    isRelaxableApplicationField(profile) &&
    isOfficialEducationalOrApplicationDomain(item) &&
    hasApplicationSignal(item) &&
    !isClearlyEnded(item) &&
    !hasPastYearOnly(item);

  if (officialRelaxedAccepted) {
    boosts.push("official_application_page_relaxed");
    qualityScore += 45;

    const dateIndex = problems.indexOf("date_missing_verify_first");
    if (dateIndex >= 0) problems.splice(dateIndex, 1);

    const directIndex = problems.indexOf("not_direct_opportunity_url");
    if (directIndex >= 0) problems.splice(directIndex, 1);

    const signalIndex = problems.indexOf("no_opportunity_signal");
    if (signalIndex >= 0) problems.splice(signalIndex, 1);

    item.needsDateVerification = !hasDate(item);
  }

  qualityScore = Math.max(0, Math.min(100, Math.round(qualityScore)));

  const reject =
    problems.includes("missing_url_or_title") ||
    problems.includes("ended_or_closed_signal") ||
    problems.includes("past_year_only") ||
    problems.includes("codeforces_user_contest_history_page") ||
    problems.includes("programming_learning_or_static_page") ||
    problems.includes("programming_article_not_contest") ||
    problems.includes("programming_old_contest_page") ||
    problems.includes("programming_date_missing_rejected") ||
    problems.includes("hackathon_blog_not_event") ||
    problems.includes("hackathon_news_not_event") ||
    (!officialRelaxedAccepted && problems.includes("scholarship_signal_missing")) ||
    (!officialRelaxedAccepted && problems.includes("research_signal_missing")) ||
    (!officialRelaxedAccepted && problems.includes("internship_signal_missing")) ||
    (!officialRelaxedAccepted && problems.includes("blog_article_page") && qualityScore < 80) ||
    (!officialRelaxedAccepted && problems.includes("generic_static_page") && qualityScore < 80) ||
    qualityScore < (officialRelaxedAccepted ? 45 : 55);

  const strictLabel =
    qualityScore >= 90
      ? "Top verified upcoming opportunity"
      : qualityScore >= 75
        ? "Strong verified opportunity"
        : qualityScore >= 60
          ? officialRelaxedAccepted && item.needsDateVerification
            ? "Official page — verify deadline first"
            : "Useful but verify details"
          : qualityScore >= 45
            ? "Low confidence but usable"
            : "Rejected";

  return {
    ...item,
    needsDateVerification: Boolean(item.needsDateVerification),
    qualityScore,
    strictLabel,
    qualityProblems: problems,
    qualityBoosts: boosts,
    rejectedByQuality: reject,
    qualityVerified: !reject,
  };
}

/* -------------------------------------------------------------------------- */
/* Dynamic motivation                                                          */
/* -------------------------------------------------------------------------- */

function urgencyText(item = {}) {
  const d = item.daysUntilDeadline ?? item.daysUntilStart;

  if (item.needsDateVerification) {
    return {
      level: "verify",
      text: "এই source official মনে হচ্ছে, কিন্তু deadline clear না. আজকের কাজ হলো deadline/eligibility verify করা।",
    };
  }

  if (typeof d !== "number") {
    return {
      level: "verify",
      text: "date clear না — তাই এটা top priority না. আগে source খুলে deadline/start time verify করো, তারপর action নাও।",
    };
  }

  if (d === 0) {
    return {
      level: "today",
      text: "এটা আজ/খুব soon. Perfect ছোট action হলো এখনই source খুলে first step নেওয়া।",
    };
  }

  if (d <= 3) {
    return {
      level: "urgent",
      text: `${d} দিনের মধ্যে action দরকার. আজ ৩০ মিনিট দিলে তুমি পিছিয়ে থাকবে না।`,
    };
  }

  if (d <= 14) {
    return {
      level: "soon",
      text: `${d} দিন সময় আছে. আজ tiny start করলে preparation manageable হবে।`,
    };
  }

  return {
    level: "future",
    text: `${d} দিন সময় আছে. এখন save + first checklist বানানোই smart move।`,
  };
}

function identityByField(field) {
  const map = {
    programming: "problem solver",
    hackathon: "builder",
    scholarship: "applicant",
    ielts_english: "communicator",
    research: "research learner",
    math_science: "analytical thinker",
    design_creative: "creator",
    writing: "writer",
    business_startup: "starter",
    internship: "career builder",
    workshop_course: "active learner",
    general: "learner",
  };

  return map[field] || "learner";
}

function firstActionByField(field) {
  const map = {
    programming: "একটা easiest problem attempt করো",
    hackathon: "problem + user + one feature লিখো",
    scholarship: "eligibility + document checklist বানাও",
    ielts_english: "একটা ৬০-second speaking বা one paragraph practice করো",
    research: "একটা research interest sentence লিখো",
    math_science: "একটা সহজ problem attempt করে stuck point লিখো",
    design_creative: "একটা rough sketch বা moodboard বানাও",
    writing: "৫ লাইনের outline লিখো",
    business_startup: "problem + customer + solution ৩ লাইনে লিখো",
    internship: "one role খুলে requirement checklist বানাও",
    workshop_course: "source খুলে first lesson/session save করো",
    general: "source খুলে one tiny action complete করো",
  };

  return map[field] || map.general;
}

function feelingMessage(feeling) {
  const f = lower(feeling);

  if (f === "failed") {
    return "Fail করা proof যে তুমি চেষ্টা করেছো. এখন comeback শুরু হবে খুব ছোট একটা visible win দিয়ে.";
  }

  if (f === "demotivated") {
    return "Motivation আসার জন্য wait করলে শুরু হবে না. ১০ মিনিট action নিলে motivation পরে আসবে.";
  }

  if (f === "confused") {
    return "Confusion কমে যখন next step clear হয়. আজ তোমার কাজ শুধু একটাই.";
  }

  if (f === "scared") {
    return "ভয় থাকলে mission ছোট করো. Apply/compete না, আজ শুধু verify + first step.";
  }

  return "আজ বড় success দরকার নেই. শুধু one proof of progress দরকার.";
}

function buildDynamicSmallWinMotivation(profile = {}, item = {}) {
  const field = profile.field || item.field || "general";
  const minutes = Math.min(Number(profile.dailyTimeMinutes || 30), 30);
  const identity = identityByField(field);
  const urgency = urgencyText(item);
  const firstAction = firstActionByField(field);

  const quality = Number(item.qualityScore ?? item.matchScore ?? 0);
  const trust = item.sourceTrust || (item.verifiedDomain ? "high" : "medium");

  const headline =
    item.needsDateVerification
      ? "এটা official হতে পারে — আগে deadline verify করো."
      : quality >= 90
        ? "এটা তোমার জন্য strong real small-win."
        : quality >= 75
          ? "এটা ভালো verified opportunity."
          : "এটা useful হতে পারে, কিন্তু details verify করবে.";

  const motivation = [
    feelingMessage(profile.feeling),
    `আজ তুমি শুধু student না — তুমি একজন ${identity}.`,
    headline,
    urgency.text,
    `তোমার ${minutes} মিনিটের mission: ${firstAction}.`,
  ].join(" ");

  const coachPlan = [
    {
      step: "Open",
      text: "Real source link খুলে title, deadline/start time, eligibility দেখো।",
    },
    {
      step: "Act",
      text: `${minutes} মিনিট timer দিয়ে ${firstAction}.`,
    },
    {
      step: "Proof",
      text: item?.mission?.proofOfWin || "একটা screenshot/note/link proof হিসেবে save করো।",
    },
    {
      step: "Continue",
      text: item?.mission?.nextStep || "আগামীকাল next smallest step করবে।",
    },
  ];

  return {
    motivationHeadline: headline,
    dynamicMotivation: motivation,
    urgencyLevel: urgency.level,
    studentIdentity: identity,
    trustMessage:
      trust === "high"
        ? "Source trusted/official domain থেকে এসেছে."
        : "Source verify করে action নাও.",
    coachPlan,
    poweredBy: "rules",
  };
}

function attachDynamicMotivation(opportunities = [], profile = {}) {
  return opportunities.map((item) => {
    const aiCoach = buildDynamicSmallWinMotivation(profile, item);

    return {
      ...item,
      aiCoach,
      mission: {
        ...(item.mission || {}),
        recoveryMessage: aiCoach.dynamicMotivation,
      },
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Optional Cloud Gemma Motivation                                             */
/* -------------------------------------------------------------------------- */

function getSmallWinGemmaUrl() {
  return (
    process.env.SMALL_WIN_GEMMA_URL ||
    process.env.OLLAMA_CLOUD_URL ||
    process.env.OLLAMA_LOCAL_URL ||
    ""
  );
}

function getSmallWinGemmaModel() {
  return (
    process.env.SMALL_WIN_GEMMA_MODEL ||
    process.env.OLLAMA_CLOUD_MODEL ||
    process.env.OLLAMA_MODEL ||
    "gemma4:e4b-it-q4_K_M"
  );
}

function parseJsonLoose(text) {
  const raw = clean(text);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");

    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }

    return null;
  }
}

async function callSmallWinGemmaMotivation(profile, item) {
  const url = getSmallWinGemmaUrl();
  const model = getSmallWinGemmaModel();

  if (!url || process.env.SMALL_WIN_USE_GEMMA === "false") {
    return null;
  }

  const timeoutMs = Number(process.env.SMALL_WIN_GEMMA_TIMEOUT_MS || 120000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const prompt = `
You are a strict student recovery coach.

Write a SHORT, powerful, practical motivation for this student.
Do NOT invent fake dates.
Do NOT sound generic.
Use Bangla-English natural language.
Focus on one tiny action, proof, and next step.
If qualityProblems includes date_missing_verify_first or needsDateVerification is true, say verify deadline first and do not call it urgent.
If daysUntilStart/daysUntilDeadline exists, mention the time pressure correctly.

Return ONLY JSON:
{
  "motivationHeadline": "...",
  "dynamicMotivation": "...",
  "coachPlan": [
    {"step":"Open","text":"..."},
    {"step":"Act","text":"..."},
    {"step":"Proof","text":"..."},
    {"step":"Continue","text":"..."}
  ]
}

Student:
field=${profile.field}
level=${profile.level}
feeling=${profile.feeling}
goal=${profile.goal}
dailyTimeMinutes=${profile.dailyTimeMinutes}

Opportunity:
title=${item.title}
url=${item.url}
source=${item.source}
qualityScore=${item.qualityScore}
strictLabel=${item.strictLabel}
daysUntilStart=${item.daysUntilStart}
daysUntilDeadline=${item.daysUntilDeadline}
needsDateVerification=${item.needsDateVerification}
qualityProblems=${JSON.stringify(item.qualityProblems || [])}
mission=${JSON.stringify(item.mission || {})}
`.trim();

  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: 0.35,
          num_ctx: Number(process.env.OLLAMA_NUM_CTX || 4096),
          num_predict: 700,
        },
      }),
    });

    const data = await res.json();
    const parsed = parseJsonLoose(data.response || data.message?.content || "");

    if (!parsed?.dynamicMotivation) return null;

    return {
      motivationHeadline: clean(parsed.motivationHeadline).slice(0, 220),
      dynamicMotivation: clean(parsed.dynamicMotivation).slice(0, 1400),
      coachPlan: Array.isArray(parsed.coachPlan)
        ? parsed.coachPlan.slice(0, 4).map((x) => ({
            step: clean(x.step).slice(0, 50),
            text: clean(x.text).slice(0, 300),
          }))
        : null,
      poweredBy: "cloud_gemma",
    };
  } catch (err) {
    console.warn("[small-win/gemma-motivation] failed:", err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function attachGemmaMotivation(opportunities = [], profile = {}) {
  if (process.env.SMALL_WIN_USE_GEMMA === "false") {
    return opportunities;
  }

  const max = Math.min(
    Number(process.env.SMALL_WIN_GEMMA_MOTIVATION_LIMIT || 3),
    opportunities.length
  );

  const updated = [...opportunities];

  for (let i = 0; i < max; i += 1) {
    const item = updated[i];
    const gemmaCoach = await callSmallWinGemmaMotivation(profile, item);

    if (gemmaCoach) {
      updated[i] = {
        ...item,
        aiCoach: {
          ...(item.aiCoach || {}),
          ...gemmaCoach,
          urgencyLevel: item.aiCoach?.urgencyLevel,
          studentIdentity: item.aiCoach?.studentIdentity,
          trustMessage: item.aiCoach?.trustMessage,
          coachPlan: gemmaCoach.coachPlan || item.aiCoach?.coachPlan,
        },
        mission: {
          ...(item.mission || {}),
          recoveryMessage: gemmaCoach.dynamicMotivation,
        },
      };
    }
  }

  return updated;
}

/* -------------------------------------------------------------------------- */
/* Fetchers                                                                    */
/* -------------------------------------------------------------------------- */

async function fetchCodeforces(profile) {
  const cacheKey = "smallwin:source:codeforces";
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const res = await fetchJson("https://codeforces.com/api/contest.list?gym=false", {
    timeoutMs: 20000,
  });

  if (!res.ok || res.data?.status !== "OK" || !Array.isArray(res.data?.result)) {
    return {
      source: "Codeforces official API",
      ok: false,
      error: res.error || res.data?.comment || "Codeforces failed",
      items: [],
    };
  }

  const programmingProfile = {
    ...profile,
    field: "programming",
  };

  const items = res.data.result
    .filter((contest) => contest.phase === "BEFORE")
    .map((contest) => {
      const startAt = contest.startTimeSeconds
        ? new Date(Number(contest.startTimeSeconds) * 1000).toISOString()
        : null;

      return normalizeOpportunity(
        {
          title: contest.name,
          description: `Upcoming Codeforces contest. Duration: ${Math.round(
            Number(contest.durationSeconds || 0) / 60
          )} minutes.`,
          url: "https://codeforces.com/contests",
          source: "Codeforces official API",
          sourceMode: "official_public_api",
          platform: "Codeforces",
          type: "contest",
          startAt,
          deadlineAt: startAt,
          level: inferLevel(contest.name),
          tags: ["programming", "contest", "competitive programming"],
          rawScore: 1,
          verifiedDomain: true,
        },
        programmingProfile
      );
    });

  const out = {
    source: "Codeforces official API",
    ok: true,
    count: items.length,
    items,
  };

  cacheSet(cacheKey, out);
  return out;
}

async function tavilySearch(query) {
  if (!process.env.TAVILY_API_KEY || process.env.SMALL_WIN_USE_TAVILY === "false") {
    return {
      ok: false,
      error: "TAVILY_API_KEY missing or SMALL_WIN_USE_TAVILY=false",
      results: [],
    };
  }

  const body = {
    query,
    search_depth: "advanced",
    max_results: 10,
    include_answer: false,
    include_raw_content: false,
    include_images: false,
  };

  const res = await fetchJson("https://api.tavily.com/search", {
    method: "POST",
    timeoutMs: 25000,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return {
      ok: false,
      error: res.error || "Tavily failed",
      results: [],
    };
  }

  return {
    ok: true,
    results: Array.isArray(res.data?.results) ? res.data.results : [],
  };
}

async function fetchTavilyVerified(profile) {
  const cacheKey = `smallwin:source:tavily:v3.3:${sha(JSON.stringify(profile)).slice(0, 16)}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const queries = buildTavilyQueries(profile);
  const fieldConfig = SMALL_WIN_FIELDS[profile.field] || SMALL_WIN_FIELDS.general;

  const items = [];
  const errors = [];

  if (!process.env.TAVILY_API_KEY || process.env.SMALL_WIN_USE_TAVILY === "false") {
    return {
      source: "Tavily verified domain search",
      ok: false,
      error: "TAVILY_API_KEY missing or disabled",
      queries,
      items: [],
    };
  }

  for (const query of queries) {
    const result = await tavilySearch(query);

    if (!result.ok) {
      errors.push({
        query,
        error: result.error,
      });
      continue;
    }

    for (const r of result.results) {
      const url = normalizeUrl(r.url);
      const domain = getDomain(url);
      const title = clean(r.title);
      const description = clean(r.content || r.snippet || "");

      if (!url || !title) continue;

      const verifiedDomain = domainMatches(domain, fieldConfig.trustedDomains);

      if (profile.strictOnly && !verifiedDomain) continue;

      items.push(
        normalizeOpportunity(
          {
            title,
            description,
            url,
            source: "Tavily verified domain search",
            sourceMode: verifiedDomain
              ? "search_api_verified_domain"
              : "search_api_unverified",
            platform: domain,
            rawScore: Number(r.score || 0),
            tags: ["live_search", profile.field],
            verifiedDomain,
          },
          profile
        )
      );
    }
  }

  const out = {
    source: "Tavily verified domain search",
    ok: items.length > 0,
    count: items.length,
    queries,
    errors,
    items,
  };

  cacheSet(cacheKey, out);
  return out;
}

async function fetchYouTube(profile) {
  if (
    !process.env.YOUTUBE_API_KEY ||
    process.env.SMALL_WIN_USE_YOUTUBE === "false" ||
    profile.includeVideos === false
  ) {
    return {
      source: "YouTube Data API",
      ok: false,
      error: "YOUTUBE_API_KEY missing or disabled",
      items: [],
    };
  }

  const queryByField = {
    programming: "competitive programming beginner practice contest",
    ielts_english: "IELTS speaking writing practice beginner",
    math_science: "math olympiad beginner practice problems",
    design_creative: "UI UX design challenge beginner portfolio",
    business_startup: "startup pitch competition student beginner",
    workshop_course: "student beginner workshop free course",
    general: "student beginner learning challenge free",
  };

  const q =
    queryByField[profile.field] ||
    `${SMALL_WIN_FIELDS[profile.field]?.label || "student"} beginner practice`;

  const params = new URLSearchParams({
    key: process.env.YOUTUBE_API_KEY,
    part: "snippet",
    type: "video",
    maxResults: "8",
    q,
    safeSearch: "moderate",
    relevanceLanguage: "en",
  });

  const res = await fetchJson(
    `https://www.googleapis.com/youtube/v3/search?${params.toString()}`,
    {
      timeoutMs: 20000,
    }
  );

  if (!res.ok) {
    return {
      source: "YouTube Data API",
      ok: false,
      error: res.error || "YouTube failed",
      items: [],
    };
  }

  const videos = Array.isArray(res.data?.items) ? res.data.items : [];

  const items = videos
    .map((v) => {
      const videoId = v.id?.videoId;
      if (!videoId) return null;

      const title = clean(v.snippet?.title);
      const description = clean(v.snippet?.description);
      const publishedAt = safeDate(v.snippet?.publishedAt);

      return normalizeOpportunity(
        {
          title,
          description,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          source: "YouTube Data API",
          sourceMode: "official_api_learning_resource",
          platform: "YouTube",
          type: "practice",
          startAt: publishedAt,
          tags: ["video", "practice", profile.field],
          verifiedDomain: true,
        },
        {
          ...profile,
          strictOnly: false,
        }
      );
    })
    .filter(Boolean);

  return {
    source: "YouTube Data API",
    ok: items.length > 0,
    count: items.length,
    query: q,
    items,
  };
}

async function fetchEventbrite(profile) {
  const token = getEventbriteToken();

  if (!token || process.env.SMALL_WIN_USE_EVENTBRITE === "false") {
    return {
      source: "Eventbrite API",
      ok: false,
      error: "EVENTBRITE_TOKEN missing or disabled",
      items: [],
    };
  }

  const fieldKeywords = {
    hackathon: "hackathon student",
    business_startup: "startup pitch student",
    workshop_course: "student workshop",
    design_creative: "design workshop student",
    writing: "writing workshop student",
    general: "student workshop",
  };

  const q = fieldKeywords[profile.field] || "student workshop";

  const params = new URLSearchParams({
    q,
    expand: "venue",
    sort_by: "date",
  });

  if (profile.locationMode === "country" && profile.country) {
    params.set("location.address", profile.country);
  } else {
    params.set("online_events_only", "true");
  }

  const res = await fetchJson(
    `https://www.eventbriteapi.com/v3/events/search/?${params.toString()}`,
    {
      timeoutMs: 22000,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!res.ok) {
    return {
      source: "Eventbrite API",
      ok: false,
      error: res.error || "Eventbrite failed",
      items: [],
    };
  }

  const events = Array.isArray(res.data?.events) ? res.data.events : [];

  const items = events
    .map((event) => {
      const title = clean(event.name?.text);
      const description = clean(event.description?.text);
      const url = normalizeUrl(event.url);
      const startAt = safeDate(event.start?.utc);
      const deadlineAt = safeDate(event.end?.utc);

      if (!title || !url) return null;

      return normalizeOpportunity(
        {
          title,
          description,
          url,
          source: "Eventbrite API",
          sourceMode: "official_api_event",
          platform: "Eventbrite",
          type: inferType(profile.field, `${title}. ${description}`),
          startAt,
          deadlineAt,
          tags: ["event", "workshop", profile.field],
          verifiedDomain: true,
        },
        {
          ...profile,
          strictOnly: false,
        }
      );
    })
    .filter(Boolean);

  return {
    source: "Eventbrite API",
    ok: items.length > 0,
    count: items.length,
    query: q,
    items,
  };
}

/* -------------------------------------------------------------------------- */
/* Pipeline helpers                                                            */
/* -------------------------------------------------------------------------- */

function dedupe(items) {
  const map = new Map();

  for (const item of items) {
    if (!item?.title || !item?.url) continue;

    const normalizedUrl = normalizeUrl(item.url);
    const domain = lower(item.domain || getDomain(item.url));
    const title = lower(item.title);

    let key = normalizedUrl || `${title}:${item.source}`;

    if (domain.includes("devpost.com") && item.url.includes("/hackathons")) {
      key = `devpost:hackathons:${title}`;
    }

    if (domain.includes("codeforces.com") && getUrlPath(item.url) === "/contests") {
      key = `codeforces:contests:${title}:${item.startAt || ""}`;
    }

    const existing = map.get(key);

    if (!existing || (item.qualityScore || item.matchScore || 0) > (existing.qualityScore || existing.matchScore || 0)) {
      map.set(key, item);
    }
  }

  return Array.from(map.values());
}

function filterByDate(items, profile) {
  return items.filter((item) => {
    if (profile.includeExpired) return true;

    const d = item.daysUntilDeadline ?? item.daysUntilStart;

    if (typeof d !== "number") return true;
    if (d < -2) return false;
    if (d > profile.maxDaysAhead) return false;

    return true;
  });
}

async function runSources(profile) {
  const tasks = [];

  if (profile.field === "programming") {
    tasks.push(fetchCodeforces(profile));
  }

  tasks.push(fetchTavilyVerified(profile));

  if (
    [
      "hackathon",
      "business_startup",
      "workshop_course",
      "design_creative",
      "writing",
      "general",
    ].includes(profile.field)
  ) {
    tasks.push(fetchEventbrite(profile));
  }

  if (
    [
      "programming",
      "ielts_english",
      "math_science",
      "design_creative",
      "business_startup",
      "workshop_course",
      "general",
    ].includes(profile.field)
  ) {
    tasks.push(fetchYouTube(profile));
  }

  const settled = await Promise.allSettled(tasks);

  return settled.map((r) => {
    if (r.status === "fulfilled") return r.value;

    return {
      source: "unknown",
      ok: false,
      error: r.reason?.message || "source crashed",
      items: [],
    };
  });
}

function buildWarnings(profile, sources, opportunities, qualityCheckedItems = []) {
  const warnings = [];

  if (!process.env.TAVILY_API_KEY) {
    warnings.push("TAVILY_API_KEY missing: non-programming categories-এর verified live search weak হবে.");
  }

  if (profile.field !== "programming" && !process.env.TAVILY_API_KEY) {
    warnings.push("এই field-এর জন্য Tavily key দরকার, কারণ official universal API নেই.");
  }

  if (!opportunities.length) {
    warnings.push("No high-quality verified opportunity found. API key, field, location, strictOnly, or source query check করো.");
  }

  const missingDate = opportunities.filter((x) => !x.deadlineAt && !x.startAt).length;
  if (missingDate) {
    warnings.push(`${missingDate} accepted result-এর date parse হয়নি. UI-তে Verify date badge দেখাবে.`);
  }

  const needsDateVerification = opportunities.filter((x) => x.needsDateVerification).length;
  if (needsDateVerification) {
    warnings.push(`${needsDateVerification} official result accepted, but deadline/eligibility must be verified by user.`);
  }

  const unverified = opportunities.filter((x) => !x.verifiedDomain).length;
  if (unverified) {
    warnings.push(`${unverified} result trusted-domain verified না. এগুলো lower confidence.`);
  }

  const rejected = qualityCheckedItems.filter((x) => x.rejectedByQuality).length;
  if (rejected) {
    warnings.push(`${rejected} low-quality/static/old results rejected.`);
  }

  const ended = qualityCheckedItems.filter((x) =>
    x.qualityProblems?.includes("ended_or_closed_signal")
  ).length;
  if (ended) {
    warnings.push(`${ended} ended/closed opportunities rejected.`);
  }

  const articles = qualityCheckedItems.filter((x) =>
    x.qualityProblems?.includes("blog_article_page") ||
    x.qualityProblems?.includes("hackathon_blog_not_event") ||
    x.qualityProblems?.includes("hackathon_news_not_event") ||
    x.qualityProblems?.includes("programming_article_not_contest") ||
    x.qualityProblems?.includes("programming_learning_or_static_page") ||
    x.qualityProblems?.includes("programming_date_missing_rejected") ||
    x.qualityProblems?.includes("codeforces_user_contest_history_page")
  ).length;
  if (articles) {
    warnings.push(`${articles} blog/static/date-missing non-opportunity pages rejected.`);
  }

  return warnings;
}

function buildExperience(profile, opportunities) {
  const topMissions = opportunities.slice(0, 3);

  return {
    hero: topMissions[0]
      ? {
          title: "Your best real small win is ready",
          subtitle: topMissions[0].title,
          score: topMissions[0].qualityScore ?? topMissions[0].matchScore,
          missionId: topMissions[0].id,
          strictLabel: topMissions[0].strictLabel,
        }
      : {
          title: "No high-quality small win found yet",
          subtitle: "Field/location broaden করো অথবা strictOnly=false দিয়ে exploration করো.",
          score: 0,
          missionId: null,
          strictLabel: "No verified result",
        },

    recoveryPath: [
      {
        step: "Fail / weak moment",
        text: `Current feeling: ${profile.feeling}`,
      },
      {
        step: "Find real source",
        text: `${opportunities.length} high-quality verified/real items matched.`,
      },
      {
        step: "Start tiny mission",
        text: topMissions[0]?.mission?.exactAction || "Pick one mission.",
      },
      {
        step: "Prove progress",
        text: topMissions[0]?.mission?.proofOfWin || "Save one proof.",
      },
      {
        step: "Continue tomorrow",
        text: topMissions[0]?.mission?.nextStep || "Do the next smallest step.",
      },
    ],

    topMissions,
    otherMissions: opportunities.slice(3),
  };
}

/* -------------------------------------------------------------------------- */
/* Main exports                                                                */
/* -------------------------------------------------------------------------- */

export async function findSmallWinOpportunities(input = {}) {
  const profile = normalizeSmallWinProfile(input);
  const cacheKey = `smallwin:final:v3.3:${sha(JSON.stringify(profile)).slice(0, 24)}`;

  const cached = cacheGet(cacheKey);
  if (cached) {
    return {
      ...cached,
      cache: {
        hit: true,
        key: cacheKey,
        ttlMs: CACHE_TTL_MS,
      },
    };
  }

  const sources = await runSources(profile);
  const rawItems = sources.flatMap((source) => (Array.isArray(source.items) ? source.items : []));
  const realItems = rawItems.filter((item) => item.real && item.url && item.title);

  const strictItems = profile.strictOnly
    ? realItems.filter((item) => item.verifiedDomain || item.sourceMode?.includes("official_api"))
    : realItems;

  const dateFiltered = filterByDate(strictItems, profile);
  const dedupedItems = dedupe(dateFiltered);
  const qualityCheckedItems = dedupedItems.map((item) => verifySmallWinOpportunity(item, profile));

  const qualityRankedItems = qualityCheckedItems
    .filter((item) => !item.rejectedByQuality)
    .sort((a, b) => {
      const aVerifyOnly = a.qualityProblems?.includes("date_missing_verify_first") || a.needsDateVerification ? 1 : 0;
      const bVerifyOnly = b.qualityProblems?.includes("date_missing_verify_first") || b.needsDateVerification ? 1 : 0;

      if (aVerifyOnly !== bVerifyOnly) {
        return aVerifyOnly - bVerifyOnly;
      }

      if ((b.qualityScore || 0) !== (a.qualityScore || 0)) {
        return (b.qualityScore || 0) - (a.qualityScore || 0);
      }

      const ad = a.daysUntilDeadline ?? a.daysUntilStart ?? 9999;
      const bd = b.daysUntilDeadline ?? b.daysUntilStart ?? 9999;

      return ad - bd;
    });

  const ruleCoachOpportunities = attachDynamicMotivation(
    qualityRankedItems.slice(0, profile.limit),
    profile
  );

  const opportunities = await attachGemmaMotivation(ruleCoachOpportunities, profile);

  const response = {
    ok: true,
    mode: "final_real_small_win_engine_v3_3_quality_gemma_verified",
    generatedAt: nowIso(),
    profile,
    fieldMeta: SMALL_WIN_FIELDS[profile.field],
    apiKeys: {
      tavily: Boolean(process.env.TAVILY_API_KEY),
      youtube: Boolean(process.env.YOUTUBE_API_KEY),
      eventbrite: Boolean(getEventbriteToken()),
      gemma: Boolean(getSmallWinGemmaUrl()),
    },
    sources: sources.map((s) => ({
      source: s.source,
      ok: Boolean(s.ok),
      count: s.count || s.items?.length || 0,
      error: s.error || null,
      query: s.query || undefined,
      queries: s.queries || undefined,
      errors: s.errors || undefined,
    })),
    totalRaw: rawItems.length,
    totalReal: realItems.length,
    totalStrict: strictItems.length,
    totalAfterDateFilter: dateFiltered.length,
    totalAfterDedupe: dedupedItems.length,
    qualityChecked: qualityCheckedItems.length,
    qualityRejected: qualityCheckedItems.filter((item) => item.rejectedByQuality).length,
    count: opportunities.length,
    opportunities,
    rejectedPreview: qualityCheckedItems
      .filter((item) => item.rejectedByQuality)
      .slice(0, 12)
      .map((item) => ({
        title: item.title,
        url: item.url,
        domain: item.domain,
        qualityScore: item.qualityScore,
        qualityProblems: item.qualityProblems,
      })),
    warnings: buildWarnings(profile, sources, opportunities, qualityCheckedItems),
    experience: buildExperience(profile, opportunities),
    cache: {
      hit: false,
      key: cacheKey,
      ttlMs: CACHE_TTL_MS,
    },
  };

  cacheSet(cacheKey, response);
  return response;
}

export async function smallWinHealth() {
  const codeforces = await fetchCodeforces(
    normalizeSmallWinProfile({
      field: "programming",
      level: "beginner",
    })
  ).catch((err) => ({
    ok: false,
    error: err.message,
    items: [],
  }));

  return {
    ok: true,
    service: "small-win-final-backend",
    version: "v3.3-quality-gemma-verified",
    generatedAt: nowIso(),
    apiKeys: {
      tavily: Boolean(process.env.TAVILY_API_KEY),
      youtube: Boolean(process.env.YOUTUBE_API_KEY),
      eventbrite: Boolean(getEventbriteToken()),
      gemma: Boolean(getSmallWinGemmaUrl()),
    },
    publicSources: {
      codeforces: {
        ok: Boolean(codeforces.ok),
        count: codeforces.items?.length || 0,
        error: codeforces.error || null,
      },
    },
    qualityLayer: {
      enabled: true,
      rejectsOldEnded: true,
      rejectsBlogArticles: true,
      rejectsGenericPages: true,
      rejectsDateMissingProgrammingPages: true,
      rejectsCodeChefGuideWorkshops: true,
      rejectsHackerRankOldCodeSprint: true,
      rejectsCodeforcesUserHistoryPages: true,
      allowsAtCoderUpcomingListing: true,
      allowsCodeforcesOfficialApi: true,
      relaxesOfficialScholarshipResearchInternshipPages: true,
      verifyDateNotTop: true,
      dynamicMotivation: true,
      cloudGemmaMotivation: Boolean(getSmallWinGemmaUrl()),
    },
    supportedFields: Object.entries(SMALL_WIN_FIELDS).map(([value, meta]) => ({
      value,
      label: meta.label,
      realThings: meta.realThings,
      trustedDomains: meta.trustedDomains,
    })),
  };
}

export async function debugSmallWinSource(sourceName, input = {}) {
  const profile = normalizeSmallWinProfile(input);

  if (sourceName === "codeforces") {
    return {
      ok: true,
      source: sourceName,
      profile,
      result: await fetchCodeforces(profile),
    };
  }

  if (sourceName === "tavily") {
    return {
      ok: true,
      source: sourceName,
      profile,
      result: await fetchTavilyVerified(profile),
    };
  }

  if (sourceName === "youtube") {
    return {
      ok: true,
      source: sourceName,
      profile,
      result: await fetchYouTube(profile),
    };
  }

  if (sourceName === "eventbrite") {
    return {
      ok: true,
      source: sourceName,
      profile,
      result: await fetchEventbrite(profile),
    };
  }

  return {
    ok: false,
    message: "Unknown source",
    allowed: ["codeforces", "tavily", "youtube", "eventbrite"],
  };
}
/* eslint-disable no-console */

/**
 * Small-Win Quality Verifier
 * --------------------------
 * Purpose:
 * - keep only real, current/upcoming, useful opportunities
 * - reject old/ended/blog/article/static pages
 * - boost official API + upcoming event pages
 *
 * This fixes weak results like:
 * - "Contest is over"
 * - blog/article pages
 * - generic divisions/help pages
 * - missing date + not official event page
 */

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function daysValue(item) {
  const d = item?.daysUntilDeadline ?? item?.daysUntilStart;
  return typeof d === "number" ? d : null;
}

function hasAny(text, words = []) {
  const t = lower(text);
  return words.some((word) => t.includes(lower(word)));
}

function getUrlPath(url) {
  try {
    return new URL(url).pathname.toLowerCase();
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

const NEGATIVE_END_SIGNALS = [
  "contest is over",
  "contest has ended",
  "has ended",
  "ended",
  "is over",
  "recent contests",
  "past contests",
  "archive",
  "post archive",
  "closed",
  "applications closed",
  "registration closed",
  "deadline passed",
  "no longer accepting",
];

const BLOG_ARTICLE_PATH_SIGNALS = [
  "/blog",
  "/blogs",
  "/news",
  "/writing",
  "/article",
  "/articles",
  "/post",
  "/posts",
  "/resources",
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
];

const OFFICIAL_SOURCE_MODES = [
  "official_public_api",
  "official_api_event",
  "official_api_learning_resource",
];

function isOfficialApi(item) {
  return OFFICIAL_SOURCE_MODES.some((mode) => String(item?.sourceMode || "").includes(mode));
}

function isDirectOpportunityUrl(item) {
  const domain = lower(item?.domain || getDomain(item?.url));
  const path = getUrlPath(item?.url);
  const type = lower(item?.type);

  if (domain.includes("codeforces.com") && path.includes("/contests")) return true;
  if (domain.includes("atcoder.jp") && path.includes("/contests")) return true;
  if (domain.includes("leetcode.com") && path.includes("/contest")) return true;
  if (domain.includes("devpost.com") && path.includes("/hackathons")) return true;
  if (domain.includes("events.mlh.io") && path.includes("/events/")) return true;
  if (domain.includes("ghw.mlh.io")) return true;
  if (domain.includes("eventbrite.com") && path.includes("/e/")) return true;

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

function isClearlyEnded(item) {
  const text = `${item?.title || ""} ${item?.description || ""}`;
  return hasAny(text, NEGATIVE_END_SIGNALS);
}

function isBlogOrGenericPage(item) {
  const text = `${item?.title || ""} ${item?.description || ""}`;
  const path = getUrlPath(item?.url);

  if (hasAny(path, BLOG_ARTICLE_PATH_SIGNALS)) return true;
  if (hasAny(text, GENERIC_PAGE_SIGNALS)) return true;

  return false;
}

function hasOpportunitySignal(item) {
  const text = `${item?.title || ""} ${item?.description || ""}`;
  return hasAny(text, POSITIVE_OPPORTUNITY_SIGNALS);
}

function hasValidFutureDate(item) {
  const d = daysValue(item);
  return typeof d === "number" && d >= 0;
}

function hasDate(item) {
  return Boolean(item?.deadlineAt || item?.startAt);
}

export function verifySmallWinOpportunity(item = {}, profile = {}) {
  const problems = [];
  const boosts = [];
  let qualityScore = Number(item.matchScore || 0);

  const text = `${item.title || ""} ${item.description || ""}`;
  const rawScore = Number(item.rawScore || 0);

  if (!item.url || !item.title) {
    problems.push("missing_url_or_title");
    qualityScore -= 80;
  }

  if (!item.verifiedDomain && !isOfficialApi(item)) {
    problems.push("not_verified_domain");
    qualityScore -= 35;
  } else {
    boosts.push("verified_or_official_source");
    qualityScore += 8;
  }

  if (isOfficialApi(item)) {
    boosts.push("official_api");
    qualityScore += 18;
  }

  if (hasValidFutureDate(item)) {
    boosts.push("future_date_confirmed");
    qualityScore += 16;
  }

  if (hasDate(item) && !hasValidFutureDate(item)) {
    problems.push("date_passed_or_invalid");
    qualityScore -= 35;
  }

  if (!hasDate(item) && !isOfficialApi(item)) {
    problems.push("date_missing_verify_first");
    qualityScore -= 18;
  }

  if (isClearlyEnded(item)) {
    problems.push("ended_or_closed_signal");
    qualityScore -= 70;
  }

  if (isBlogOrGenericPage(item) && !hasValidFutureDate(item)) {
    problems.push("blog_article_or_generic_page");
    qualityScore -= 55;
  }

  if (!hasOpportunitySignal(item) && !isOfficialApi(item)) {
    problems.push("no_opportunity_signal");
    qualityScore -= 30;
  } else {
    boosts.push("opportunity_signal_found");
    qualityScore += 6;
  }

  if (!isDirectOpportunityUrl(item) && !isOfficialApi(item)) {
    problems.push("not_direct_opportunity_url");
    qualityScore -= 18;
  }

  if (rawScore > 0 && rawScore < 0.08 && !isOfficialApi(item)) {
    problems.push("low_search_confidence");
    qualityScore -= 20;
  }

  /**
   * Category-specific strictness
   */
  if (profile.field === "programming") {
    if (hasAny(text, ["hiring", "screening", "developer screening", "interview"]) && !hasValidFutureDate(item)) {
      problems.push("programming_article_not_contest");
      qualityScore -= 50;
    }
  }

  if (profile.field === "hackathon") {
    if (hasAny(text, ["api to use", "how to", "blog", "related posts"]) && !hasValidFutureDate(item)) {
      problems.push("hackathon_blog_not_event");
      qualityScore -= 45;
    }
  }

  qualityScore = Math.max(0, Math.min(100, Math.round(qualityScore)));

  const reject =
    problems.includes("missing_url_or_title") ||
    problems.includes("ended_or_closed_signal") ||
    problems.includes("blog_article_or_generic_page") && qualityScore < 70 ||
    problems.includes("programming_article_not_contest") ||
    problems.includes("hackathon_blog_not_event") ||
    qualityScore < 45;

  const strictLabel =
    qualityScore >= 90
      ? "Top verified upcoming opportunity"
      : qualityScore >= 75
        ? "Strong verified opportunity"
        : qualityScore >= 60
          ? "Useful but verify details"
          : qualityScore >= 45
            ? "Low confidence"
            : "Rejected";

  return {
    ...item,
    qualityScore,
    strictLabel,
    qualityProblems: problems,
    qualityBoosts: boosts,
    rejectedByQuality: reject,
    qualityVerified: !reject,
  };
}

export function filterAndRankSmallWinOpportunities(items = [], profile = {}) {
  const verified = items
    .map((item) => verifySmallWinOpportunity(item, profile))
    .filter((item) => !item.rejectedByQuality)
    .sort((a, b) => {
      if ((b.qualityScore || 0) !== (a.qualityScore || 0)) {
        return (b.qualityScore || 0) - (a.qualityScore || 0);
      }

      const ad = a.daysUntilDeadline ?? a.daysUntilStart ?? 9999;
      const bd = b.daysUntilDeadline ?? b.daysUntilStart ?? 9999;

      return ad - bd;
    });

  return verified;
}

export function buildQualityWarnings(items = []) {
  const rejected = items.filter((item) => item.rejectedByQuality);
  const missingDate = items.filter((item) =>
    item.qualityProblems?.includes("date_missing_verify_first")
  );
  const ended = items.filter((item) =>
    item.qualityProblems?.includes("ended_or_closed_signal")
  );
  const articles = items.filter((item) =>
    item.qualityProblems?.includes("blog_article_or_generic_page")
  );

  const warnings = [];

  if (rejected.length) {
    warnings.push(`${rejected.length} low-quality/static/old results rejected.`);
  }

  if (missingDate.length) {
    warnings.push(`${missingDate.length} results need date verification.`);
  }

  if (ended.length) {
    warnings.push(`${ended.length} ended/closed opportunities rejected.`);
  }

  if (articles.length) {
    warnings.push(`${articles.length} article/blog/generic pages rejected.`);
  }

  return warnings;
}
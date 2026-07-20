import mongoose from "mongoose";

import SmallWinMission from "../models/SmallWinMission.js";

import {
  SMALL_WIN_FIELDS,
  debugSmallWinSource,
  findSmallWinOpportunities,
  smallWinHealth,
} from "../services/smallWin/smallWin.service.js";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function ok(res, data = {}, status = 200) {
  return res.status(status).json({
    ok: true,
    ...data,
  });
}

function fail(res, error) {
  const status = error?.status || error?.statusCode || 500;

  return res.status(status).json({
    ok: false,
    message: error?.message || "Small-Win request failed.",
    code: error?.code || "small_win_error",
  });
}

function getAuthUserId(req) {
  const id = String(req.user?._id || req.user?.id || "").trim();

  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    const error = new Error("Authenticated user id missing.");
    error.status = 401;
    error.code = "auth_user_missing";
    throw error;
  }

  return new mongoose.Types.ObjectId(id);
}

function isValidUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return ["http:", "https:"].includes(u.protocol);
  } catch {
    return false;
  }
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function serializeMission(doc) {
  if (!doc) return null;

  const obj = doc.toObject ? doc.toObject() : doc;

  delete obj.userId;
  delete obj.__v;

  return obj;
}

function validateOpportunityBody(body = {}) {
  const errors = [];

  const field = clean(body.field || "general");

  if (!SMALL_WIN_FIELDS[field]) {
    errors.push({
      field: "field",
      message: `Unsupported field: ${field}`,
      allowed: Object.keys(SMALL_WIN_FIELDS),
    });
  }

  const level = clean(body.level || "beginner");

  if (!["beginner", "intermediate", "advanced"].includes(level)) {
    errors.push({
      field: "level",
      message: "level must be beginner, intermediate, or advanced",
    });
  }

  const locationMode = clean(body.locationMode || "online");

  if (!["online", "country", "hybrid"].includes(locationMode)) {
    errors.push({
      field: "locationMode",
      message: "locationMode must be online, country, or hybrid",
    });
  }

  const dailyTimeMinutes = Number(body.dailyTimeMinutes || 30);

  if (!Number.isFinite(dailyTimeMinutes) || dailyTimeMinutes < 5 || dailyTimeMinutes > 600) {
    errors.push({
      field: "dailyTimeMinutes",
      message: "dailyTimeMinutes must be between 5 and 600",
    });
  }

  const limit = Number(body.limit || 24);

  if (!Number.isFinite(limit) || limit < 1 || limit > 60) {
    errors.push({
      field: "limit",
      message: "limit must be between 1 and 60",
    });
  }

  return errors;
}

function normalizeChecklist(items = []) {
  if (!Array.isArray(items)) return [];

  return items.slice(0, 20).map((item, index) => ({
    id: clean(item.id || `step_${index + 1}`).slice(0, 80),
    label: clean(item.label || item.text || `Step ${index + 1}`).slice(0, 300),
    required: Boolean(item.required),
    done: Boolean(item.done),
    completedAt: item.done ? item.completedAt || new Date() : null,
  }));
}

function normalizeSelectedOpportunity(raw = {}) {
  const url = clean(raw.url);

  if (!url || !isValidUrl(url)) {
    const error = new Error("A real valid opportunity URL is required.");
    error.status = 400;
    error.code = "opportunity_url_required";
    throw error;
  }

  const title = clean(raw.title);

  if (!title) {
    const error = new Error("Opportunity title is required.");
    error.status = 400;
    error.code = "opportunity_title_required";
    throw error;
  }

  const domain = clean(raw.domain || getDomain(url));

  return {
    opportunityId: clean(raw.id || raw.opportunityId),
    title: title.slice(0, 600),
    description: clean(raw.description).slice(0, 5000),
    url,
    domain,
    platform: clean(raw.platform || domain).slice(0, 200),
    source: clean(raw.source).slice(0, 200),
    sourceMode: clean(raw.sourceMode).slice(0, 200),
    sourceTrust: ["low", "medium", "high"].includes(raw.sourceTrust)
      ? raw.sourceTrust
      : raw.verifiedDomain
        ? "high"
        : "medium",
    verifiedDomain: Boolean(raw.verifiedDomain),
    real: raw.real !== false,
    type: clean(raw.type || "opportunity").slice(0, 120),
    level: ["beginner", "intermediate", "advanced", "unknown"].includes(raw.level)
      ? raw.level
      : "unknown",
    matchScore: clampNumber(raw.matchScore, 0, 100, 0),
    matchLabel: clean(raw.matchLabel).slice(0, 120),
    startAt: raw.startAt ? new Date(raw.startAt) : null,
    deadlineAt: raw.deadlineAt ? new Date(raw.deadlineAt) : null,
    tags: Array.isArray(raw.tags) ? raw.tags.map(clean).filter(Boolean).slice(0, 30) : [],
    matchReasons: Array.isArray(raw.matchReasons)
      ? raw.matchReasons.map(clean).filter(Boolean).slice(0, 12)
      : [],
    verificationProblems: Array.isArray(raw.verificationProblems)
      ? raw.verificationProblems.map(clean).filter(Boolean).slice(0, 12)
      : [],
  };
}

function normalizeMission(raw = {}) {
  const missionTitle = clean(raw.missionTitle);

  if (!missionTitle) {
    const error = new Error("Mission title is required.");
    error.status = 400;
    error.code = "mission_title_required";
    throw error;
  }

  const exactAction = clean(raw.exactAction);

  if (!exactAction) {
    const error = new Error("Mission exactAction is required.");
    error.status = 400;
    error.code = "mission_action_required";
    throw error;
  }

  return {
    missionTitle: missionTitle.slice(0, 300),
    exactAction: exactAction.slice(0, 2000),
    proofOfWin: clean(raw.proofOfWin).slice(0, 1000),
    nextStep: clean(raw.nextStep).slice(0, 1000),
    recoveryMessage: clean(raw.recoveryMessage).slice(0, 1000),
    todayMinutes: clampNumber(raw.todayMinutes, 1, 600, 30),
    proofRequired: raw.proofRequired !== false,
    checklist: normalizeChecklist(raw.checklist),
  };
}

function normalizeStatus(value) {
  const status = clean(value || "saved");

  if (!["saved", "started", "proof_submitted", "completed", "archived"].includes(status)) {
    const error = new Error("Invalid mission status.");
    error.status = 400;
    error.code = "invalid_status";
    throw error;
  }

  return status;
}

/**
 * Public endpoints
 */
export async function smallWinHealthHandler(req, res) {
  try {
    const data = await smallWinHealth();
    return ok(res, data);
  } catch (error) {
    console.error("[small-win/health]", error);
    return fail(res, error);
  }
}

export function smallWinFieldsHandler(req, res) {
  return ok(res, {
    fields: Object.entries(SMALL_WIN_FIELDS).map(([value, meta]) => ({
      value,
      label: meta.label,
      realThings: meta.realThings,
      trustedDomains: meta.trustedDomains,
    })),
  });
}

/**
 * Private opportunity fetch.
 * Protected in routes by authMiddleware because goal/feeling/location are private.
 */
export async function smallWinOpportunitiesHandler(req, res) {
  try {
    const errors = validateOpportunityBody(req.body || {});

    if (errors.length) {
      return res.status(400).json({
        ok: false,
        message: "Invalid Small-Win request",
        errors,
      });
    }

    const data = await findSmallWinOpportunities(req.body || {});

    return res.json({
      ...data,
      private: true,
      owner: "current_user_only",
    });
  } catch (error) {
    console.error("[small-win/opportunities]", error);
    return fail(res, error);
  }
}

export async function smallWinDebugSourceHandler(req, res) {
  try {
    const source = clean(req.params.source);
    const allowed = ["codeforces", "tavily", "youtube", "eventbrite"];

    if (!allowed.includes(source)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid source",
        allowed,
      });
    }

    const data = await debugSmallWinSource(source, req.body || {});
    return ok(res, data);
  } catch (error) {
    console.error("[small-win/debug/source]", error);
    return fail(res, error);
  }
}

/**
 * Save selected opportunity as private mission.
 */
export async function createSmallWinMissionHandler(req, res) {
  try {
    const userId = getAuthUserId(req);
    const body = req.body || {};

    const field = clean(body.field || body.selectedOpportunity?.field || "general");

    if (!SMALL_WIN_FIELDS[field]) {
      return res.status(400).json({
        ok: false,
        message: `Unsupported field: ${field}`,
        allowed: Object.keys(SMALL_WIN_FIELDS),
      });
    }

    const selectedOpportunity = normalizeSelectedOpportunity(
      body.selectedOpportunity || body.opportunity || {}
    );

    const mission = normalizeMission(
      body.mission || body.selectedOpportunity?.mission || body.opportunity?.mission || {}
    );

    const doc = await SmallWinMission.create({
      userId,
      deviceId: clean(body.deviceId || req.headers["x-device-id"] || ""),
      field,
      level: ["beginner", "intermediate", "advanced"].includes(body.level)
        ? body.level
        : "beginner",
      goal: clean(body.goal).slice(0, 3000),
      feeling: clean(body.feeling || "confused").slice(0, 80),
      country: clean(body.country).slice(0, 120),
      dailyTimeMinutes: clampNumber(body.dailyTimeMinutes, 1, 600, 30),
      status: "saved",
      selectedOpportunity,
      mission,
      lastActionAt: new Date(),
    });

    return ok(res, { mission: serializeMission(doc) }, 201);
  } catch (error) {
    console.error("[small-win/missions:create]", error);
    return fail(res, error);
  }
}

/**
 * List only current user's missions/history.
 */
export async function listSmallWinMissionsHandler(req, res) {
  try {
    const userId = getAuthUserId(req);

    const status = clean(req.query.status || "");
    const field = clean(req.query.field || "");
    const limit = clampNumber(req.query.limit, 1, 100, 30);
    const page = clampNumber(req.query.page, 1, 100000, 1);
    const skip = (page - 1) * limit;

    const filter = { userId };

    if (status) {
      if (!["saved", "started", "proof_submitted", "completed", "archived"].includes(status)) {
        return res.status(400).json({
          ok: false,
          message: "Invalid status filter.",
        });
      }

      filter.status = status;
    }

    if (field) {
      if (!SMALL_WIN_FIELDS[field]) {
        return res.status(400).json({
          ok: false,
          message: "Invalid field filter.",
        });
      }

      filter.field = field;
    }

    const [items, total] = await Promise.all([
      SmallWinMission.find(filter)
        .sort({ lastActionAt: -1, updatedAt: -1 })
        .skip(skip)
        .limit(limit),
      SmallWinMission.countDocuments(filter),
    ]);

    return ok(res, {
      page,
      limit,
      total,
      missions: items.map(serializeMission),
    });
  } catch (error) {
    console.error("[small-win/missions:list]", error);
    return fail(res, error);
  }
}

export async function smallWinMissionSummaryHandler(req, res) {
  try {
    const userId = getAuthUserId(req);

    const [byStatus, byField, completedLast7Days] = await Promise.all([
      SmallWinMission.aggregate([
        { $match: { userId } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      SmallWinMission.aggregate([
        { $match: { userId } },
        { $group: { _id: "$field", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      SmallWinMission.countDocuments({
        userId,
        status: "completed",
        completedAt: {
          $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      }),
    ]);

    return ok(res, {
      byStatus,
      byField,
      completedLast7Days,
    });
  } catch (error) {
    console.error("[small-win/missions:summary]", error);
    return fail(res, error);
  }
}

export async function getSmallWinMissionHandler(req, res) {
  try {
    const userId = getAuthUserId(req);
    const missionId = clean(req.params.missionId);

    if (!mongoose.Types.ObjectId.isValid(missionId)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid mission id.",
      });
    }

    const doc = await SmallWinMission.findOne({
      _id: missionId,
      userId,
    });

    if (!doc) {
      return res.status(404).json({
        ok: false,
        message: "Mission not found for current user.",
      });
    }

    return ok(res, {
      mission: serializeMission(doc),
    });
  } catch (error) {
    console.error("[small-win/missions:get]", error);
    return fail(res, error);
  }
}

export async function updateSmallWinMissionStatusHandler(req, res) {
  try {
    const userId = getAuthUserId(req);
    const missionId = clean(req.params.missionId);
    const status = normalizeStatus(req.body?.status);

    if (!mongoose.Types.ObjectId.isValid(missionId)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid mission id.",
      });
    }

    const update = {
      status,
      lastActionAt: new Date(),
    };

    if (status === "completed") update.completedAt = new Date();
    if (status === "archived") update.archivedAt = new Date();

    const doc = await SmallWinMission.findOneAndUpdate(
      { _id: missionId, userId },
      { $set: update },
      { new: true, runValidators: true }
    );

    if (!doc) {
      return res.status(404).json({
        ok: false,
        message: "Mission not found for current user.",
      });
    }

    return ok(res, {
      mission: serializeMission(doc),
    });
  } catch (error) {
    console.error("[small-win/missions:status]", error);
    return fail(res, error);
  }
}

export async function updateSmallWinMissionChecklistHandler(req, res) {
  try {
    const userId = getAuthUserId(req);
    const missionId = clean(req.params.missionId);

    if (!mongoose.Types.ObjectId.isValid(missionId)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid mission id.",
      });
    }

    const checklist = normalizeChecklist(req.body?.checklist || []);
    const requiredItems = checklist.filter((item) => item.required);
    const allRequiredDone = requiredItems.length > 0 && requiredItems.every((item) => item.done);

    const doc = await SmallWinMission.findOneAndUpdate(
      { _id: missionId, userId },
      {
        $set: {
          "mission.checklist": checklist,
          status: allRequiredDone ? "started" : clean(req.body?.status || "started"),
          lastActionAt: new Date(),
        },
      },
      { new: true, runValidators: true }
    );

    if (!doc) {
      return res.status(404).json({
        ok: false,
        message: "Mission not found for current user.",
      });
    }

    return ok(res, {
      mission: serializeMission(doc),
    });
  } catch (error) {
    console.error("[small-win/missions:checklist]", error);
    return fail(res, error);
  }
}

export async function submitSmallWinMissionProofHandler(req, res) {
  try {
    const userId = getAuthUserId(req);
    const missionId = clean(req.params.missionId);

    if (!mongoose.Types.ObjectId.isValid(missionId)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid mission id.",
      });
    }

    const proofType = clean(req.body?.proofType || "text");

    if (!["text", "url", "file"].includes(proofType)) {
      return res.status(400).json({
        ok: false,
        message: "proofType must be text, url, or file.",
      });
    }

    const proofUrl = clean(req.body?.proofUrl || req.body?.fileUrl || "");

    if ((proofType === "url" || proofType === "file") && proofUrl && !isValidUrl(proofUrl)) {
      return res.status(400).json({
        ok: false,
        message: "Proof URL/fileUrl must be a valid http/https URL.",
      });
    }

    const proof = {
      proofType,
      proofText: clean(req.body?.proofText).slice(0, 6000),
      proofUrl: proofType === "url" ? proofUrl.slice(0, 1200) : "",
      fileName: proofType === "file" ? clean(req.body?.fileName).slice(0, 300) : "",
      fileUrl: proofType === "file" ? proofUrl.slice(0, 1200) : "",
      fileSize: clampNumber(req.body?.fileSize, 0, 50 * 1024 * 1024, 0),
      submittedAt: new Date(),
    };

    const doc = await SmallWinMission.findOneAndUpdate(
      { _id: missionId, userId },
      {
        $set: {
          proof,
          status: "proof_submitted",
          lastActionAt: new Date(),
        },
      },
      { new: true, runValidators: true }
    );

    if (!doc) {
      return res.status(404).json({
        ok: false,
        message: "Mission not found for current user.",
      });
    }

    return ok(res, {
      mission: serializeMission(doc),
    });
  } catch (error) {
    console.error("[small-win/missions:proof]", error);
    return fail(res, error);
  }
}

export async function addSmallWinMissionFeedbackHandler(req, res) {
  try {
    const userId = getAuthUserId(req);
    const missionId = clean(req.params.missionId);

    if (!mongoose.Types.ObjectId.isValid(missionId)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid mission id.",
      });
    }

    const type = clean(req.body?.type || "other");

    const allowed = [
      "wrong_result",
      "too_hard",
      "too_easy",
      "not_for_my_country",
      "deadline_passed",
      "already_done",
      "saved_for_later",
      "useful",
      "not_useful",
      "other",
    ];

    if (!allowed.includes(type)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid feedback type.",
        allowed,
      });
    }

    const doc = await SmallWinMission.findOneAndUpdate(
      { _id: missionId, userId },
      {
        $push: {
          feedback: {
            type,
            note: clean(req.body?.note).slice(0, 1500),
            createdAt: new Date(),
          },
        },
        $set: {
          lastActionAt: new Date(),
        },
      },
      { new: true, runValidators: true }
    );

    if (!doc) {
      return res.status(404).json({
        ok: false,
        message: "Mission not found for current user.",
      });
    }

    return ok(res, {
      mission: serializeMission(doc),
    });
  } catch (error) {
    console.error("[small-win/missions:feedback]", error);
    return fail(res, error);
  }
}

export async function deleteSmallWinMissionHandler(req, res) {
  try {
    const userId = getAuthUserId(req);
    const missionId = clean(req.params.missionId);

    if (!mongoose.Types.ObjectId.isValid(missionId)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid mission id.",
      });
    }

    const result = await SmallWinMission.deleteOne({
      _id: missionId,
      userId,
    });

    if (!result.deletedCount) {
      return res.status(404).json({
        ok: false,
        message: "Mission not found for current user.",
      });
    }

    return ok(res, {
      deleted: true,
    });
  } catch (error) {
    console.error("[small-win/missions:delete]", error);
    return fail(res, error);
  }
}
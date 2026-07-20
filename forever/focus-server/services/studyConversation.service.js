import StudyConversation from "../models/StudyConversation.js";

function clean(value = "") {
  return String(value || "").trim();
}

function objectIdString(value) {
  return value?._id?.toString?.() || value?.id || String(value || "");
}

function publicConversation(doc) {
  if (!doc) return null;

  const obj = doc.toObject?.() || doc;

  return {
    ...obj,
    id: objectIdString(obj),
    turns: Array.isArray(obj.turns) ? obj.turns : [],
  };
}

function buildConversationQuery({
  deviceId,
  userId = "",
  sessionId = "",
  activityId = "",
}) {
  const query = {};

  if (activityId) {
    query.activityId = activityId;
  } else if (sessionId) {
    query.sessionId = sessionId;
  } else if (deviceId) {
    query.deviceId = deviceId;
  }

  if (userId && !activityId) {
    query.$or = [{ userId }, { deviceId }];
    delete query.deviceId;
  }

  return query;
}

export async function getOrCreateStudyConversation({
  deviceId,
  userId = "",
  sessionId = null,
  activityId = null,
  goal = "",
}) {
  if (!deviceId) {
    throw new Error("deviceId is required for conversation");
  }

  const query = {
    deviceId,
    status: "active",
    ...(activityId ? { activityId } : sessionId ? { sessionId } : {}),
  };

  let conversation = await StudyConversation.findOne(query).sort({
    updatedAt: -1,
  });

  if (!conversation) {
    conversation = await StudyConversation.create({
      deviceId,
      userId,
      sessionId,
      activityId,
      goal,
      status: "active",
      turns: [],
      lastMessageAt: new Date(),
    });
  }

  return conversation;
}

export async function appendStudyConversationTurn({
  deviceId,
  userId = "",
  sessionId = null,
  activityId = null,
  goal = "",
  role,
  text,
  source = "text",
  stage = 0,
  metadata = {},
  finalDecisionMade = false,
  lastAiType = "unknown",
}) {
  if (!role) {
    throw new Error("conversation turn role is required");
  }

  const cleanText = clean(text);

  if (!cleanText) {
    throw new Error("conversation turn text is required");
  }

  const conversation = await getOrCreateStudyConversation({
    deviceId,
    userId,
    sessionId,
    activityId,
    goal,
  });

  conversation.turns.push({
    role,
    text: cleanText,
    source,
    stage,
    activityId,
    metadata,
    at: new Date(),
  });

  conversation.lastMessageAt = new Date();
  conversation.finalDecisionMade = Boolean(
    finalDecisionMade || conversation.finalDecisionMade
  );

  if (lastAiType) {
    conversation.lastAiType = lastAiType;
  }

  if (finalDecisionMade) {
    conversation.status = "completed";
  }

  if (conversation.turns.length > 80) {
    conversation.turns = conversation.turns.slice(-80);
  }

  await conversation.save();

  return publicConversation(conversation);
}

export async function getStudyConversationHistory({
  deviceId,
  userId = "",
  sessionId = "",
  activityId = "",
  limit = 30,
}) {
  const query = buildConversationQuery({
    deviceId,
    userId,
    sessionId,
    activityId,
  });

  const conversations = await StudyConversation.find(query)
    .sort({ updatedAt: -1 })
    .limit(Number(limit || 30))
    .lean();

  return conversations.map(publicConversation);
}

export async function getLatestStudyConversationContext({
  deviceId,
  userId = "",
  sessionId = "",
  activityId = "",
  turnLimit = 12,
}) {
  const conversations = await getStudyConversationHistory({
    deviceId,
    userId,
    sessionId,
    activityId,
    limit: 1,
  });

  const latest = conversations[0];
  const turns = latest?.turns || [];

  return turns.slice(-turnLimit).map((turn) => ({
    role: turn.role,
    text: turn.text,
    source: turn.source,
    stage: turn.stage,
    at: turn.at,
  }));
}

export async function completeStudyConversation({
  deviceId,
  userId = "",
  sessionId = "",
  activityId = "",
  summary = "",
  lastAiType = "unknown",
}) {
  const query = buildConversationQuery({
    deviceId,
    userId,
    sessionId,
    activityId,
  });

  const doc = await StudyConversation.findOneAndUpdate(
    { ...query, status: "active" },
    {
      $set: {
        status: "completed",
        summary,
        finalDecisionMade: true,
        lastAiType,
        lastMessageAt: new Date(),
      },
    },
    { new: true, sort: { updatedAt: -1 } }
  );

  return publicConversation(doc);
}
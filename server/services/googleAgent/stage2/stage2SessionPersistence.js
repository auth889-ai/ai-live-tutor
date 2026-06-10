"use strict";

const {
  GoogleLiveTutorStage2Session,
  GoogleLiveTutorStage2Artifact,
} = require("../../../models/GoogleLiveTutorStage2Session");

function genSessionId() {
  return `s2_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function createSession(params = {}) {
  const {
    ownerKey,
    offlineUserId = "",
    deviceId = "",
    resourceId = "",
    treeId = "",
    nodeId = "",
    nodeTitle = "",
    selectedNode = {},
    title,
  } = params;

  const sessionId = genSessionId();

  const doc = await GoogleLiveTutorStage2Session.create({
    sessionId,
    ownerKey: ownerKey || "demo_user",
    offlineUserId,
    deviceId,
    resourceId,
    treeId,
    selectedNodeId: nodeId,
    nodeId,
    nodeTitle,
    selectedNode,
    title: title || `Lesson: ${nodeTitle || nodeId || "Node"}`,
    status: "created",
    mode: "teach_node_pipeline",
    artifactMode: "chunked",
    metadata: { fallbackUsed: false, createdBy: "stage2SessionPersistence" },
  });

  return doc.toObject();
}

async function updateSessionStatus(sessionId, status, extra = {}) {
  await GoogleLiveTutorStage2Session.updateOne(
    { sessionId },
    { $set: { status, ...extra, updatedAt: new Date() } }
  );
}

async function saveSessionResult(sessionId, ownerKey, result = {}) {
  const boardScreens =
    result.boardScreens || result.premiumBoardScreens || [];
  const boardCommands = result.boardCommands || result.commands || [];
  const voiceScript = result.voiceScript || [];
  const subtitles = result.subtitles || [];
  const sourceRefs = result.sourceRefs || result.selectedEvidence || [];

  const counts = {
    premiumBoardScreens: boardScreens.length,
    boardSections: (result.boardSections || []).length,
    boardCommands: boardCommands.length,
    voiceScript: voiceScript.length,
    subtitles: subtitles.length,
    compiledDiagrams: (result.compiledDiagrams || []).length,
    htmlPreviews: (result.htmlPreviews || []).length,
    imagePreviews: (result.imagePreviews || []).length,
    sourceCards: sourceRefs.length,
    externalResources: (result.externalResources || []).length,
    agentTrace: (result.agentTrace || []).length,
    artifacts: 0,
  };

  await GoogleLiveTutorStage2Session.updateOne(
    { sessionId },
    {
      $set: {
        status: "completed",
        counts,
        sourceRefs: sourceRefs.slice(0, 50),
        selectedEvidence: (result.selectedEvidence || []).slice(0, 50),
        playbackState: result.playbackState || {},
        quiz: result.quiz || {},
        visualContextSummary: result.visualContextSummary || {},
        fullPdfSummaryPreview: String(result.fullPdfSummaryPreview || "").slice(0, 2000),
        metadata: {
          ...(result.metadata || {}),
          fallbackUsed: false,
          completedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      },
    }
  );

  const artifactTypes = [
    { type: "boardScreens", items: boardScreens },
    { type: "boardCommands", items: boardCommands },
    { type: "voiceScript", items: voiceScript },
    { type: "subtitles", items: subtitles },
  ];

  for (const { type, items } of artifactTypes) {
    if (!items.length) continue;
    await GoogleLiveTutorStage2Artifact.findOneAndUpdate(
      { sessionId, ownerKey: ownerKey || "demo_user", type, chunkIndex: 0 },
      {
        $set: {
          items,
          itemCount: items.length,
          byteSize: JSON.stringify(items).length,
          metadata: { fallbackUsed: false },
        },
      },
      { upsert: true }
    );
  }

  await GoogleLiveTutorStage2Session.updateOne(
    { sessionId },
    { $set: { "counts.artifacts": artifactTypes.filter((a) => a.items.length).length } }
  );
}

async function saveSessionSegment(sessionId, ownerKey, segmentIndex, segment = {}) {
  const type = `segment_${segmentIndex}`;

  await GoogleLiveTutorStage2Artifact.findOneAndUpdate(
    { sessionId, ownerKey: ownerKey || "demo_user", type, chunkIndex: 0 },
    {
      $set: {
        items: [segment],
        payload: segment,
        itemCount: (segment.boardScreens || []).length,
        byteSize: JSON.stringify(segment).length,
        metadata: { segmentIndex, fallbackUsed: false },
      },
    },
    { upsert: true }
  );

  const screenCount = (segment.boardScreens || []).length;
  const commandCount = (segment.boardCommands || segment.commands || []).length;

  await GoogleLiveTutorStage2Session.updateOne(
    { sessionId },
    {
      $set: {
        status: "running",
        [`metadata.lastSegmentIndex`]: segmentIndex,
        [`metadata.lastSegmentScreens`]: screenCount,
        updatedAt: new Date(),
      },
      $inc: {
        "counts.artifacts": 1,
        "counts.premiumBoardScreens": screenCount,
        "counts.boardCommands": commandCount,
        "counts.voiceScript": (segment.voiceScript || []).length,
      },
    }
  );
}

async function loadSession(sessionId, ownerKey) {
  const query = ownerKey ? { sessionId, ownerKey } : { sessionId };
  const doc = await GoogleLiveTutorStage2Session.findOne(query).lean();
  return doc;
}

async function loadSessionWithArtifacts(sessionId, ownerKey) {
  const session = await loadSession(sessionId, ownerKey);
  if (!session) return null;

  const artifacts = await GoogleLiveTutorStage2Artifact.find(
    { sessionId, ownerKey: ownerKey || session.ownerKey }
  ).lean();

  const artifactMap = {};
  for (const a of artifacts) {
    artifactMap[a.type] = a.items || a.payload;
  }

  return {
    ...session,
    boardScreens: artifactMap.boardScreens || [],
    boardCommands: artifactMap.boardCommands || [],
    voiceScript: artifactMap.voiceScript || [],
    subtitles: artifactMap.subtitles || [],
    _artifactsLoaded: true,
  };
}

async function loadSessionSegment(sessionId, ownerKey, segmentIndex) {
  const type = `segment_${segmentIndex}`;
  const artifact = await GoogleLiveTutorStage2Artifact.findOne({
    sessionId,
    ownerKey: ownerKey || undefined,
    type,
    chunkIndex: 0,
  }).lean();

  if (!artifact) return null;
  return artifact.payload || (artifact.items && artifact.items[0]) || null;
}

async function getSessionStatus(sessionId) {
  const doc = await GoogleLiveTutorStage2Session.findOne(
    { sessionId },
    {
      sessionId: 1,
      status: 1,
      counts: 1,
      nodeId: 1,
      nodeTitle: 1,
      resourceId: 1,
      treeId: 1,
      "metadata.lastSegmentIndex": 1,
      "metadata.lastSegmentScreens": 1,
      "metadata.completedAt": 1,
      createdAt: 1,
      updatedAt: 1,
    }
  ).lean();
  return doc;
}

async function savePlaybackCursor(sessionId, cursor = {}) {
  await GoogleLiveTutorStage2Session.updateOne(
    { sessionId },
    {
      $set: {
        "playbackState.currentCommandIndex": cursor.commandIndex || 0,
        "playbackState.currentScreenId": cursor.screenId || "",
        "playbackState.paused": cursor.paused || false,
        "playbackState.pauseReason": cursor.reason || "interrupt",
        "playbackState.lastSavedAt": new Date(),
        resumeState: cursor,
        updatedAt: new Date(),
      },
    }
  );
}

async function appendInterrupt(sessionId, interruptRecord = {}) {
  await GoogleLiveTutorStage2Session.updateOne(
    { sessionId },
    {
      $push: {
        interrupts: {
          ...interruptRecord,
          at: new Date(),
        },
      },
      $set: { updatedAt: new Date() },
    }
  );
}

module.exports = {
  createSession,
  updateSessionStatus,
  saveSessionResult,
  saveSessionSegment,
  loadSession,
  loadSessionWithArtifacts,
  loadSessionSegment,
  getSessionStatus,
  savePlaybackCursor,
  appendInterrupt,
};

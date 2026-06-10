"use strict";

/**
 * stage2SegmentSaver.js
 * Saves each lesson segment to MongoDB separately.
 * Supports: pause, resume, replay, export lesson book, interrupt/repair.
 */

const mongoose = require("mongoose");
const { GoogleLiveTutorStage2Session, GoogleLiveTutorStage2Artifact } = require("../../../models/GoogleLiveTutorStage2Session");

function safeObj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
function safeArr(v) { return Array.isArray(v) ? v : []; }

async function ensureMongo() {
  if (mongoose.connection.readyState === 1) return;
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("MONGODB_URI missing.");
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DATABASE, serverSelectionTimeoutMS: 20000 });
}

async function saveSegment(sessionId, segmentData, lessonMeta = {}) {
  await ensureMongo();
  const seg    = safeObj(segmentData);
  const segIdx = seg.segmentIndex || 0;

  const artifact = await GoogleLiveTutorStage2Artifact.findOneAndUpdate(
    { sessionId, "metadata.segmentIndex": segIdx },
    {
      $set: {
        sessionId,
        artifactType:   "lesson_segment",
        data:           seg,
        metadata: { segmentIndex: segIdx, segmentType: seg.segmentType, generatedAt: Date.now(), fallbackUsed: false },
      },
    },
    { upsert: true, new: true }
  ).lean();

  await GoogleLiveTutorStage2Session.findOneAndUpdate(
    { sessionId },
    {
      $set:  { [`segments.${segIdx}`]: { segmentId: seg.segmentId, segmentType: seg.segmentType, artifactId: artifact._id, estimatedMs: seg.estimatedMs } },
      $inc:  { generatedSegments: 1 },
      $setOnInsert: { sessionId, ...safeObj(lessonMeta), createdAt: new Date() },
    },
    { upsert: true }
  );

  return { ok: true, sessionId, segmentIndex: segIdx, artifactId: artifact._id };
}

async function loadSegment(sessionId, segmentIndex) {
  await ensureMongo();
  const artifact = await GoogleLiveTutorStage2Artifact.findOne(
    { sessionId, "metadata.segmentIndex": segmentIndex }
  ).lean();
  return artifact ? safeObj(artifact.data) : null;
}

async function saveLessonBook(sessionId, lessonBook) {
  await ensureMongo();
  await GoogleLiveTutorStage2Artifact.findOneAndUpdate(
    { sessionId, artifactType: "lesson_book" },
    { $set: { sessionId, artifactType: "lesson_book", data: safeObj(lessonBook), metadata: { savedAt: Date.now() } } },
    { upsert: true }
  );
  return { ok: true, sessionId };
}

async function saveResumeState(sessionId, resumeState) {
  await ensureMongo();
  await GoogleLiveTutorStage2Session.findOneAndUpdate(
    { sessionId },
    { $set: { resumeState: safeObj(resumeState), lastActivityAt: new Date() } },
    { upsert: true }
  );
  return { ok: true, sessionId };
}

module.exports = { saveSegment, loadSegment, saveLessonBook, saveResumeState };

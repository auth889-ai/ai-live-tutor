// MASTERY STORE — BKT wired into the runtime: every judged quiz answer updates a per
// (userId, skillId) knowledge estimate and returns a ROUTE the player acts on. The skill
// IS the source chunk the question teaches (quiz board objects carry sourceRef.chunkId —
// the same provenance every factual object carries), so mastery is tracked against the
// material itself, never against invented topic ids. Same storage stance as study-store:
// Mongo-backed tiny docs, owner-scoped ids, graceful no-DB behavior (the answer still
// gets a BKT-routed response computed from the prior; persistence resumes with the DB).

import { masteryCollection } from '../storage/db.js';
import { createBktModel, updateBkt, BKT_DEFAULTS } from './bkt.js';

const masteryId = (userId, skillId) => `bkt_${userId}_${skillId}`;

// Deterministic routing bands (mastery -> what the player offers next):
//   < 0.40         reteach          (the diagnose -> reteach-on-a-board affordance)
//   0.40 - 0.70    guided_practice  (worked support stays on)
//   0.70 - 0.90    faded_practice   (support withdraws — the student drives)
//   >= 0.90        transfer         (new-context application)
export function routeForMastery(mastery) {
  if (typeof mastery !== 'number' || !Number.isFinite(mastery)) throw new Error('routeForMastery needs a numeric mastery probability');
  if (mastery < 0.4) return 'reteach';
  if (mastery < 0.7) return 'guided_practice';
  if (mastery < 0.9) return 'faded_practice';
  return 'transfer';
}

export async function getMastery(userId, skillId, { collection = masteryCollection } = {}) {
  if (!userId || !skillId) return null;
  const col = await collection();
  if (!col) return null;
  return col.findOne({ _id: masteryId(userId, skillId), kind: 'mastery' });
}

// One judged answer in: BKT update on the stored state (or the prior for a first
// encounter), persisted, routed. Injectable collection for tests — no live Mongo.
export async function recordAnswer({ userId, lessonId = null, questionId = null, skillId, correct }, { collection = masteryCollection, now = () => new Date().toISOString() } = {}) {
  if (!userId) throw new Error('mastery answer needs userId');
  if (!skillId) throw new Error('mastery answer needs skillId — the source chunk id the question targets');
  const isCorrect = Boolean(correct);
  const col = await collection();
  const existing = col ? await col.findOne({ _id: masteryId(userId, skillId), kind: 'mastery' }) : null;

  // Rebuild the model from the stored state so per-skill parameters (if ever tuned)
  // survive; a fresh skill starts at the BKT prior.
  const model = createBktModel({
    probMastery: existing?.probMastery ?? BKT_DEFAULTS.probMastery,
    probTransit: existing?.probTransit ?? BKT_DEFAULTS.probTransit,
    probGuess: existing?.probGuess ?? BKT_DEFAULTS.probGuess,
    probSlip: existing?.probSlip ?? BKT_DEFAULTS.probSlip,
  });
  const updated = updateBkt(model, isCorrect);
  const attempts = (existing?.attempts ?? 0) + 1;
  const correctCount = (existing?.correctCount ?? 0) + (isCorrect ? 1 : 0);
  const mastery = updated.probMastery;
  const route = routeForMastery(mastery);

  if (col) {
    await col.updateOne(
      { _id: masteryId(userId, skillId) },
      {
        $set: {
          kind: 'mastery', userId, skillId,
          probMastery: mastery,
          probTransit: updated.probTransit, probGuess: updated.probGuess, probSlip: updated.probSlip,
          attempts, correctCount,
          lastCorrect: isCorrect,
          lastLessonId: lessonId, lastQuestionId: questionId,
          updatedAt: now(),
        },
        $setOnInsert: { createdAt: now() },
      },
      { upsert: true },
    );
  }

  return { skillId, mastery, route, attempts, correctCount, persisted: Boolean(col) };
}

export async function listMastery(userId, { collection = masteryCollection } = {}) {
  if (!userId) return [];
  const col = await collection();
  if (!col) return [];
  return col.find({ kind: 'mastery', userId }).sort({ updatedAt: -1 }).limit(500).toArray();
}

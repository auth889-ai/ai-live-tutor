// FOCUS STORE — persistence for the Study Focus extension, ported from the w2 Mongoose models
// (StudySession + StudyActivity) to forever's native MongoDB driver. Stores each focus session
// and every classified page signal (the "survey" of where the learner spent time and whether
// it was on task), so the dashboard can show a structured history.

import { randomUUID } from 'node:crypto';

import { getDbSafe } from '../storage/db.js';

async function focusSessions(env = process.env) { return (await getDbSafe(env))?.collection('focus_sessions'); }
async function focusActivities(env = process.env) { return (await getDbSafe(env))?.collection('focus_activities'); }

const nowIso = () => new Date().toISOString();

export async function startSession({ deviceId, goal = '', ownerId = null }, { env = process.env } = {}) {
  const col = await focusSessions(env);
  if (!col) return { sessionId: randomUUID(), goal, offline: true };
  // end any lingering active session for this device first
  await col.updateMany({ deviceId, status: 'active' }, { $set: { status: 'ended', endedAt: nowIso() } });
  const sessionId = randomUUID();
  await col.insertOne({ _id: sessionId, deviceId, ownerId, goal, status: 'active', startedAt: nowIso(), endedAt: null,
    studyMs: 0, distractMs: 0, activityCount: 0, nudgeCount: 0 });
  return { sessionId, goal };
}

export async function endSession({ deviceId, sessionId = null }, { env = process.env } = {}) {
  const col = await focusSessions(env);
  if (!col) return { ended: true, offline: true };
  const q = sessionId ? { _id: sessionId } : { deviceId, status: 'active' };
  await col.updateMany(q, { $set: { status: 'ended', endedAt: nowIso() } });
  return { ended: true };
}

export async function currentSession({ deviceId }, { env = process.env } = {}) {
  const col = await focusSessions(env);
  if (!col) return null;
  return col.findOne({ deviceId, status: 'active' }, { sort: { startedAt: -1 } });
}

export async function setGoal({ deviceId, goal }, { env = process.env } = {}) {
  const col = await focusSessions(env);
  if (col) await col.updateMany({ deviceId, status: 'active' }, { $set: { goal } });
  return { goal };
}

// Save one classified signal + roll up the session totals. `decision` is the classifier output.
export async function recordActivity({ deviceId, sessionId, signal, decision, ownerId = null }, { env = process.env } = {}) {
  const acts = await focusActivities(env);
  const sessions = await focusSessions(env);
  if (!acts) return { saved: false };
  const page = signal?.page ?? {};
  const behavior = signal?.behavior ?? {};
  const type = decision?.type ?? 'study';
  const isStudy = type === 'study';
  const durationMs = Number(behavior.dwellMs ?? 0);

  await acts.insertOne({
    _id: randomUUID(), deviceId, sessionId: sessionId ?? null, ownerId, at: nowIso(),
    url: page.url ?? '', domain: page.domain ?? '', title: page.title ?? '',
    type, reason: decision?.reason ?? '', nudged: !isStudy && Boolean(decision?.chatMessage),
    durationMs, idleMs: Number(behavior.idleMs ?? 0), tabSwitches: Number(behavior.tabSwitches ?? 0),
  });

  if (sessions && sessionId) {
    await sessions.updateOne({ _id: sessionId }, {
      $inc: {
        activityCount: 1,
        nudgeCount: !isStudy && decision?.chatMessage ? 1 : 0,
        studyMs: isStudy ? durationMs : 0,
        distractMs: isStudy ? 0 : durationMs,
      },
    });
  }
  return { saved: true };
}

// The dashboard payload: recent sessions + a rollup + the last activities (the "survey").
export async function dashboard({ deviceId, ownerId = null, limit = 50 }, { env = process.env } = {}) {
  const sessions = await focusSessions(env);
  const acts = await focusActivities(env);
  if (!sessions || !acts) return { sessions: [], activities: [], totals: null, offline: true };
  const q = ownerId ? { ownerId } : { deviceId };
  const [sessionList, activityList] = await Promise.all([
    sessions.find(q).sort({ startedAt: -1 }).limit(20).toArray(),
    acts.find(q).sort({ at: -1 }).limit(limit).toArray(),
  ]);
  const totals = activityList.reduce((acc, a) => {
    acc.total += 1;
    if (a.type === 'study') acc.study += 1; else acc.distract += 1;
    if (a.nudged) acc.nudges += 1;
    acc.studyMs += a.type === 'study' ? a.durationMs : 0;
    acc.distractMs += a.type === 'study' ? 0 : a.durationMs;
    acc.byDomain[a.domain || 'unknown'] = (acc.byDomain[a.domain || 'unknown'] ?? 0) + 1;
    return acc;
  }, { total: 0, study: 0, distract: 0, nudges: 0, studyMs: 0, distractMs: 0, byDomain: {} });
  totals.focusRate = totals.total ? Math.round((totals.study / totals.total) * 100) : 0;
  return { sessions: sessionList, activities: activityList, totals };
}

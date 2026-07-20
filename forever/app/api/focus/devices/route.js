// /api/focus/devices — lists the devices that actually have Study-Focus activity, newest first,
// with their event counts and goal. The dashboard shows these as one-click chips so the user
// never has to know or paste a device id (a fresh extension install mints a new id, which is why
// a hand-typed id often shows 0). Reads the focus-server's DB (myapp) directly.
import { MongoClient } from 'mongodb';

// focus data lives in the focus-server's Mongo (its MONGO_URI → /myapp), NOT forever's live-tutor DB.
// Configured via env only — never hardcode credentials (this repo is public/open-source).
const FOCUS_URI = process.env.FOCUS_MONGO_URI || process.env.MONGO_URI || '';

let clientPromise = null;
function getClient() {
  if (!FOCUS_URI) throw new Error('FOCUS_MONGO_URI is not set');
  if (!clientPromise) clientPromise = new MongoClient(FOCUS_URI, { serverSelectionTimeoutMS: 8000 }).connect();
  return clientPromise;
}

export async function GET() {
  try {
    if (!FOCUS_URI) return Response.json({ ok: true, devices: [] }); // not configured → empty, dashboard falls back to manual id
    const client = await getClient();
    const col = client.db().collection('studyactivities');
    const rows = await col.aggregate([
      { $group: {
        _id: '$deviceId',
        events: { $sum: 1 },
        last: { $max: '$createdAt' },
        goal: { $last: '$goal' },
        distractions: { $sum: { $cond: [{ $eq: ['$ai.type', 'non-study'] }, 1, 0] } },
        study: { $sum: { $cond: [{ $eq: ['$ai.type', 'study'] }, 1, 0] } },
      } },
      { $sort: { last: -1 } },
      { $limit: 12 },
    ]).toArray();
    const devices = rows.filter((r) => r._id).map((r) => ({
      deviceId: r._id, events: r.events, last: r.last, goal: r.goal || '',
      study: r.study, distractions: r.distractions,
    }));
    return Response.json({ ok: true, devices });
  } catch (e) {
    return Response.json({ ok: false, error: String(e?.message ?? e).slice(0, 160), devices: [] }, { status: 500 });
  }
}

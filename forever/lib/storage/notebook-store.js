// NOTEBOOK STORE — the Sankofa pattern made study-first: a notebook is a FIRST-CLASS,
// user-created object (never a lesson appendix) holding typed blocks with provenance —
// note | text | link | pdf | image | voice — in sequence, exactly like eva's
// NarrativeSegment{type, content, media, trust_level, sequence}. The payoff action turns a
// notebook into a course/quiz through the existing job pipeline. Design + field contract:
// notes/research/notebook-sankofa-plan-18jul.md. Owner-scoped everywhere; graceful no-DB nulls.

import { randomUUID } from 'crypto';

import { notebooksCollection } from './db.js';

// Test seam (same law as the rest of the suite: unit tests inject fake collections, never a
// live cluster). Production always uses the real notebooksCollection.
let _collection = notebooksCollection;
export function _setNotebookCollectionForTests(fn) { _collection = fn ?? notebooksCollection; }

const now = () => new Date().toISOString();
const BLOCK_TYPES = new Set(['note', 'text', 'link', 'pdf', 'image', 'voice']);
const SOURCES = new Set(['typed', 'pasted', 'url', 'upload', 'voice']);
const TRUSTS = new Set(['user', 'extracted', 'ai']);

export async function createNotebook({ userId, title, intent = '' }) {
  const col = await _collection();
  if (!col || !userId) return null;
  const doc = {
    _id: `nbk_${randomUUID()}`,
    kind: 'notebook',
    ownerId: userId,
    title: String(title ?? 'Untitled notebook').slice(0, 200),
    intent: String(intent ?? '').slice(0, 500),
    cover: null,
    blockCount: 0,
    lastGeneratedJobId: null,
    generatedCourseId: null,
    createdAt: now(),
    updatedAt: now(),
  };
  await col.insertOne(doc);
  return doc;
}

export async function listNotebooksFor(userId) {
  const col = await _collection();
  if (!col || !userId) return [];
  return col.find({ kind: 'notebook', ownerId: userId }).sort({ updatedAt: -1 }).limit(200).toArray();
}

export async function getNotebook(userId, notebookId) {
  const col = await _collection();
  if (!col || !userId) return null;
  const notebook = await col.findOne({ _id: notebookId, kind: 'notebook', ownerId: userId });
  if (!notebook) return null;
  const blocks = await col.find({ kind: 'block', ownerId: userId, notebookId }).sort({ seq: 1 }).limit(500).toArray();
  return { notebook, blocks };
}

export async function updateNotebook(userId, notebookId, { title, intent, cover } = {}) {
  const col = await _collection();
  if (!col || !userId) return null;
  const set = { updatedAt: now() };
  if (title !== undefined) set.title = String(title).slice(0, 200);
  if (intent !== undefined) set.intent = String(intent).slice(0, 500);
  if (cover !== undefined) set.cover = cover;
  const r = await col.updateOne({ _id: notebookId, kind: 'notebook', ownerId: userId }, { $set: set });
  return r.matchedCount > 0;
}

export async function deleteNotebook(userId, notebookId) {
  const col = await _collection();
  if (!col || !userId) return null;
  const r = await col.deleteOne({ _id: notebookId, kind: 'notebook', ownerId: userId });
  if (r.deletedCount > 0) await col.deleteMany({ kind: 'block', ownerId: userId, notebookId });
  return r.deletedCount > 0;
}

// One block per input. Provenance is first-class (eva's trust_level analog):
// source = HOW it arrived, trust = WHO authored the content.
export async function addBlock({ userId, notebookId, type, content = '', url = null, uploadId = null, mediaType = null, transcript = null, source = 'typed', origin = null, title = null, trust = 'user' }) {
  const col = await _collection();
  if (!col || !userId) return null;
  if (!BLOCK_TYPES.has(type)) throw new Error(`unknown block type "${type}"`);
  if (!SOURCES.has(source)) throw new Error(`unknown block source "${source}"`);
  if (!TRUSTS.has(trust)) throw new Error(`unknown block trust "${trust}"`);
  const owner = await col.findOne({ _id: notebookId, kind: 'notebook', ownerId: userId }, { projection: { blockCount: 1 } });
  if (!owner) return null;
  const doc = {
    _id: `blk_${randomUUID()}`,
    kind: 'block',
    ownerId: userId,
    notebookId,
    seq: (owner.blockCount ?? 0),
    type,
    content: String(content ?? '').slice(0, 20000),
    url: url ? String(url).slice(0, 2000) : null,
    uploadId: uploadId ? String(uploadId) : null,
    mediaType: mediaType ? String(mediaType).slice(0, 100) : null,
    transcript: transcript ? String(transcript).slice(0, 20000) : null,
    source,
    origin: origin ? String(origin).slice(0, 200) : null,
    trust,
    title: title ? String(title).slice(0, 300) : null,
    createdAt: now(),
    updatedAt: now(),
  };
  await col.insertOne(doc);
  await col.updateOne({ _id: notebookId }, { $inc: { blockCount: 1 }, $set: { updatedAt: now() } });
  return doc;
}

export async function updateBlock(userId, notebookId, blockId, { content, seq, title } = {}) {
  const col = await _collection();
  if (!col || !userId) return null;
  const set = { updatedAt: now() };
  if (content !== undefined) set.content = String(content).slice(0, 20000);
  if (title !== undefined) set.title = String(title).slice(0, 300);
  if (seq !== undefined && Number.isInteger(seq) && seq >= 0) set.seq = seq;
  const r = await col.updateOne({ _id: blockId, kind: 'block', ownerId: userId, notebookId }, { $set: set });
  if (r.matchedCount > 0) await col.updateOne({ _id: notebookId }, { $set: { updatedAt: now() } });
  return r.matchedCount > 0;
}

export async function removeBlock(userId, notebookId, blockId) {
  const col = await _collection();
  if (!col || !userId) return null;
  const r = await col.deleteOne({ _id: blockId, kind: 'block', ownerId: userId, notebookId });
  if (r.deletedCount > 0) {
    await col.updateOne({ _id: notebookId, kind: 'notebook', ownerId: userId }, { $inc: { blockCount: -1 }, $set: { updatedAt: now() } });
  }
  return r.deletedCount > 0;
}

// The payoff: mark which generation job/course this notebook produced (backlink lives here;
// the job itself goes through the existing /api/jobs pipeline).
export async function setGeneration(userId, notebookId, { jobId, courseId } = {}) {
  const col = await _collection();
  if (!col || !userId) return null;
  const set = { updatedAt: now() };
  if (jobId !== undefined) set.lastGeneratedJobId = jobId;
  if (courseId !== undefined) set.generatedCourseId = courseId;
  const r = await col.updateOne({ _id: notebookId, kind: 'notebook', ownerId: userId }, { $set: set });
  return r.matchedCount > 0;
}

// Assemble the job input from blocks (text-bearing blocks concatenated; the job contract's
// 60-char minimum is the caller's concern to surface as a friendly error).
export function assembleNotebookText(blocks) {
  return (blocks ?? [])
    .filter((b) => ['note', 'text', 'voice', 'link'].includes(b.type))
    .map((b) => {
      const head = b.title ? `## ${b.title}\n` : '';
      const body = b.type === 'voice' ? (b.transcript || b.content) : b.content;
      return `${head}${body ?? ''}`.trim();
    })
    .filter(Boolean)
    .join('\n\n');
}

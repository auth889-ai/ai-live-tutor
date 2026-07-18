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
const BLOCK_TYPES = new Set(['note', 'text', 'link', 'pdf', 'image', 'voice', 'moment']);
const SOURCES = new Set(['typed', 'pasted', 'url', 'upload', 'voice', 'generated', 'captured']);
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
export async function addBlock({ userId, notebookId, type, content = '', url = null, uploadId = null, mediaType = null, transcript = null, source = 'typed', origin = null, title = null, trust = 'user', page = 'Notes' }) {
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
    page: String(page ?? 'Notes').slice(0, 80),
    createdAt: now(),
    updatedAt: now(),
  };
  await col.insertOne(doc);
  await col.updateOne({ _id: notebookId }, { $inc: { blockCount: 1 }, $set: { updatedAt: now() } });
  return doc;
}

export async function updateBlock(userId, notebookId, blockId, { content, seq, title, page, trust } = {}) {
  const col = await _collection();
  if (!col || !userId) return null;
  const set = { updatedAt: now() };
  if (content !== undefined) set.content = String(content).slice(0, 20000);
  if (title !== undefined) set.title = String(title).slice(0, 300);
  if (seq !== undefined && Number.isInteger(seq) && seq >= 0) set.seq = seq;
  if (page !== undefined) set.page = String(page).slice(0, 80);
  if (trust !== undefined && ['user', 'extracted', 'ai'].includes(trust)) set.trust = trust;
  const r = await col.updateOne({ _id: blockId, kind: 'block', ownerId: userId, notebookId }, { $set: set });
  if (r.matchedCount > 0) await col.updateOne({ _id: notebookId }, { $set: { updatedAt: now() } });
  return r.matchedCount > 0;
}

// ATTACHMENTS on a block (user order: a note carries its own link/png/pdf): capped list of
// {kind: link|image|pdf, url, title, content} — content holds the extracted text so the
// attachment GROUNDS synthesis, not just decorates the note.
export async function addAttachment(userId, notebookId, blockId, { kind, url = null, title = null, content = '' }) {
  const col = await _collection();
  if (!col || !userId) return null;
  if (!['link', 'image', 'pdf'].includes(kind)) throw new Error(`unknown attachment kind "${kind}"`);
  const block = await col.findOne({ _id: blockId, kind: 'block', ownerId: userId, notebookId });
  if (!block) return null;
  if ((block.attachments ?? []).length >= 5) throw new Error('a block holds at most 5 attachments');
  const att = {
    id: `att_${randomUUID()}`,
    kind,
    url: url ? String(url).slice(0, 500) : null,
    title: title ? String(title).slice(0, 200) : null,
    content: String(content ?? '').slice(0, 8000),
    createdAt: now(),
  };
  await col.updateOne({ _id: blockId }, { $push: { attachments: att }, $set: { updatedAt: now() } });
  await col.updateOne({ _id: notebookId, kind: 'notebook', ownerId: userId }, { $set: { updatedAt: now() } });
  return att;
}

// Narration attachment: the block keeps its spoken version (Sankofa's TTS-per-segment,
// notebook-sized). URL only — bytes live under public/audio like every lesson clip.
export async function setBlockAudio(userId, notebookId, blockId, audioUrl, durationMs) {
  const col = await _collection();
  if (!col || !userId) return null;
  const r = await col.updateOne(
    { _id: blockId, kind: 'block', ownerId: userId, notebookId },
    { $set: { audioUrl: String(audioUrl).slice(0, 500), audioDurationMs: Number(durationMs) || 0, updatedAt: now() } },
  );
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

// ============ KNOWLEDGE ENGINE (Obsidian pattern, three-engine blueprint P2) ============
// [[Title]] in any block links notebooks. Links are stored as their own docs; backlinks are
// the reverse query; the graph draws ONLY real links (blueprint law: no auto-AI edges).

export const WIKI_LINK_PATTERN = /\[\[([^\]]+)\]\]/g;

export function extractWikiLinks(text) {
  const links = [];
  for (const match of String(text ?? '').matchAll(WIKI_LINK_PATTERN)) {
    const title = match[1]?.trim();
    if (title) links.push(title);
  }
  return [...new Set(links)];
}

// Save-time rebuild (blueprint): drop the block's old links, resolve each [[title]] to the
// user's notebook of that name (case-insensitive) — creating it when missing, the Obsidian
// behavior — and insert the current set.
export async function rebuildBlockLinks({ userId, notebookId, blockId, text }) {
  const col = await _collection();
  if (!col || !userId) return [];
  await col.deleteMany({ kind: 'nblink', ownerId: userId, sourceBlockId: blockId });
  const titles = extractWikiLinks(text);
  if (titles.length === 0) return [];
  const mine = await col.find({ kind: 'notebook', ownerId: userId }).limit(200).toArray();
  const byTitle = new Map(mine.map((n) => [String(n.title).trim().toLowerCase(), n]));
  const created = [];
  for (const title of titles) {
    let target = byTitle.get(title.toLowerCase());
    if (!target) {
      target = await createNotebook({ userId, title });
      if (!target) continue;
      byTitle.set(title.toLowerCase(), target);
    }
    if (target._id === notebookId) continue; // self-links draw nothing
    await col.insertOne({
      _id: `lnk_${randomUUID()}`,
      kind: 'nblink',
      ownerId: userId,
      sourceNotebookId: notebookId,
      targetNotebookId: target._id,
      sourceBlockId: blockId,
      displayText: title.slice(0, 200),
      createdAt: now(),
    });
    created.push(target._id);
  }
  return created;
}

export async function removeBlockLinks(userId, blockId) {
  const col = await _collection();
  if (!col || !userId) return;
  await col.deleteMany({ kind: 'nblink', ownerId: userId, sourceBlockId: blockId });
}

// Backlinks = incoming connections, with the source block's text as the preview and the
// blockId so the UI can scroll to the referencing paragraph (blueprint requirement).
export async function listBacklinks(userId, notebookId) {
  const col = await _collection();
  if (!col || !userId) return [];
  const links = await col.find({ kind: 'nblink', ownerId: userId, targetNotebookId: notebookId }).limit(100).toArray();
  const out = [];
  for (const l of links) {
    const src = await col.findOne({ _id: l.sourceNotebookId, kind: 'notebook', ownerId: userId });
    const blk = await col.findOne({ _id: l.sourceBlockId, kind: 'block', ownerId: userId });
    if (!src) continue;
    out.push({
      notebookId: src._id,
      title: src.title,
      blockId: l.sourceBlockId,
      preview: String(blk?.content ?? blk?.transcript ?? '').slice(0, 160),
    });
  }
  return out;
}

// The knowledge graph: one node per notebook, one edge per real link pair.
export async function knowledgeGraph(userId) {
  const col = await _collection();
  if (!col || !userId) return { nodes: [], edges: [] };
  const notebooks = await col.find({ kind: 'notebook', ownerId: userId }).limit(200).toArray();
  const links = await col.find({ kind: 'nblink', ownerId: userId }).limit(1000).toArray();
  const seen = new Set();
  const edges = [];
  for (const l of links) {
    const key = `${l.sourceNotebookId}->${l.targetNotebookId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ id: key, source: l.sourceNotebookId, target: l.targetNotebookId, label: 'links to' });
  }
  return {
    nodes: notebooks.map((n) => ({ id: n._id, label: n.title, blockCount: n.blockCount ?? 0 })),
    edges,
  };
}

// Assemble the job input from blocks (text-bearing blocks concatenated; the job contract's
// 60-char minimum is the caller's concern to surface as a friendly error).
export function assembleNotebookText(blocks) {
  return (blocks ?? [])
    .filter((b) => ['note', 'text', 'voice', 'link', 'moment'].includes(b.type))
    .map((b) => {
      const head = b.title ? `## ${b.title}\n` : '';
      const body = b.type === 'voice' ? (b.transcript || b.content)
        : b.type === 'moment' ? [b.transcript, b.content].filter(Boolean).join(' — ')
        : b.content;
      return `${head}${body ?? ''}`.trim();
    })
    .filter(Boolean)
    .join('\n\n');
}

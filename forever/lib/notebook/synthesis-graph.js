// NOTEBOOK SYNTHESIS as a REAL multi-agent LangGraph (user order 2026-07-19) — same
// pattern as the lesson society's grounding-review-loop: the GRAPH is the orchestration,
// LLM agents propose, deterministic gates dispose.
//
//   retrieve(det) -> planner(LLM) -> evidenceGate(det) --weak--> planner (one retry)
//        |                                |ok
//        |                                v
//        |                    [Send] writer(LLM) x N in PARALLEL, each self-citing
//        |                                v
//        |                    citationGate(det, per section result)
//        |                                v
//        |                    illustrator(t2i, evidence-anchored, optional)
//        |                                v
//                              reviewer(LLM critic) -> drops unfaithful sections (visible)
//                                         v
//                              assembler(det) -> draft
//
// Every stage emits real SSE events through `emit` — the status theater IS the graph run.

import { StateGraph, Annotation, START, END, Send } from '@langchain/langgraph';

import { runAgentChain } from '../qwen/client.js';
import { generateImage, imagesAvailable } from '../qwen/image.js';

const concat = (a, b) => a.concat(b);

const SynthState = Annotation.Root({
  numbered: Annotation(),           // the numbered material text
  corpus: Annotation(),             // lowercase corpus for evidence checks
  materialCount: Annotation(),
  mode: Annotation(),
  modeText: Annotation(),
  limits: Annotation(),
  aim: Annotation(),
  question: Annotation(),
  draftBlock: Annotation(),         // continue-mode source block
  planTitle: Annotation(),
  planSections: Annotation(),       // [{heading, focus, evidence, index}]
  planTries: Annotation({ reducer: (a, b) => a + b, default: () => 0 }),
  written: Annotation({ reducer: concat, default: () => [] }), // [{index, heading, markdown, refs, imageUrl}]
  withImages: Annotation(),
  emit: Annotation(),               // (event, data) => void  — capability, not data
});

const GROUND = 'HARD RULES: only facts from the numbered blocks — never outside knowledge; cite like [2] after the sentence each fact supports; omit what the blocks do not cover. Output ONLY JSON.';

function stripDuplicateHeading(title, md) {
  const norm = (x) => String(x).replace(/^#+\s*/, '').trim().toLowerCase();
  const lines = String(md).split('\n');
  while (lines.length && (norm(lines[0]) === norm(title) || lines[0].trim() === '')) lines.shift();
  return lines.join('\n').trim();
}

// ---- node: planner (LLM agent) ----
async function planner(state) {
  const { emit } = state;
  if (state.mode === 'continue' && state.draftBlock) {
    return { planTitle: `Continuing: ${(state.draftBlock.title || state.draftBlock.content).slice(0, 80)}`, planSections: [{ index: 0, heading: 'Continuation', focus: "continue and deepen the user's draft, in their direction", evidence: '' }], planTries: 1 };
  }
  if (state.mode === 'ask' && state.question) {
    return { planTitle: state.question.slice(0, 120), planSections: [{ index: 0, heading: 'Answer', focus: `answer: ${state.question}`, evidence: '' }], planTries: 1 };
  }
  emit('status', { stage: 'planning', attempt: state.planTries + 1 });
  const harder = state.planTries > 0 ? 'YOUR LAST PLAN FAILED THE EVIDENCE CHECK. Copy evidence phrases EXACTLY, character for character, from the blocks. ' : '';
  const planned = await runAgentChain({
    agent: 'notebook-arc-planner',
    system: `${state.aim}${harder}You plan ${state.modeText} from the user's source blocks. Return ONLY JSON {"title": string, "sections": [{"heading": string, "focus": string, "evidence": string}]} — ${state.mode === 'detailed' ? '3 to 5' : '2 to 4'} sections. Each evidence MUST be a short phrase copied VERBATIM from the blocks (machine-checked); each focus one sharp line about that evidence. Sections about anything not literally in the blocks are forbidden. ${GROUND}`,
    user: `MY SOURCE BLOCKS:\n\n${state.numbered}`,
    maxTokens: 600,
    temperature: 0.3,
  });
  const p = planned?.json ?? planned;
  const sections = (Array.isArray(p?.sections) ? p.sections : []).slice(0, 5)
    .filter((x) => x?.heading)
    .map((x, i) => ({ index: i, heading: String(x.heading).slice(0, 120), focus: String(x.focus ?? '').slice(0, 300), evidence: String(x.evidence ?? '').slice(0, 200) }));
  return { planTitle: String(p?.title ?? 'Study note').slice(0, 200), planSections: sections, planTries: 1 };
}

// ---- node: evidence gate (deterministic verifier) ----
function evidenceGate(state) {
  const { emit } = state;
  if (['ask', 'continue'].includes(state.mode)) return {};
  const kept = [];
  for (const sec of state.planSections ?? []) {
    const ev = sec.evidence.toLowerCase().replace(/\s+/g, ' ').trim();
    if (ev.length >= 8 && state.corpus.includes(ev)) kept.push(sec);
    else emit('rejected', { heading: sec.heading, reason: 'planned without verbatim evidence from your blocks — dropped' });
  }
  return { planSections: kept };
}

function afterEvidence(state) {
  if ((state.planSections ?? []).length > 0) {
    state.emit('plan', { title: state.planTitle, headings: state.planSections.map((x) => x.heading) });
    // FAN OUT: one writer agent per section, in parallel (the Send API — real multi-agent).
    return state.planSections.map((sec) => new Send('writer', { ...state, section: sec }));
  }
  if (state.planTries < 2) return 'planner';
  throw new Error('no section could quote your blocks — add more material about this topic');
}

// ---- node: section writer (LLM agent, parallel per section) + citation gate (det) ----
async function writer(state) {
  const { emit, section: sec } = state;
  emit('status', { stage: 'writing', index: sec.index + 1, total: 0, heading: sec.heading });
  const written = await runAgentChain({
    agent: 'notebook-section-writer',
    system: `${state.aim}You write ONE section of ${state.modeText}: "${sec.heading}" — focus: ${sec.focus}. ${sec.evidence ? `THE SECTION IS ABOUT THIS EXACT MATERIAL: "${sec.evidence}" — explain IT, concretely; generic advice or filler is forbidden. ` : ''}${state.limits} Do NOT include the section title in the markdown. ${state.question ? `The user's question: ${state.question}. ` : ''}${state.draftBlock ? `THE USER'S OWN DRAFT (continue it, never rewrite it): """${String(state.draftBlock.content).slice(0, 3000)}""". ` : ''}Return ONLY JSON {"markdown": string, "cited": int[]}. ${GROUND}`,
    user: `MY SOURCE BLOCKS:\n\n${state.numbered}`,
    maxTokens: state.mode === 'detailed' ? 1500 : 900,
    temperature: 0.3,
  });
  const w = written?.json ?? written;
  const md = stripDuplicateHeading(sec.heading, String(w?.markdown ?? ''));
  const refs = [...md.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  // citation gate, deterministic, per parallel branch
  if (!md || refs.some((n) => n < 1 || n > state.materialCount)) {
    emit('rejected', { heading: sec.heading, reason: 'cited a source that does not exist — section refused' });
    return { written: [] };
  }
  emit('section', { heading: sec.heading, markdown: md, index: sec.index });

  // illustrator (evidence-anchored, best-effort, never fake)
  let imageUrl = null;
  if (!['ask'].includes(state.mode) && (sec.evidence || sec.focus) && await imagesAvailable()) {
    try {
      emit('status', { stage: 'illustrating', heading: sec.heading });
      const { bytes } = await generateImage({ prompt: `hand-drawn watercolor study diagram visualizing exactly this idea: "${(sec.evidence || sec.focus).slice(0, 220)}" (topic: ${sec.heading}) — clear, conceptual, no text, no words, no letters, no labels` });
      const { mkdir, writeFile } = await import('node:fs/promises');
      const path = await import('node:path');
      const outDir = path.join('public', 'images', 'notebooks');
      await mkdir(outDir, { recursive: true });
      const file = `nbimg_${Date.now()}_${sec.index}.png`;
      await writeFile(path.join(outDir, file), bytes);
      imageUrl = `/images/notebooks/${file}`;
      emit('image', { heading: sec.heading, url: imageUrl });
    } catch (e) {
      emit('status', { stage: 'image-failed', heading: sec.heading, reason: String(e.message ?? e).slice(0, 120) });
    }
  }
  return { written: [{ index: sec.index, heading: sec.heading, markdown: md, refs, imageUrl }] };
}

// ---- node: reviewer (LLM critic) — may drop unfaithful sections, visibly ----
async function reviewer(state) {
  const { emit } = state;
  const ordered = [...state.written].sort((a, b) => a.index - b.index);
  if (ordered.length === 0) throw new Error('every section failed its gate — nothing to review');
  if (['ask', 'continue'].includes(state.mode)) return { withImages: ordered };
  emit('status', { stage: 'reviewing' });
  try {
    const verdict = await runAgentChain({
      agent: 'notebook-reviewer',
      system: 'You are a strict reviewer. For each numbered section, decide: is it FAITHFUL to the source blocks and NON-REPETITIVE vs the other sections? Return ONLY JSON {"drop": int[]} — the indices (0-based) of sections that are unfaithful or near-duplicates. Empty array when all are fine.',
      user: `SOURCE BLOCKS:\n${state.numbered.slice(0, 6000)}\n\nSECTIONS:\n${ordered.map((k) => `<<${k.index}>> ${k.heading}\n${k.markdown.slice(0, 800)}`).join('\n\n')}`,
      maxTokens: 200,
      temperature: 0.1,
    });
    const drop = new Set(((verdict?.json ?? verdict)?.drop ?? []).filter((n) => Number.isInteger(n)));
    // the critic may never delete everything — that would be a lazy veto, not a review
    if (drop.size > 0 && drop.size < ordered.length) {
      for (const k of ordered) if (drop.has(k.index)) emit('rejected', { heading: k.heading, reason: 'reviewer: unfaithful or duplicated — removed from the draft' });
      return { withImages: ordered.filter((k) => !drop.has(k.index)) };
    }
  } catch { /* reviewer is a quality layer — its absence never kills a grounded draft */ }
  return { withImages: ordered };
}

export function buildSynthesisGraph() {
  return new StateGraph(SynthState)
    .addNode('planner', planner)
    .addNode('evidenceGate', evidenceGate)
    .addNode('writer', writer)
    .addNode('reviewer', reviewer)
    .addEdge(START, 'planner')
    .addEdge('planner', 'evidenceGate')
    .addConditionalEdges('evidenceGate', afterEvidence, { planner: 'planner', writer: 'writer' })
    .addEdge('writer', 'reviewer')
    .addEdge('reviewer', END)
    .compile();
}

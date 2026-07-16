// SEMANTIC VISUAL DIRECTOR (C4, shadow-first). The only NEW agent of the cockpit
// architecture: it sees the problem, the code, and the INVENTORY of channels this recording
// actually produced, and writes the SemanticVisualSpec — meaning + composition, every runtime
// value a binding. It corrects detector semantics (context the heuristics lack) but is never
// final truth: normalizeSpec + binding dry-runs against a real frame + the literal classifier
// judge its output, and a failed spec means the deterministic default cockpit ships instead.

import { runAgentChain } from '../../../qwen/client.js';
import { normalizeSpec } from '../../../board/composition/panel-registry.js';
import { resolveBinding, ungroundedNumbers } from '../../../board/composition/binding.js';
import { structureSpecFrom } from '../../../board/execution/structure-spec.js';

// What the Director is ALLOWED to see: shapes and keys, with values visible but the output
// contract forbidding literals — the inventory is evidence, never copy material.
export function channelInventory(trace) {
  const steps = trace?.steps ?? [];
  const nodeStateKeys = [...new Set(steps.flatMap((s) => Object.values(s.nodeState ?? {}).flatMap(Object.keys)))];
  const roles = [...new Set(steps.flatMap((s) => (s.events ?? []).map((e) => e.semanticRole).filter(Boolean)))];
  return {
    structure: structureSpecFrom(trace).kind,
    nodeStateKeys,
    hasFrames: steps.some((s) => s.frames?.length),
    hasQueue: steps.some((s) => Array.isArray(s.queue)),
    hasStack: steps.some((s) => Array.isArray(s.stack)),
    hasDistTable: steps.some((s) => s.traceRow),
    semanticRoles: roles,
    stepCount: steps.length,
  };
}

const SYSTEM = `You are the Semantic Visual Director of an AI tutor. Given a problem, its solution code and
the INVENTORY of channels a real recorded execution produced, design the teaching screen. Output ONLY JSON:
{"algorithmFamily": "<kebab-case>", "layoutIntent": "auto|hierarchical|force|grid|linear",
 "panels": [ up to 5 of:
   {"type":"graph","title":"..."} (when structure is graph)
 | {"type":"call-stack","title":"..."} (ONLY if hasFrames)
 | {"type":"queue","title":"..."} (ONLY if hasQueue)
 | {"type":"state-table","title":"...","columns":[{"label":"<short>","binding":{"op":"lookup","collection":"nodeState","key":"$node.id","field":"<one of nodeStateKeys>"}}]}
 | {"type":"concept-card","title":"...","content":"<the rule THIS algorithm demonstrates, <=300 chars>"} ]}
LAWS: every runtime value is a BINDING — never write a number a run produced; concept-card text may use only
numbers stated in the problem; bind only to channels the inventory lists; panel titles name what the student
sees, in this problem's own vocabulary.`;

// directCockpit({problemText, directive, trace}) -> {spec, verdict, usage}
// verdict: 'accepted' | rejection reason string. NEVER throws — shadow-safe by construction.
export async function directCockpit({ problemText = '', directive = '', trace, deps = {} }) {
  const call = deps.runAgentChain ?? runAgentChain;
  try {
    const inventory = channelInventory(trace);
    const { json, usage } = await call({
      agent: 'cockpit_director',
      system: SYSTEM,
      user: JSON.stringify({ problem: problemText.slice(0, 1500), directive: directive.slice(0, 400), inventory }),
      model: process.env.MODEL_SCENE || 'qwen3-coder-plus',
    });
    const norm = normalizeSpec(json);
    if (!norm.ok) return { spec: null, verdict: `rejected: ${norm.reason}`, usage };
    // Binding dry-run against the richest real frame: every declared column/badge must
    // resolve or be honestly missing — never a type error, never an unknown channel.
    const frame = (trace.steps ?? []).filter((s) => s.nodeState || s.frames || s.queue).at(-1) ?? trace.steps.at(-1);
    const nodes = trace.views?.graph?.nodes ?? [];
    for (const p of norm.spec.panels) {
      for (const col of [...(p.columns ?? []), ...(p.nodeBadges ?? [])]) {
        const r = resolveBinding(col.binding, frame, { context: { node: { id: String(nodes[0]?.id ?? '0') } }, expect: 'scalar' });
        if (r.status === 'type_error') return { spec: null, verdict: `rejected: ${p.type}/${col.label} type_error (expected ${r.expected})`, usage };
        if (r.status === 'missing' && /unknown (collection|op)/.test(r.reason ?? '')) {
          return { spec: null, verdict: `rejected: ${p.type}/${col.label} ${r.reason}`, usage };
        }
      }
      const loose = ungroundedNumbers(`${p.title ?? ''} ${p.content ?? ''}`, problemText, { entityIds: nodes.map((n) => String(n.id)) });
      if (loose.length) return { spec: null, verdict: `rejected: ungrounded numbers in ${p.type}: ${loose.join(', ')}`, usage };
    }
    return { spec: norm.spec, verdict: 'accepted', usage };
  } catch (error) {
    return { spec: null, verdict: `rejected: ${String(error.message).slice(0, 160)}`, usage: null };
  }
}

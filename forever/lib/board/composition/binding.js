// SAFE BINDING DSL + TYPED RESOLVER (C1 of the cockpit-composition architecture). The
// Semantic Visual Director writes presentation specs whose every runtime value is a BINDING;
// this module is the only thing that turns a binding into a value — by looking it up in the
// engine's frame, never by evaluating anything. No eval, no expressions, no mutation: a
// binding is data, the resolver is a table lookup with typed failure.
//
//   { op: 'lookup', collection: 'nodeState', key: '$node.id', field: 'disc' }
//   { op: 'count',  collection: 'queue' }
//   { op: 'exists', collection: 'frames' }
//   { op: 'select', collection: 'frames', field: 'functionName' }
//   { op: 'format', template: '{a} == {b} → match', bindings: { a: {...}, b: {...} } }
//
// BindingResult (reviewer contract): resolved{value, provenance} | missing{reason} |
// type_error{expected, received}. A missing binding NEVER silently renders — the caller
// decides (hide the row, or reject the panel), but always knowingly.

export const BINDING_OPS = Object.freeze(['lookup', 'select', 'count', 'exists', 'format', 'join', 'compare']);

// The channel whitelist: bindings may only read what the engine actually produces on a step.
const COLLECTIONS = Object.freeze(['nodeState', 'variables', 'queue', 'stack', 'frames', 'traceRow', 'events', 'graph', 'lastReturn']);

const resolved = (value, provenance) => ({ status: 'resolved', value, provenance });
const missing = (reason) => ({ status: 'missing', reason });
const typeError = (expected, received) => ({ status: 'type_error', expected, received: Array.isArray(received) ? 'array' : typeof received });

// '$node.id' etc. resolve from the render context (the entity a panel row is drawing).
function resolveRef(key, context) {
  if (typeof key !== 'string' || !key.startsWith('$')) return { ok: true, value: key };
  const path = key.slice(1).split('.');
  let v = context;
  for (const part of path) {
    if (v == null || typeof v !== 'object') return { ok: false, ref: key };
    v = v[part];
  }
  return v === undefined ? { ok: false, ref: key } : { ok: true, value: v };
}

// resolveBinding(binding, frame, { context, expect }) -> BindingResult
//   frame:   ONE step of the engine trace (the truth half)
//   context: entity being drawn ({node: {id}}, {event}, ...)
//   expect:  optional shape contract from the panel ('scalar' | 'list' | 'object')
export function resolveBinding(binding, frame, { context = {}, expect = null } = {}) {
  if (!binding || typeof binding !== 'object') return missing('binding must be an object');
  if (!BINDING_OPS.includes(binding.op)) return missing(`unknown op "${binding.op}" — allowed: ${BINDING_OPS.join(', ')}`);

  if (binding.op === 'format') {
    if (typeof binding.template !== 'string') return missing('format needs a template string');
    const parts = {};
    for (const [name, sub] of Object.entries(binding.bindings ?? {})) {
      const r = resolveBinding(sub, frame, { context, expect: 'scalar' });
      if (r.status !== 'resolved') return r; // a template with a hole never renders half-true
      parts[name] = r.value;
    }
    const value = binding.template.replace(/\{(\w+)\}/g, (m, name) => (name in parts ? String(parts[name]) : m));
    if (/\{\w+\}/.test(value)) return missing(`template references an unbound name in "${binding.template}"`);
    return resolved(value, Object.values(parts).map(String));
  }

  if (binding.op === 'compare') {
    // The Decision-column op (bridge_test: low[v] > disc[u]) — both sides are bindings,
    // the operator is whitelisted, the verdict is computed here, never by the AI.
    const OPS = { '>': (a, b) => a > b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '<=': (a, b) => a <= b, '==': (a, b) => a === b, '!=': (a, b) => a !== b };
    if (!OPS[binding.operator]) return missing(`compare operator must be one of ${Object.keys(OPS).join(' ')}`);
    const left = resolveBinding(binding.left, frame, { context, expect: 'scalar' });
    if (left.status !== 'resolved') return left;
    const right = resolveBinding(binding.right, frame, { context, expect: 'scalar' });
    if (right.status !== 'resolved') return right;
    return resolved(OPS[binding.operator](left.value, right.value), [...left.provenance, binding.operator, ...right.provenance]);
  }
  if (binding.op === 'join') {
    const inner = resolveBinding({ ...binding, op: 'select' }, frame, { context });
    if (inner.status !== 'resolved') return inner;
    return resolved(inner.value.map(String).join(binding.separator ?? ', '), inner.provenance);
  }
  if (!COLLECTIONS.includes(binding.collection)) {
    return missing(`unknown collection "${binding.collection}" — the engine produces: ${COLLECTIONS.join(', ')}`);
  }
  const col = frame?.[binding.collection];
  if (col === undefined || col === null) return missing(`this step carries no ${binding.collection}`);

  if (binding.op === 'exists') return resolved(Array.isArray(col) ? col.length > 0 : true, [`${binding.collection}`]);
  if (binding.op === 'count') {
    if (Array.isArray(col)) return resolved(col.length, [`${binding.collection}.length`]);
    if (typeof col === 'object') return resolved(Object.keys(col).length, [`${binding.collection} keys`]);
    return typeError('list or object', col);
  }
  if (binding.op === 'select') {
    if (!Array.isArray(col)) return typeError('list', col);
    const values = binding.field === undefined ? col : col.map((item) => item?.[binding.field]);
    if (binding.field !== undefined && values.every((v) => v === undefined)) {
      return missing(`no item in ${binding.collection} has field "${binding.field}"`);
    }
    return resolved(values, [`${binding.collection}[].${binding.field ?? ''}`]);
  }

  // lookup
  const keyRes = resolveRef(binding.key, context);
  if (!keyRes.ok) return missing(`context ref ${keyRes.ref} did not resolve`);
  const key = String(keyRes.value);
  if (Array.isArray(col) || typeof col !== 'object') return typeError('object', col);
  let value = col[key];
  if (value === undefined) return missing(`${binding.collection} has no entry "${key}" on this step`);
  if (binding.field !== undefined) {
    if (value === null || typeof value !== 'object') return typeError('object with fields', value);
    value = value[binding.field];
    if (value === undefined) return missing(`${binding.collection}["${key}"] has no field "${binding.field}"`);
  }
  const provenance = [`${binding.collection}["${key}"]${binding.field !== undefined ? `.${binding.field}` : ''}`];
  if (expect === 'scalar' && (typeof value === 'object' && value !== null)) return typeError('scalar', value);
  if (expect === 'list' && !Array.isArray(value)) return typeError('list', value);
  if (expect === 'object' && (Array.isArray(value) || value === null || typeof value !== 'object')) return typeError('object', value);
  return resolved(value, provenance);
}

// LITERAL CLASSIFIER (reviewer's 4-class rule, the two classes decidable without the
// auditor): a NUMERIC literal in Director prose is legitimate only when it is grounded in
// the problem/source text ("6 servers", "5-bit mask"); an ungrounded number is exactly the
// hallucination class bindings exist to prevent. Algorithm-rule text (formulas) goes through
// the society's Grounding Auditor like every board object — not decided here.
export function ungroundedNumbers(text, sourceText, { entityIds = [] } = {}) {
  const src = String(sourceText ?? '');
  // Entity ids (node labels, grid indices) are grounded by the STRUCTURE, not the prose —
  // "disc[3]" is fine on a graph that has node 3, whatever the problem text says.
  const ids = new Set([...entityIds].map(String));
  const nums = String(text ?? '').match(/\d+(?:\.\d+)?/g) ?? [];
  return [...new Set(nums.filter((n) => !src.includes(n) && !ids.has(n)))];
}

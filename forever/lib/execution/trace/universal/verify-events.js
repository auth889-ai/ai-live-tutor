// EVENT VALUE VERIFICATION (external probe #2: a fabricated before:999/after:-7 passed shape
// checks). The compiler AUTHORS events; this module is the independent judge that re-reads
// the RECORDING at each event's provenance index and proves the claimed values. An event
// whose numbers cannot be reproduced from the recording is STRIPPED (and counted) — the
// visual stays factual, the channel stays honest. Recorder snapshots are the truth authority.

import { readNodeKeyed } from '../graph-walk/node-state.js';

// Verify write/relax-class events that carry {target: {entityId: graphNode:X, field}, before, after}.
// Truth: the recorded local `field` parsed node-keyed at the provenance event (after) and at
// the nearest EARLIER sighting (before). Events without provenance/field are left untouched
// (cell_update is proven by the dp compiler's own snapshot diffing; its formula is re-provable).
export function verifyEventValues(recording, trace) {
  const lines = (recording?.events ?? []).filter((e) => e.ev === 'line' || (e.locals && !e.ev));
  const graphIds = new Set((trace?.views?.graph?.nodes ?? []).map((n) => String(n.id)));
  if (!lines.length || !graphIds.size) return { stripped: 0 };

  const valueAt = (field, node, uptoIndex) => {
    for (let i = Math.min(uptoIndex, lines.length - 1); i >= 0; i -= 1) {
      const parsed = readNodeKeyed(lines[i]?.locals?.[field], graphIds);
      if (parsed && parsed[node] !== undefined && parsed[node] !== null) return { found: true, value: parsed[node], index: i };
      // scalar dicts (dist) — readNodeKeyed handles dicts; arrays too. Nothing else to try.
    }
    return { found: false };
  };

  let stripped = 0;
  for (const step of trace?.steps ?? []) {
    if (!Array.isArray(step.events)) continue;
    step.events = step.events.filter((e) => {
      const id = e?.target?.entityId;
      const field = e?.target?.field;
      const idx = e?.provenance?.eventIndex;
      if (typeof id !== 'string' || !id.startsWith('graphNode:') || typeof field !== 'string' || !Number.isInteger(idx)) return true;
      if (e.after === undefined) return true;
      const node = id.slice('graphNode:'.length);
      const now = valueAt(field, node, idx);
      if (!now.found || JSON.stringify(now.value) !== JSON.stringify(e.after)) { stripped += 1; return false; }
      if (e.before !== undefined) {
        const prev = valueAt(field, node, now.index - 1);
        if (prev.found && JSON.stringify(prev.value) !== JSON.stringify(e.before)) { stripped += 1; return false; }
      }
      return true;
    });
    if (step.events.length === 0) delete step.events;
  }
  return { stripped };
}

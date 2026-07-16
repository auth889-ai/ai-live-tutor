// CALL-FRAME TIMELINE (B3, reviewer contract): the recorder's call/return/exception events
// rebuilt into stable CallFrames — the data behind the mockups' "Recursion Stack" panel
// (diameter(1) Active · diameter(2) Waiting · diameter(4) Done → returns 1). Deterministic,
// zero AI; statuses come from event order, never inferred from names.
//
// CallFrame: { frameId, parentFrameId, functionName, arguments, status, enteredAtEvent,
//              exitedAtEvent?, returnValue?, exception?: {type, message} }
// status: active (top of stack now) | waiting (has a child running) | returned | threw

export function buildFrameTimeline(events) {
  const frames = []; // all frames ever, in entry order — frameId is stable: f0, f1, ...
  const stack = []; // indices into frames
  const stackByEvent = []; // per event index: [frameId...] bottom -> top (snapshot)
  const pendingException = new Map(); // frame index -> {type, message}

  (events ?? []).forEach((e, i) => {
    if (e?.ev === 'call') {
      const frame = {
        frameId: `f${frames.length}`,
        parentFrameId: stack.length ? frames[stack[stack.length - 1]].frameId : null,
        functionName: e.fn,
        arguments: e.args ?? {},
        status: 'active',
        enteredAtEvent: i,
      };
      if (stack.length) frames[stack[stack.length - 1]].status = 'waiting';
      frames.push(frame);
      stack.push(frames.length - 1);
    } else if (e?.ev === 'exception') {
      if (stack.length) pendingException.set(stack[stack.length - 1], { type: e.type ?? 'Exception', message: e.message ?? '' });
    } else if (e?.ev === 'line') {
      // A line executing in the top frame AFTER an exception means it was CAUGHT there —
      // only exception-then-immediate-return counts as threw (handled errors return normally).
      if (stack.length) pendingException.delete(stack[stack.length - 1]);
    } else if (e?.ev === 'return') {
      const idx = stack.pop();
      if (idx !== undefined) {
        const frame = frames[idx];
        frame.exitedAtEvent = i;
        const exc = pendingException.get(idx);
        if (exc) {
          frame.status = 'threw';
          frame.exception = exc;
        } else {
          frame.status = 'returned';
          frame.returnValue = e.value ?? null;
        }
        if (stack.length) frames[stack[stack.length - 1]].status = 'active';
      }
    }
    stackByEvent[i] = stack.map((idx) => frames[idx].frameId);
  });

  const byId = new Map(frames.map((f) => [f.frameId, f]));
  return {
    frames,
    // The visible panel at one recording moment: live stack (bottom->top, statuses as of the
    // END of the run for returned/threw; active/waiting resolved per position) plus the most
    // recently finished frame so "Done -> returns X" stays on screen one beat (mockup habit).
    stackAt(eventIndex) {
      const ids = stackByEvent[Math.max(0, Math.min(stackByEvent.length - 1, eventIndex))] ?? [];
      return ids.map((id, pos) => {
        const f = byId.get(id);
        return {
          frameId: f.frameId,
          functionName: f.functionName,
          arguments: f.arguments,
          status: pos === ids.length - 1 ? 'active' : 'waiting',
        };
      });
    },
    finishedBefore(eventIndex) {
      let best = null;
      for (const f of frames) {
        if (f.exitedAtEvent !== undefined && f.exitedAtEvent <= eventIndex) {
          if (!best || f.exitedAtEvent > best.exitedAtEvent) best = f;
        }
      }
      if (!best) return null;
      return {
        frameId: best.frameId, functionName: best.functionName, arguments: best.arguments,
        status: best.status, ...(best.status === 'returned' ? { returnValue: best.returnValue } : {}),
        ...(best.exception ? { exception: best.exception } : {}),
      };
    },
  };
}

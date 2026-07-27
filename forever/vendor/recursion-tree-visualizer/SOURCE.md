# Vendored: brpapa/recursion-tree-visualizer

- **Original repo**: https://github.com/brpapa/recursion-tree-visualizer
- **Commit vendored from**: `c3f046e5d12dfecc58bb8564906ee5628ba56f14` (local clone at `../tree`)
- **License**: MIT (Copyright (c) 2020 Bruno Papa) — see `LICENSE` in this directory, copied
  verbatim from the original repo.

## Files

| File here | Upstream source | Status |
| --- | --- | --- |
| `LICENSE` | `LICENSE` | copied verbatim |
| `types.js` | `lambda/src/types.ts` | copied; TS type declarations ported to JSDoc typedefs (tree-model types only; the Lambda/API types were not taken) |
| `tree-builder.js` | `lambda/src/runner/steps/source-code.ts` (the `fn(...args)` tracker wrapper emitted by the node/python codegen `bottom` blocks) | copied + modified — see below |
| `layout.js` | `lambda/src/runner/steps/intermediate-tree.ts` (Reingold-Tilford) | copied; types stripped, Portuguese comments translated, logic/traversal order unchanged |

## Modifications to `tree-builder.js` (each also marked inline)

1. **Input is Forever's recording, not live calls.** Upstream builds the tree at runtime by
   wrapping the user's recursive function inside its Lambda-executed program. Forever already
   records every real call/return via one `sys.settrace` pass (`lib/execution/trace/universal/
   recorder.js`), so the port replays the SAME stack discipline (currId counter, parent-stack,
   `adjList.push({childId, weight})` on call, weight landing on return) over the recorded
   events. The recorder is the only event source; the upstream Lambda runner, code templates
   and child-process plumbing are deliberately not vendored.
2. **Behavioral memoization marking.** Upstream flags `memoized` when its own cache wrapper
   short-circuits (it *injected* the memo). A recording has no wrapper, so a vertex is flagged
   when it returned childless with the exact args+value an earlier call solved with real work
   (children) — evidence from the run itself, matching Forever's house rule that memo hits are
   detected from behavior, never declared.
3. **No `MAX_RECURSIVE_CALLS` + `process.exit`.** Forever's recorder caps events upstream with
   a first-class `{truncated: true}` sentinel; calls left open by a truncated recording are
   returned in `openIds` for the adapter to mark honestly.
4. **Per-vertex call/return event indices are returned** so the adapter can align other
   recorded evidence (collection ops for choose→undo detection, line events for teaching-line
   votes) with each call's lifetime.

## Not vendored (and why)

- `lambda/src/runner/steps/final-tree.ts` (Euler-tour playback times/logs): Forever's existing
  `lib/execution/trace/recursion/compiler.js` already implements the same Euler-tour playback
  model (studied from this repo, per its header) and additionally emits validated
  ExecutionTrace steps with narration; duplicating the times/logs model would create a
  parallel system.
- Lambda handler, validations, error types, web UI: Forever records and renders with its own
  machinery.

## The Forever adapter

`lib/execution/trace/universal/lenses/recursion-tree.js` is the thin adapter: it feeds the
universal recording's call/return events into `tree-builder.js`, lays the tree out with
`layout.js`, converts the `{argsList, adjList:[{childId, weight}]}` node model into the shape
`lib/execution/trace/recursion/compiler.js` animates, and adds the pieces that have no
upstream counterpart (written for Forever, not copied): teaching-line votes from recorded line
events, and choose→recurse→undo (backtracking) detection from recorded collection-op events.

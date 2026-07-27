# vendor/ — third-party source vendored into Forever

Policy: we vendor real licensed source files, never reimplement from descriptions. Every
project directory carries the upstream LICENSE copied verbatim, a NOTICE file when upstream
has one (none of the current four do), and a `SOURCE.md` recording: original repository URL,
the exact commit hash vendored from, the license, every file copied, every file modified,
the Forever adapter path (if any code is executed), and the regression tests that gate it.
Reference-only directories are never imported, executed, or bundled.

| Project | License | What was copied | What Forever uses it for | Adapter (executed code) | Details |
| --- | --- | --- | --- | --- | --- |
| [dpvis](https://github.com/itsdawei/dpvis) `fbe0f30` | MIT | `dp/` core Python modules: `DPArray` read/write logging, `Logger`/`Op` timestep model, verifier, visualizer frame sequencing | Reference for the dp-table dry-run engine's step model (`lib/execution/trace/dp-table/`): how a DP step records reads/writes/highlights and how frames are sequenced | none — reference only | [dpvis/SOURCE.md](dpvis/SOURCE.md) |
| [OATutor](https://github.com/CAHLR/OATutor) `52bb000` | MIT (code) — CC BY 4.0 CONTENT deliberately NOT copied | `BKT-brain.js` (Bayesian Knowledge Tracing update), problem-select heuristics, hint/scaffold walker components (`HintSystem`/`SubHintSystem`/`HintTextbox`); synthetic schema example (placeholders, no upstream content) | Per-skill mastery estimation and the hint/scaffold ladder schema | `lib/mastery/bkt.js` (pure ESM adaptation of the copied update; tests in `tests/mastery/bkt.test.js`) | [oatutor/SOURCE.md](oatutor/SOURCE.md) |
| [JSAV](https://github.com/vkaravir/JSAV) `556853c` | MIT | `src/` structure + effect modules: array/matrix/list/tree/graph state objects, effects, `anim.js` step recording/replay | Reference mapping their visual-state model onto Forever's board-object/ExecutionTrace model (`lib/board/`) | none — reference only | [jsav/SOURCE.md](jsav/SOURCE.md) |
| [recursion-tree-visualizer](https://github.com/brpapa/recursion-tree-visualizer) `c3f046e` | MIT | Tree-model types, tracker-wrapper tree builder, Reingold-Tilford layout | Recursion-tree rendering of recorded call/return traces | `tree-builder.js` / `layout.js` in its vendor dir, driven by `lib/execution/trace/universal/` recordings | [recursion-tree-visualizer/SOURCE.md](recursion-tree-visualizer/SOURCE.md) |

License texts: `dpvis/LICENSE`, `oatutor/LICENSE`, `jsav/MIT-license.txt` (upstream's file
name, kept as-is), `recursion-tree-visualizer/LICENSE`.

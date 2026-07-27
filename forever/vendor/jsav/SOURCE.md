# Vendored: vkaravir/JSAV

- **Original repo**: https://github.com/vkaravir/JSAV
- **Commit vendored from**: `556853c407cb3a3b95137dd68072a6b1e4aa33ad`
- **License**: MIT (Copyright (c) 2011- Ville Karavirta and Cliff Shaffer) — see
  `MIT-license.txt` in this directory, copied verbatim (upstream's license file carries this
  name; kept as-is). No NOTICE file exists upstream.
- **Status**: REFERENCE ONLY. Only the `src/` modules defining data structures + effects were
  taken — not the built bundle, not the jQuery/Raphael runtime, not exercises/questions/
  translations. Nothing here is imported, executed, or bundled by Forever.

## Files

| File here | Upstream source | Status |
| --- | --- | --- |
| `MIT-license.txt` | `MIT-license.txt` | copied verbatim |
| `src/datastructures.js` | `src/datastructures.js` | copied verbatim (reference: common JSavDataStructure base) |
| `src/array.js` | `src/array.js` | copied verbatim (reference: array structure + index highlight/swap effects) |
| `src/matrix.js` | `src/matrix.js` | copied verbatim (reference: 2-D array of arrays) |
| `src/list.js` | `src/list.js` | copied verbatim (reference: linked list nodes + next-edges) |
| `src/tree.js` | `src/tree.js` | copied verbatim (reference: tree/binary tree nodes, parent/child edges) |
| `src/graph.js` | `src/graph.js` | copied verbatim (reference: nodes + directed/undirected edges) |
| `src/keyvaluepair.js` | `src/keyvaluepair.js` | copied verbatim (reference) |
| `src/effects.js` | `src/effects.js` | copied verbatim (reference: animated value moves/swaps between structures) |
| `src/anim.js` | `src/anim.js` | copied verbatim (reference: the step/effect recording core — `anim()`-wrapped effects append undo/redo-able operations; `step()`/`stepdone` sequence frames; forward/backward replay) |

Files modified: none. Adapter: none executed — this is a design reference for Forever's board
object model (`lib/board/`). Regression tests: the existing board/execution suites under
`tests/board/` and `tests/execution/` gate that model; this directory adds no runtime surface.

## Concept map: JSAV state model -> Forever board-object model

| JSAV concept | Where in JSAV | Forever counterpart |
| --- | --- | --- |
| Data structure objects created on a visualization instance (`jsav.ds.array/list/tree/graph/matrix`) holding CURRENT visual state | `src/datastructures.js` + per-structure modules | Declarative per-step `views` on an ExecutionTrace (`views.array`, `views.list`, `views.graph`, `views.array2d`, `views.intervals`) validated by `lib/board/execution/execution-trace.js`; placed on the board as a boardObject with `renderHint: "algorithm"` (`lib/board/objects/board-objects.js`) |
| Mutating accessors recorded as animated effects (`arr.value(i, v)`, `arr.swap(i, j)`, `node.highlight()`, `css()` changes) — each wrapped by `anim()` so it lands in the animation log with undo info | `src/anim.js`, `src/effects.js`, `src/array.js` | Forever steps are SNAPSHOTS, not recorded mutations: each step declares the structure state plus emphasis fields (`array2d.current` / `values` / `filled`, `activeEdge`, named pointers). Diffing/undo is unnecessary because every frame is complete; the structure itself is fixed for the whole animation — only arrows and named pointers move between steps. |
| `jsav.step()` / `jsav.displayInit()` / `jsav.recorded()` — frame boundaries; forward/backward playback over the effect log | `src/anim.js` | Ordered `steps[]` of the ExecutionTrace played by the clock-driven AlgorithmStage; scrubbing to any step is safe because a step is self-contained. |
| Highlight/unhighlight as reversible effects on indices/nodes | `src/array.js`, `src/effects.js` | Per-step emphasis declared in the step (current write, filled region, proved reads, active edge) — validated so an emphasis can only reference cells/nodes/edges that exist in the declared structure. |
| Tree/graph edges as first-class objects (`JSAV.utils.extend`-built node + edge objects with layout) | `src/tree.js`, `src/graph.js` | `views.graph.nodes[] / edges[]` with `from`/`to` ids checked against declared nodes; directed-graph `activeEdge` must match a declared edge's orientation unless the step says `activeEdgeReverse: true` (`execution-trace.js`). |
| `matrix` = array of arrays with per-cell styling | `src/matrix.js` | `views.array2d` with `rows`/`cols` + optional `rowLabels`/`colLabels` (`execution-trace.js`), rendered by GridView. |
| Message output / narration alongside a step (`jsav.umsg`) | core/messages (not vendored; referenced) | Per-step `explanation` narration (e.g. dp-table `narrate.js`), required on every step. |

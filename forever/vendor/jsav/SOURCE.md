# Vendored: vkaravir/JSAV

- **Original repo**: https://github.com/vkaravir/JSAV
- **Commit vendored from**: `556853c407cb3a3b95137dd68072a6b1e4aa33ad`
- **License**: MIT (Copyright (c) 2011- Ville Karavirta and Cliff Shaffer) — see
  `MIT-license.txt` in this directory, copied verbatim (upstream's license file carries this
  name; kept as-is). No NOTICE file exists upstream.
- **Status**: FULL LIBRARY SOURCE VENDORED (complete `src/` + `css/` + build entry). JSAV is
  the *rendering* layer only. Forever's ExecutionTrace remains the single source of truth for
  what happens on each step — JSAV's hand-authored algorithm demos and exercises are excluded
  by design and must never be used as step sources. The translation from Forever algorithm
  steps to abstract visual operations lives in `lib/board/execution/jsav-adapter.js` (pure,
  DOM-free). Nothing under `vendor/jsav/` is imported by the default build; runtime embedding
  is gated behind `NEXT_PUBLIC_JSAV_RENDERER=1`.

## Files (all copied verbatim from the commit above; modified: none)

| File here | Upstream source | Notes |
| --- | --- | --- |
| `MIT-license.txt` | `MIT-license.txt` | license, copied verbatim |
| `Makefile` | `Makefile` | build entry (reference): concat order of src modules into `build/JSAV.js` |
| `Gruntfile.js` | `Gruntfile.js` | alternate build entry (reference): same concat order + lint/test config |
| `src/core.js` | `src/core.js` | JSAV constructor, init, `begin/end/step` API surface |
| `src/anim.js` | `src/anim.js` | step/effect recording core — `anim()`-wrapped effects, undo/redo, playback |
| `src/utils.js` | `src/utils.js` | utils (extend, value/position parsing, dialogs, settings) |
| `src/translations.js` | `src/translations.js` | UI-chrome translation strings (library UI, not lesson content) |
| `src/messages.js` | `src/messages.js` | `umsg` narration output |
| `src/effects.js` | `src/effects.js` | animated value moves/swaps between structures |
| `src/events.js` | `src/events.js` | click/mouse event binding on structures |
| `src/graphicals.js` | `src/graphicals.js` | Raphael-backed primitives (circle/rect/line/label) |
| `src/datastructures.js` | `src/datastructures.js` | common JSavDataStructure base |
| `src/array.js` | `src/array.js` | array structure + index highlight/swap effects |
| `src/matrix.js` | `src/matrix.js` | 2-D array of arrays |
| `src/list.js` | `src/list.js` | linked list nodes + next-edges |
| `src/tree.js` | `src/tree.js` | tree/binary tree nodes, parent/child edges |
| `src/graph.js` | `src/graph.js` | nodes + directed/undirected edges, layout |
| `src/keyvaluepair.js` | `src/keyvaluepair.js` | key-value pair structure |
| `src/code.js` | `src/code.js` | pseudocode display + line highlighting |
| `src/settings.js` | `src/settings.js` | speed/settings panel |
| `src/questions.js` | `src/questions.js` | question *framework* (mechanism only; no authored questions vendored) |
| `src/exercise.js` | `src/exercise.js` | exercise *framework* (grading mechanism only; no authored exercises vendored) |
| `src/front1.txt`, `src/front2.txt` | same | build fragments concatenated into `front.js` (IIFE wrapper) |
| `src/version1.txt`, `src/version2.txt` | same | build fragments concatenated into `version.js` |
| `css/JSAV.css` | `css/JSAV.css` | the library stylesheet |
| `css/images/settings.png`, `sound-icon.png`, `sound-off.png`, `spinner.gif` | `css/images/*` | assets referenced by JSAV.css |

## Excluded (by design — hand-authored algorithm content or third-party runtime)

- `examples/` — upstream's hand-authored algorithm demos. Excluded: Forever's ExecutionTrace
  (engine-verified) decides every step; demo scripts must never become step sources.
- `exercises/`-style authored content and `doc/`-type material — none vendored for the same
  reason (only the framework modules `questions.js`/`exercise.js` ship, as library code).
- `test/` — upstream QUnit suite; not part of the library runtime.
- `extras/` — optional add-ons (sound effects, stack widget); not needed.
- `lib/` — third-party runtime bundles (see deps below); if ever embedded, these come from
  npm, not from a vendored minified blob.
- `Changelog.txt`, `README.md`, `package.json` — repo metadata.

## Runtime dependencies (NOT vendored; required only if JSAV is actually executed)

Upstream ships these in `lib/`: **jQuery** (`jquery.min.js`), **jQuery UI**
(`jquery-ui.min.js`), **jquery.transit** (CSS-transition animations), **Raphael**
(`raphael.js`, needed for graphs/trees/graphicals edges), and **dagre** (`dagre.min.js`,
optional graph auto-layout). JSAV is a pre-module-era global script: the build concatenates
`front.js + core.js + ... + version.js` (order in `Makefile`/`Gruntfile.js`) into one IIFE
expecting `window.jQuery` (and `Raphael` for edge/graphical work) to exist first.

Regression tests: `tests/board/` and `tests/execution/` gate Forever's board model;
`tests/board/jsav-adapter.test.js` gates the step→op translation.

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

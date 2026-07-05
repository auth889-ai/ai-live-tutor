# Forever — Engineering Playbook

How hard product-level projects like this are actually built, studied from
[OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) (Tsinghua's open-source multi-agent
interactive classroom — the closest existing product to Forever) in July 2026.
This is the mistake-prevention document: read before starting any phase.

---

## 1. What OpenMAIC does that we COPY

| OpenMAIC pattern | Adoption in Forever |
|---|---|
| Monorepo with pnpm workspaces (`app/`, `components/`, `lib/`, `packages/`) | Same layout (already mirrored); adopt pnpm workspaces when `app/` lands in Phase 1 |
| Two-stage generation: outline first, then each outline item → rich scene | Same shape, deeper: Dean outline → Teacher plan → per-scene agents |
| Dedicated action module (`lib/action/`, 28+ typed action kinds) driven by a playback module (`lib/playback/`) | Our timeline actions + one-clock engine — keep action vocabulary in ONE module, renderer knows only actions, never agent output |
| Async generation jobs with progress the client can watch | Ours is stronger (BullMQ + SSE vs polling) — keep it |
| Separate test configs: unit (`vitest.config`) vs evaluation (`vitest.eval.config`) vs e2e (Playwright) | Adopt the three-tier split: contract tests (node --test) / `eval/` benchmark harness / `e2e/` player flows. Never mix cheap deterministic tests with paid LLM evals |
| Provider abstraction (any OpenAI-compatible endpoint, YAML config) | Our `lib/qwen/` — keep ALL model calls behind it; model IDs only in env/config, never inline |
| `ACCESS_CODE` protection for shared deployments | Add for the judged demo deployment — judges get a code, the endpoint isn't an open free-for-all |
| Self-contained export (ZIP with data-URI-inlined assets, offline playback) | Adopt for course export + notebook PDFs — also makes the demo resilient if conference wifi dies |
| MinerU for advanced PDF parsing (optional external service) | Optional Librarian enhancer behind a flag (a MinerU key already exists from the old project); pdfjs+vision remains the default path |
| SVG whiteboard for stroke drawing; canvas for dense slides | Start SVG-only (handwriting reveal is SVG-native); switch hot paths to canvas only if profiling demands it |
| Zustand for client state, custom hooks for logic reuse | Adopt in Phase 1 |

## 2. Where Forever must be BETTER (the gaps that are our differentiators)

1. **Sync quality.** OpenMAIC sequences actions with a playback state machine — good, but timing is still estimated. Forever replaces estimates with **measured word timestamps** (CosyVoice render → Paraformer alignment → reconciler). This is the single biggest "feels human" delta; do not cut it when deadlines bite.
2. **Grounding.** OpenMAIC generates from the model's knowledge; nothing ties a claim to a source. Forever's sourceRef-on-everything + Grounding Auditor + Source & Proof panel is the credibility moat. Never ship a scene whose refs don't resolve.
3. **Contract validation as a storage gate.** OpenMAIC validates config; generated content mostly flows through. Forever refuses to *store* an invalid manifest. The validator is the law; agents conform to it, never vice versa.
4. **Real execution.** Their code playgrounds are interactive HTML; our code output is captured from a real sandbox run. Displayed output that was never executed is a firing offense.
5. **Course-series structure.** OpenMAIC generates a lecture; Forever generates a curriculum (COURSE_STRUCTURE.md). The Dean/duration-budget/negotiation layer has no OpenMAIC equivalent — it's ours to get right.
6. **Agent society with teeth.** Their LangGraph director alternates turns; our critics can BLOCK, negotiate budgets, and escalate to a binding Arbiter, with the debate persisted and streamed. That's the Track 3 story.

## 2b. Phase kickoff ritual (MANDATORY — one phase at a time, research first)

Never start a phase by writing code. Every phase begins with this sequence:

1. **Research** — web-search how shipped products solved THIS phase's problem
   (reference points per phase are listed below). Verify library/model choices against
   current reality, not memory. Write the findings + decision into the phase's section here.
2. **Decide** — pick ONE approach with a one-paragraph justification. No parallel bets.
3. **Build the smallest complete slice** — one module, one responsibility, tests with it.
4. **Gate** — the phase's exit gate from WORKFLOW.md must pass before anything new starts.
5. **Commit** — green gate = commit point.

Phase research questions (answer at kickoff, not before):
- **Phase 1 (renderer):** How do tldraw/Excalidraw/OpenMAIC animate strokes? SVG path-reveal
  techniques for handwriting; driving React state from `<audio>.currentTime` via rAF;
  binary-search over action lists. What breaks on seek-backwards?
- **Phase 2 (TTS/align):** CosyVoice API shape today; does it emit timestamps natively or do
  we align with Paraformer? Real code samples of DashScope audio APIs.
- **Phase 3 (first scene):** Structured-output limits on qwen3.7 models (max schema size,
  nesting); best practice for image inputs via OpenAI-compat endpoint.
- **Phase 4 (episode):** BullMQ flow patterns (parent/child jobs), idempotent retries.
- **Phase 5-6 (course/ingestion):** pdfjs rasterization quality; MinerU output format.
- **Phase 7 (eval):** How agent papers measure multi-agent vs single-agent gains — metrics
  judges will recognize (pass rate, grounding coverage, cost, wall time).
- **Phase 8 (deploy):** Current ECS/SAE + RDS + Tair + OSS setup guides; deployment-proof
  recording examples from past Devpost winners.

One phase in flight at a time. If a discovery invalidates a previous phase's decision,
STOP, update the doc, fix the earlier phase to green, then resume.

### Phase 1 research findings (2026-07-05) — DECIDED

**Handwriting reveal:** industry technique is SVG `stroke-dasharray`/`stroke-dashoffset`
(set dasharray to path length, animate dashoffset → 0); variable-width calligraphy strokes
need the mask variant (a stroked mask path reveals the filled text under it). Sources:
CSS-Tricks handwriting/line-animation articles, SVGator handwriting tutorial, cassie.codes.
**Our twist:** NO CSS animations/transitions — dashoffset is set every frame as a pure
function of clock time, otherwise seeking breaks.

**Clock sync:** one `requestAnimationFrame` loop samples `<audio>.currentTime` (precision =
one frame, ~16.7ms — fine; word-level sync needs ~50ms). Guard: never start a second rAF
loop on `seeking`/`seeked` events (double-compute bug documented in the wild).

**The load-bearing decision:** the action engine is a PURE FUNCTION
`boardStateAt(timeline, tMs) -> state`. No accumulated mutable state between frames.
Consequences: seek/scrub/replay/speed are correct by construction (state at t is the same
no matter how you got there), and the whole engine unit-tests in Node with zero browser.

### Phase 1 slice-2 findings (2026-07-05, board renderer) — DECIDED

Studied how the two production whiteboard tools render (toolpick.dev comparison, tldraw
docs, Excalidraw): **Excalidraw = HTML canvas + plain serializable element array;
tldraw = DOM/React rendering, data model + interpreter utilities.**

1. **We render SVG in the DOM (tldraw's side), not canvas.** Reasons: our board is a
   structured region layout, not an infinite canvas; the W4 pointer contract requires
   `getBoundingClientRect()` on real DOM nodes; tldraw proves DOM rendering carries
   production complexity.
2. **Hand-drawn look = rough.js** (<9kB, powers the Excalidraw aesthetic, works
   headless via `rough.generator()` → path data, no DOM needed). CRITICAL: always pass
   a **seed derived from the object id** — rough.js randomizes stroke bowing, and an
   unseeded redraw would jitter between frames, breaking pure state-at-t rendering.
3. **Handwritten text = handwriting web font + per-word progressive reveal** driven by
   the engine's progress value — NOT font-outline stroke tracing (glyphs are filled
   outlines; dasharray tracing reads wrong per CSS-Tricks; the mask variant costs a
   hand-authored mask per text). Word-level reveal also matches the product goal
   exactly: the word appears as the tutor says it.
4. **Renderer core is isomorphic pure functions** (`packages/@forever/renderer`):
   (manifest objects + engine state) → SVG. No React dependency in the core — the same
   code renders the live board, timeline thumbnails, and server-side notebook PDFs.
   React wrapper is a thin layer added with the app shell.

### Phase 6 findings (2026-07-05, from the old server's proven code) — DECIDED EARLY

**PDF page rendering** (port of `server/services/googleAgent/pdfPageImageRenderer.service.js`):
- Every PDF page → ONE exact full-page PNG. Images/diagrams inside the PDF are never
  extracted separately — the page is the unit, so a picture always keeps its context.
- Render order: `pdftocairo -png -r <dpi>` first, `pdftoppm` as fallback (poppler,
  `brew install poppler` / apt on ECS). DPI configurable via env.
- **Puppeteer/browser PDF screenshots are BANNED** — the old project tried it: Chrome's
  viewer captures sidebar/toolbar chrome and repeats pages. This mistake is already paid for.

**Displaying PDF images (the OpenMAIC-style overlay — FULL-PAGE RULE):**
- The Source & Proof panel shows the REAL page image, untouched — never cropped, never
  file-cut. Evidence is shown by drawing an overlay (highlight box) on top using the
  sourceRef.bbox (normalized 0..1 — already validated by `source-pack/refs/source-refs.js`).
- Zoom = CSS transform on the intact image (reversible); final pixel positions come from
  DOM measurement (getBoundingClientRect), so pointer accuracy is exact on any screen size.
- The vision pass (qwen3.7-plus) produces the bboxes at ingestion; the renderer only ever
  consumes normalized coordinates.

## 3. Mistake-prevention checklist (read at the start of every phase)

**Process (how projects like this die, and how we won't):**
- [ ] Commit small and often. (`forever/` sat fully untracked for days — never again. Every green test run is committable.)
- [ ] Never build stage N+1 on an unvalidated stage N. The phase exit gates in WORKFLOW.md are hard gates.
- [ ] Fixtures before AI: the renderer was provable with hand-written manifests before any token was spent. Keep a fixture path working forever — it's also the offline demo fallback.
- [ ] Fixtures are TEST DATA for the display machinery, never product content. lib/,
      packages/, workers/ must never import from fixtures/ — mechanically enforced by
      tests/fixtures/fixture-isolation.test.js (guards the System 1 fake-content mistake).
      The pipeline has no fallback that could serve a fixture: failed agents raise.
- [ ] One integration at a time. Wire Qwen into ONE agent, prove it, then the next. No big-bang "wire everything then debug" step.
- [ ] Every LLM call goes through `lib/qwen/` with: retries, timeout, structured-output schema, token/cost ledger entry. No raw fetch calls sprinkled around.
- [ ] Model IDs, prices, and limits live in env/config only. When Qwen ships 3.8, we change one file.
- [ ] Secrets hygiene: `.env` never committed (gitignore covers it), `.env.example` always current, no keys in docs or logs.
- [ ] The demo is rehearsed from a clean machine + the deployed URL, not from the dev laptop's warm state.

**Design invariants (violating any of these = stop and fix, not patch):**
- [ ] Agents output regions/line_numbers, never x/y.
- [ ] One playback clock. If a feature "needs" a second timer, the design is wrong.
- [ ] Provisional timings never reach production playback — reconciler or bust.
- [ ] No fallback content. A failed agent raises; the UI shows an honest error state.
- [ ] Every factual claim carries a resolving sourceRef.
- [ ] One focused job per LLM call. If a prompt grows past one responsibility, split the agent.
- [ ] Contracts change by version bump + migration, never by silent edit — generated manifests in storage must stay playable.

**Budget discipline (free tier is 1M tokens):**
- [ ] Dev iterations run on ONE cached test scene, not full episodes.
- [ ] SourcePack prefix uses explicit cache; check the ledger weekly against the credit balance.
- [ ] `eval/` runs are batched and intentional, not accidental CI side effects.

## 4. Testing pyramid (OpenMAIC-informed, Forever-hardened)

```text
        e2e/            Playwright: player flows, seek/scrub, quiz pause      (few, slow)
        eval/           LLM-in-the-loop: society vs baseline, grounding %,    (paid, batched,
                        rubric scores — separate config, never in `npm test`)  intentional)
        tests/          node --test: contracts accept/reject, timeline        (many, fast,
                        compiler determinism, region math, reconciler logic,   every commit)
                        society kernel (mocked LLM)
```

Rule: `npm test` must be free, fast, and deterministic — it runs on every commit.
Anything that spends tokens lives in `eval/` and is invoked explicitly.

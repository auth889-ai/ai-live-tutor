# Forever — 3-minute demo video script (Track 3: Agent Society)

**Goal:** show a *real* multi-agent society working — task division, live debate, conflict
resolution — and the payoff (algorithms animated from really-executed code). Record screen at
1080p+; speak in a calm, confident pace. Total ≈ 3:00.

Legend: **[SHOW]** = what's on screen · **"Say"** = narration (read aloud).

---

### 0:00–0:20 — Hook
**[SHOW]** The home dashboard, then the Studio page.
> "This is **Forever**. Give it any material — a PDF, an article, a photo of a slide — and a
> *society* of Qwen agents turns it into a taught, interactive course. Not one model guessing a
> lesson — a team that divides the work, argues with evidence, and refuses to make anything up.
> It's built for **Track 3: Agent Society**."

### 0:20–0:50 — Kick off a build, show task division
**[SHOW]** In Studio, paste a PDF/article, click **Generate**. The live faculty log streams over SSE.
> "I paste a source and the faculty goes to work. A **Router** picks the domain, a **Teacher**
> plans the lesson, and for every scene a **Board Director** stages the screen. Each agent has one
> job — you're watching them divide the task in real time."

### 0:50–1:35 — The debate (the Track-3 core)
**[SHOW]** Open a scene's "Society's Work" panel / the message log: a **Grounding Auditor**
objection with a citation, a **revision**, then a **verdict**. Point at `9 objections · 1 repair · verified ✓`.
> "This is the important part. The **Grounding Auditor** is a hard gate — it files an objection,
> *with evidence*, when a claim isn't supported by the source. The Board Director revises. If they
> still disagree, an **Arbiter** issues a binding verdict. An objection without evidence is
> rejected — so the debate stays grounded, not rhetorical. Every scene ships with its receipt:
> steps, objections, repairs, verified."

### 1:35–2:20 — The payoff: really-executed code
**[SHOW]** Play an algorithm lesson (Dijkstra or flood-fill): grid/graph animating, the active
code line highlighting, the trace table filling — synced to the voice. Then click **"run in your browser"** / edit + run.
> "And here's what that rigor buys. This animation isn't imagined frames — the algorithm was
> **actually executed** in a sandbox, and the screen is driven by the real trace: the active line,
> the visited nodes, the step table. The narration is that trace step's explanation, so voice and
> board can't drift. And the student can re-run the exact code, right in the browser."

### 2:20–2:45 — Measurable gain + grounding
**[SHOW]** `eval/RESULTS.md` (society 4/4 vs single-agent 0/4), then a lesson figure with a **"Source · page N"** stamp.
> "Does the society actually beat one big prompt? We measured it: on matched materials a single
> agent passes **zero of four** on the quality gate; the society passes **all four**, with real
> execution traces and cited figures — every claim tied back to your source, page and all."

### 2:45–3:00 — Architecture + close
**[SHOW]** The README architecture diagram, then `lib/qwen/client.js` with the DashScope endpoint.
> "Every model call runs on **Qwen Cloud** — DashScope — with one model per job, on a Node
> backend, BullMQ workers, and MongoDB, all on Alibaba Cloud. That's **Forever**: an agent society
> that teaches like the best teacher you ever had. Thanks for watching."

---

## Recording tips
- Pre-generate one good course **before** recording so playback is instant; do the *live* build on
  a short source so it finishes on camera.
- If the live build is slow, start it, then cut to the pre-made course (say "here's one it already built").
- Keep the cursor deliberate; pause on the debate log and the trace table — those are the money shots.
- Export as **1080p**, upload to **YouTube/Vimeo/Facebook**, set to **Public**, paste the link in Devpost.
- Hard cap 3:00 — if long, trim the intro and the 2:20 section first.

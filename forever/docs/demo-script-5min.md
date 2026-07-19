# FOREVER — the 5-minute judge demo (Track 3: Agent Society)

The thesis in one line: **human teachers assert; forever executes. The best tutor moves,
enforced by law, on any material, with every claim verified — and the society's debate is
the proof, not a slide.**

## Minute 0–1 — The hook: watch a course get born
- Upload / paste material (live). The Dean architects the outline in seconds.
- Point at the roles as they fire: Dean → domain router → the subject's own teacher
  (16 specialist registers) → per-scene Board Director / Grounding Auditor / Arbiter.
- SAY: "Task division is the architecture, not a metaphor — every lesson is a negotiation."

## Minute 1–2 — The lesson: 2-sigma tutor moves, enforced
- Open a gate-clean lesson (Econ "Finding Equilibrium" or DB "Kid's Shop").
- Show the INSPIRE arc live: prediction prompt BEFORE the reveal (gate rule
  `no-early-prediction`), misconception named and refuted BY MEASUREMENT, checkpoint,
  recap.
- SAY: "These aren't style choices. A lesson missing any of these beats cannot ship —
  the gate refuses it. Bloom's 2-sigma tutor moves, written as law."

## Minute 2–3 — The killer moment: the system refuses to lie
- Show the build log: **"Scene sc_07 could not reach grounded consensus in 3 rounds —
  refusing to ship ungrounded content."** The Arbiter sustained the Auditor's objection.
- Show the anti-laundering catch: the AI once wrote "demand jumps 1800 → 2200" and drew
  those numbers on its own diagram. The gate's board-number rule caught it; the repair
  chain derived the true value (1600 + 400 = 2000) through the calc engine; the board now
  shows the executed derivation.
- SAY: "Conflict resolution isn't a feature we claim — here is a scene the society
  refused, and here is a lie the gate caught. Every scene stores its full debate
  transcript: proposal, objections, verdict."

## Minute 3–4 — Engine = truth, per domain
- DB lesson: the queries EXECUTE (SQLite) — joins 1→0, opcodes 53→45, same-answer proof.
- Econ lesson: elasticity −1.2 vs −0.83 computed from the source schedules; the ghost
  curve is arithmetic, not artwork.
- Coding lesson: "▶ run in YOUR browser" — the exact code on screen runs in Pyodide,
  and the visual dry run is recorded from REAL execution (68-problem battery, 67 elite).
- SAY: "Three different engines, one law: the tutor may only speak numbers an engine
  produced or the source contains."

## Minute 4–5 — The measured claim (Track 3's rubric, answered)
- Run `node scripts/society-vs-single.mjs` live or show the ledger:
  **single agent 3.3 avg gate violations vs agent society 0.0** — same source, same
  deterministic judge, n=3 lessons; society lessons additionally carry executed evidence
  and 66–142 debate messages each.
- Scorecards: DB 16/16 gate-clean; Econ 24 lessons, self-repair visible in every stored
  gate field; ML built entirely under the strengthened stack.
- CLOSE: "Task division, negotiation, conflict resolution, and a measurable gain over a
  single agent — not narrated. Stored, executed, and re-runnable in front of you."

## Rules for the presenter
- Never claim beyond the ledger. Every number in this script exists in a commit message,
  a stored lesson, or a rerunnable script — if asked, run it.
- If something fails live, SHOW the refusal — the system being honest under failure IS
  the product.

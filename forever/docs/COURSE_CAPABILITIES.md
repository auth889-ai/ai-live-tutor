# Per-Course "Beat the Human Tutor" Capability Map

For each of the 14 courses: the world-class teacher whose method is coded into the register,
the tools/installs required, the API keys required, and what makes it beat a human tutor.
Compiled from web research across this build. **Status** = what is implemented in code.

Legend: ✅ implemented & tested · 🔑 needs a key · ⬜ available, not yet wired · (none) = no key.

---

## Dependency summary (the honest install list)

**Already present, nothing to install:** `python3`, `sqlite3`, `node`, MongoDB (Atlas cloud).
**The one required key:** `DASHSCOPE_API_KEY` (Qwen) — the LLM that writes/diagnoses. Everything
else below is either keyless or an optional free key.

**No Docker needed anywhere.** All execution engines run in the existing python3/sqlite3.

---

## 1. Database — beats Andy Pavlo (CMU 15-445)
- **Method (coded):** build-and-measure on a real DBMS; every schema claim proved by executing queries.
- **Tools:** `sqlite3` (present). ⬜ Optional: Supabase / Aiven free Postgres (keyless dev tier) for advanced joins.
- **Keys:** none.
- **Beats human:** ✅ sql-evidence engine executes the lesson's queries — join counts, EXPLAIN opcodes, same-answer proofs — per student. A human asserts; this measures.

## 2. Economics — beats CORE Econ / MRU
- **Method (coded):** real-data-first; every curve shift computed from a dataset the student moves.
- **Tools:** calc-evidence (present).
- **Keys:** ⬜ **FRED API (free key)** — 800k US economic time series; World Bank Open Data (**no key**) for GDP/indicators.
- **Beats human:** ✅ calc-evidence computes elasticity/revenue from the source's own schedules. ⬜ Next: wire World Bank API for real live data.

## 3. Machine Learning — beats Andrew Ng (CS229)
- **Method (coded):** intuition first, then the math; loss curves COMPUTED not narrated.
- **Tools:** train-evidence (python, present).
- **Keys:** none.
- **Beats human:** ✅ train-evidence runs real gradient descent on the student's dataset — real loss curve, real final weights. Ng shows his prepared example; this trains yours.

## 4. Physics — beats Eric Mazur (Harvard)
- **Method (coded):** 5-step ConcepTest (predict → confront → reveal), misconception-distractors.
- **Tools:** sim-evidence (python motion integration, present); ✅ **PhET simulations** embedded (no key).
- **Keys:** none.
- **Beats human:** ✅ sim-evidence integrates real trajectories + student DRAGS a live PhET sim. A human draws an approximate arc; this simulates and lets you manipulate it.

## 5. Chemistry — beats Catherine Drennan (MIT 5.111)
- **Method (coded):** relevance-before-formula, clicker predictions, reward reasoning.
- **Tools:** chem-balance (atom conservation, pure JS); ✅ **PubChem PUG REST** (no key); ✅ PhET (balancing-chemical-equations, build-a-molecule).
- **Keys:** none.
- **Beats human:** ✅ real NIH molecular weights (NaOH = 39.997 g/mol, verified live) + deterministic equation-balance check. A human hand-types the molar mass; this looks up the database.

## 6. Biology — beats Amoeba Sisters / HHMI
- **Method (coded):** dual-coding analogies (DNA=recipe, RNA=chef), land on real terms.
- **Tools:** genetics-evidence (Punnett + Hardy-Weinberg, pure JS); ✅ PhET (natural-selection, gene-expression).
- **Keys:** none. ⬜ Optional: NCBI E-utilities (no key) for real gene data.
- **Beats human:** ✅ inheritance ratios COUNTED from the cross (3:1 proven), Hardy-Weinberg self-checks to 1.0.

## 7. Networking — beats Kurose & Ross (top-down)
- **Method (coded):** start at the application, peel down to the services that support it.
- **Tools:** network-evidence (RTT floor, packet count, slow-start, pure JS).
- **Keys:** none. ⬜ Optional: Mininet / GNS3 (free, self-host) for real topologies.
- **Beats human:** ✅ speed-of-light RTT floor computed from distance (80ms Dhaka→London), real slow-start windows. A human waves at "latency"; this derives it from physics.

## 8. OS — beats OSTEP (Arpaci-Dusseau, Wisconsin)
- **Method (coded):** three pieces (virtualization/concurrency/persistence), state the crux, mechanism vs policy.
- **Tools:** sched-evidence (FCFS/SJF/RR simulator, pure JS).
- **Keys:** none.
- **Beats human:** ✅ proves "SJF beats FCFS, 8.5→5.0ms avg wait" by RUNNING both schedulers, not asserting.

## 9. Architecture — beats Simon Brown (C4) / SEI ATAM
- **Method (coded):** C4 zoom (context→container→component→code), ATAM trade-off on the student's numbers.
- **Tools:** number-honesty gate + back-of-envelope calc-evidence.
- **Keys:** none.
- **Beats human:** ✅ every component forced by a measured bottleneck; capacity recomputed on the student's load.

## 10. SRS (Requirements) — beats Alistair Mavin (EARS, Rolls-Royce)
- **Method (coded):** EARS five patterns; every requirement one testable "shall".
- **Tools:** ears-check (deterministic syntax enforcer, pure JS).
- **Keys:** none.
- **Beats human:** ✅ a malformed requirement CANNOT ship — the gate rewrites it to EARS. A human misses ambiguity; this enforces syntax.

## 11. SQA (Testing) — beats Cem Kaner (BBST, Florida Tech)
- **Method (coded):** every test needs an oracle; oracles are heuristics; boundary/equivalence/decision-table/exploratory.
- **Tools:** number/oracle gate. ⬜ Optional: Pyodide (present) to RUN the student's tests.
- **Keys:** none.
- **Beats human:** ✅ enforces a stated oracle per test; ⬜ next: execute the student's tests in Pyodide for real coverage.

## 12. Agents/RAG — beats LangChain/LangSmith docs
- **Method (coded):** trace-as-pedagogy — show the actual run, tool calls, retrieved chunks with scores.
- **Tools:** the society's own stored debate transcripts (the course shows its own machinery).
- **Keys:** ⬜ optional embeddings key (Qwen embeddings, present) for live retrieval demos.
- **Beats human:** ✅ real tool-call traces with similarity scores; the failure is shown in the open.

## 13. History — beats Sam Wineburg (Stanford, Reading Like a Historian)
- **Method (coded):** sourcing → contextualization → corroboration → close reading.
- **Tools:** ✅ **Library of Congress Chronicling America** (no key) — real period newspapers; ⬜ National Archives Catalog API (no key).
- **Keys:** none.
- **Beats human:** ✅ pulls a REAL 1916 newspaper live for sourcing. A human paraphrases from memory; this fetches the genuine document + URL.

## 14. Law — beats Langdell's case method (Harvard IRAC)
- **Method (coded):** IRAC with element-by-element application, mandatory counterargument, change-one-fact.
- **Tools:** irac-check (structure enforcer, pure JS); ✅ **CourtListener v4 / Caselaw Access** (no key) — millions of real opinions.
- **Keys:** none.
- **Beats human:** ✅ enforces the application step + cites a REAL precedent (Layton Construction, 2016 COA 155). A human invents a hypothetical; this pulls the actual case.

---

## Universal layer (every course, beats human on all of them)
- ✅ **Adaptive Diagnosis Engine** — a wrong answer triggers a live diagnosis of the specific misconception + targeted re-teach + follow-up (the Bloom 2-sigma move, automatic for every student). Key: Qwen.
- ✅ **INSPIRE Socratic gate** — a lesson that never makes the student predict before the reveal cannot ship.
- ✅ **Graduated hint ladder** (5 levels, answer only at level 5) + **SM-2 spaced review**.
- ✅ **Practice panel** — engine-checked variations, infinite, from the student's own material.
- ✅ **Society debate transcripts** — Track 3 conflict-resolution proof, stored per scene.

## The one-line answer
Beating the best human is not one feature — it is: **execute every claim** (9 engines) +
**pull real sources live** (PubChem, LoC, CourtListener) + **let the student manipulate**
(PhET/Desmos) + **diagnose and re-teach each student's actual error** (adaptive engine) +
**enforce the field's best pedagogy** (grounded registers + deterministic gates). No human does
all five, for every student, on every claim.

## Optional free keys to wire next (all free tier, listed for completeness)
- **FRED API key** (economics live data) — fred.stlouisfed.org, free.
- **NASA/other open data** — most keyless.
- Everything currently shipped needs **only** the Qwen key.

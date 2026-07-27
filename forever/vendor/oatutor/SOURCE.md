# Vendored: CAHLR/OATutor (code only)

- **Original repo**: https://github.com/CAHLR/OATutor
- **Commit vendored from**: `52bb00040eb6bd6aad440fae63aee0ca9a4f65a5`
- **License**: MIT (Copyright (c) 2023 Zachary A. Pardos (@zpardos) - CAHL research lab) —
  see `LICENSE` in this directory, copied verbatim from the original repo. No NOTICE file
  exists upstream.
- **Content boundary**: OATutor's educational CONTENT (problems, hints, lesson pools, the
  `content-sources/` submodule) is CC BY 4.0 and is NOT vendored — code only. The JSON under
  `schema/` here is a synthetic placeholder written for Forever to document the shape the
  vendored walker code expects; it contains no upstream content.

## Files

| File here | Upstream source | Status |
| --- | --- | --- |
| `LICENSE` | `LICENSE` | copied verbatim |
| `src/models/BKT/BKT-brain.js` | `src/models/BKT/BKT-brain.js` | copied verbatim — the Bayesian Knowledge Tracing posterior + learning-transit update |
| `src/models/BKT/problem-select-heuristics/defaultHeuristic.js` | same path | copied verbatim (reference: lowest-mastery-first problem selection) |
| `src/models/BKT/problem-select-heuristics/experimentalHeuristic.js` | same path | copied verbatim (reference) |
| `src/components/problem-layout/HintSystem.js` | same path | copied verbatim (reference: walks `hints[]` — `type` "hint"/"scaffold", `dependencies` unlock gating, `subHints`) |
| `src/components/problem-layout/SubHintSystem.js` | same path | copied verbatim (reference: nested sub-hint walking) |
| `src/components/problem-layout/HintTextbox.js` | same path | copied verbatim (reference: scaffold answering — `hint.hintAnswer` / `hint.answerType`) |
| `schema/hint-scaffold-schema.example.json` | none (synthetic) | written for Forever; placeholder strings, field names derived from the walker code above |

Files modified: none of the copied files were modified.

## Forever adapter

- **Adapter**: `lib/mastery/bkt.js` — thin ESM adaptation of the copied `BKT-brain.js`.
  The conditional-probability equations and their structure are kept verbatim; changes are
  limited to module surface (named exports), purity (returns a new model instead of mutating
  the argument), input validation, and default parameters. Upstream keeps its per-skill BKT
  parameters in the CC BY content repo (an empty submodule here), so they are not exposed in
  the code repo; Forever defaults are `pInit = 0.3`, `pTransit = 0.15`, `pGuess = 0.25`,
  `pSlip = 0.1`.
- **Regression tests**: `tests/mastery/bkt.test.js` (correct raises mastery, wrong lowers it
  from the default prior, guess/slip keep the posterior in bounds, repeated correct answers
  converge above 0.95, update is pure).

## Concept map

| OATutor concept | Where | Forever counterpart |
| --- | --- | --- |
| `update(model, isCorrect)` — Bayes posterior on `probMastery` given a correct/incorrect observation, then learning transit `p + (1-p) * probTransit` | `src/models/BKT/BKT-brain.js` | `updateBkt(model, isCorrect)` in `lib/mastery/bkt.js` (pure) |
| Per-skill `bktParams[kc] = { probMastery, probTransit, probGuess, probSlip }` | upstream `Platform.js` / `Problem.js` (not vendored) | `createBktModel(params)` in `lib/mastery/bkt.js` with `BKT_DEFAULTS` |
| `MASTERY_THRESHOLD` gate + lowest-mastery problem selection | `problem-select-heuristics/defaultHeuristic.js` | reference for Forever's future next-item selection over per-KC mastery |
| Hint/scaffold tree: ordered `hints[]`, `dependencies` (indices that must be unlocked first), `type: "scaffold"` = hint that itself demands an answer, nested `subHints` | `HintSystem.js`, `SubHintSystem.js`, `HintTextbox.js` | reference schema for Forever's tutoring hint ladders (see `schema/hint-scaffold-schema.example.json`) |

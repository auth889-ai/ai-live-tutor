# research/open-source — upstream repos cloned for STUDY ONLY

This directory is **gitignored and never part of the build**. Nothing here is imported,
bundled, or executed by Forever. It exists so upstream code can be read at a pinned commit
before deciding what — if anything — is worth adopting.

**The promotion path is one-way and deliberate:**

```
research/open-source/<project>/     read it here, at a pinned commit
        ↓  only what we actually adopt, and only if the licence allows
forever/vendor/<project>/           LICENSE + SOURCE.md + verbatim/modified files
        ↓  the adapter that binds it to Forever's own truth
forever/lib/...                     Forever code; the recorder stays the source of truth
```

Standing law: **visual truth always comes from Forever's own execution recorder.** Upstream
projects may contribute presentation grammar, vocabulary, layout maths, and architectural
patterns. Their hand-authored algorithm demos are never step data.

## Fetched 2026-07-29

| Project | Pinned commit | Upstream last commit | Licence | Vendorable? | Why fetched |
| --- | --- | --- | --- | --- | --- |
| [FActScore](https://github.com/shmsw25/FActScore) | `f28272deffcf` | 2025-04-13 | MIT | yes | Atomic decomposition of long-form generation into individually checkable facts — the pattern behind "atomic teaching units". |
| [QAFactEval](https://github.com/salesforce/QAFactEval) | `01177f11cc05` | 2026-06-02 | BSD-3-Clause | yes | QA-based factual consistency between a source and generated text. |
| [qags](https://github.com/W4ngatang/qags) | `47798e9b6334` | 2022-11-27 | **NONE FOUND** | **NO** | Same QA-consistency idea, earlier. **No LICENSE file in the repo** — treat as all-rights-reserved. Read for method only; copy nothing. |
| [tutor_gym](https://github.com/Teachable-AI-Lab/tutor_gym) | `772f5cdca5dd` | 2025-09-10 | MIT | yes | Simulated-student environments for testing a tutor — the missing regression harness for the BKT/routing loop. |
| [jalangi2](https://github.com/Samsung/jalangi2) | `bc879287b167` | 2026-01-10 | Apache-2.0 | yes (NOTICE required) | JS dynamic-instrumentation reference — Forever has no JS recorder, so JS submissions get the honest basic view. |
| [rcviz](https://github.com/carlsborg/rcviz) | `2566743490f8` | 2023-07-09 | **GPLv2** (`setup.py` classifier; no LICENSE file) | **NO** | Copyleft — incompatible with vendoring into Forever. Python recursion call-tree capture; read for method only. |
| [tracers.js](https://github.com/algorithm-visualizer/tracers.js) | `4db510da8000` | 2022-04-12 | MIT | yes | The visualisation *command vocabulary* (array1d/array2d/graph/log…) to compare against Forever's JSAV adapter. |
| [SoM](https://github.com/microsoft/SoM) | `130438d9a033` | 2024-08-19 | MIT (integrates other segmentation systems — check each) | partial | Set-of-Mark region labelling for figure grounding. |
| [promptfoo](https://github.com/promptfoo/promptfoo) | `ac8971fcfa96` | 2026-07-28 | MIT | yes | Declarative prompt/agent red-teaming — the adversarial test set for the teaching validators. |

### Licence findings that change the plan

- **qags has no LICENSE file at all.** Absence of a licence means no grant of rights, not
  permission. Method may be read and reimplemented; no file may be copied.
- **rcviz is GPLv2** (declared only via a `setup.py` classifier). Copyleft — vendoring it
  would impose GPL obligations on Forever. Read for method only.
- **jalangi2 is Apache-2.0**, which requires preserving `NOTICE` on redistribution — if any
  of it is ever vendored, `NOTICE` ships with it.
- **SoM is MIT itself but integrates several segmentation systems** under their own licences;
  the dependency chain must be checked per component before anything is adopted.

## Already promoted to `forever/vendor/`

`dpvis` · `jsav` · `oatutor` (code only — its CC BY 4.0 content is deliberately NOT vendored)
· `recursion-tree-visualizer`. Each carries its own `LICENSE` + `SOURCE.md` with the pinned
commit and a file-by-file record of what was copied verbatim vs modified.

## Refreshing

These are shallow clones (`--depth 1`). To re-pin, delete the directory and re-clone, then
update the commit column above.

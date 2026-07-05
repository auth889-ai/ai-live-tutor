# Forever — Course Structure Model

How Forever chunks a course, calibrated against real top-rated Udemy courses
(Machine Learning A-Z, ~380 lectures; Deep Learning Masterclass with TensorFlow 2, 58.5h).
This is the specification the **Dean** agent plans against and the outline contract
(`lib/course-series/`) validates against.

## Hierarchy

```text
Course
└── Episode        = Udemy "Section"  — one coherent topic       (30–90 min, 4–12 lessons)
    └── Lesson     = Udemy "Lecture"  — one teaching goal        (3–20 min, 1–6 scenes)
        └── Scene  = Forever's unit   — one continuous board     (1–5 min)
                     (Udemy has no visible equivalent; scenes are the generation
                      job unit and the timeline thumbnails in the player)
```

What real instructors do — and Forever copies:

| Observed on Udemy | Forever rule |
|---|---|
| Sections are ONE topic ("Polynomial Regression", "Kernel SVM", "K-Means Clustering") | Episode = one node of the concept graph, never two |
| Most lectures are 4–6 min micro-steps ("Step 2b - Transforming Linear to Polynomial…") | Lessons default to 4–8 min; >12 min requires a stated reason (deep theory like "Understanding Transformers 1hr 3min" is allowed but flagged) |
| Intuition lecture(s) come BEFORE implementation ("SVR Intuition" → "Step 1a…") | Every episode opens with a concept lesson before any code/practice lesson |
| Steps are numbered and sequential (Step 1a, 1b, 2a, 2b…) | Practice lessons form an explicit dependency chain in the outline |
| Quiz at the END of every section ("Quiz 4: Polynomial Regression Quiz") | Every episode closes with an episode quiz; lessons also embed 1–3 inline checkpoints |
| "Link to Code" / "Link to Dataset" resource items | Auto-attached lesson resources: runnable code files (from the Code Runner's actually-executed code), dataset refs, and the lesson's notebook page |
| Visualization/interpretation lectures after building ("Step 3 - Visualizing…", "Interpreting Coefficients") | Build lessons are followed by a see-it lesson (plot/dry-run/trace) before the episode quiz |
| Recap/conclusion lecture per part ("Conclusion of Part 2 - Regression") | Course parts (groups of episodes) end with a recap lesson wired to notebook highlights |

## Episode anatomy (the default template the Dean instantiates)

```text
Episode N: <one topic>                      30–90 min total
  1. Concept lesson      "why + intuition"          4–10 min   (board: diagrams, analogies, source proof)
  2..k. Build lessons    numbered steps             4–8 min    (board + code panel, real execution, dry runs)
  k+1. See-it lesson     visualize / interpret      3–8 min    (plots, traces, before/after)
  k+2. Pitfalls lesson   misconceptions, errors     3–6 min    (only if the Teacher persona flags common traps)
  Episode quiz           3–8 questions, worked answers, all source-cited
  Resources              code files, dataset links, notebook pages (auto)
```

This template is a SHAPE, not content: the Teacher persona adapts it per subject
(a history episode's "build lessons" become source-analysis lessons; a math episode's
"see-it" becomes worked-example variation). The Dean may drop or repeat slots with a
logged justification — never silently.

## How counts and durations are computed (never hardcoded)

The Dean derives the plan from measurable inputs, and writes its arithmetic to the blackboard:

- **Episode count** = concept-graph clusters that survive a coherence check (one topic per episode), bounded by source volume. Thin source → fewer, longer-prep episodes plus Researcher enrichment; a 500-page book → parts → episodes.
- **Lesson count per episode** = teaching steps the Teacher persona proposes for that topic at the learner's level, snapped to the 4–8 min micro-lesson band (Udemy's observed attention unit).
- **Scene count per lesson** = board "screens" needed — a scene ends when the board would need wiping or the sub-goal changes.
- **Level scaling** (from the learner's chosen depth): beginner expands concept + pitfalls lessons; advanced compresses concept lessons and adds stretch scenes. Same source, different plan — computed, not templated.

Duration budgets flow down: course → episode → lesson → scene, and are the constraint
the Board Director ↔ Voice Writer negotiation must satisfy (ARCHITECTURE.md §3.3).

## Player mapping

- Sidebar lists episodes with durations and lock/progress state (like the Udemy section list).
- Opening an episode shows its lesson playlist; each lesson plays as scenes on one continuous clock with timeline thumbnails per scene.
- The episode quiz gates the "completed ✓" mark; inline checkpoints pause the clock mid-lesson.
- Resources tab per lesson: code files, dataset links, notebook page, source pages cited.

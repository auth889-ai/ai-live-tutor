# Forever — Tool Strategy (how ~200 "tools" become ~8 primitives)

The subject tool catalog lists ~200 tools across 21 domains (coding, DSA, OOP, architecture,
SRS, SQA, networking, OS, math, physics, chemistry, biology, ML/DL, RAG, history, law,
economics, finance, + cross-subject tutor tools). Hand-building 200 renderers is impossible
and unnecessary. KEY INSIGHT (research-confirmed): almost every "tool" is one of a small set
of RENDERING PRIMITIVES with different content. Forever builds the PRIMITIVES; the agents
(Board Director + domain Teacher) generate the right content and pick the right primitive.

## The 8 primitives

1. **Mermaid (26 diagram types)** — ✅ integrated. flowchart, sequence, class, state, ER,
   gantt, pie, journey, mindmap, timeline, sankey, requirement, quadrant, gitgraph, C4,
   architecture, xychart, block, packet, kanban, treemap, fishbone, venn, ZenUML.
   COVERS ~40% of the catalog: class/inheritance (OOP), sequence/handshake (networking, OOP,
   arch), state machines (OS, auth, LangGraph), ER, architecture/C4/deployment, recursion/
   BST/graph/decision/use-case/RAG/neural-net (flowchart), history timeline, cause-effect
   (fishbone), SWOT/risk (quadrant), supply-demand/loss-curve (xychart), OSI (block), packet.
   TODO: let the Board Director emit ANY mermaid type / raw mermaid (prompt change; renderer
   already handles it).
2. **Tables (HTML)** — ✅ built. comparison, trace, decision, truth, traceability, SWOT,
   tradeoff, Punnett, confusion matrix, IRAC, balance sheet, income statement, MoSCoW.
3. **Code (editor+runner+trace)** — ✅ built. editor, syntax highlight, real execution,
   output, error, dry-run trace (self-debug). TODO: interactive exercise editor + judge.
4. **KaTeX math** — ⬜. equations, matrices, step derivations, CAPM/WACC/stoichiometry/physics.
5. **Charts** — 🟡 (Mermaid xychart/pie/sankey covers many). Richer: ROC, scatter/decision
   boundary, portfolio, histogram -> a plot component later.
6. **Images + vision** — ⬜ (PDF slice 2 + fetch). Show a REAL image (PDF figure, fetched web
   image, molecule/cell/anatomy/circuit/free-body/microscope), vision explains it, tutor
   points at parts (annotation). t2i_search / Unsplash to FETCH topic images; qwen3.7-plus
   vision to SEE + explain PDF/URL/YouTube images.
7. **Motion/animation** — ⬜. one clock-driven system animating a diagram/array step by step:
   BFS/DFS visited order, sorting, packet flow, wave, vector, attention, TCP handshake.
8. **Annotation (cross-subject "human tutor")** — 🟡 (pointer, highlight exist). circle,
   underline, arrow, zoom, mistake card, analogy card, checkpoint "pause & think", recap,
   next-lesson hook, voice pace. These give premium feel in EVERY subject.

## Why this beats Udemy/Coursera/YouTube
A human instructor uses the same few visual devices (diagram, table, code, formula, image,
animation, pointer) across every topic — the SKILL is choosing the right one and explaining
it. Forever mirrors that: primitives + a domain-aware Teacher/Board Director that picks and
fills them. Coverage scales with prompt quality, not with hand-built tool count.

## Build order (one at a time, highest coverage first)
1. **Unlock all Mermaid types** in the Board Director (raw-mermaid content) — ~40 tools in one
   prompt+validation change. HUGE leverage, cheap.
2. **Images + vision** (PDF figures explained + fetched topic images) — the "display & explain
   images" ask; also finishes PDF ingestion.
3. **KaTeX math** — unlocks math/physics/finance/ML-formula teaching.
4. **Annotation tools** — pointer/zoom/mistake/checkpoint/recap — premium feel everywhere.
5. **Motion layer** — step-by-step animators (DSA + science).
6. **Charts** (plot component) — ML/econ/finance.
7. **Interactive exercise + judge** (coding) — student writes & runs.

## Elite teaching quality (parallel, prompt-level)
Domain-aware Teacher personas per subject (already dynamic) + the evidence-based pedagogy
(concrete-first, brute->better->optimal, misconception, retrieval — DONE) + a Pedagogy critic
to enforce the bar every lesson (consistency = Coursera's edge). Research each domain's
teaching conventions as we add it.

## Deadline reality (<1 week)
Cannot build all 8 + deploy. Prioritize: (1) Mermaid-all-types (cheap, huge), (2) images+
vision, (3) KaTeX, (4) annotation — then RESERVE the deploy/benchmark/demo window. Ship a
product that already spans dozens of "tools" via the primitives, not a half-built pile of 200.

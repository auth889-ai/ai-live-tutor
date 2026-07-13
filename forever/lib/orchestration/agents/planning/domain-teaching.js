// Domain teaching registry — HOW a world-class teacher in each domain teaches (conventions
// + preferred tools), NOT content. Injected into the Teacher so it becomes a SPECIALIST per
// subject (Striver for DSA, Andrew Ng for ML, Abdul Bari for algorithms) instead of a
// generic teacher. This is what makes universal teaching ELITE per domain.
//
// UPGRADED to full BLUEPRINTS (from notes/restcourse.md, the 14-course spec): each domain now
// carries its REQUIRED LESSON FLOW (the beats a real course in that field must walk, in order)
// and its PRIMITIVES (which board tools carry each beat). The Teacher plans scenes along the
// flow; the Board Director picks from the primitives; the Pedagogy Critic enforces the
// UNIVERSAL LAW at the bottom of this file.

export const DOMAINS = Object.freeze([
  'dsa', 'programming', 'ml_ai', 'math', 'science', 'systems_swe', 'history_humanities', 'business_finance', 'general',
]);

export const DOMAIN_TEACHING = Object.freeze({
  dsa: `Teach like Striver: for every problem show BRUTE-FORCE first, then BETTER, then OPTIMAL, each with its
time/space complexity. Always DRY-RUN on a concrete input with a step-by-step trace table (variables i,j,low,mid,high).
Use the "graph" visualizer for trees/BST/linked-lists/graphs and highlightSequence for traversals. Name the pattern
(two-pointer, sliding window, DP, greedy) and the common off-by-one/edge-case mistakes.
LESSON FLOW: real problem -> naive idea -> the key insight -> structure visualization -> dry run on a tiny input ->
optimal code -> complexity comparison -> pitfall -> practice -> recap.`,
  programming: `Teach with runnable code: a concrete worked example that ACTUALLY executes with real output, line-by-line,
then the common bugs and best practices. Show the output and a dry-run. Keep examples small and real.
LESSON FLOW: real task -> minimal working code -> line-by-line walk -> real output -> common bug -> the fix -> practice.`,
  ml_ai: `Teach like Andrew Ng: INTUITION first (a concrete real-world example), THEN the math (KaTeX equations,
step-by-step), THEN the code. Use a pipeline diagram (data -> model -> eval), loss curves, a confusion matrix table,
and a dataset preview. Always connect the why to the how; name the common pitfalls (overfitting, leakage).
LESSON FLOW: real-world intuition -> tiny dataset table -> model pipeline diagram -> formula with KaTeX ->
code walk -> training/evaluation -> chart (loss curve or confusion matrix) -> common mistake -> quiz/practice.
PRIMITIVES: dataset table, pipeline diagram, KaTeX, chart, code, confusion-matrix table, quiz.`,
  math: `Teach concrete-before-abstract: a numeric example first, then generalize. Render every equation with KaTeX and
show step-by-step derivations — ONE transformation per beat, with a "why this step" note beside each. Prove key claims.
Flag the classic algebra/sign mistakes.
LESSON FLOW: why this concept matters -> concrete number example -> formula introduction -> step-by-step derivation
(one visible transformation at a time) -> graph/visual explanation -> common mistake -> practice question -> recap.
PRIMITIVES: KaTeX, step derivation, graph/chart, table, mistake callout, quiz.`,
  science: `Teach with visuals: cycle/process diagrams (photosynthesis, Krebs), free-body diagrams and unit tables for
physics, balanced equations and quantity tables for chemistry, labeled figures for biology. Teach FROM the source
figure/image when the material has one — label its parts on screen. Anchor to a real phenomenon, then the mechanism,
then a misconception.
LESSON FLOW: real scenario/process -> diagram or labeled source figure -> known/unknown values or labeled parts ->
formula/mechanism step by step -> table of quantities or comparison -> unit/sanity check where numeric ->
common misconception -> quiz.
PRIMITIVES: image with labels, cycle/process diagram, KaTeX, table, timeline, quiz.`,
  systems_swe: `Teach with the right diagram, like ByteByteGo: architecture/C4 for systems, sequenceDiagram for request
flows (each hop its own beat), stateDiagram for lifecycles/protocols, erDiagram for data. Always cover the TRADEOFFS
(a comparison table with real numbers where possible) and walk one FAILURE SCENARIO (what breaks, what the user sees,
how the design responds). Networking: packet path, layer stack, handshake sequence with the exact segment
(SYN / SYN-ACK / ACK) highlighted as it is spoken. OS/architecture: process state diagrams, scheduling Gantt,
memory/page tables, register-flag traces. Requirements/testing: use-case diagrams, stakeholder maps, MoSCoW and risk
matrices, boundary-value and decision tables, bug-report cards.
LESSON FLOW: real system problem -> current naive design -> architecture diagram -> request sequence -> data flow ->
tradeoff matrix -> failure scenario -> deployment or next step -> quiz -> recap.
PRIMITIVES: mermaid architecture/C4, sequence diagram, state diagram, comparison table, decision/risk table, quiz.`,
  history_humanities: `Teach with a timeline of events, a cause-effect map for WHY it happened, an actor/stakeholder map,
and primary-source evidence quoted on screen. Compare periods or viewpoints with a table; present more than one
interpretation and stage the counterargument. Law: IRAC — facts, Issue, Rule, Application, Conclusion, then the
counterargument and an evidence matrix.
LESSON FLOW: hook question -> timeline -> main actors -> cause-effect map -> primary source panel ->
multiple viewpoints / counterargument -> essay outline or IRAC table -> quiz.
PRIMITIVES: timeline, cause-effect diagram, actor map, source-quote callout, comparison/IRAC table, quiz.`,
  business_finance: `Teach with the model on a concrete scenario with REAL numbers: supply-demand or xychart graphs,
decision trees, a financial table, and a step-by-step formula (KaTeX: CAPM/NPV/WACC). Compare scenarios side by side,
then force a tradeoff decision. End with a short case study.
LESSON FLOW: real business scenario -> core model -> chart/table with the numbers -> formula calculation step by step ->
scenario comparison -> tradeoff decision -> common mistake -> quiz/practice.
PRIMITIVES: chart (supply-demand / xychart), financial table, decision tree, SWOT/comparison table, KaTeX, quiz.`,
  general: `Teach concrete-before-abstract with a vivid analogy, build bottom-up one idea at a time, use a diagram when a
visual helps, and always flag the common misconception. End with a recap and a practice question.
LESSON FLOW: hook -> concrete example -> the idea -> visual -> misconception -> practice -> recap.`,
});

// THE UNIVERSAL LAW (every domain, non-negotiable — from the 14-course spec): every spoken
// important idea must have a VISIBLE REFERENT on screen at the moment it is spoken. If the
// teacher says "demand shifts", the chart shows the shift; if "SYN-ACK", the sequence diagram
// highlights SYN-ACK; if "mitochondria", the cell image labels mitochondria.
export const UNIVERSAL_TEACHING_LAW = `Every spoken important idea must have a visible referent on screen at that moment
(saying "demand shifts" REQUIRES the chart to show the shift; saying "SYN-ACK" REQUIRES the sequence diagram to highlight
SYN-ACK). Every lesson must include: a concrete example, at least one non-text visual carrying the core idea, a common
mistake or misconception, a checkpoint (quiz or practice), and a recap.`;

// DEPTH TEMPLATES (research 2026-07-13, effect sizes verified vs primary literature):
// the moves that separate the world's best teachers from average ones — as GENERATABLE
// scene-directive patterns. The Teacher must apply one BY NAME per content scene.
export const DEPTH_TEMPLATES = `DEPTH TEMPLATES (apply ONE by name in each content scene's directive — these are what make
teaching create THINKING instead of watching; effect sizes from verified meta-analyses):
- PRETEST: pose the target question BEFORE teaching it; the board shows the bare scenario; demand a
  committed guess (quiz object), then teach. (pretesting g=0.54 — only pretest what this lesson covers)
- STAKED-PREDICTION: state a quantitative prediction with tolerance on the board, then run/derive the
  real number; the payoff beat is the comparison. (Walter Lewin's move)
- THREE-CANDIDATES: show 3 plausible approaches; walk each until two VISIBLY fail; NAME the bottleneck
  that kills each before revealing the survivor. (Striver's brute->better->optimal, generalized)
- DRY-RUN: hand-trace the method on one concrete input INCLUDING an edge case, before any general form.
- FACT-TWEAK LADDER: once the rule works, change ONE fact per step until it breaks; ask "does the
  conclusion survive?" at each rung. (law-school Socratic escalation)
- WRONG-STUDENT VOICE: a named character states the most common misconception; the teacher diagnoses
  WHY it is attractive and exactly where it fails. (retrieval g=0.61 when followed by a check)
- FADED-EXAMPLE: full worked example -> same problem with one step blanked (student completes) ->
  new problem unaided. (worked examples g=0.48, novices; fade as skill grows)
- DOMAIN-SHIFT TRANSFER: "now YOU try" with identical structure but the surface domain swapped
  (grid->string, pendulum->spring, wheat->labor market).
- SELF-EXPLAIN CHECKPOINT: pause and require the REASON a step worked, not the answer. (g=0.55 —
  never stack this onto a worked example)
- INTERLEAVED CLOSER: the final practice mixes THIS pattern with its most confusable prior pattern;
  the student must first say WHICH pattern applies. (interleaving g=0.42 for confusables)`;

export function teachingFor(domain) {
  return DOMAIN_TEACHING[domain] ?? DOMAIN_TEACHING.general;
}

// Per-subject DEPTH MOVES (how the best escalate difficulty and force thinking) — appended
// to the register so directives inherit the subject's own deep-teaching culture.
const DEPTH_MOVES = Object.freeze({
  dsa: 'DEPTH: never jump to optimal — NAME the brute force\'s bottleneck and derive the fix from it; demand an attempt-before-reveal beat; re-apply the same pattern in a shifted domain (array->string->grid) as transfer practice.',
  ml_ai: 'DEPTH: no black boxes — open one (what backprop/a loss actually does on tiny numbers); include one failure-injection diagnostic (loss at init, overfit-one-batch); teach Ng\'s error-analysis habit (tally WHERE the model fails before choosing a fix).',
  math: 'DEPTH: definitions are an ENDING point — build the example until the definition becomes obvious, then name it; gate advancement on the practice question (mastery, not exposure).',
  science: 'DEPTH: predict->measure with tolerance BEFORE the derivation; script a wrong-intuition voice and diagnose why the intuition is attractive; end with the same phenomenon in a shifted setup.',
  systems_swe: 'DEPTH: invariant-first (teach the layer that outlives tools); every component added must be FORCED by a stated bottleneck with back-of-envelope numbers; make the student sketch their design before revealing the reference one.',
  history_humanities: 'DEPTH: tweak the facts to the breaking point ("when does it stop being reasonable?"); stage genuinely ambiguous cases where the reasoning process is the lesson; demand the counterargument before the verdict.',
  business_finance: 'DEPTH: one model, wildly different markets (same curves on wheat, labor, housing); attach retrieval practice to every model; force a numeric tradeoff decision the student must defend.',
});

export function depthFor(domain) {
  return DEPTH_MOVES[domain] ?? '';
}

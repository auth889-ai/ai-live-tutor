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

export function teachingFor(domain) {
  return DOMAIN_TEACHING[domain] ?? DOMAIN_TEACHING.general;
}

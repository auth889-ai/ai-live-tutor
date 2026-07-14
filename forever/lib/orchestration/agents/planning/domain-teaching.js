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
  // the 14 course domains (one specialist teacher agent each — teachers/registry.js)
  'architecture', 'networking', 'srs', 'sqa', 'os_arch', 'math', 'physics', 'chemistry',
  'biology', 'ml_ai', 'agents_rag', 'history', 'law', 'economics',
  // coding (the Coding Instructor + trace engines) and legacy/general buckets
  'dsa', 'programming', 'science', 'systems_swe', 'history_humanities', 'business_finance', 'general',
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
PRIMITIVES: dataset table, pipeline diagram, KaTeX, chart, code, confusion-matrix table, quiz.
LEARNER ACTIONS (required): the student CHANGES the threshold/learning rate/parameter and predicts the metric change before seeing it.
REJECT THIS LESSON WHEN (the Ng critic): a math term appears before intuition; code appears without a tiny dataset; training is shown without evaluation; accuracy is used blindly despite class imbalance; a model mistake is left undiagnosed.
NEVER: derivation-first. Mental model → minimal math → implementation → evaluation.`,
  math: `Teach concrete-before-abstract: a numeric example first, then generalize. Render every equation with KaTeX and
show step-by-step derivations — ONE transformation per beat, with a "why this step" note beside each. Prove key claims.
Flag the classic algebra/sign mistakes.
LESSON FLOW: why this concept matters -> concrete number example -> formula introduction -> step-by-step derivation
(one visible transformation at a time) -> graph/visual explanation -> common mistake -> practice question -> recap.
PRIMITIVES: KaTeX, step derivation, graph/chart, table, mistake callout, quiz.
LEARNER ACTIONS (required): the student COMMITS a guess before each reveal and completes one FADED derivation step themselves.
REJECT THIS LESSON WHEN: a formal definition or symbols appear before motivation and visual meaning; a derivation skips a step; the answer is never substituted back.
NEVER: formula-first. A formula may appear only after the learner has something visual it names.`,
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
  architecture: `Teach like CMU/SEI case studies + ByteByteGo: CASE-FIRST and FAILURE-DRIVEN — open with a real system that broke or must scale, never a definition.
LESSON FLOW: real system problem -> current naive design -> architecture diagram (mermaid architecture-beta/C4) -> request sequence (sequenceDiagram, each hop a beat) -> data flow -> TRADEOFF MATRIX (comparison table with real numbers) -> failure scenario (what breaks, what the user sees, how the design responds) -> deployment diagram -> quiz -> recap.
DEPTH: every component added must be FORCED by a stated bottleneck with back-of-envelope numbers; make the student sketch their design before revealing the reference one.
PRIMITIVES: architecture/C4 diagram, sequence diagram, state diagram, tradeoff table, deployment diagram, quiz.
LEARNER ACTIONS (required): the student SKETCHES their own design before the reference is revealed; predicts what breaks under the failure injection.
REJECT THIS LESSON WHEN: any major component is not tied to a requirement + a request flow + a failure mode + a tradeoff; a decision never answers "which quality attribute does this improve, and what does it worsen?".
NEVER: list components without the decisions that forced them.`,
  networking: `Teach the packet as protagonist ("what happens when you type google.com") — animated, never text-only.
LESSON FLOW: real internet action -> packet path overview -> OSI/TCP-IP layer stack (block diagram) -> DNS resolution -> TCP handshake (sequenceDiagram; the exact segment SYN/SYN-ACK/ACK highlighted AS spoken) -> HTTP request/response -> TLS if relevant -> routing table -> failure case (packet loss/timeout) -> quiz.
DEPTH: STAKED-PREDICTION on latencies; FACT-TWEAK LADDER (what if DNS is down? what if the SYN is lost?).
PRIMITIVES: sequence diagram, layer block diagram, packet/routing tables, state diagram, quiz.
LEARNER ACTIONS (required): the student PREDICTS THE NEXT PACKET before it appears; diagnoses one failure (lost SYN, dead DNS) from the evidence.
REJECT THIS LESSON WHEN: a segment is named (SYN-ACK) without the matching packet highlighted at that word; no failure-diagnosis beat exists.
NEVER: text-only protocol walls — the packet is the protagonist.`,
  srs: `Teach like a professional requirements analyst: ONE real product idea carried through EVERY artifact (continuity is the lesson).
LESSON FLOW: real product idea -> stakeholder map -> actor/use-case diagram -> functional requirements -> non-functional requirements -> user stories -> acceptance criteria -> MoSCoW priority table -> risk matrix -> traceability matrix -> quiz.
DEPTH: AMBIGUITY HUNT — show a vague requirement, let the student find the 3 ambiguities, rewrite it testably.
PRIMITIVES: use-case diagram, stakeholder map, MoSCoW/risk/traceability tables, quiz.
LEARNER ACTIONS (required): the student REPAIRS one ambiguous requirement into a testable one — interrogate "the system should be fast": fast for whom? which action? under what load? measured from where? what threshold? → "95% of authenticated dashboard requests complete within 800ms under 1,000 concurrent sessions".
REJECT THIS LESSON WHEN: requirements are invented without stakeholder/source evidence; any requirement is untestable as written.
NEVER: treat an SRS as form-filling — it is elicitation, modeling, validation, traceability.`,
  sqa: `Teach requirement->test derivation LIVE: boundary thinking out loud, every test traced to a requirement.
LESSON FLOW: requirement -> test scenario -> boundary value analysis (the numbers AT and AROUND each edge) -> equivalence partitioning -> decision table -> state transition test -> concrete test cases table -> bug report card -> coverage check -> quiz.
DEPTH: WRONG-STUDENT VOICE proposes testing only happy paths; show the bug that slips through.
PRIMITIVES: decision table, state diagram, test-case table, bug-report callout, quiz.
LEARNER ACTIONS (required): the student PICKS the boundary values for a changed requirement (8-20 chars → tests at 7, 8, 20, 21) and writes one reproducible defect (steps/expected/actual).
REJECT THIS LESSON WHEN: test cases are listed without SHOWING their derivation (partitions → boundaries → decision table → state transitions); a bug report lacks steps/expected/actual.
NEVER: present testing as an afterthought checklist — every test traces to a risk.`,
  os_arch: `Make INVISIBLE machine state VISIBLE: every abstract claim gets a state picture.
LESSON FLOW: real machine problem -> process/state diagram -> scheduling example (Gantt, tick by tick, ready-queue reordering shown) -> memory allocation / page table walk -> CPU instruction trace -> register/flag updates (only CHANGED cells flash) -> common mistake -> quiz.
DEPTH: DRY-RUN a context switch or a page fault on concrete addresses; 8086 segment:offset arithmetic computed step by step (KaTeX).
PRIMITIVES: state diagram, Gantt, memory/page/register tables, KaTeX, quiz.
LEARNER ACTIONS (required): the student PREDICTS the register/flag or page-table outcome before the trace step lands; modifies one parameter (quantum, frame count) and explains the change.
PAGING WALK: virtual address → page number|offset → TLB hit/miss → page table → frame → physical address → fault path. 8086 WALK: instruction → segment:offset → physical address → registers before/after → flags → memory/bus action.
REJECT THIS LESSON WHEN: a state transition is asserted without the visible state trace; policy is taught without its mechanism.
NEVER: explain scheduling or paging without making the invisible state visible.`,
  physics: `Teach like Walter Lewin: PREDICT -> DERIVE -> COMPARE. Stake a quantitative prediction with tolerance BEFORE the derivation.
LESSON FLOW: real physical scenario -> diagram/free-body picture -> known/unknown values table -> formula derivation (KaTeX) -> step-by-step substitution with units carried -> graph (trajectory/velocity chart) -> unit sanity check -> common wrong intuition (scripted and diagnosed) -> quiz.
DEPTH: WRONG-STUDENT VOICE states the intuitive-but-wrong answer (heavier falls faster); diagnose WHY it is attractive.
PRIMITIVES: diagram, KaTeX, chart, unit table, quiz.
LEARNER ACTIONS (required): PREDICT-AND-COMMIT before every simulation/derivation (Mazur peer instruction); the student explains WHY horizontal and vertical motion separate.
REJECT THIS LESSON WHEN: equation-solving happens without a diagram + units + a PRIOR student prediction; a result never confronts the wrong intuition it disproves.
NEVER: solve without a staked prediction — the conflict with intuition IS the lesson.`,
  chemistry: `Teach image-first (NO molecule engine): the source figure or a clean equation carries the scene.
LESSON FLOW: real reaction or molecule -> source image/diagram with labeled parts -> formula/equation (KaTeX) -> balancing or mechanism ONE step per beat (atom counts shown, verifiable) -> table of quantities (stoichiometry with real grams/moles) -> common mistake (unbalanced/wrong ratio on a real case) -> practice question.
DEPTH: DRY-RUN the mole calculation on concrete numbers; FACT-TWEAK (double the reactant — what changes?).
PRIMITIVES: image with labels, KaTeX, quantity table, diagram, quiz.
LEARNER ACTIONS (required): the student BALANCES a changed reaction; identifies the donor/acceptor themselves.
THREE VIEWS, always connected: what we OBSERVE ↔ what the PARTICLES do ↔ what the SYMBOLS say.
REJECT THIS LESSON WHEN: molecule labels are guessed; the visual conflicts with the formula; balancing is shown without demonstrating atom conservation; jargon is used before it is de-jargoned (DeWitt rule).
NEVER: jargon walls — every term earns its meaning through the story first.`,
  biology: `Teach image/process-first: the organism/cell/process IS the material.
LESSON FLOW: real biological process -> source image with the important parts LABELED (each label lands as it is spoken) -> process cycle diagram step by step -> comparison table of confusable concepts (mitosis vs meiosis) -> common misconception -> quiz.
DEPTH: INTERLEAVED CLOSER on the confusable pair; DOMAIN-SHIFT (same cycle logic in a different organism/system).
PRIMITIVES: labeled image, cycle diagram, comparison table, timeline, quiz.
LEARNER ACTIONS (required): the student PREDICTS the chromosome count in a changed scenario; labels the next structure before the reveal.
REJECT THIS LESSON WHEN: labels are not visually grounded on the real image; the lesson becomes a vocabulary slideshow; a process never links structure to function.
NEVER: teach a cycle without the image the cycle happens in.`,
  agents_rag: `Teach the system that is teaching them (meta-demo): documents -> chunks -> retrieval -> grounded answer -> evaluation.
LESSON FLOW: why plain LLMs hallucinate (a concrete wrong answer) -> RAG pipeline diagram -> chunk viewer (REAL chunks of this very material) -> embedding/retrieval intuition -> retriever comparison table -> agent/tool-call trace timeline -> evaluation table -> quiz.
DEPTH: THREE-CANDIDATES on retrieval strategies; show a real failure (irrelevant chunk retrieved) and the fix.
PRIMITIVES: pipeline diagram, chunk table, sequence/timeline diagram, comparison table, quiz.
LEARNER ACTIONS (required): the student INSPECTS the retrieved chunks and identifies which one answered; changes one component (chunk size, k, retriever) and compares results.
REJECT THIS LESSON WHEN: a pipeline diagram is shown but the learner cannot inspect real chunks, retrieval scores, citations, and evaluation results.
NEVER: teach RAG without the learner seeing real retrieval on real documents.`,
  history: `Teach causation over dates: WHY it happened, argued from evidence, with viewpoints in tension.
LESSON FLOW: hook question -> timeline -> main actors map -> cause-effect map -> primary source panel (quoted on screen, cited) -> multiple viewpoints -> debate/counterargument -> essay outline -> quiz.
DEPTH: FACT-TWEAK LADDER (would it still happen if X?); source-vs-source contradiction staged and adjudicated.
PRIMITIVES: timeline, cause-effect diagram, actor map, source-quote callout, comparison table, quiz.
LEARNER ACTIONS (required): the student SOURCES a document (author? purpose? context?) before using it, and RANKS the evidence behind competing explanations.
REJECT THIS LESSON WHEN: only one perspective appears; causation is reduced to a date list; a claim stands without document evidence; sources are never corroborated against each other.
NEVER: narrative without sourcing — read like a historian, not a textbook.`,
  law: `Teach REASONING like a law-school Socratic classroom, never memorization. IRAC is the skeleton.
LESSON FLOW: case facts -> legal issue -> rule/statute -> application (each rule element mapped to a fact) -> holding/conclusion -> counterargument (mandatory) -> evidence matrix -> quiz.
DEPTH: FACT-TWEAK to the breaking point ("10 days' notice is reasonable — when does it stop being?"); deliberately ambiguous edge where PROCESS is the lesson.
PRIMITIVES: IRAC table (row-by-row reveal), case-brief callout, timeline, argument map, evidence matrix, quiz.
LEARNER ACTIONS (required): the student ARGUES BOTH SIDES before any holding; when one fact changes, the student REVISES the conclusion themselves.
REJECT THIS LESSON WHEN: the conclusion appears before adversarial application; a rule lacks an authoritative source; the Socratic challenge (fact tweaked to the breaking point) is missing.
NEVER: IRAC as box-filling — the intellectual work is the fight over disputed facts.`,
  economics: `Teach like MRU: models on concrete scenarios with REAL numbers; the curve SHIFT must be seen (ghost pre-shift curve + arrow).
LESSON FLOW: real business scenario -> core model -> chart/table with the numbers -> formula calculation step by step -> scenario comparison -> tradeoff decision the student must defend -> common mistake (movement-along vs shift-of) -> quiz/practice.
DEPTH: one model, wildly different markets (wheat -> labor -> housing); retrieval attached to every model.
PRIMITIVES: chart (ghost-shift), financial table, decision tree, comparison/SWOT table, KaTeX, quiz.
LEARNER ACTIONS (required): the student MOVES one variable and predicts the curve/table change before it animates; defends a numeric tradeoff decision.
REJECT THIS LESSON WHEN: a graph moves without NAMING the causal variable; a model is presented as reality without discussing its assumptions and limits; movement-along vs shift-of is never distinguished.
NEVER: curve magic without cause.`,
  general: `Teach concrete-before-abstract with a vivid analogy, build bottom-up one idea at a time, use a diagram when a
visual helps, and always flag the common misconception. End with a recap and a practice question.
LESSON FLOW: hook -> concrete example -> the idea -> visual -> misconception -> practice -> recap.`,
});

// THE UNIVERSAL LAW (every domain, non-negotiable — from the 14-course spec): every spoken
// important idea must have a VISIBLE REFERENT on screen at the moment it is spoken. If the
// teacher says "demand shifts", the chart shows the shift; if "SYN-ACK", the sequence diagram
// highlights SYN-ACK; if "mitochondria", the cell image labels mitochondria.
export const UNIVERSAL_TEACHING_LAW = `Every important SPATIAL, QUANTITATIVE, PROCEDURAL, or EVIDENCE-BASED claim must have a
SYNCHRONIZED visible or inspectable referent (saying "demand shifts" REQUIRES the chart to show the shift; "SYN-ACK"
REQUIRES the sequence diagram to highlight SYN-ACK; a number REQUIRES the table/chart cell it lives in). Warmth,
transitions and motivation sentences do NOT need their own visual. THE CANONICAL SPINE every lesson walks:
SEE IT -> PREDICT IT -> MANIPULATE IT -> EXPLAIN IT -> TRANSFER IT -> RETRIEVE IT LATER — so every lesson includes:
a concrete anchor, a learner PREDICTION or action the student COMMITS to before the reveal, a MANIPULATE beat where
ONE condition is changed and the changed result is shown (not just narrated), at least one non-text visual carrying
the core idea, a named misconception that is CHALLENGED with evidence (not merely stated), a TRANSFER example (same
idea, changed surface), a checkpoint (including one DESCRIPTIVE scenario question the student answers in their own
words), and a recap. Claims the engine can verify (a number, a run, a trace, a retrieval) are EXPLAINED from the
verified result, never invented; when a claim cannot be grounded, mark it honestly as assumption or inference.`;

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

// The per-subject rules a world-class teacher of THIS domain never breaks — the LEARNER ACTIONS,
// REJECT, and NEVER lines only, extracted so the Pedagogy Critic can ENFORCE them. A prompt that
// tells the Teacher "never formula-first" is a hope; a critic that REJECTS formula-first is a
// guarantee — and consistency is exactly what separates a human master from an average teacher.
// This is what turns "we told it to be elite" into "the society enforces elite".
export function domainRejectRules(domain) {
  const register = DOMAIN_TEACHING[domain] ?? DOMAIN_TEACHING.general;
  return register
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(LEARNER ACTIONS|REJECT THIS LESSON WHEN|NEVER:)/.test(line))
    .join('\n');
}

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

// New course domains inherit the nearest researched depth culture until each gets its own.
const DEPTH_ALIAS = Object.freeze({
  architecture: 'systems_swe', networking: 'systems_swe', srs: 'systems_swe', sqa: 'systems_swe',
  os_arch: 'systems_swe', physics: 'science', chemistry: 'science', biology: 'science',
  agents_rag: 'ml_ai', history: 'history_humanities', law: 'history_humanities', economics: 'business_finance',
});

export function depthFor(domain) {
  return DEPTH_MOVES[domain] ?? DEPTH_MOVES[DEPTH_ALIAS[domain]] ?? '';
}

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

import { REGISTER as DSA } from './registers/dsa.js';
import { REGISTER as PROGRAMMING } from './registers/programming.js';
import { REGISTER as ML_AI } from './registers/ml_ai.js';
import { REGISTER as MATH } from './registers/math.js';
import { REGISTER as SCIENCE } from './registers/science.js';
import { REGISTER as SYSTEMS_SWE } from './registers/systems_swe.js';
import { REGISTER as HISTORY_HUMANITIES } from './registers/history_humanities.js';
import { REGISTER as BUSINESS_FINANCE } from './registers/business_finance.js';
import { REGISTER as ARCHITECTURE } from './registers/architecture.js';
import { REGISTER as NETWORKING } from './registers/networking.js';
import { REGISTER as SRS } from './registers/srs.js';
import { REGISTER as SQA } from './registers/sqa.js';
import { REGISTER as OS_ARCH } from './registers/os_arch.js';
import { REGISTER as PHYSICS } from './registers/physics.js';
import { REGISTER as CHEMISTRY } from './registers/chemistry.js';
import { REGISTER as BIOLOGY } from './registers/biology.js';
import { REGISTER as AGENTS_RAG } from './registers/agents_rag.js';
import { REGISTER as HISTORY } from './registers/history.js';
import { REGISTER as LAW } from './registers/law.js';
import { REGISTER as ECONOMICS } from './registers/economics.js';
import { REGISTER as GENERAL } from './registers/general.js';
import { REGISTER as DATA_DB } from './registers/data_db.js';

export const DOMAINS = Object.freeze([
  // the 14 course domains (one specialist teacher agent each — teachers/registry.js)
  'architecture', 'networking', 'srs', 'sqa', 'os_arch', 'math', 'physics', 'chemistry',
  'biology', 'ml_ai', 'agents_rag', 'history', 'law', 'economics', 'data_db',
  // coding (the Coding Instructor + trace engines) and legacy/general buckets
  'dsa', 'programming', 'science', 'systems_swe', 'history_humanities', 'business_finance', 'general',
]);

// Registers live one-per-subject under ./registers/ (user architecture rule: a subject's
// prompt belongs to its subject's file, never a god-file). This map only AGGREGATES them for
// the router, the critic (domainRejectRules) and teachingFor — content owned by the files.
export const DOMAIN_TEACHING = Object.freeze({
  dsa: DSA,
  programming: PROGRAMMING,
  ml_ai: ML_AI,
  math: MATH,
  science: SCIENCE,
  systems_swe: SYSTEMS_SWE,
  history_humanities: HISTORY_HUMANITIES,
  business_finance: BUSINESS_FINANCE,
  architecture: ARCHITECTURE,
  networking: NETWORKING,
  srs: SRS,
  sqa: SQA,
  os_arch: OS_ARCH,
  physics: PHYSICS,
  chemistry: CHEMISTRY,
  biology: BIOLOGY,
  agents_rag: AGENTS_RAG,
  history: HISTORY,
  law: LAW,
  economics: ECONOMICS,
  data_db: DATA_DB,
  general: GENERAL,
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
verified result, never invented; when a claim cannot be grounded, mark it honestly as assumption or inference.
NUMBER HONESTY (gate-enforced, board AND narration): every figure of 2+ digits you write — in a spoken line, a table
cell, a diagram label, an example — must either appear verbatim in the source material or be produced by an executed
computation shown on the board. NEVER invent sample data, prices, counts or "typical" values to decorate an example:
if the example needs numbers the source lacks, derive them by arithmetic FROM source figures and show the derivation.
A drawn diagram cannot vouch for its own numbers; only the source or an executed result can.
TUTOR VOICE — INSPIRE (Lepper & Woolverton, the measured difference between 2-sigma tutors and average ones):
ASK, don't tell. Before EVERY key reveal, pose a question the student must commit to (gate checks that a real
question or prediction prompt appears in the first half of the lesson). Prefer indirect hints over direct answers:
"look at what happens to quantity when price rises" beats "the answer is elastic". After a reveal, one
self-explanation prompt ("say in your own words WHY...") beats three more facts. Tone: encouraging and specific
("your prediction correctly caught the direction — the size is what the data corrects") — never scolding, never
gushing. Socratic does NOT mean vague: the question must be answerable from what is ALREADY on the board.
FIGURE-TEACHING LAW (every domain): a source figure on the board is TEXTBOOK MATERIAL and gets a professor's
treatment — walk it PART BY PART (each named part: what it is, what it does, how it connects to its neighbors),
in the same order the marks reveal, reading the figure's own visible text and structure; tie each part back to
the concept it embodies and to the document's own words about the figure. A figure that is shown but explained
in one sentence is a broken scene. NEVER claim a figure shows something it does not — the description of record
(whatItShows / parts) is the truth about the image; teach THAT image, or teach without an image.`;

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

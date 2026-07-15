// MATH register — this subject's teaching prompt, owned by ITS OWN file (user rule:
// prompts live with their subject, never in a god-file). Consumed by the math teacher agent
// and aggregated into DOMAIN_TEACHING for the router/critic. Content unchanged by the move.

export const REGISTER = `Teach concrete-before-abstract: a numeric example first, then generalize. Render every equation with KaTeX and
show step-by-step derivations — ONE transformation per beat, with a "why this step" note beside each. Prove key claims.
Flag the classic algebra/sign mistakes.
LESSON FLOW: why this concept matters -> concrete number example -> formula introduction -> step-by-step derivation
(one visible transformation at a time) -> graph/visual explanation -> common mistake -> practice question -> recap.
PRIMITIVES: KaTeX, step derivation, graph/chart, table, mistake callout, quiz.
LEARNER ACTIONS (required): the student COMMITS a guess before each reveal and completes one FADED derivation step themselves.
REJECT THIS LESSON WHEN: a formal definition or symbols appear before motivation and visual meaning; a derivation skips a step; the answer is never substituted back.
NEVER: formula-first. A formula may appear only after the learner has something visual it names.`;

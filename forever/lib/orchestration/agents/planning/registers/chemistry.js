// CHEMISTRY register — this subject's teaching prompt, owned by ITS OWN file (user rule:
// prompts live with their subject, never in a god-file). Consumed by the chemistry teacher agent
// and aggregated into DOMAIN_TEACHING for the router/critic. Content unchanged by the move.

export const REGISTER = `Teach image-first (NO molecule engine): the source figure or a clean equation carries the scene.
LESSON FLOW: real reaction or molecule -> source image/diagram with labeled parts -> formula/equation (KaTeX) -> balancing or mechanism ONE step per beat (atom counts shown, verifiable) -> table of quantities (stoichiometry with real grams/moles) -> common mistake (unbalanced/wrong ratio on a real case) -> practice question.
DEPTH: DRY-RUN the mole calculation on concrete numbers; FACT-TWEAK (double the reactant — what changes?).
PRIMITIVES: image with labels, KaTeX, quantity table, diagram, quiz.
LEARNER ACTIONS (required): the student BALANCES a changed reaction; identifies the donor/acceptor themselves.
THREE VIEWS, always connected: what we OBSERVE ↔ what the PARTICLES do ↔ what the SYMBOLS say.
REJECT THIS LESSON WHEN: molecule labels are guessed; the visual conflicts with the formula; balancing is shown without demonstrating atom conservation; jargon is used before it is de-jargoned (DeWitt rule).
NEVER: jargon walls — every term earns its meaning through the story first.`;

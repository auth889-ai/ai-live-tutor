// SRS register — this subject's teaching prompt, owned by ITS OWN file (user rule:
// prompts live with their subject, never in a god-file). Consumed by the srs teacher agent
// and aggregated into DOMAIN_TEACHING for the router/critic. Content unchanged by the move.

export const REGISTER = `Teach like a professional requirements analyst: ONE real product idea carried through EVERY artifact (continuity is the lesson).
LESSON FLOW: real product idea -> stakeholder map -> actor/use-case diagram -> functional requirements -> non-functional requirements -> user stories -> acceptance criteria -> MoSCoW priority table -> risk matrix -> traceability matrix -> quiz.
DEPTH: AMBIGUITY HUNT — show a vague requirement, let the student find the 3 ambiguities, rewrite it testably.
PRIMITIVES: use-case diagram, stakeholder map, MoSCoW/risk/traceability tables, quiz.
LEARNER ACTIONS (required): the student REPAIRS one ambiguous requirement into a testable one — interrogate "the system should be fast": fast for whom? which action? under what load? measured from where? what threshold? → "95% of authenticated dashboard requests complete within 800ms under 1,000 concurrent sessions".
REJECT THIS LESSON WHEN: requirements are invented without stakeholder/source evidence; any requirement is untestable as written.
NEVER: treat an SRS as form-filling — it is elicitation, modeling, validation, traceability.`;

// SQA register — this subject's teaching prompt, owned by ITS OWN file (user rule:
// prompts live with their subject, never in a god-file). Consumed by the sqa teacher agent
// and aggregated into DOMAIN_TEACHING for the router/critic. Content unchanged by the move.

export const REGISTER = `Teach requirement->test derivation LIVE: boundary thinking out loud, every test traced to a requirement.
LESSON FLOW: requirement -> test scenario -> boundary value analysis (the numbers AT and AROUND each edge) -> equivalence partitioning -> decision table -> state transition test -> concrete test cases table -> bug report card -> coverage check -> quiz.
DEPTH: WRONG-STUDENT VOICE proposes testing only happy paths; show the bug that slips through.
PRIMITIVES: decision table, state diagram, test-case table, bug-report callout, quiz.
LEARNER ACTIONS (required): the student PICKS the boundary values for a changed requirement (8-20 chars → tests at 7, 8, 20, 21) and writes one reproducible defect (steps/expected/actual).
REJECT THIS LESSON WHEN: test cases are listed without SHOWING their derivation (partitions → boundaries → decision table → state transitions); a bug report lacks steps/expected/actual.
NEVER: present testing as an afterthought checklist — every test traces to a risk.`;

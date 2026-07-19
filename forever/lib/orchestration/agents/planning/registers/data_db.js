// DATA/DB register — this subject's teaching prompt, owned by ITS OWN file (user rule:
// prompts live with their subject, never in a god-file). Research base (2026-07-20):
// CMU 15-445 (Pavlo) teaches by BUILD-AND-MEASURE on a real DBMS; Kimball teaches
// star-schema trade-offs as MEASURED performance-vs-storage decisions. The beat-human
// lever: Forever EXECUTES the lesson's own queries per student (sql-evidence engine) —
// a lecturer cannot run measured evidence for every student on every claim.

export const REGISTER = `Teach like CMU 15-445 + Kimball: BUILD-AND-MEASURE — every schema claim is PROVED by executing real queries on the lesson's own SQLite world (the sql-evidence engine); trade-offs are MEASURED (join counts, EXPLAIN opcodes, same-answer proofs), never asserted.
LESSON FLOW: real business pain (slow dashboard / write anomaly) -> the schema on the board (drawn tables+keys+FK arrows, never a generated image) -> PREDICT beat (student states expected join count/cost BEFORE the run) -> EXECUTED evidence (result tables + measured joins/opcodes) -> trade-off decision the student must defend (normalize vs denormalize, star vs snowflake) -> misconception refuted BY MEASUREMENT ("denormalization changes answers" -> the same-answer proof; "joins are always slow" -> measure one that is not) -> quiz/practice -> recap.
DEPTH: one schema, three workloads (OLTP write, dashboard read, ad-hoc analyst); Kimball-vs-Inmon framed as a DECISION with measured consequences, never dogma.
PRIMITIVES: schema diagram (tables/keys/FK arrows), computed_evidence table (numbers from sql-evidence ONLY), before/after query comparison, quiz.
LEARNER ACTIONS (required): predict a join count or cost before the measured reveal; defend one denormalization decision citing a MEASURED number.
REJECT THIS LESSON WHEN: any performance or count claim lacks executed evidence; a schema appears as a generated image instead of a drawn diagram; a denormalization scene lacks the same-answer proof; there is no predict-before-reveal beat.
NEVER: numbers the engine did not produce.`;

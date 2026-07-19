// AGENTS_RAG register — this subject's teaching prompt, owned by ITS OWN file (user rule:
// prompts live with their subject, never in a god-file). Consumed by the agents_rag teacher agent
// and aggregated into DOMAIN_TEACHING for the router/critic. Content unchanged by the move.

export const REGISTER = `Teach the system that is teaching them (meta-demo): documents -> chunks -> retrieval -> grounded answer -> evaluation.
LESSON FLOW: why plain LLMs hallucinate (a concrete wrong answer) -> RAG pipeline diagram -> chunk viewer (REAL chunks of this very material) -> embedding/retrieval intuition -> retriever comparison table -> agent/tool-call trace timeline -> evaluation table -> quiz.
DEPTH: THREE-CANDIDATES on retrieval strategies; show a real failure (irrelevant chunk retrieved) and the fix.
PRIMITIVES: pipeline diagram, chunk table, sequence/timeline diagram, comparison table, quiz.
LEARNER ACTIONS (required): the student INSPECTS the retrieved chunks and identifies which one answered; changes one component (chunk size, k, retriever) and compares results.
REJECT THIS LESSON WHEN: a pipeline diagram is shown but the learner cannot inspect real chunks, retrieval scores, citations, and evaluation results.
NEVER: teach RAG without the learner seeing real retrieval on real documents.
BEAT-THE-BEST BENCHMARK: LangChain/LangGraph/LangSmith docs-as-pedagogy (traces as first-class teaching). DOMAIN LEVER: show LIVE tool-call traces of the very agent society teaching the student — the course explains its own machinery.
SURPASS THE BENCHMARK (AI-only levers, gate-enforced): per-student EXECUTED/measured evidence for every claim; a visible referent for every spoken sentence; misconceptions refuted by measurement, not assertion; infinite leveled variations from the student's OWN material; SM-2 spaced retention per student — none of which any human can run for every student on every claim.`;

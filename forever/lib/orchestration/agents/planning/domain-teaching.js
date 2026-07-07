// Domain teaching registry — HOW a world-class teacher in each domain teaches (conventions
// + preferred tools), NOT content. Injected into the Teacher so it becomes a SPECIALIST per
// subject (Striver for DSA, Andrew Ng for ML, Abdul Bari for algorithms) instead of a
// generic teacher. This is what makes universal teaching ELITE per domain.

export const DOMAINS = Object.freeze([
  'dsa', 'programming', 'ml_ai', 'math', 'science', 'systems_swe', 'history_humanities', 'business_finance', 'general',
]);

export const DOMAIN_TEACHING = Object.freeze({
  dsa: `Teach like Striver: for every problem show BRUTE-FORCE first, then BETTER, then OPTIMAL, each with its
time/space complexity. Always DRY-RUN on a concrete input with a step-by-step trace table (variables i,j,low,mid,high).
Use the "graph" visualizer for trees/BST/linked-lists/graphs and highlightSequence for traversals. Name the pattern
(two-pointer, sliding window, DP, greedy) and the common off-by-one/edge-case mistakes.`,
  programming: `Teach with runnable code: a concrete worked example that ACTUALLY executes with real output, line-by-line,
then the common bugs and best practices. Show the output and a dry-run. Keep examples small and real.`,
  ml_ai: `Teach like Andrew Ng: INTUITION first (a concrete real-world example), THEN the math (KaTeX equations,
step-by-step), THEN the code. Use a pipeline diagram (data -> model -> eval), loss curves, a confusion matrix table,
and a dataset preview. Always connect the why to the how; name the common pitfalls (overfitting, leakage).`,
  math: `Teach concrete-before-abstract: a numeric example first, then generalize. Render every equation with KaTeX and
show step-by-step derivations (each algebra step with a note). Prove key claims. Flag the classic algebra/sign mistakes.`,
  science: `Teach with visuals: cycle/process diagrams (photosynthesis, Krebs), cause-effect, and REAL figures/images when
available (teach FROM the diagram). Anchor to a real-world phenomenon, then the mechanism, then a misconception.`,
  systems_swe: `Teach with the right diagram: architecture/C4 for systems, sequenceDiagram for request flows, stateDiagram
for lifecycles, erDiagram for data. Always cover the TRADEOFFS (a comparison table) and a failure scenario.`,
  history_humanities: `Teach with a timeline of events, a cause-effect map for WHY it happened, an actor/stakeholder map,
and primary-source evidence. Compare periods with a table. Present more than one interpretation.`,
  business_finance: `Teach with the model: supply-demand or xychart graphs, decision trees, a financial table, and a
step-by-step formula (KaTeX: CAPM/NPV/WACC) on a concrete scenario. End with a short case study.`,
  general: `Teach concrete-before-abstract with a vivid analogy, build bottom-up one idea at a time, use a diagram when a
visual helps, and always flag the common misconception. End with a recap and a practice question.`,
});

export function teachingFor(domain) {
  return DOMAIN_TEACHING[domain] ?? DOMAIN_TEACHING.general;
}

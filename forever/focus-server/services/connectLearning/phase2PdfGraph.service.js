// server/services/connectLearning/phase2PdfGraph.service.js

import { runPdfTreeGraph } from "../pdfTree.graph.js";

export async function runPhase2PdfConceptGraph(input = {}) {
  const result = await runPdfTreeGraph(input);

  return {
    phase: 2,
    userId: result.userId,
    deviceId: result.deviceId,
    studyGoal: result.studyGoal,
    pdf: result.pdf,
    understanding: result.understanding,
    graph: result.graph,
    message: "Phase 2 complete: cloud Gemma created roadmap tree.",
  };
}
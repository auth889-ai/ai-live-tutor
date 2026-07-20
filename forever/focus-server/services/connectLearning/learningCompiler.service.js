// server/services/connectLearning/learningCompiler.service.js

import {
  understandDocument,
  logDocumentUnderstanding,
} from "./documentUnderstanding.agent.js";

import {
  buildConceptGraph,
  logConceptGraph,
} from "./conceptGraph.agent.js";

function clean(value = "") {
  return String(value || "").trim();
}

function safeList(value) {
  return Array.isArray(value) ? value : [];
}

function makeMinimalPhase1Plan({ understanding, fileName = "", fullText = "" }) {
  const rootTitle =
    clean(understanding.detectedSubject) ||
    clean(fileName.replace(/\.pdf$/i, "")) ||
    "Document Understanding";

  const keyPoints = [
    understanding.learningGoal,
    understanding.summary,
    ...safeList(understanding.majorConcepts).slice(0, 8),
  ].filter(Boolean);

  return {
    treeTitle: rootTitle,
    treeDescription: understanding.summary,
    centralConcept: rootTitle,
    domain: understanding.detectedSubject,
    rootTitle,
    studyPath: [
      {
        order: 1,
        nodeTitle: rootTitle,
        action: "Review Phase 1 document understanding before building the concept graph.",
      },
    ],
    nodes: [
      {
        title: rootTitle,
        type: "document_understanding",
        summary: understanding.summary,
        parentTitle: null,
        relation: "root",
        whyItMatters: understanding.learningGoal,
        pdfEvidence: fullText.slice(0, 1200),
        studentShouldKnow: safeList(understanding.majorConcepts),
        studentShouldDo: safeList(understanding.assessmentTasks),
        checklist: [
          "Confirm detected subject is correct.",
          "Confirm learning goal is accurate.",
          "Confirm major concepts are real PDF concepts.",
          "Only then continue to Phase 2 concept graph.",
        ],
        mistakesToAvoid: [
          "Do not build graph if subject is generic or wrong.",
          "Do not use fixed domain categories.",
        ],
        keyPoints,
        concepts: safeList(understanding.majorConcepts),
        tags: [
          "phase-1",
          "document-understanding",
          understanding.documentType,
          understanding.studentLevel,
        ].filter(Boolean),
        confidence: understanding.confidence,
        attachPdfHere: true,
        excerpt: fullText.slice(0, 2000),
        generatedResources: {
          note: {
            title: `${rootTitle} — Phase 1 Understanding`,
            summary: understanding.summary,
            content: [
              `# ${rootTitle}`,
              "",
              "## Document Type",
              understanding.documentType,
              "",
              "## Student Level",
              understanding.studentLevel,
              "",
              "## Learning Goal",
              understanding.learningGoal,
              "",
              "## Summary",
              understanding.summary,
              "",
              "## Main Skills",
              ...safeList(understanding.mainSkills).map((x) => `- ${x}`),
              "",
              "## Major Concepts",
              ...safeList(understanding.majorConcepts).map((x) => `- ${x}`),
              "",
              "## Assessment / Tasks",
              ...safeList(understanding.assessmentTasks).map((x) => `- ${x}`),
              "",
              "## Practical Outputs",
              ...safeList(understanding.practicalOutputs).map((x) => `- ${x}`),
            ].join("\n"),
          },
          key_points: {
            title: `${rootTitle} — Key Understanding Points`,
            points: keyPoints,
          },
          lecture: {
            title: `${rootTitle} — Teacher Overview`,
            summary: understanding.learningGoal,
            content: [
              `This document is about ${rootTitle}.`,
              "",
              `The learning goal is: ${understanding.learningGoal}`,
              "",
              "The main things a student should focus on are:",
              ...safeList(understanding.majorConcepts).map((x, i) => `${i + 1}. ${x}`),
            ].join("\n"),
          },
          chart: {
            title: `${rootTitle} — Understanding Table`,
            summary: "Phase 1 extracted understanding.",
            rows: [
              { label: "Subject", value: understanding.detectedSubject },
              { label: "Document Type", value: understanding.documentType },
              { label: "Student Level", value: understanding.studentLevel },
              { label: "Learning Goal", value: understanding.learningGoal },
            ],
          },
          relatedQueries: [],
          videoQueries: [],
          quiz: [],
        },
      },
    ],
    edges: [],
    pdfAttachNodeTitle: rootTitle,
    globalKeyPoints: keyPoints,
    phase: 1,
    understanding,
  };
}

function incomingEdgeForNode(graph = {}, node = {}) {
  const title = clean(node.title).toLowerCase();

  return safeList(graph.edges).find(
    (edge) => clean(edge.to).toLowerCase() === title
  );
}

function buildBookStubForNode(node = {}, edge = null) {
  return [
    `# ${node.title}`,
    "",
    "## Simple explanation",
    node.summary,
    "",
    "## Why this matters",
    node.whyItMatters,
    "",
    "## PDF evidence",
    node.pdfEvidence,
    "",
    "## Graph connection",
    edge
      ? `${edge.from} --${edge.relation}--> ${edge.to}. ${edge.reason || ""}`
      : "This is the central concept of the graph.",
    "",
    "## What student should do",
    `- Understand what "${node.title}" means.`,
    `- Read the PDF evidence for "${node.title}".`,
    "- Explain its relationship with connected nodes.",
    "",
    "## Common mistakes",
    "- Do not memorize only the node title.",
    "- Do not ignore the edge relationship.",
    "- Do not treat all concepts as simple parent-child items.",
    "",
    "## Checklist",
    `- I can define "${node.title}".`,
    "- I can point to PDF evidence.",
    "- I can explain why this node connects to another node.",
    "",
    "## Mini quiz",
    `1. What does "${node.title}" mean in this PDF?`,
    "2. Which concept does it support, verify, produce, or depend on?",
  ].join("\n");
}

function makePhase2Plan({ understanding, graph, fileName = "", fullText = "" }) {
  const rootTitle =
    clean(graph.rootTitle) ||
    clean(understanding.detectedSubject) ||
    clean(fileName.replace(/\.pdf$/i, "")) ||
    "Concept Graph";

  if (!graph.quality?.passed) {
    throw new Error("Phase 2 graph quality failed before plan creation.");
  }

  const sortedNodes = safeList(graph.nodes).sort(
    (a, b) => Number(a.order || 0) - Number(b.order || 0)
  );

  const nodes = sortedNodes.map((node, index) => {
    const edge = incomingEdgeForNode(graph, node);

    return {
      title: node.title,
      type: node.type,
      summary: node.summary,
      parentTitle: node.parentTitle,
      relation: index === 0 ? "root" : edge?.relation || "contains",
      edgeFrom: edge?.from || null,
      edgeTo: edge?.to || node.title,
      edgeReason: edge?.reason || "",
      whyItMatters: node.whyItMatters,
      pdfEvidence: node.pdfEvidence,
      studentShouldKnow: node.concepts || [],
      studentShouldDo: [
        `Explain "${node.title}" using PDF evidence.`,
        edge
          ? `Explain why "${edge.from}" ${edge.relation} "${edge.to}".`
          : "Explain the central subject of the PDF.",
      ],
      checklist: [
        `Understand what "${node.title}" means.`,
        `Read the PDF evidence for "${node.title}".`,
        edge
          ? `Explain the relation: ${edge.from} --${edge.relation}--> ${edge.to}.`
          : "Explain why this is the central concept.",
      ],
      mistakesToAvoid: [
        "Do not memorize only the title.",
        "Do not ignore edge relation labels.",
        "Do not flatten this into a simple tree.",
      ],
      keyPoints: [node.summary, node.whyItMatters, edge?.reason].filter(Boolean),
      concepts: node.concepts || [node.title],
      tags: ["phase-2", "concept-graph", node.type, edge?.relation].filter(Boolean),
      confidence: node.confidence,
      attachPdfHere: index === 0,
      excerpt: node.pdfEvidence || fullText.slice(0, 1200),
      generatedResources: {
        note: {
          title: `${node.title} — Concept Notes`,
          summary: node.summary,
          content: buildBookStubForNode(node, edge),
        },
        key_points: {
          title: `${node.title} — Graph Key Points`,
          points: [node.summary, node.whyItMatters, edge?.reason].filter(Boolean),
        },
        lecture: {
          title: `${node.title} — Teacher Explanation`,
          summary: node.summary,
          content: [
            `This concept is: ${node.title}`,
            "",
            node.summary,
            "",
            `Why it matters: ${node.whyItMatters}`,
            "",
            edge
              ? `Graph relation: ${edge.from} --${edge.relation}--> ${edge.to}.`
              : "This is the central concept of the PDF.",
            "",
            edge?.reason || "",
          ].join("\n"),
        },
        chart: {
          title: `${node.title} — Graph Relation`,
          summary: `Concept node type: ${node.type}`,
          rows: [
            { label: "Node", value: node.title },
            { label: "Type", value: node.type },
            { label: "Relation", value: index === 0 ? "root" : edge?.relation || "contains" },
            { label: "From", value: edge?.from || "Root" },
            { label: "To", value: edge?.to || node.title },
          ],
        },
        relatedQueries: [],
        videoQueries: [],
        quiz: [
          {
            question: `What does "${node.title}" mean in this PDF?`,
            answer: node.summary,
          },
          {
            question: edge
              ? `Why does "${edge.from}" ${edge.relation} "${edge.to}"?`
              : `Why is "${node.title}" the central concept?`,
            answer: edge?.reason || node.whyItMatters,
          },
        ],
      },
    };
  });

  return {
    treeTitle: graph.graphTitle || rootTitle,
    treeDescription: `Phase 2 concept graph generated for ${rootTitle}.`,
    centralConcept: rootTitle,
    domain: understanding.detectedSubject,
    rootTitle,
    studyPath: nodes.map((node, index) => ({
      order: index + 1,
      nodeTitle: node.title,
      action:
        index === 0
          ? "Start with the central concept."
          : `Study relation: ${node.edgeFrom || node.parentTitle || rootTitle} --${node.relation}--> ${node.title}.`,
    })),
    nodes,
    edges: safeList(graph.edges),
    pdfAttachNodeTitle: rootTitle,
    globalKeyPoints: safeList(understanding.majorConcepts),
    phase: 2,
    understanding,
    conceptGraph: graph,
    quality: graph.quality,
  };
}

export async function compilePhase1Understanding({
  text = "",
  fileName = "",
  studyGoal = "",
}) {
  const understanding = await understandDocument({
    text,
    fileName,
    studyGoal,
  });

  logDocumentUnderstanding(understanding);

  const plan = makeMinimalPhase1Plan({
    understanding,
    fileName,
    fullText: text,
  });

  return {
    understanding,
    plan,
  };
}

export async function compilePhase2ConceptGraph({
  text = "",
  fileName = "",
  studyGoal = "",
}) {
  const understanding = await understandDocument({
    text,
    fileName,
    studyGoal,
  });

  logDocumentUnderstanding(understanding);

  const graph = await buildConceptGraph({
    understanding,
    text,
    fileName,
    studyGoal,
  });

  logConceptGraph(graph);

  if (!graph.quality?.passed) {
    throw new Error("Phase 2 quality failed. Graph will not be saved.");
  }

  const plan = makePhase2Plan({
    understanding,
    graph,
    fileName,
    fullText: text,
  });

  return {
    understanding,
    graph,
    plan,
  };
}
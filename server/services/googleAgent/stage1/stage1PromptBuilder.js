"use strict";

const { compactPagesForPrompt } = require("./stage1ContextBuilder");

function buildSummaryPrompt(pagePackets) {
  return `Analyze this PDF document carefully. Read every page.

${compactPagesForPrompt(pagePackets, 180000)}

Return ONLY a JSON object (no markdown):
{
  "title": "exact document title",
  "subject": "subject area (e.g. Database Design, Physics, Law)",
  "difficulty": "beginner|intermediate|advanced",
  "mainTopics": ["topic1", "topic2"],
  "keyTerms": ["term1", "term2"],
  "teachingGoal": "what a student will learn from this PDF",
  "totalPagesCovered": number
}`;
}

function buildOutlinePrompt(summary, pagePackets) {
  return `PDF Summary: ${JSON.stringify(summary)}

Read the full page content and build a chapter-by-chapter outline.
Every chapter must reference REAL page numbers from the document.

${compactPagesForPrompt(pagePackets, 160000)}

Return ONLY JSON:
{
  "chapters": [
    {
      "title": "chapter title from PDF",
      "pages": [1, 2, 3],
      "concepts": ["key concept names"],
      "processes": ["step-by-step processes"],
      "examples": ["concrete examples"],
      "warnings": ["risks or mistakes mentioned"]
    }
  ],
  "roadmapModules": ["Module 1: Core Concepts", "Module 2: Advanced Topics"]
}`;
}

function buildTreePrompt(summary, outline, anchors, pagePackets) {
  const anchorList = anchors.slice(0, 50)
    .map((a) => `[p.${a.page}] "${a.title}" — "${a.quote.slice(0, 120)}"`)
    .join("\n");

  return `Build a teaching roadmap tree for a student learning from this PDF.

DOCUMENT: ${JSON.stringify(summary)}
OUTLINE: ${JSON.stringify(outline)}
CONCEPTS FOUND IN PDF TEXT:
${anchorList}

STRICT RULES — follow every one:
1. Use ONLY content from this PDF. Do not invent topics.
2. Every node MUST have pageRefs (real page numbers) and sourceRefs with exact quotes.
3. nodeType: root | module | concept | definition | process | step | example | comparison | schema | warning | quiz
4. If a concept has steps, aspects, or sub-items in the PDF → create child nodes for each.
5. Levels: root=0, module=1, concept=2, sub-concept=3, leaf=4 (max).
6. 20–80 nodes total. No duplicate titles.
7. shortDefinition = 1–2 sentences using the PDF's own words.

Return ONLY JSON:
{
  "nodes": [{
    "nodeId": "snake_case_unique_id",
    "title": "Node Title From PDF",
    "nodeType": "concept",
    "level": 2,
    "parentNodeId": "parent_id_or_null",
    "pageRefs": [3, 4],
    "sourceRefs": [{"chunkId": "page_chunk_ref", "page": 3, "quote": "exact text from PDF page 3"}],
    "evidenceQuotes": ["quote1", "quote2"],
    "shortDefinition": "1-2 sentence definition from PDF.",
    "hasCodeExample": false,
    "hasDiagram": false,
    "complexity": "easy|medium|hard"
  }],
  "edges": [{"from": "parent_id", "to": "child_id", "type": "parent-child"}]
}`;
}

module.exports = { buildSummaryPrompt, buildOutlinePrompt, buildTreePrompt };

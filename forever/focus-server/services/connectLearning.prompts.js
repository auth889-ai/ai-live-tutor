export function strictJsonInstruction() {
  return "Return ONLY valid JSON. Do not use markdown. Do not add comments. Do not add extra text.";
}

export function resourceExtractionPrompt({ studyGoal = "", treeTitle = "", nodeTitle = "", context = "" }) {
  return `${strictJsonInstruction()}
You are Connect Your Learning, an AI engine that extracts real learning-resource metadata and decides the best tree/node location.
No fake demo topics. Use only the provided content and current user goal.

Expected JSON:
{
  "resourceType": "lecture|note|video|chart|key_points|related_link|pdf|webpage|manual",
  "title": "",
  "creator": "",
  "duration": "",
  "summary": "",
  "keyPoints": [],
  "concepts": [],
  "tags": [],
  "suggestedTreeTitle": "",
  "suggestedNodeTitle": "",
  "shouldCreateNewTree": false,
  "shouldCreateNewNode": false,
  "confidence": 0.0,
  "reason": ""
}

Current study goal: ${studyGoal}
Selected tree: ${treeTitle}
Selected node: ${nodeTitle}

Resource context:
${context}`;
}

export function treePlanningPrompt({ studyGoal = "", title = "", text = "" }) {
  return `${strictJsonInstruction()}
You are an AI learning-tree planner. Convert the real content into a knowledge tree.
Do not use DSA/Graphs/Arrays unless the content actually contains those topics.
Create useful nodes, prerequisites, child topics, related topics, and suggested links.

Expected JSON:
{
  "treeTitle": "",
  "treeDescription": "",
  "nodes": [
    {
      "title": "",
      "summary": "",
      "status": "not_started",
      "parentTitle": null,
      "relation": "child|prerequisite|related|suggested_link",
      "confidence": 0.0
    }
  ],
  "edges": [
    {
      "from": "",
      "to": "",
      "relation": "child|prerequisite|related|suggested_link|ai_inferred"
    }
  ]
}

Study goal: ${studyGoal}
Document/resource title: ${title}
Content:
${text}`;
}

export function nodeConnectionPrompt({ studyGoal = "", existingNodes = [], resource = {} }) {
  return `${strictJsonInstruction()}
You are a node connection engine. Pick the best existing node for the resource or decide to create a new one.

Expected JSON:
{
  "bestExistingNodeTitle": "",
  "shouldCreateNewNode": false,
  "newNodeTitle": "",
  "relation": "child|prerequisite|related|suggested_link|ai_inferred",
  "confidence": 0.0,
  "reason": ""
}

Study goal: ${studyGoal}
Existing nodes:
${JSON.stringify(existingNodes).slice(0, 8000)}

Resource:
${JSON.stringify(resource).slice(0, 8000)}`;
}

export function pdfToTreePrompt({ studyGoal = "", fileName = "", chunks = [] }) {
  return treePlanningPrompt({
    studyGoal,
    title: fileName,
    text: chunks.map((c) => `Page/Chunk ${c.index}:\n${c.text}`).join("\n\n").slice(0, 24000),
  });
}

export function voiceAgentCommandPrompt({ goal = "", transcript = "", currentPageContext = {}, selectedTree = null, selectedNode = null, memories = [] }) {
  return `${strictJsonInstruction()}
You are a LangGraph-style study agent for Connect Your Learning.
Decide the user's intended action and the tool arguments.

Allowed actions:
create_tree, create_node, save_resource, connect_resource, generate_note, extract_keypoints, email_saved_location, ask_clarifying_question

Expected JSON:
{
  "action": "",
  "treeTitle": "",
  "nodeTitle": "",
  "resourceTitle": "",
  "resourceType": "manual|note|webpage|pdf|video|lecture|key_points|link|voice",
  "content": "",
  "shouldEmail": false,
  "emailTo": "",
  "needsClarification": false,
  "clarifyingQuestion": "",
  "finalAnswer": ""
}

Current goal: ${goal}
User command/transcript: ${transcript}
Selected tree: ${JSON.stringify(selectedTree || {}).slice(0, 2000)}
Selected node: ${JSON.stringify(selectedNode || {}).slice(0, 2000)}
Current page context: ${JSON.stringify(currentPageContext || {}).slice(0, 8000)}
Relevant memories: ${JSON.stringify(memories || []).slice(0, 6000)}`;
}

export function recommendationPrompt({ goal = "", tree = null, nodes = [], resources = [] }) {
  return `${strictJsonInstruction()}
You are an AI learning coach. Recommend real next actions only from the provided saved learning data.

Expected JSON:
{
  "recommendations": [
    {
      "title": "",
      "type": "next_topic|resource_review|missing_prerequisite|weak_area|continue_learning",
      "reason": "",
      "treeId": "",
      "nodeId": "",
      "resourceId": "",
      "priority": "low|medium|high",
      "confidence": 0.0
    }
  ]
}

Goal: ${goal}
Tree: ${JSON.stringify(tree || {}).slice(0, 2000)}
Nodes: ${JSON.stringify(nodes || []).slice(0, 8000)}
Resources: ${JSON.stringify(resources || []).slice(0, 8000)}`;
}

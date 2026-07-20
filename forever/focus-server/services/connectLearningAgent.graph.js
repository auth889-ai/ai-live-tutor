import LearningTree from "../models/LearningTree.js";
import LearningNode from "../models/LearningNode.js";
import LearningResource from "../models/LearningResource.js";
import { callOllamaJson } from "./ollamaCompat.service.js";
import { voiceAgentCommandPrompt } from "./connectLearning.prompts.js";
import { findSimilarNodes, findSimilarResources } from "./learningRag.service.js";
import { createTreeManual, createNodeManual, saveResource, saveWebpage, getFullTree } from "./connectLearning.service.js";
import { sendSavedLocationEmail } from "./email.service.js";
import { emitStudyEvent } from "../config/realtime.js";

function clean(v = "") { return String(v || "").trim(); }
function socket(target, eventName, payload = {}) { try { emitStudyEvent(target, eventName, payload); } catch {} }

export async function runConnectLearningAgent(input = {}) {
  const state = {
    userId: clean(input.userId),
    userEmail: clean(input.userEmail || input.email),
    deviceId: clean(input.deviceId),
    goal: clean(input.goal || input.studyGoal),
    transcript: clean(input.transcript || input.command),
    currentPageContext: input.currentPageContext || {},
    selectedTreeId: clean(input.selectedTreeId || input.treeId),
    selectedNodeId: clean(input.selectedNodeId || input.nodeId),
    retrievedMemories: [],
    plannedAction: null,
    toolResults: [],
    finalAnswer: "",
    needsClarification: false,
  };

  if (!state.deviceId) throw new Error("deviceId is required");
  if (!state.transcript) throw new Error("transcript is required");

  const [selectedTree, selectedNode] = await Promise.all([
    state.selectedTreeId ? LearningTree.findOne({ _id: state.selectedTreeId, deviceId: state.deviceId }).lean().catch(() => null) : null,
    state.selectedNodeId ? LearningNode.findOne({ _id: state.selectedNodeId, deviceId: state.deviceId }).lean().catch(() => null) : null,
  ]);

  const memoryText = [state.goal, state.transcript, state.currentPageContext?.title, state.currentPageContext?.visibleText].filter(Boolean).join("\n");
  const [similarNodes, similarResources] = await Promise.all([
    findSimilarNodes({ deviceId: state.deviceId, userId: state.userId, treeId: state.selectedTreeId, text: memoryText, limit: 5 }).catch(() => []),
    findSimilarResources({ deviceId: state.deviceId, userId: state.userId, treeId: state.selectedTreeId, text: memoryText, url: state.currentPageContext?.url, limit: 5 }).catch(() => []),
  ]);
  state.retrievedMemories = { nodes: similarNodes, resources: similarResources };

  const fallback = {
    action: "save_resource",
    treeTitle: selectedTree?.title || state.goal || "Learning Tree",
    nodeTitle: selectedNode?.title || state.transcript.slice(0, 80),
    resourceTitle: state.currentPageContext?.title || state.transcript.slice(0, 80),
    resourceType: state.currentPageContext?.url ? "webpage" : "voice",
    content: state.currentPageContext?.visibleText || state.transcript,
    shouldEmail: /email|mail/i.test(state.transcript),
    emailTo: state.userEmail || state.userId,
    needsClarification: false,
    clarifyingQuestion: "",
    finalAnswer: "I saved this in your learning tree.",
  };

  state.plannedAction = await callOllamaJson(voiceAgentCommandPrompt({
    goal: state.goal,
    transcript: state.transcript,
    currentPageContext: state.currentPageContext,
    selectedTree,
    selectedNode,
    memories: state.retrievedMemories,
  }), fallback);

  const action = clean(state.plannedAction.action || fallback.action);
  let result = null;

  if (state.plannedAction.needsClarification || action === "ask_clarifying_question") {
    state.needsClarification = true;
    state.finalAnswer = clean(state.plannedAction.clarifyingQuestion || "Where should I save this learning resource?");
  } else if (action === "create_tree") {
    result = await createTreeManual({ userId: state.userId, deviceId: state.deviceId, title: state.plannedAction.treeTitle || state.goal || "Learning Tree", description: state.plannedAction.content || "", studyGoal: state.goal });
    state.toolResults.push({ action, result });
    state.finalAnswer = state.plannedAction.finalAnswer || `Created tree: ${result.tree?.title || state.plannedAction.treeTitle}`;
  } else if (action === "create_node") {
    let treeId = state.selectedTreeId;
    if (!treeId) {
      const created = await createTreeManual({ userId: state.userId, deviceId: state.deviceId, title: state.plannedAction.treeTitle || state.goal || "Learning Tree", studyGoal: state.goal });
      treeId = created.tree?._id;
    }
    result = await createNodeManual({ userId: state.userId, deviceId: state.deviceId, treeId, title: state.plannedAction.nodeTitle || state.transcript.slice(0, 80), summary: state.plannedAction.content || "" });
    state.toolResults.push({ action, result });
    state.finalAnswer = state.plannedAction.finalAnswer || `Created topic: ${result.node?.title}`;
  } else if (action === "email_saved_location") {
    const latest = await LearningResource.findOne({ deviceId: state.deviceId, ...(state.userId ? { userId: state.userId } : {}) }).sort({ createdAt: -1 }).lean();
    const tree = latest ? await LearningTree.findById(latest.treeId).lean() : selectedTree;
    const node = latest ? await LearningNode.findById(latest.nodeId).lean() : selectedNode;
    const emailResult = await sendSavedLocationEmail({ to: state.plannedAction.emailTo || state.userEmail || state.userId, treeTitle: tree?.title, nodeTitle: node?.title, resourceTitle: latest?.title, savedPath: latest?.savedPath, url: latest?.url, summary: latest?.summary });
    result = { emailResult, tree, node, resource: latest };
    state.toolResults.push({ action, result });
    state.finalAnswer = emailResult.sent ? "I emailed you where I saved it." : `Saved location email was not sent: ${emailResult.reason}`;
  } else {
    const page = state.currentPageContext || {};
    const payload = {
      userId: state.userId,
      userEmail: state.userEmail,
      deviceId: state.deviceId,
      treeId: state.selectedTreeId,
      nodeId: state.selectedNodeId,
      studyGoal: state.goal,
      sourceType: state.plannedAction.resourceType || (page.url ? "webpage" : "voice"),
      title: state.plannedAction.resourceTitle || page.title || state.transcript.slice(0, 100),
      url: page.url,
      domain: page.domain,
      duration: page.duration,
      watchedTime: page.currentTime,
      extractedText: state.plannedAction.content || page.visibleText || state.transcript,
      currentPageContext: page,
      shouldEmail: Boolean(state.plannedAction.shouldEmail || /email|mail/i.test(state.transcript)),
      emailTo: state.plannedAction.emailTo || state.userEmail || state.userId,
    };
    result = page.url ? await saveWebpage(payload) : await saveResource(payload);
    state.toolResults.push({ action, result });
    state.finalAnswer = state.plannedAction.finalAnswer || `Saved in ${result.resource?.savedPath || result.tree?.title || "your learning tree"}.`;
  }

  let fullTree = null;
  const treeId = result?.tree?._id || result?.result?.tree?._id || state.selectedTreeId;
  if (treeId) fullTree = await getFullTree(treeId, { deviceId: state.deviceId, userId: state.userId }).catch(() => null);

  const response = { ...state, result, tree: fullTree?.tree || result?.tree || null, fullTree };
  socket({ deviceId: state.deviceId, userId: state.userId }, "connect-learning:agent-response", response);
  return response;
}

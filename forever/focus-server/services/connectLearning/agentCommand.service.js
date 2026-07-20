import LearningTree from "../../models/LearningTree.js";
import LearningNode from "../../models/LearningNode.js";
import LearningResource from "../../models/LearningResource.js";
import { callOllamaJson } from "../ollamaCompat.service.js";

function clean(value = "") {
  return String(value || "").trim();
}

function lower(value = "") {
  return clean(value).toLowerCase();
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function isObjectId(value = "") {
  return /^[0-9a-fA-F]{24}$/.test(String(value || ""));
}

function norm(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9+# ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceTypeFromText(command = "") {
  const text = lower(command);

  if (text.includes("video") || text.includes("youtube") || text.includes("play")) return "video";
  if (text.includes("note") || text.includes("notes") || text.includes("book")) return "note";
  if (text.includes("lecture")) return "lecture";
  if (text.includes("pdf") || text.includes("evidence")) return "pdf";
  if (text.includes("key point") || text.includes("keypoint")) return "key_points";
  if (text.includes("chart")) return "chart";
  if (text.includes("diagram") || text.includes("workflow")) return "diagram";
  if (text.includes("web") || text.includes("link") || text.includes("page")) return "webpage";
  if (text.includes("manual")) return "manual";
  if (text.includes("voice")) return "voice";
  if (text.includes("image") || text.includes("picture")) return "image";
  if (text.includes("screenshot")) return "screenshot";
  if (text.includes("table")) return "table";
  if (text.includes("code")) return "code";
  if (text.includes("audio")) return "audio";
  if (text.includes("flashcard")) return "flashcard";

  return "";
}

function removeCommandWords(command = "") {
  return lower(command)
    .replace(
      /\b(open|show|play|read|go to|please|resource|resources|the|this|for|node|concept)\b/g,
      " "
    )
    .replace(
      /\b(video|youtube|note|notes|book|lecture|pdf|evidence|key|points|chart|diagram|web|link|page|manual|voice|image|screenshot|table|code|audio)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function scoreText(text = "", terms = []) {
  const hay = norm(text);
  let score = 0;

  for (const term of terms) {
    if (!term) continue;
    if (hay.includes(term)) score += 1;
  }

  return score;
}

async function findCurrentTree({ treeId, selectedTreeId, deviceId, userId }) {
  const id = treeId || selectedTreeId;

  if (isObjectId(id)) {
    return LearningTree.findById(id).lean();
  }

  const query = { deviceId: clean(deviceId) };
  if (clean(userId)) query.userId = clean(userId);

  return LearningTree.findOne(query).sort({ updatedAt: -1 }).lean();
}

async function findCurrentNode({ nodeId, selectedNodeId, treeId, deviceId, userId }) {
  const id = nodeId || selectedNodeId;

  if (isObjectId(id)) {
    return LearningNode.findById(id).lean();
  }

  const tree = await findCurrentTree({ treeId, deviceId, userId });
  if (!tree) return null;

  return LearningNode.findOne({ treeId: tree._id }).sort({ order: 1, createdAt: 1 }).lean();
}

async function findResourceForCommand({ command, treeId, nodeId, deviceId, userId }) {
  const wantedType = sourceTypeFromText(command);
  const keywordText = removeCommandWords(command);
  const terms = keywordText.split(/\s+/).filter((w) => w.length > 2);

  const baseQuery = {};
  if (isObjectId(nodeId)) baseQuery.nodeId = nodeId;
  else if (isObjectId(treeId)) baseQuery.treeId = treeId;
  else baseQuery.deviceId = clean(deviceId);

  if (clean(userId)) baseQuery.userId = clean(userId);
  if (wantedType) baseQuery.sourceType = wantedType;

  let resources = await LearningResource.find(baseQuery)
    .sort({ qualityScore: -1, confidence: -1, updatedAt: -1 })
    .limit(60)
    .lean();

  if (!resources.length && wantedType) {
    const fallbackQuery = {
      deviceId: clean(deviceId),
      sourceType: wantedType,
    };

    if (clean(userId)) fallbackQuery.userId = clean(userId);
    if (isObjectId(treeId)) fallbackQuery.treeId = treeId;

    resources = await LearningResource.find(fallbackQuery)
      .sort({ qualityScore: -1, confidence: -1, updatedAt: -1 })
      .limit(60)
      .lean();
  }

  if (!resources.length) return null;
  if (!terms.length) return resources[0];

  const ranked = resources
    .map((resource) => {
      const text = [
        resource.title,
        resource.summary,
        resource.extractedText,
        resource.sourceType,
        ...list(resource.tags),
        ...list(resource.concepts),
        ...list(resource.keyPoints),
      ].join(" ");

      return {
        resource,
        score: scoreText(text, terms),
      };
    })
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.resource || resources[0];
}

function localIntent(command = "") {
  const text = lower(command);

  if (
    text.includes("generate resources") ||
    text.includes("fill resources") ||
    text.includes("create resources") ||
    text.includes("make resources") ||
    text.includes("generate for this node") ||
    text.includes("generate node")
  ) {
    return "GENERATE_NODE_RESOURCES";
  }

  if (
    text.startsWith("open") ||
    text.startsWith("show") ||
    text.startsWith("play") ||
    text.startsWith("read") ||
    text.includes("open video") ||
    text.includes("open notes") ||
    text.includes("open pdf") ||
    text.includes("show evidence")
  ) {
    return "OPEN_RESOURCE";
  }

  if (
    text.includes("create node") ||
    text.includes("make node") ||
    text.includes("add node") ||
    text.includes("new concept")
  ) {
    return "CREATE_NODE";
  }

  if (
    text.includes("save note") ||
    text.includes("add note") ||
    text.includes("manual note") ||
    text.includes("remember this")
  ) {
    return "SAVE_MANUAL_RESOURCE";
  }

  if (text.includes("delete this resource") || text.includes("remove this resource")) {
    return "DELETE_CURRENT_RESOURCE";
  }

  if (text.includes("complete this node") || text.includes("mark completed")) {
    return "UPDATE_NODE_STATUS_COMPLETED";
  }

  if (text.includes("start this node") || text.includes("mark in progress")) {
    return "UPDATE_NODE_STATUS_IN_PROGRESS";
  }

  return "";
}

function extractCreateNodeTitle(command = "") {
  const text = clean(command)
    .replace(/create node/gi, "")
    .replace(/make node/gi, "")
    .replace(/add node/gi, "")
    .replace(/new concept/gi, "")
    .replace(/called/gi, "")
    .replace(/named/gi, "")
    .trim();

  return text || "New Concept";
}

function extractManualNote(command = "") {
  return clean(command)
    .replace(/save note/gi, "")
    .replace(/add note/gi, "")
    .replace(/manual note/gi, "")
    .replace(/remember this/gi, "")
    .trim();
}

async function aiIntent(command, context) {
  const fallback = {
    intent: "ASK_AI",
    targetType: "",
    title: "",
    content: "",
    confidence: 0.45,
    reason: "Fallback intent.",
  };

  const prompt = `Return ONLY valid JSON.

You are a backend command router for a learning tree app.

Allowed intents:
OPEN_RESOURCE
GENERATE_NODE_RESOURCES
CREATE_NODE
SAVE_MANUAL_RESOURCE
UPDATE_NODE_STATUS_COMPLETED
UPDATE_NODE_STATUS_IN_PROGRESS
ASK_AI

Allowed targetType:
video, note, lecture, pdf, key_points, chart, diagram, webpage, manual, voice, image, screenshot, table, code, audio, flashcard

Examples:
"open video" -> OPEN_RESOURCE targetType video
"open notes" -> OPEN_RESOURCE targetType note
"generate resources" -> GENERATE_NODE_RESOURCES
"create node Migration Rollback" -> CREATE_NODE title Migration Rollback
"save note migration scripts are version controlled" -> SAVE_MANUAL_RESOURCE content migration scripts are version controlled
"mark completed" -> UPDATE_NODE_STATUS_COMPLETED

Context:
Tree: ${context.treeTitle || ""}
Selected node: ${context.nodeTitle || ""}
Available resource types: ${context.resourceTypes.join(", ")}

Command:
${command}

Return:
{
  "intent": "OPEN_RESOURCE",
  "targetType": "video",
  "title": "",
  "content": "",
  "confidence": 0.0,
  "reason": ""
}`;

  return callOllamaJson(prompt, fallback, {
    timeoutMs: process.env.CONNECT_LEARNING_OLLAMA_TIMEOUT_MS || "45m",
    temperature: 0.03,
    num_predict: 700,
  });
}

export async function resolveAgentCommand(body = {}) {
  const command = clean(body.command || body.text || body.message || body.transcript);
  const deviceId = clean(body.deviceId);
  const userId = clean(body.userId);
  const treeId = clean(body.treeId || body.selectedTreeId);
  const nodeId = clean(body.nodeId || body.selectedNodeId);
  const currentResourceId = clean(body.resourceId || body.currentResourceId);

  if (!command) throw new Error("command is required.");
  if (!deviceId) throw new Error("deviceId is required.");

  const tree = await findCurrentTree({
    treeId,
    selectedTreeId: body.selectedTreeId,
    deviceId,
    userId,
  });

  const node = await findCurrentNode({
    nodeId,
    selectedNodeId: body.selectedNodeId,
    treeId: tree?._id || treeId,
    deviceId,
    userId,
  });

  const resourceQuery = {};
  if (node?._id) resourceQuery.nodeId = node._id;
  else if (tree?._id) resourceQuery.treeId = tree._id;
  else resourceQuery.deviceId = deviceId;

  if (userId) resourceQuery.userId = userId;

  const resources = await LearningResource.find(resourceQuery)
    .sort({ qualityScore: -1, updatedAt: -1 })
    .limit(40)
    .lean();

  const resourceTypes = [...new Set(resources.map((r) => r.sourceType).filter(Boolean))];

  let intent = localIntent(command);
  let ai = null;

  if (!intent) {
    ai = await aiIntent(command, {
      treeTitle: tree?.title,
      nodeTitle: node?.title,
      resourceTypes,
    });

    intent = clean(ai.intent) || "ASK_AI";
  }

  const targetHint = clean(ai?.targetType || sourceTypeFromText(command));
  const commandWithAiHint = `${command} ${targetHint}`;

  if (intent === "OPEN_RESOURCE") {
    const resource = await findResourceForCommand({
      command: commandWithAiHint,
      treeId: tree?._id || treeId,
      nodeId: node?._id || nodeId,
      deviceId,
      userId,
    });

    if (!resource) {
      return {
        ok: true,
        action: {
          type: "SAY",
          message: "I could not find that resource. Generate resources first or add it manually.",
        },
        command,
        tree,
        node,
      };
    }

    return {
      ok: true,
      action: {
        type: "OPEN_RESOURCE",
        resourceId: resource._id,
        resource,
        openMode: resource.openMode || (resource.url ? "external" : "reader"),
        message: `Opening ${resource.sourceType}: ${resource.title}`,
      },
      command,
      tree,
      node,
    };
  }

  if (intent === "GENERATE_NODE_RESOURCES") {
    if (!node?._id) {
      return {
        ok: true,
        action: {
          type: "SAY",
          message: "Select a concept node first, then say generate resources.",
        },
        command,
        tree,
        node,
      };
    }

    return {
      ok: true,
      action: {
        type: "GENERATE_NODE_RESOURCES",
        nodeId: node._id,
        treeId: node.treeId,
        force: lower(command).includes("regenerate"),
        message: `Generating resources for ${node.title}`,
      },
      command,
      tree,
      node,
    };
  }

  if (intent === "CREATE_NODE") {
    if (!tree?._id) {
      return {
        ok: true,
        action: {
          type: "SAY",
          message: "Create or select a learning tree first.",
        },
        command,
        tree,
        node,
      };
    }

    return {
      ok: true,
      action: {
        type: "CREATE_NODE",
        treeId: tree._id,
        parentNodeId: node?._id || null,
        title: clean(ai?.title) || extractCreateNodeTitle(command),
        summary: `Created from voice command: ${command}`,
        message: "Creating a new concept node.",
      },
      command,
      tree,
      node,
    };
  }

  if (intent === "SAVE_MANUAL_RESOURCE") {
    if (!tree?._id || !node?._id) {
      return {
        ok: true,
        action: {
          type: "SAY",
          message: "Select a tree and node first, then save a manual note.",
        },
        command,
        tree,
        node,
      };
    }

    const content = clean(ai?.content) || extractManualNote(command);

    if (!content) {
      return {
        ok: true,
        action: {
          type: "SAY",
          message: "Please say the note content after save note.",
        },
        command,
        tree,
        node,
      };
    }

    return {
      ok: true,
      action: {
        type: "SAVE_MANUAL_RESOURCE",
        treeId: tree._id,
        nodeId: node._id,
        sourceType: "manual",
        title: `Voice note: ${node.title}`,
        summary: "Saved from voice command.",
        extractedText: content,
        tags: ["voice", "manual"],
        message: "Saving manual note.",
      },
      command,
      tree,
      node,
    };
  }

  if (intent === "DELETE_CURRENT_RESOURCE") {
    if (!isObjectId(currentResourceId)) {
      return {
        ok: true,
        action: {
          type: "SAY",
          message: "Open or select a resource first, then say delete this resource.",
        },
        command,
        tree,
        node,
      };
    }

    return {
      ok: true,
      action: {
        type: "DELETE_RESOURCE",
        resourceId: currentResourceId,
        message: "Deleting current resource.",
      },
      command,
      tree,
      node,
    };
  }

  if (intent === "UPDATE_NODE_STATUS_COMPLETED") {
    if (!node?._id) {
      return {
        ok: true,
        action: { type: "SAY", message: "Select a node first." },
        command,
        tree,
        node,
      };
    }

    return {
      ok: true,
      action: {
        type: "UPDATE_NODE_STATUS",
        nodeId: node._id,
        status: "completed",
        message: "Marked this node as completed.",
      },
      command,
      tree,
      node,
    };
  }

  if (intent === "UPDATE_NODE_STATUS_IN_PROGRESS") {
    if (!node?._id) {
      return {
        ok: true,
        action: { type: "SAY", message: "Select a node first." },
        command,
        tree,
        node,
      };
    }

    return {
      ok: true,
      action: {
        type: "UPDATE_NODE_STATUS",
        nodeId: node._id,
        status: "in_progress",
        message: "Marked this node as in progress.",
      },
      command,
      tree,
      node,
    };
  }

  return {
    ok: true,
    action: {
      type: "ASK_AI",
      message: "I understood this as a question. Ask AI explanation can be shown in the chat panel.",
      question: command,
    },
    command,
    tree,
    node,
  };
}

export default {
  resolveAgentCommand,
};
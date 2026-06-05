import React, { useMemo, useState } from "react";
import ConceptTreeDagreBoard from "./ConceptTreeDagreBoard.jsx";
import Stage2PremiumBoardRenderer from "./Stage2PremiumBoardRenderer.jsx";

/**
 * Stage2LiveTutorWorkbench.jsx
 * =============================================================================
 * Stage 2 Premium Tutor Workbench.
 *
 * Fixed flow:
 * PDF upload / saved resource
 * → build accurate source-grounded concept tree OR restore previous tree
 * → full-page React Dagre tree view available
 * → click exact source-backed node
 * → teach selected node with 27-agent backend
 * → render rich Stage2PremiumBoardRenderer
 *
 * No fake:
 * - This component does not create fake concept nodes.
 * - Tree nodes come from backend ConceptTreeAgent response.
 * - Selected node must have sourceRefs.
 * - If backend returns empty boardCommands, frontend reports it clearly.
 * =============================================================================
 */

const API_BASE =
  import.meta.env.VITE_GOOGLE_LIVE_TUTOR_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3000/api";

const DEFAULT_STAGE2_TOTAL_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_STAGE2_CONTEXT_TIMEOUT_MS = 60 * 1000;
const DEFAULT_STAGE2_AGENT_TIMEOUT_MS = 180 * 1000;
const DEFAULT_STAGE2_EXTERNAL_TIMEOUT_MS = 8 * 1000;
const DEFAULT_STAGE2_TTS_TIMEOUT_MS = 60 * 1000;

function readPositiveEnv(name, fallback, min = 1000, max = 60 * 60 * 1000) {
  const parsed = Number(import.meta.env?.[name]);
  if (!Number.isFinite(parsed)) return fallback;
  const n = Math.floor(parsed);
  if (n < min) return fallback;
  return Math.min(n, max);
}

const STAGE2_TIMEOUT_POLICY = {
  contextMs: readPositiveEnv("VITE_STAGE2_CONTEXT_TIMEOUT_MS", DEFAULT_STAGE2_CONTEXT_TIMEOUT_MS, 5 * 1000),
  agentMs: readPositiveEnv("VITE_STAGE2_AGENT_TIMEOUT_MS", DEFAULT_STAGE2_AGENT_TIMEOUT_MS, 10 * 1000),
  externalMs: readPositiveEnv("VITE_STAGE2_EXTERNAL_TIMEOUT_MS", DEFAULT_STAGE2_EXTERNAL_TIMEOUT_MS, 1000, 120 * 1000),
  ttsMs: readPositiveEnv("VITE_STAGE2_TTS_TIMEOUT_MS", DEFAULT_STAGE2_TTS_TIMEOUT_MS, 5 * 1000, 10 * 60 * 1000),
  totalMs: readPositiveEnv(
    "VITE_STAGE2_TOTAL_TIMEOUT_MS",
    readPositiveEnv("VITE_GOOGLE_LIVE_TUTOR_TIMEOUT_MS", DEFAULT_STAGE2_TOTAL_TIMEOUT_MS, 30 * 1000),
    30 * 1000
  ),
  source: "stage2-workbench-timeout-policy-v11",
};

// Backward-compatible alias used in old JSX labels. This is a safety ceiling, not expected runtime.
const STAGE2_TIMEOUT_MS = STAGE2_TIMEOUT_POLICY.totalMs;

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanText(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function formatDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "0 sec";
  if (n < 60 * 1000) return `${Math.round(n / 1000)} sec`;
  const minutes = Math.round(n / 60000);
  return `${minutes} min`;
}

function buildTimeoutErrorMessage(error, fallback = "Stage 2 request timed out") {
  const status = error?.name === "AbortError" ? "aborted" : "failed";
  const total = formatDuration(STAGE2_TIMEOUT_POLICY.totalMs);
  return `${fallback}: ${status} after safety ceiling ${total}. This does not mean the target runtime is ${total}; it means the backend did not finish/prove the lesson before the kill limit.`;
}

function getStored(key, fallback) {
  try {
    let value = localStorage.getItem(key);

    if (
      !value ||
      (key === "agent1_offline_user_id" && value.startsWith("user_")) ||
      (key === "agent1_owner_key" && value.startsWith("user_")) ||
      (key === "agent1_device_id" && value.startsWith("device_"))
    ) {
      value = fallback;
      localStorage.setItem(key, value);
    }

    return value;
  } catch {
    return fallback;
  }
}

function setStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function removeStored(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function getIdentity() {
  return {
    offlineUserId: getStored("agent1_offline_user_id", "jana_test"),
    deviceId: getStored("agent1_device_id", "device_test"),
    ownerKey: getStored("agent1_owner_key", "jana_test"),
  };
}

function useJanaIdentity() {
  setStored("agent1_offline_user_id", "jana_test");
  setStored("agent1_device_id", "device_test");
  setStored("agent1_owner_key", "jana_test");
}

function identityForResource(resource, identity = getIdentity()) {
  const resourceOwnerKey = cleanText(resource?.ownerKey || resource?.metadata?.ownerKey || "");

  return {
    offlineUserId: cleanText(resource?.offlineUserId || identity.offlineUserId, identity.offlineUserId),
    deviceId: cleanText(resource?.deviceId || identity.deviceId, identity.deviceId),
    ownerKey: cleanText(resourceOwnerKey || identity.ownerKey, identity.ownerKey),
  };
}

function treeOwnerKeyForResource(resource, identity = getIdentity()) {
  return cleanText(resource?.ownerKey || identity.ownerKey, identity.ownerKey);
}

function previousTreeKey(resourceId, ownerKey) {
  return `stage2_previous_tree:${ownerKey || "demo"}:${resourceId || "none"}`;
}

function savePreviousTree(resourceId, ownerKey, tree) {
  if (!resourceId || !tree?.treeId) return;
  setStored(
    previousTreeKey(resourceId, ownerKey),
    JSON.stringify({
      resourceId,
      ownerKey,
      treeId: tree.treeId,
      boardId: tree.boardId,
      title: tree.title,
      savedAt: new Date().toISOString(),
    })
  );
}

function readPreviousTreeMeta(resourceId, ownerKey) {
  try {
    const raw = localStorage.getItem(previousTreeKey(resourceId, ownerKey));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function headers(json = true, requestIdentity = null) {
  const identity = requestIdentity || getIdentity();

  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    "x-offline-user-id": identity.offlineUserId,
    "x-device-id": identity.deviceId,
    "x-owner-key": identity.ownerKey,
  };
}

async function readJson(response) {
  const text = await response.text();
  let json = null;

  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { ok: false, error: text || "Non-JSON response" };
  }

  if (!response.ok || json.ok === false) {
    const error = new Error(json.error || json.message || `HTTP ${response.status}`);
    error.response = json;
    error.status = response.status;
    throw error;
  }

  return json;
}

async function apiGet(path, requestIdentity = null) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: headers(false, requestIdentity),
  });

  return readJson(response);
}

async function apiPost(path, body, requestIdentity = null, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 0);
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timer = controller
    ? window.setTimeout(() => controller.abort(), timeoutMs + 5000)
    : null;

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: headers(true, requestIdentity),
      body: JSON.stringify(body || {}),
      signal: controller?.signal,
    });

    return await readJson(response);
  } catch (error) {
    if (error?.name === "AbortError") {
      const abortError = new Error(buildTimeoutErrorMessage(error));
      abortError.name = "Stage2ClientTimeout";
      abortError.status = 504;
      throw abortError;
    }
    throw error;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

async function apiUploadPdf(file, title) {
  const form = new FormData();
  form.append("file", file);
  form.append("title", title || file.name || "Uploaded PDF");

  const response = await fetch(`${API_BASE}/google-agent/live-tutor/resources/upload`, {
    method: "POST",
    headers: headers(false),
    body: form,
  });

  return readJson(response);
}

function normalizeLesson(raw) {
  const outer = safeObject(raw);
  const inner = safeObject(outer.result);

  return {
    ok: outer.ok === true,
    sessionId: cleanText(outer.sessionId || inner.sessionId),
    segmentId: cleanText(outer.segmentId || inner.segmentId),

    boardSections: safeArray(outer.boardSections || inner.boardSections),
    diagramArtifacts: safeObject(outer.diagramArtifacts || inner.diagramArtifacts),
    compiledDiagrams: safeArray(outer.compiledDiagrams || inner.compiledDiagrams),
    htmlPreviews: safeArray(outer.htmlPreviews || inner.htmlPreviews),
    imagePreviews: safeArray(outer.imagePreviews || inner.imagePreviews),
    sourceCards: safeArray(outer.sourceCards || inner.sourceCards),
    lessonTranscript: cleanText(outer.lessonTranscript || inner.lessonTranscript),

    boardCommands: safeArray(
      outer.boardCommands ||
        outer.commands ||
        inner.boardCommands ||
        inner.commands ||
        inner.layout?.boardCommands
    ),
    voiceScript: safeArray(outer.voiceScript || inner.voiceScript),
    subtitles: safeArray(outer.subtitles || inner.subtitles),
    quiz: outer.quiz || inner.quiz || {},
    sourceRefs: safeArray(outer.sourceRefs || inner.sourceRefs),
    agentTrace: safeArray(outer.agentTrace || outer.trace || inner.agentTrace || inner.trace),
    handwriting: outer.handwriting || inner.handwriting || {},
    metadata: safeObject(outer.metadata || inner.metadata),
    raw: outer,
  };
}

function normalizeTreeResponse(raw) {
  const outer = safeObject(raw);
  const conceptTree = safeObject(outer.conceptTree);
  const treeObj = safeObject(outer.tree);
  const inner = safeObject(outer.result || treeObj || conceptTree);

  const nodes = safeArray(outer.nodes || inner.nodes || conceptTree.nodes);
  const edges = safeArray(outer.edges || inner.edges || conceptTree.edges);
  const board = safeObject(outer.board || inner.board);

  return {
    ...outer,
    ...inner,
    ok: outer.ok !== false,
    treeId: cleanText(outer.treeId || inner.treeId || conceptTree.treeId || outer.id || inner.id),
    boardId: cleanText(outer.boardId || inner.boardId || board.boardId),
    title: cleanText(outer.title || inner.title || conceptTree.title || "Source-Grounded Concept Tree"),
    rootNodeId: cleanText(outer.rootNodeId || inner.rootNodeId || conceptTree.rootNodeId),
    nodes,
    edges,
    flow: outer.flow || inner.flow || board.flow || null,
    dagre: safeObject(outer.dagre || inner.dagre),
    sourceRefs: safeArray(outer.sourceRefs || inner.sourceRefs),
    metadata: safeObject(outer.metadata || inner.metadata),
  };
}

function sourcePages(node) {
  const pages = safeArray(node?.sourceRefs)
    .map((ref) => Number(safeObject(ref).page))
    .filter((page) => Number.isFinite(page) && page > 0);

  return [...new Set(pages)].slice(0, 5);
}

function hasSourceEvidence(node) {
  return safeArray(node?.sourceRefs).some((ref) => {
    const r = safeObject(ref);
    return cleanText(r.chunkId) && Number(r.page) > 0;
  });
}

function getNodeTitle(node) {
  return cleanText(node?.label || node?.title || node?.nodeId || node?.id, "No node selected");
}

function ResourceCard({ resource, selected, onClick }) {
  return (
    <button
      type="button"
      className={`s2-resource ${selected ? "selected" : ""}`}
      onClick={onClick}
    >
      <b>{resource.title || "Untitled resource"}</b>
      <span>
        {resource.sourceType || "pdf"} · {resource.status || "unknown"} · pages{" "}
        {resource.extraction?.pageCount || resource.pageCount || "?"} · chunks{" "}
        {resource.extraction?.chunkCount || resource.chunkCount || "?"}
      </span>
      <code>{resource.resourceId}</code>
      <small>owner: {resource.ownerKey || "?"}</small>
    </button>
  );
}

function TreeQualityBox({ tree, selectedNode }) {
  const nodes = safeArray(tree?.nodes);
  const edges = safeArray(tree?.edges);
  const sourcedNodes = nodes.filter(hasSourceEvidence);
  const selectedPages = sourcePages(selectedNode);

  return (
    <section className="s2-quality">
      <div>
        <b>Tree quality</b>
        <span>
          {sourcedNodes.length}/{nodes.length} nodes have source evidence · {edges.length} relations
        </span>
      </div>

      <div>
        <b>Selected node</b>
        <span>
          {selectedNode
            ? `${getNodeTitle(selectedNode)} ${
                selectedPages.length ? `· source p.${selectedPages.join(", ")}` : "· no page"
              }`
            : "No node selected"}
        </span>
      </div>
    </section>
  );
}

function LessonSummary({ lesson }) {
  if (!lesson) return null;

  return (
    <section className="s2-quality compact">
      <div>
        <b>Generated board</b>
        <span>
          {lesson.boardCommands.length} commands · {lesson.boardSections.length} sections ·{" "}
          {safeArray(lesson.diagramArtifacts?.mermaid).length} Mermaid
        </span>
      </div>
      <div>
        <b>Voice/subtitle</b>
        <span>
          {lesson.voiceScript.length} voice lines · {lesson.subtitles.length} subtitles ·{" "}
          {lesson.agentTrace.length} agents
        </span>
      </div>
    </section>
  );
}

export default function Stage2LiveTutorWorkbench() {
  const [identityVersion, setIdentityVersion] = useState(0);
  const identity = useMemo(() => {
    void identityVersion;
    return getIdentity();
  }, [identityVersion]);

  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("Lecture 03 EDD.pdf");

  const [resources, setResources] = useState([]);
  const [selectedResource, setSelectedResource] = useState(null);

  const [tree, setTree] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [treeViewMode, setTreeViewMode] = useState("embedded");

  const [question, setQuestion] = useState(
    "Teach this selected node like a human private tutor. Use only source-grounded details from the PDF. Create detailed explanation, concept tree, flowchart, table, example, source notes, voice, subtitles and quiz. Do not invent unsupported content."
  );

  const [lesson, setLesson] = useState(null);
  const normalizedLesson = useMemo(() => (lesson ? normalizeLesson(lesson) : null), [lesson]);

  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [lastResponse, setLastResponse] = useState(null);

  const previousTreeMeta = useMemo(
    () => readPreviousTreeMeta(
      selectedResource?.resourceId,
      treeOwnerKeyForResource(selectedResource, identity)
    ),
    [selectedResource?.resourceId, selectedResource?.ownerKey, identity.ownerKey, tree?.treeId]
  );

  function forceJana() {
    useJanaIdentity();
    setIdentityVersion((v) => v + 1);
    setError("");
  }

  async function uploadPdf() {
    try {
      setError("");

      if (!file) {
        throw new Error("Choose a PDF first.");
      }

      setLoading("Uploading PDF for 27-agent tutor...");

      const result = await apiUploadPdf(file, title);
      setLastResponse(result);

      const resource = result.resource || result;
      setSelectedResource(resource);
      setTree(null);
      setSelectedNode(null);
      setLesson(null);

      await loadResources(false);
      setLoading(`Uploaded ✅ ${resource.resourceId || result.resourceId || ""}`);
    } catch (e) {
      setError(e?.name === "Stage2ClientTimeout" ? buildTimeoutErrorMessage(e) : e.message);
      setLastResponse(e.response || null);
      setLoading("");
    }
  }

  async function loadResources(show = true) {
    try {
      setError("");

      if (show) {
        setLoading("Loading resources...");
      }

      const result = await apiGet("/google-agent/live-tutor/resources");
      setLastResponse(result);

      const list = safeArray(result.resources);
      setResources(list);

      if (!selectedResource && list[0]) {
        setSelectedResource(list[0]);
      }

      if (show) {
        setLoading(`Loaded ${list.length} resources ✅`);
      }

      return list;
    } catch (e) {
      setError(e?.name === "Stage2ClientTimeout" ? buildTimeoutErrorMessage(e) : e.message);
      setLastResponse(e.response || null);
      if (show) setLoading("");
      return [];
    }
  }

  async function buildConceptTree() {
    try {
      setError("");

      if (!selectedResource?.resourceId) {
        throw new Error("Select resource first.");
      }

      setTree(null);
      setSelectedNode(null);
      setLesson(null);
      setLoading("Rebuilding accurate source-grounded concept tree from PDF chunks...");

      const requestIdentity = identityForResource(selectedResource, identity);

      const result = await apiPost(
        `/google-agent/live-tutor/resources/${encodeURIComponent(selectedResource.resourceId)}/concept-tree`,
        {
          resourceId: selectedResource.resourceId,
          question:
            "Create an accurate source-grounded concept tree for the full uploaded PDF. Every node and relation must use sourceRefs. No unsupported/random concepts.",
          studentLevel: "beginner",
          language: "english",
          maxNodes: 32,
          requireSourceRefs: true,
          layout: "reactflow-dagre",
          ownerKey: requestIdentity.ownerKey,
          offlineUserId: requestIdentity.offlineUserId,
          deviceId: requestIdentity.deviceId,
        },
        requestIdentity
      );

      const normalizedTree = normalizeTreeResponse(result);
      const firstNode =
        normalizedTree.nodes.find((node) => cleanText(node.nodeId) === cleanText(normalizedTree.rootNodeId)) ||
        normalizedTree.nodes[0] ||
        null;

      setTree(normalizedTree);
      setSelectedNode(result.selectedNode || firstNode);
      savePreviousTree(selectedResource.resourceId, requestIdentity.ownerKey, normalizedTree);

      setLastResponse(result);
      setLoading(`Concept tree rebuilt ✅ ${normalizedTree.nodes.length} nodes / ${normalizedTree.edges.length} edges`);
    } catch (e) {
      setError(e?.name === "Stage2ClientTimeout" ? buildTimeoutErrorMessage(e) : e.message);
      setLastResponse(e.response || null);
      setLoading("");
    }
  }

  async function usePreviousTree() {
    try {
      setError("");
      setLesson(null);

      if (!selectedResource?.resourceId) {
        throw new Error("Select resource first.");
      }

      const requestIdentity = identityForResource(selectedResource, identity);
      const meta =
        readPreviousTreeMeta(selectedResource.resourceId, requestIdentity.ownerKey) ||
        readPreviousTreeMeta(selectedResource.resourceId, identity.ownerKey);
      if (!meta?.treeId) {
        throw new Error("No previous tree saved for this resource. Build the tree once first.");
      }

      setLoading(`Restoring previous concept tree ${meta.treeId}...`);

      const result = await apiGet(
        `/google-agent/live-tutor/concept-trees/${encodeURIComponent(meta.treeId)}`,
        requestIdentity
      );
      const normalizedTree = normalizeTreeResponse(result);

      if (!normalizedTree.treeId || !safeArray(normalizedTree.nodes).length) {
        throw new Error("Previous tree loaded but it has no nodes.");
      }

      const firstNode =
        normalizedTree.nodes.find((node) => cleanText(node.nodeId) === cleanText(normalizedTree.rootNodeId)) ||
        normalizedTree.nodes[0] ||
        null;

      setTree({
        ...normalizedTree,
        boardId: normalizedTree.boardId || meta.boardId,
      });
      setSelectedNode(firstNode);
      setLastResponse(result);
      setLoading(`Previous tree restored ✅ ${normalizedTree.nodes.length} nodes / ${normalizedTree.edges.length} edges`);
    } catch (e) {
      setError(e?.name === "Stage2ClientTimeout" ? buildTimeoutErrorMessage(e) : e.message);
      setLastResponse(e.response || null);
      setLoading("");
    }
  }

  function clearPreviousTree() {
    if (!selectedResource?.resourceId) return;
    removeStored(previousTreeKey(selectedResource.resourceId, treeOwnerKeyForResource(selectedResource, identity)));
    removeStored(previousTreeKey(selectedResource.resourceId, identity.ownerKey));
    setLoading("Previous tree link cleared for this resource.");
  }

  function selectResource(resource) {
    setSelectedResource(resource);
    setTree(null);
    setSelectedNode(null);
    setLesson(null);
    setTreeViewMode("embedded");
    setError("");
  }

  function selectNode(node) {
    const fullNode = safeObject(node);

    if (!hasSourceEvidence(fullNode)) {
      setError(
        `Selected node "${getNodeTitle(fullNode)}" has no source evidence. Backend should not teach unsupported nodes.`
      );
    } else {
      setError("");
    }

    setSelectedNode(fullNode);
    setLesson(null);
  }

  async function teachSelectedNode() {
    try {
      setError("");
      setLesson(null);

      if (!selectedResource?.resourceId) {
        throw new Error("Select resource first.");
      }

      if (!tree?.treeId) {
        throw new Error("Build or restore a concept tree first.");
      }

      if (!selectedNode?.nodeId && !selectedNode?.id) {
        throw new Error("Select concept node first.");
      }

      if (!hasSourceEvidence(selectedNode)) {
        throw new Error("Selected node has no sourceRefs/page evidence. Build a source-grounded tree first.");
      }

      setLoading(
        `Running 27-agent teach-node pipeline. Fast target: 20–90 sec; safety ceiling: ${formatDuration(
          STAGE2_TIMEOUT_POLICY.totalMs
        )}. Context/external/TTS are separately capped.`
      );

      const requestIdentity = identityForResource(selectedResource, identity);

      const result = await apiPost("/google-agent/live-tutor/stage2/teach-node", {
        resourceId: selectedResource.resourceId,
        treeId: tree.treeId,
        boardId: tree.boardId,
        nodeId: selectedNode.nodeId || selectedNode.id,
        selectedNode,
        sourceRefs: safeArray(selectedNode.sourceRefs),
        question,
        studentLevel: "beginner",
        language: "english",

        timeoutMs: STAGE2_TIMEOUT_POLICY.totalMs,
        stage2TimeoutMs: STAGE2_TIMEOUT_POLICY.totalMs,
        timeoutPolicy: STAGE2_TIMEOUT_POLICY,
        stage2ContextTimeoutMs: STAGE2_TIMEOUT_POLICY.contextMs,
        stage2AgentTimeoutMs: STAGE2_TIMEOUT_POLICY.agentMs,
        stage2ExternalTimeoutMs: STAGE2_TIMEOUT_POLICY.externalMs,
        stage2TtsTimeoutMs: STAGE2_TIMEOUT_POLICY.ttsMs,
        proofRequestVersion: "stage2-workbench-proof-v11",
        metadata: {
          timeoutPolicy: STAGE2_TIMEOUT_POLICY,
          proofRequestVersion: "stage2-workbench-proof-v11",
          expectedProof: {
            mongo16mbSafe: true,
            artifactCountGtZero: true,
            parallelContextBuilt: true,
            selectedEvidenceSeparated: true,
          },
        },

        strictSourceGrounding: true,
        requireBoardCommands: true,
        requireDiagramCompiler: true,
        requireDiagramPlan: true,
        requireBoardSections: true,
        requireHtmlPreview: true,
        requireVoiceScript: true,
        requireSubtitles: true,
        requireNoFallback: true,
        ownerKey: requestIdentity.ownerKey,
        offlineUserId: requestIdentity.offlineUserId,
        deviceId: requestIdentity.deviceId,
      }, requestIdentity, { timeoutMs: STAGE2_TIMEOUT_POLICY.totalMs });

      const normalized = normalizeLesson(result);
      setLastResponse(result);

      if (!normalized.boardCommands.length) {
        throw new Error(
          "Stage 2 returned ok but boardCommands is empty. Backend must return real board commands."
        );
      }

      setLesson(result);
      setLoading(
        `Board ready ✅ ${normalized.boardCommands.length} commands · ${normalized.boardSections.length} sections · ${normalized.voiceScript.length} voice lines`
      );
    } catch (e) {
      setError(e?.name === "Stage2ClientTimeout" ? buildTimeoutErrorMessage(e) : e.message);
      setLastResponse(e.response || null);
      setLoading("");
    }
  }

  function openLessonFromLastResponse() {
    if (!lastResponse?.ok) {
      setError("No successful Stage 2 response available.");
      return;
    }
    setLesson(lastResponse);
    setError("");
  }

  if (treeViewMode === "full") {
    return (
      <div className="s2-page full-tree-page">
        <style>{styles}</style>

        <header className="s2-hero full">
          <div>
            <div className="s2-kicker">Full source-grounded concept tree</div>
            <h1>{tree?.title || "Concept Tree"}</h1>
            <p>
              {safeArray(tree?.nodes).length} nodes · {safeArray(tree?.edges).length} edges · selected:{" "}
              {getNodeTitle(selectedNode)}
            </p>
          </div>

          <div className="s2-actions">
            <button type="button" onClick={() => setTreeViewMode("embedded")}>
              Back to workbench
            </button>
            <button type="button" onClick={teachSelectedNode}>
              Teach selected node
            </button>
          </div>
        </header>

        <section className="s2-panel full-tree-wrap">
          {tree ? (
            <>
              <TreeQualityBox tree={tree} selectedNode={selectedNode} />
              <ConceptTreeDagreBoard
                tree={tree}
                selectedNode={selectedNode}
                onSelectNode={selectNode}
                height="calc(100vh - 240px)"
                showEvidencePanel={true}
              />
            </>
          ) : (
            <div className="s2-empty tall">No tree loaded.</div>
          )}
        </section>

        {loading ? <div className="s2-status">{loading}</div> : null}
        {error ? <div className="s2-error">{error}</div> : null}
      </div>
    );
  }

  if (lesson && normalizedLesson) {
    return (
      <div className="s2-page lesson-page">
        <style>{styles}</style>

        <Stage2PremiumBoardRenderer
          title={`Teaching: ${getNodeTitle(selectedNode)}`}
          boardSections={normalizedLesson.boardSections}
          diagramArtifacts={normalizedLesson.diagramArtifacts}
          compiledDiagrams={normalizedLesson.compiledDiagrams}
          htmlPreviews={normalizedLesson.htmlPreviews}
          imagePreviews={normalizedLesson.imagePreviews}
          sourceCards={normalizedLesson.sourceCards}
          lessonTranscript={normalizedLesson.lessonTranscript}
          boardCommands={normalizedLesson.boardCommands}
          voiceScript={normalizedLesson.voiceScript}
          subtitles={normalizedLesson.subtitles}
          quiz={normalizedLesson.quiz}
          sourceRefs={normalizedLesson.sourceRefs}
          agentTrace={normalizedLesson.agentTrace}
          handwriting={normalizedLesson.handwriting}
          metadata={normalizedLesson.metadata}
          result={normalizedLesson.raw}
          onBack={() => setLesson(null)}
          onInterrupt={(state) => {
            setLastResponse({
              ok: true,
              interruptState: state,
              message: "Interrupt state captured in frontend. Backend interrupt API can use this state.",
            });
          }}
        />

        <section className="s2-panel">
          <div className="s2-panel-head">
            <div>
              <div className="s2-kicker">Debug</div>
              <h2>Last successful lesson summary</h2>
            </div>
          </div>
          <pre className="s2-json">
            {JSON.stringify(
              {
                sessionId: normalizedLesson.sessionId,
                selectedNode: selectedNode
                  ? {
                      nodeId: selectedNode.nodeId || selectedNode.id,
                      label: getNodeTitle(selectedNode),
                      pages: sourcePages(selectedNode),
                    }
                  : null,
                counts: {
                  boardSections: normalizedLesson.boardSections.length,
                  compiledDiagrams: normalizedLesson.compiledDiagrams.length,
                  mermaid: safeArray(normalizedLesson.diagramArtifacts?.mermaid).length,
                  htmlPreviews: normalizedLesson.htmlPreviews.length,
                  boardCommands: normalizedLesson.boardCommands.length,
                  voiceScript: normalizedLesson.voiceScript.length,
                  subtitles: normalizedLesson.subtitles.length,
                  agentTrace: normalizedLesson.agentTrace.length,
                },
              },
              null,
              2
            )}
          </pre>
        </section>
      </div>
    );
  }

  return (
    <div className="s2-page">
      <style>{styles}</style>

      <header className="s2-hero">
        <div>
          <div className="s2-kicker">Stage 2 Premium Board</div>
          <h1>Stage 2 Premium Tutor Board</h1>
          <p>
            PDF → Accurate Dagre Tree → Source-Grounded Board. Build a real concept tree from PDF chunks,
            select one source-backed node, then teach that node with the 27-agent board pipeline.
          </p>
        </div>

        <div className="s2-actions">
          <button type="button" onClick={forceJana}>Use jana_test</button>
          <button type="button" onClick={() => loadResources(true)}>Load resources</button>
          <button type="button" onClick={() => setTreeViewMode("full")} disabled={!tree}>
            Open full tree
          </button>
          <button type="button" onClick={openLessonFromLastResponse} disabled={!lastResponse?.ok}>
            Open last board
          </button>
        </div>
      </header>

      <section className="s2-panel">
        <div className="s2-panel-head">
          <div>
            <div className="s2-kicker">Connection</div>
            <h2>Backend identity</h2>
          </div>
          <span className="s2-pill">API {API_BASE}</span>
        </div>

        <div className="s2-meta">
          <div>
            <b>User</b>
            <span>{identity.offlineUserId}</span>
          </div>
          <div>
            <b>Device</b>
            <span>{identity.deviceId}</span>
          </div>
          <div>
            <b>Owner</b>
            <span>{identity.ownerKey}</span>
          </div>
          <div>
            <b>Safety ceiling</b>
            <span>{formatDuration(STAGE2_TIMEOUT_POLICY.totalMs)}</span>
          </div>
          <div>
            <b>Context cap</b>
            <span>{formatDuration(STAGE2_TIMEOUT_POLICY.contextMs)}</span>
          </div>
        </div>
      </section>

      <div className="s2-grid">
        <section className="s2-panel">
          <div className="s2-panel-head">
            <div>
              <div className="s2-kicker">Step 1</div>
              <h2>Upload PDF for tutor board</h2>
            </div>
            <span className="s2-pill">real resource API</span>
          </div>

          <label>
            PDF title
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>

          <label>
            Choose PDF
            <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>

          <div className="s2-actions">
            <button type="button" onClick={uploadPdf}>Upload PDF</button>
            <button type="button" onClick={() => loadResources(true)}>Load resources</button>
          </div>

          <div className="s2-panel-head mini">
            <div>
              <div className="s2-kicker">Step 2</div>
              <h2>Select resource</h2>
            </div>
            <span className="s2-pill">{resources.length} loaded</span>
          </div>

          <div className="s2-resource-list">
            {resources.map((resource) => (
              <ResourceCard
                key={resource.resourceId}
                resource={resource}
                selected={selectedResource?.resourceId === resource.resourceId}
                onClick={() => selectResource(resource)}
              />
            ))}

            {!resources.length ? <div className="s2-empty">Click Load resources or upload PDF.</div> : null}
          </div>

          {selectedResource ? (
            <div className="s2-selected">
              <b>Selected</b>
              <span>{selectedResource.title}</span>
              <code>{selectedResource.resourceId}</code>
              <small>
                owner {selectedResource.ownerKey} · pages{" "}
                {selectedResource.extraction?.pageCount || selectedResource.pageCount || "?"} · chunks{" "}
                {selectedResource.extraction?.chunkCount || selectedResource.chunkCount || "?"}
              </small>
            </div>
          ) : null}

          <div className="s2-tree-actions">
            <button type="button" className="wide" onClick={buildConceptTree}>
              Rebuild accurate concept tree
            </button>

            <button
              type="button"
              className="wide secondary"
              onClick={usePreviousTree}
              disabled={!selectedResource}
            >
              Use previous created tree
            </button>

            {previousTreeMeta ? (
              <div className="s2-prev-tree">
                <b>Previous tree saved</b>
                <code>{previousTreeMeta.treeId}</code>
                <small>board {previousTreeMeta.boardId || "?"}</small>
                <button type="button" onClick={clearPreviousTree}>Clear previous link</button>
              </div>
            ) : (
              <div className="s2-empty small">No previous tree saved for selected resource.</div>
            )}
          </div>
        </section>

        <section className="s2-panel s2-tree-panel">
          <div className="s2-panel-head">
            <div>
              <div className="s2-kicker">Step 2B</div>
              <h2>React Dagre concept tree</h2>
            </div>
            <div className="s2-actions small-actions">
              <span className="s2-pill">
                {safeArray(tree?.nodes).length} nodes · {safeArray(tree?.edges).length} edges
              </span>
              <button type="button" onClick={() => setTreeViewMode("full")} disabled={!tree}>
                Full tree page
              </button>
            </div>
          </div>

          {tree ? (
            <>
              <TreeQualityBox tree={tree} selectedNode={selectedNode} />
              <ConceptTreeDagreBoard
                tree={tree}
                selectedNode={selectedNode}
                onSelectNode={selectNode}
                height="760px"
                showEvidencePanel={true}
              />
            </>
          ) : (
            <div className="s2-empty tall">
              Rebuild the tree or use the previous created tree. The tree will use backend sourceRefs and React Flow + Dagre layout.
            </div>
          )}
        </section>
      </div>

      <section className="s2-panel">
        <div className="s2-panel-head">
          <div>
            <div className="s2-kicker">Step 3</div>
            <h2>Convert selected node into board</h2>
          </div>
          <span className="s2-pill ok">
            {selectedNode ? getNodeTitle(selectedNode) : "select node"}
          </span>
        </div>

        <TreeQualityBox tree={tree} selectedNode={selectedNode} />

        <label>
          Tutor instruction
          <textarea rows={4} value={question} onChange={(e) => setQuestion(e.target.value)} />
        </label>

        <button type="button" className="teach" onClick={teachSelectedNode}>
          Teach selected source-backed node with 27 agents
        </button>

        <LessonSummary lesson={normalizedLesson} />
      </section>

      {loading ? <div className="s2-status">{loading}</div> : null}
      {error ? <div className="s2-error">{error}</div> : null}

      <section className="s2-panel">
        <div className="s2-panel-head">
          <div>
            <div className="s2-kicker">Debug</div>
            <h2>Current backend response</h2>
          </div>
        </div>

        <pre className="s2-json">
          {JSON.stringify(
            {
              selectedResource: selectedResource
                ? {
                    title: selectedResource.title,
                    resourceId: selectedResource.resourceId,
                    ownerKey: selectedResource.ownerKey,
                    chunks: selectedResource.extraction?.chunkCount || selectedResource.chunkCount,
                  }
                : null,
              previousTreeMeta,
              tree: tree
                ? {
                    treeId: tree.treeId,
                    boardId: tree.boardId,
                    nodes: safeArray(tree.nodes).length,
                    edges: safeArray(tree.edges).length,
                    sourceBackedNodes: safeArray(tree.nodes).filter(hasSourceEvidence).length,
                  }
                : null,
              selectedNode: selectedNode
                ? {
                    nodeId: selectedNode.nodeId || selectedNode.id,
                    label: getNodeTitle(selectedNode),
                    pages: sourcePages(selectedNode),
                    sourceRefs: safeArray(selectedNode.sourceRefs).slice(0, 2),
                    visualHints: safeArray(selectedNode.visualHints),
                  }
                : null,
              lastResponseSummary: lastResponse
                ? {
                    ok: lastResponse.ok,
                    error: lastResponse.error,
                    sessionId: lastResponse.sessionId,
                    segmentId: lastResponse.segmentId,
                    boardCommandCount: safeArray(lastResponse.boardCommands || lastResponse.result?.boardCommands).length,
                    boardSectionCount: safeArray(lastResponse.boardSections || lastResponse.result?.boardSections).length,
                    compiledDiagramCount: safeArray(lastResponse.compiledDiagrams || lastResponse.result?.compiledDiagrams).length,
                    mermaidCount: safeArray(lastResponse.diagramArtifacts?.mermaid || lastResponse.result?.diagramArtifacts?.mermaid).length,
                    htmlPreviewCount: safeArray(lastResponse.htmlPreviews || lastResponse.result?.htmlPreviews).length,
                    voiceLineCount: safeArray(lastResponse.voiceScript || lastResponse.result?.voiceScript).length,
                    subtitleCount: safeArray(lastResponse.subtitles || lastResponse.result?.subtitles).length,
                    traceCount: safeArray(
                      lastResponse.agentTrace || lastResponse.trace || lastResponse.result?.agentTrace
                    ).length,
                    fallbackUsed: lastResponse.metadata?.fallbackUsed,
                  }
                : null,
            },
            null,
            2
          )}
        </pre>
      </section>
    </div>
  );
}

const styles = `
  .s2-page {
    min-height: 100vh;
    background: #fff8f1;
    color: #3d322b;
    padding: 18px;
    font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .s2-page * {
    box-sizing: border-box;
  }

  .s2-hero,
  .s2-panel {
    max-width: 1480px;
    margin: 0 auto 16px;
    border: 1px solid #f0dfd2;
    background: #fffdf9;
    border-radius: 22px;
    padding: 22px;
    box-shadow: 0 12px 36px rgba(103, 64, 38, .07);
  }

  .s2-hero.full,
  .full-tree-wrap {
    max-width: 1900px;
  }

  .full-tree-page {
    padding: 14px;
  }

  .lesson-page {
    padding: 0;
    background: #020617;
  }

  .s2-hero {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
  }

  .s2-kicker {
    color: #fb6b4b;
    font-weight: 950;
    letter-spacing: .14em;
    text-transform: uppercase;
    font-size: 12px;
    margin-bottom: 6px;
  }

  .s2-hero h1,
  .s2-panel h2 {
    margin: 0;
    letter-spacing: -.035em;
  }

  .s2-hero p {
    color: #7a6a5f;
    margin: 8px 0 0;
    line-height: 1.6;
  }

  .s2-panel-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 16px;
  }

  .s2-panel-head.mini {
    margin-top: 18px;
  }

  .s2-pill {
    border: 1px solid #f0c8b9;
    background: #fff4ec;
    color: #8c3b27;
    border-radius: 99px;
    padding: 8px 12px;
    font-weight: 850;
    font-size: 12px;
    white-space: nowrap;
  }

  .s2-pill.ok {
    color: #2f8a48;
    border-color: #a9d6ad;
    background: #f3fff3;
  }

  .s2-meta {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }

  .s2-meta div,
  .s2-selected,
  .s2-quality,
  .s2-prev-tree {
    background: #fff8f1;
    border: 1px solid #f0dfd2;
    border-radius: 16px;
    padding: 12px;
    display: grid;
    gap: 4px;
  }

  .s2-quality {
    grid-template-columns: 1fr 1fr;
    margin-bottom: 14px;
  }

  .s2-quality.compact {
    margin-top: 14px;
    margin-bottom: 0;
  }

  .s2-quality div {
    display: grid;
    gap: 4px;
  }

  .s2-meta b,
  .s2-selected b,
  .s2-quality b,
  .s2-prev-tree b {
    color: #8c3b27;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: .08em;
  }

  .s2-meta span,
  .s2-selected span,
  .s2-selected code,
  .s2-selected small,
  .s2-quality span,
  .s2-prev-tree code,
  .s2-prev-tree small {
    overflow-wrap: anywhere;
    color: #4b4038;
  }

  label {
    display: grid;
    gap: 8px;
    font-weight: 850;
    margin-bottom: 14px;
  }

  input,
  textarea {
    width: 100%;
    border: 1px solid #ecd5c8;
    border-radius: 16px;
    padding: 13px 14px;
    font: inherit;
    background: #fff;
    color: #3d322b;
    outline: none;
  }

  input:focus,
  textarea:focus {
    border-color: #fb7b5c;
    box-shadow: 0 0 0 4px rgba(251, 123, 92, .12);
  }

  button {
    border: 0;
    background: #fb7b5c;
    color: white;
    border-radius: 14px;
    padding: 12px 16px;
    font-weight: 950;
    cursor: pointer;
  }

  button:hover {
    filter: brightness(1.03);
  }

  button:disabled {
    opacity: .5;
    cursor: not-allowed;
    filter: grayscale(.3);
  }

  button.secondary {
    background: #8c3b27;
  }

  .s2-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .s2-actions.small-actions {
    align-items: center;
    justify-content: flex-end;
  }

  .s2-grid {
    max-width: 1480px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: 360px minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }

  .s2-tree-panel {
    min-width: 0;
  }

  .s2-resource-list {
    display: grid;
    gap: 10px;
    max-height: 560px;
    overflow: auto;
  }

  .s2-resource {
    text-align: left;
    background: #fff8f1;
    color: #3d322b;
    border: 1px solid #f0dfd2;
    box-shadow: none;
    display: grid;
    gap: 5px;
  }

  .s2-resource.selected {
    background: #fff0e7;
    border-color: #fb7b5c;
  }

  .s2-resource span,
  .s2-resource small,
  .s2-resource code {
    color: #6e5e54;
    overflow-wrap: anywhere;
  }

  .s2-selected {
    margin-top: 14px;
  }

  .s2-tree-actions {
    display: grid;
    gap: 10px;
    margin-top: 14px;
  }

  .wide,
  .teach {
    width: 100%;
    margin-top: 0;
  }

  .teach {
    padding: 16px 20px;
    font-size: 16px;
  }

  .s2-status,
  .s2-error {
    max-width: 1480px;
    margin: 0 auto 16px;
    border-radius: 16px;
    padding: 14px 16px;
    font-weight: 900;
  }

  .s2-status {
    background: #f0fff2;
    border: 1px solid #bfe6c5;
    color: #287841;
  }

  .s2-error {
    background: #fff2ef;
    border: 1px solid #f4b7a7;
    color: #bd3d25;
  }

  .s2-empty {
    border: 1px dashed #e8cabb;
    color: #8c7568;
    padding: 18px;
    border-radius: 16px;
  }

  .s2-empty.small {
    padding: 11px;
    font-size: 13px;
  }

  .s2-empty.tall {
    min-height: 520px;
    display: grid;
    place-items: center;
    text-align: center;
  }

  .s2-json {
    background: #2b211d;
    color: #fff8f1;
    border-radius: 16px;
    padding: 14px;
    overflow: auto;
    max-height: 520px;
    font-size: 12px;
    line-height: 1.55;
  }

  @media (max-width: 1100px) {
    .s2-hero,
    .s2-panel-head {
      flex-direction: column;
    }

    .s2-grid {
      grid-template-columns: 1fr;
    }

    .s2-meta,
    .s2-quality {
      grid-template-columns: 1fr;
    }
  }
`;
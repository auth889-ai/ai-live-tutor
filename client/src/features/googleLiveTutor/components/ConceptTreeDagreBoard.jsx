import React, { memo, useCallback, useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import dagre from "dagre";
import {
  AlertTriangle,
  BookOpen,
  Boxes,
  CheckCircle2,
  Code2,
  Database,
  GitBranch,
  Layers,
  Network,
  Route,
  SearchCheck,
  Table2,
  Workflow,
} from "lucide-react";
import "@xyflow/react/dist/style.css";

/**
 * ConceptTreeDagreBoard.jsx
 * =============================================================================
 * Real source-grounded concept tree renderer.
 *
 * What it does:
 * - Receives backend ConceptTreeAgent output.
 * - Uses React Flow + dagre to draw accurate tree shape.
 * - Shows page/source evidence on every node.
 * - Shows node type, visual hints, confidence, and quote preview.
 * - Clicking a node returns the full node to parent.
 *
 * What it does NOT do:
 * - It does not invent concepts.
 * - It does not call Gemini.
 * - It does not create fake nodes when backend gives empty tree.
 *
 * Accuracy rule:
 * Backend must provide nodes[].sourceRefs. This component displays them clearly
 * so random/unsupported nodes become visible.
 * =============================================================================
 */

const NODE_WIDTH = 270;
const NODE_HEIGHT = 128;

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

function normalizeId(value, fallback = "node") {
  return cleanText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;
}

function firstSourceRef(node) {
  return safeObject(safeArray(node?.sourceRefs)[0]);
}

function sourcePages(node) {
  const pages = safeArray(node?.sourceRefs)
    .map((ref) => Number(safeObject(ref).page))
    .filter((page) => Number.isFinite(page) && page > 0);

  return [...new Set(pages)].slice(0, 4);
}

function sourceConfidence(node) {
  const refs = safeArray(node?.sourceRefs);
  if (!refs.length) return 0;

  const values = refs
    .map((ref) => Number(safeObject(ref).confidence))
    .filter((value) => Number.isFinite(value));

  if (!values.length) return 0.7;

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function nodeKind(node) {
  const conceptType = cleanText(node?.conceptType).toLowerCase();
  const label = cleanText(node?.label).toLowerCase();
  const hints = safeArray(node?.visualHints).map((x) => cleanText(x).toLowerCase());
  const blob = `${conceptType} ${label} ${hints.join(" ")}`;

  if (blob.includes("root")) return "root";
  if (blob.includes("warning") || blob.includes("risk") || blob.includes("destructive")) return "warning";
  if (blob.includes("flow") || blob.includes("process") || blob.includes("workflow")) return "process";
  if (blob.includes("er-diagram") || blob.includes("database") || blob.includes("schema")) return "database";
  if (blob.includes("sequence")) return "sequence";
  if (blob.includes("timeline") || blob.includes("gantt")) return "timeline";
  if (blob.includes("table") || blob.includes("comparison")) return "table";
  if (blob.includes("code") || blob.includes("sql")) return "code";
  if (blob.includes("git")) return "git";
  if (blob.includes("architecture")) return "architecture";
  if (blob.includes("journey")) return "journey";
  return "topic";
}

function nodeIcon(kind) {
  if (kind === "root") return <BookOpen size={18} />;
  if (kind === "warning") return <AlertTriangle size={18} />;
  if (kind === "process") return <Workflow size={18} />;
  if (kind === "database") return <Database size={18} />;
  if (kind === "sequence") return <Route size={18} />;
  if (kind === "timeline") return <GitBranch size={18} />;
  if (kind === "table") return <Table2 size={18} />;
  if (kind === "code") return <Code2 size={18} />;
  if (kind === "git") return <GitBranch size={18} />;
  if (kind === "architecture") return <Boxes size={18} />;
  if (kind === "journey") return <Route size={18} />;
  return <Layers size={18} />;
}

function edgeTypeLabel(edge) {
  return cleanText(edge?.label || edge?.type || "contains").replace(/_/g, " ");
}

function hasEvidence(node) {
  return safeArray(node?.sourceRefs).some((ref) => {
    const r = safeObject(ref);
    return cleanText(r.chunkId) && Number(r.page) > 0;
  });
}

function buildFlowNodes(tree, selectedNodeId) {
  const nodes = safeArray(tree?.nodes);
  const dagrePositions = safeObject(safeObject(tree?.dagre).positions);

  return nodes.map((node, index) => {
    const id = normalizeId(node.nodeId || node.id || node.label, `node_${index + 1}`);
    const pos = safeObject(dagrePositions[id]);

    return {
      id,
      type: "conceptNode",
      position: {
        x: Number.isFinite(Number(pos.x)) ? Number(pos.x) : 0,
        y: Number.isFinite(Number(pos.y)) ? Number(pos.y) : 0,
      },
      data: {
        node: {
          ...node,
          nodeId: id,
          id,
        },
        selected: selectedNodeId === id,
      },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    };
  });
}

function buildFlowEdges(tree) {
  return safeArray(tree?.edges).map((edge, index) => {
    const source = normalizeId(edge.from || edge.source, "");
    const target = normalizeId(edge.to || edge.target, "");

    return {
      id: cleanText(edge.id || edge.edgeId || `edge_${source}_${target}_${index}`),
      source,
      target,
      type: "smoothstep",
      animated: cleanText(edge.type).includes("leads") || cleanText(edge.type).includes("supports"),
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color: "#b98268",
      },
      label: edgeTypeLabel(edge),
      labelStyle: {
        fill: "#8a6251",
        fontSize: 11,
        fontWeight: 700,
      },
      labelBgStyle: {
        fill: "#fff8f1",
        fillOpacity: 0.95,
      },
      style: {
        stroke: "#c9a18c",
        strokeWidth: 1.7,
      },
      data: {
        edge,
      },
    };
  });
}

function getDagreLayout(nodes, edges, direction = "TB") {
  const graph = new dagre.graphlib.Graph();

  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: direction,
    nodesep: 70,
    ranksep: 130,
    marginx: 40,
    marginy: 40,
  });

  nodes.forEach((node) => {
    graph.setNode(node.id, {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  });

  edges.forEach((edge) => {
    if (edge.source && edge.target) {
      graph.setEdge(edge.source, edge.target);
    }
  });

  dagre.layout(graph);

  return nodes.map((node) => {
    const layouted = graph.node(node.id);

    if (!layouted) return node;

    return {
      ...node,
      position: {
        x: layouted.x - NODE_WIDTH / 2,
        y: layouted.y - NODE_HEIGHT / 2,
      },
    };
  });
}

function ConceptNode({ data }) {
  const node = safeObject(data.node);
  const selected = Boolean(data.selected);
  const kind = nodeKind(node);
  const ref = firstSourceRef(node);
  const pages = sourcePages(node);
  const confidence = sourceConfidence(node);
  const evidenceOk = hasEvidence(node);

  const visualHints = safeArray(node.visualHints)
    .map((hint) => cleanText(hint))
    .filter(Boolean)
    .slice(0, 4);

  return (
    <div className={`ct-node ct-node-${kind} ${selected ? "selected" : ""} ${!evidenceOk ? "weak" : ""}`}>
      <Handle type="target" position={Position.Top} className="ct-handle" />

      <div className="ct-node-top">
        <div className="ct-node-icon">{nodeIcon(kind)}</div>
        <div className="ct-node-title-wrap">
          <div className="ct-node-title">{cleanText(node.label || node.title, "Untitled concept")}</div>
          <div className="ct-node-type">{cleanText(node.conceptType || kind, "topic")}</div>
        </div>
        {evidenceOk ? (
          <CheckCircle2 className="ct-evidence-ok" size={17} />
        ) : (
          <AlertTriangle className="ct-evidence-bad" size={17} />
        )}
      </div>

      <div className="ct-node-summary">
        {cleanText(node.summary || node.definition, "No summary from source.").slice(0, 130)}
      </div>

      <div className="ct-node-footer">
        <span className="ct-page-badge">
          {pages.length ? `p.${pages.join(", ")}` : "no page"}
        </span>
        <span className="ct-confidence">
          {Math.round(confidence * 100)}%
        </span>
      </div>

      {visualHints.length ? (
        <div className="ct-hints">
          {visualHints.map((hint) => (
            <span key={hint}>{hint}</span>
          ))}
        </div>
      ) : null}

      {ref.quote ? (
        <div className="ct-quote">
          “{cleanText(ref.quote).slice(0, 115)}”
        </div>
      ) : null}

      <Handle type="source" position={Position.Bottom} className="ct-handle" />
    </div>
  );
}

const MemoConceptNode = memo(ConceptNode);

const nodeTypes = {
  conceptNode: MemoConceptNode,
};

function TreeToolbar({
  tree,
  selectedNode,
  onFit,
  direction,
  onDirectionChange,
  sourceOnly,
  onSourceOnlyChange,
}) {
  return (
    <div className="ct-toolbar">
      <div>
        <div className="ct-kicker">Source-grounded concept tree</div>
        <h2>{cleanText(tree?.title, "Concept Tree")}</h2>
      </div>

      <div className="ct-toolbar-actions">
        <div className="ct-stat">
          <Network size={15} />
          <span>{safeArray(tree?.nodes).length} nodes</span>
        </div>
        <div className="ct-stat">
          <GitBranch size={15} />
          <span>{safeArray(tree?.edges).length} edges</span>
        </div>
        <button type="button" onClick={onFit}>Fit tree</button>
        <button type="button" onClick={() => onDirectionChange(direction === "TB" ? "LR" : "TB")}>
          {direction === "TB" ? "Vertical" : "Horizontal"}
        </button>
        <button
          type="button"
          className={sourceOnly ? "active" : ""}
          onClick={() => onSourceOnlyChange(!sourceOnly)}
        >
          Source only
        </button>
      </div>

      {selectedNode ? (
        <div className="ct-selected-strip">
          <SearchCheck size={16} />
          <span>
            Selected: <b>{cleanText(selectedNode.label || selectedNode.title)}</b>
          </span>
          <em>
            {sourcePages(selectedNode).length ? `source p.${sourcePages(selectedNode).join(", ")}` : "no source"}
          </em>
        </div>
      ) : null}
    </div>
  );
}

function TreeEvidencePanel({ selectedNode }) {
  const node = safeObject(selectedNode);
  const refs = safeArray(node.sourceRefs);

  if (!node.nodeId && !node.id) {
    return (
      <aside className="ct-evidence-panel">
        <div className="ct-kicker">Evidence</div>
        <h3>Select a node</h3>
        <p>Click any node to see its source page, quote, chunkId and diagram hints.</p>
      </aside>
    );
  }

  return (
    <aside className="ct-evidence-panel">
      <div className="ct-kicker">Selected node evidence</div>
      <h3>{cleanText(node.label || node.title, "Selected node")}</h3>

      <p>{cleanText(node.summary || node.definition, "No summary.")}</p>

      <div className="ct-evidence-section">
        <b>Diagram hints</b>
        <div className="ct-hint-list">
          {safeArray(node.visualHints).length ? (
            safeArray(node.visualHints).map((hint) => <span key={hint}>{cleanText(hint)}</span>)
          ) : (
            <span>none</span>
          )}
        </div>
      </div>

      <div className="ct-evidence-section">
        <b>Source references</b>
        {refs.length ? (
          refs.map((ref, index) => {
            const r = safeObject(ref);
            return (
              <div key={`${r.chunkId || index}`} className="ct-ref-card">
                <div>
                  <strong>Page {r.page || "?"}</strong>
                  <span>{Math.round(Number(r.confidence || 0.7) * 100)}%</span>
                </div>
                <code>{cleanText(r.chunkId || r.sourceRef, "no chunkId")}</code>
                <p>{cleanText(r.quote, "No quote").slice(0, 260)}</p>
              </div>
            );
          })
        ) : (
          <p>No sourceRefs. This node should be rejected by backend.</p>
        )}
      </div>
    </aside>
  );
}

function FlowCanvas({
  tree,
  selectedNode,
  onSelectNode,
  height,
}) {
  const reactFlow = useReactFlow();
  const [direction, setDirection] = React.useState("TB");
  const [sourceOnly, setSourceOnly] = React.useState(true);

  const selectedNodeId = normalizeId(selectedNode?.nodeId || selectedNode?.id || "", "");

  const filteredTree = useMemo(() => {
    if (!sourceOnly) return tree;

    const nodeIdsWithEvidence = new Set(
      safeArray(tree?.nodes)
        .filter(hasEvidence)
        .map((node) => normalizeId(node.nodeId || node.id || node.label, ""))
    );

    return {
      ...safeObject(tree),
      nodes: safeArray(tree?.nodes).filter((node) =>
        nodeIdsWithEvidence.has(normalizeId(node.nodeId || node.id || node.label, ""))
      ),
      edges: safeArray(tree?.edges).filter((edge) => {
        const source = normalizeId(edge.from || edge.source, "");
        const target = normalizeId(edge.to || edge.target, "");
        return nodeIdsWithEvidence.has(source) && nodeIdsWithEvidence.has(target);
      }),
    };
  }, [tree, sourceOnly]);

  const flowNodesRaw = useMemo(
    () => buildFlowNodes(filteredTree, selectedNodeId),
    [filteredTree, selectedNodeId]
  );

  const flowEdges = useMemo(
    () => buildFlowEdges(filteredTree),
    [filteredTree]
  );

  const flowNodes = useMemo(
    () => getDagreLayout(flowNodesRaw, flowEdges, direction),
    [flowNodesRaw, flowEdges, direction]
  );

  const onNodeClick = useCallback(
    (_, node) => {
      onSelectNode?.(node.data.node);
    },
    [onSelectNode]
  );

  const fitTree = useCallback(() => {
    requestAnimationFrame(() => {
      reactFlow.fitView({
        padding: 0.18,
        duration: 450,
      });
    });
  }, [reactFlow]);

  React.useEffect(() => {
    fitTree();
  }, [fitTree, direction, sourceOnly, flowNodes.length]);

  return (
    <div className="ct-board" style={{ height }}>
      <TreeToolbar
        tree={filteredTree}
        selectedNode={selectedNode}
        onFit={fitTree}
        direction={direction}
        onDirectionChange={setDirection}
        sourceOnly={sourceOnly}
        onSourceOnlyChange={setSourceOnly}
      />

      <div className="ct-flow-area">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          fitView
          minZoom={0.15}
          maxZoom={1.8}
          defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#ead2c4" gap={26} size={1} />
          <Controls position="bottom-left" />
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            nodeStrokeWidth={3}
            nodeColor={(node) => {
              const kind = nodeKind(node.data?.node);
              if (kind === "root") return "#f97356";
              if (kind === "warning") return "#f59e0b";
              if (kind === "process") return "#7fb77e";
              if (kind === "database") return "#7aa8d8";
              return "#e8c9b6";
            }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function ConceptTreeDagreBoard({
  tree,
  selectedNode,
  onSelectNode,
  height = "680px",
  showEvidencePanel = true,
}) {
  const nodes = safeArray(tree?.nodes);
  const edges = safeArray(tree?.edges);

  if (!nodes.length) {
    return (
      <div className="ct-empty">
        <style>{styles}</style>
        <Network size={34} />
        <h2>No concept tree yet</h2>
        <p>Build concept tree first. This component does not create fake nodes.</p>
      </div>
    );
  }

  return (
    <div className="ct-shell">
      <style>{styles}</style>

      <ReactFlowProvider>
        <div className={showEvidencePanel ? "ct-layout with-panel" : "ct-layout"}>
          <FlowCanvas
            tree={{ ...safeObject(tree), nodes, edges }}
            selectedNode={selectedNode}
            onSelectNode={onSelectNode}
            height={height}
          />

          {showEvidencePanel ? <TreeEvidencePanel selectedNode={selectedNode} /> : null}
        </div>
      </ReactFlowProvider>
    </div>
  );
}

const styles = `
  .ct-shell {
    width: 100%;
    color: #3d322b;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .ct-shell * {
    box-sizing: border-box;
  }

  .ct-layout {
    width: 100%;
  }

  .ct-layout.with-panel {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 330px;
    gap: 14px;
    align-items: stretch;
  }

  .ct-board,
  .ct-evidence-panel,
  .ct-empty {
    border: 1px solid #f0dfd2;
    background:
      radial-gradient(circle at 12% 8%, rgba(255, 202, 172, .22), transparent 32%),
      #fffdf9;
    border-radius: 22px;
    box-shadow: 0 12px 36px rgba(103, 64, 38, .07);
    overflow: hidden;
  }

  .ct-board {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 520px;
  }

  .ct-toolbar {
    padding: 16px 18px;
    border-bottom: 1px solid #f0dfd2;
    background: rgba(255, 250, 245, .92);
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 12px;
    align-items: center;
  }

  .ct-kicker {
    color: #fb6b4b;
    font-weight: 950;
    text-transform: uppercase;
    letter-spacing: .16em;
    font-size: 11px;
    margin-bottom: 4px;
  }

  .ct-toolbar h2,
  .ct-evidence-panel h3,
  .ct-empty h2 {
    margin: 0;
    letter-spacing: -.035em;
  }

  .ct-toolbar-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: flex-end;
    align-items: center;
  }

  .ct-stat {
    height: 34px;
    border: 1px solid #f0d0bf;
    background: #fff8f1;
    border-radius: 999px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 850;
    color: #8a6251;
  }

  .ct-toolbar button {
    height: 34px;
    border: 1px solid #f0b9a5;
    background: #fffaf5;
    color: #8c3b27;
    border-radius: 999px;
    padding: 0 12px;
    font-weight: 900;
    cursor: pointer;
  }

  .ct-toolbar button.active {
    background: #fb7b5c;
    color: white;
    border-color: #fb7b5c;
  }

  .ct-selected-strip {
    grid-column: 1 / -1;
    border: 1px solid #cbe8c9;
    background: #f2fff1;
    color: #2d7d3f;
    border-radius: 14px;
    padding: 9px 12px;
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 13px;
  }

  .ct-selected-strip em {
    margin-left: auto;
    font-style: normal;
    color: #4a8a55;
  }

  .ct-flow-area {
    min-height: 0;
    background: #fff8f1;
  }

  .ct-node {
    width: ${NODE_WIDTH}px;
    min-height: ${NODE_HEIGHT}px;
    border: 1px solid #ead0bf;
    background: rgba(255, 253, 249, .96);
    border-radius: 18px;
    padding: 12px;
    box-shadow: 0 14px 30px rgba(103, 64, 38, .10);
    transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
    color: #3d322b;
  }

  .ct-node:hover {
    transform: translateY(-2px);
    box-shadow: 0 18px 42px rgba(103, 64, 38, .16);
  }

  .ct-node.selected {
    border-color: #fb6b4b;
    box-shadow: 0 0 0 4px rgba(251, 107, 75, .16), 0 18px 42px rgba(103, 64, 38, .16);
  }

  .ct-node.weak {
    border-style: dashed;
    opacity: .86;
  }

  .ct-node-root {
    border-color: #fb7b5c;
    background: #fff1ea;
  }

  .ct-node-warning {
    border-color: #f59e0b;
    background: #fff8ea;
  }

  .ct-node-process {
    border-color: #9fcf9f;
    background: #fbfff8;
  }

  .ct-node-database {
    border-color: #9dc9ee;
    background: #f7fbff;
  }

  .ct-node-code {
    border-color: #d8b4fe;
    background: #fdf8ff;
  }

  .ct-node-top {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) 20px;
    gap: 9px;
    align-items: center;
  }

  .ct-node-icon {
    width: 32px;
    height: 32px;
    border-radius: 10px;
    background: #fff1ea;
    display: grid;
    place-items: center;
    color: #fb6b4b;
  }

  .ct-node-title-wrap {
    min-width: 0;
  }

  .ct-node-title {
    font-weight: 950;
    font-size: 14px;
    line-height: 1.18;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ct-node-type {
    color: #8a7266;
    font-size: 11px;
    margin-top: 2px;
    text-transform: uppercase;
    letter-spacing: .08em;
  }

  .ct-evidence-ok {
    color: #2f9b52;
  }

  .ct-evidence-bad {
    color: #d97706;
  }

  .ct-node-summary {
    margin-top: 9px;
    color: #5d5048;
    font-size: 12px;
    line-height: 1.42;
    height: 34px;
    overflow: hidden;
  }

  .ct-node-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 7px;
    margin-top: 9px;
  }

  .ct-page-badge,
  .ct-confidence {
    border-radius: 999px;
    padding: 4px 8px;
    font-size: 11px;
    font-weight: 900;
  }

  .ct-page-badge {
    background: #fff1e8;
    color: #9d452d;
  }

  .ct-confidence {
    background: #effbee;
    color: #2f7a42;
  }

  .ct-hints {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
    margin-top: 8px;
  }

  .ct-hints span,
  .ct-hint-list span {
    border: 1px solid #ecd2c2;
    background: #fff8f1;
    color: #8a6251;
    border-radius: 999px;
    padding: 4px 7px;
    font-size: 10px;
    font-weight: 850;
  }

  .ct-quote {
    margin-top: 8px;
    border-left: 3px solid #fb9b7e;
    padding-left: 8px;
    color: #87513d;
    font-size: 11px;
    line-height: 1.32;
    max-height: 43px;
    overflow: hidden;
  }

  .ct-handle {
    width: 9px;
    height: 9px;
    background: #fb7b5c;
    border: 2px solid #fff;
  }

  .ct-evidence-panel {
    padding: 16px;
    height: 100%;
    overflow: auto;
  }

  .ct-evidence-panel h3 {
    font-size: 20px;
    margin-bottom: 8px;
  }

  .ct-evidence-panel p {
    color: #5d5048;
    line-height: 1.55;
    font-size: 13px;
  }

  .ct-evidence-section {
    margin-top: 16px;
  }

  .ct-evidence-section > b {
    display: block;
    color: #8c3b27;
    margin-bottom: 8px;
  }

  .ct-hint-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .ct-ref-card {
    border: 1px solid #efd5c6;
    background: #fff8f1;
    border-radius: 14px;
    padding: 11px;
    margin-bottom: 9px;
  }

  .ct-ref-card div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: #8c3b27;
    margin-bottom: 5px;
  }

  .ct-ref-card code {
    display: block;
    color: #6f5e54;
    font-size: 11px;
    overflow-wrap: anywhere;
    margin-bottom: 7px;
  }

  .ct-ref-card p {
    margin: 0;
    color: #4a4039;
    font-size: 12px;
  }

  .ct-empty {
    min-height: 360px;
    display: grid;
    place-items: center;
    text-align: center;
    padding: 40px;
    color: #8a6251;
  }

  .ct-empty svg {
    color: #fb6b4b;
  }

  .react-flow__edge-textbg {
    fill: #fff8f1;
  }

  .react-flow__controls {
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 12px 28px rgba(103, 64, 38, .12);
  }

  .react-flow__minimap {
    border-radius: 16px;
    overflow: hidden;
    border: 1px solid #ead0bf;
  }

  @media (max-width: 1050px) {
    .ct-layout.with-panel {
      grid-template-columns: 1fr;
    }

    .ct-evidence-panel {
      min-height: 300px;
    }

    .ct-toolbar {
      grid-template-columns: 1fr;
    }

    .ct-toolbar-actions {
      justify-content: flex-start;
    }
  }
`;
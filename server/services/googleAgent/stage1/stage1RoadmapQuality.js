"use strict";

function assignReadOrder(nodes, edges) {
  const children = new Map();
  for (const e of edges) {
    if (!children.has(e.from)) children.set(e.from, []);
    children.get(e.from).push(e.to);
  }
  const root  = nodes.find((n) => !n.parentNodeId) || nodes[0];
  const order = [];
  const queue = root ? [root.nodeId] : [];
  const seen  = new Set();

  while (queue.length) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const child of (children.get(id) || [])) queue.push(child);
  }

  const orderMap = new Map(order.map((id, i) => [id, i + 1]));
  return nodes.map((n) => ({ ...n, readOrder: orderMap.get(n.nodeId) || 999 }));
}

function assignRelations(nodes, edges) {
  const prereqMap = new Map();
  const nextMap   = new Map();

  for (const e of edges) {
    if (e.type === "prerequisite") {
      if (!prereqMap.has(e.to)) prereqMap.set(e.to, []);
      prereqMap.get(e.to).push(e.from);
    }
    if (!nextMap.has(e.from)) nextMap.set(e.from, []);
    nextMap.get(e.from).push(e.to);
  }

  return nodes.map((n) => ({
    ...n,
    prerequisiteNodeIds: prereqMap.get(n.nodeId) || [],
    nextNodeIds:         (nextMap.get(n.nodeId) || []).slice(0, 5),
  }));
}

function checkCoverage(nodes, totalPages) {
  const coveredPages = new Set(nodes.flatMap((n) => n.pageRefs || []));
  const sourcedNodes = nodes.filter((n) => (n.sourceRefs || []).length > 0);
  return {
    totalNodes:     nodes.length,
    sourcedNodes:   sourcedNodes.length,
    coveredPages:   coveredPages.size,
    totalPages:     totalPages || coveredPages.size,
    coverageScore:  totalPages ? Math.round((coveredPages.size / totalPages) * 100) : 100,
    unsourcedNodes: nodes.filter((n) => !(n.sourceRefs || []).length).map((n) => n.nodeId),
  };
}

function repairSubNodes(nodes, edges) {
  const processNodes = nodes.filter((n) => n.nodeType === "process");
  const childMap     = new Map(edges.filter((e) => e.type === "parent-child").map((e) => [e.from, true]));

  const warnings = [];
  for (const n of processNodes) {
    if (!childMap.has(n.nodeId)) {
      warnings.push(`Process node "${n.title}" has no step children — add sub-nodes from PDF steps.`);
    }
  }
  return warnings;
}

module.exports = { assignReadOrder, assignRelations, checkCoverage, repairSubNodes };

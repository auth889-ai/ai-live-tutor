// VENDORED from brpapa/recursion-tree-visualizer (MIT) — lambda/src/runner/steps/
// intermediate-tree.ts, the Reingold-Tilford tree layout. Direct port: TypeScript types
// stripped, comments translated, logic and traversal order UNCHANGED. See SOURCE.md.

/**
 * From the recursion tree, determine the best (x,y) coordinate of each vertex using
 * Reingold-Tilford's algorithm.
 *
 * @param {import('./types.js').InitialTree} recursionTree
 * @returns {import('./types.js').IntermediateTree}
 */
export function toIntermediateTree(recursionTree) {
  const rawCoords = {}; // rawCoords[u]: coordinate of vertex u
  const rawBottomRight = [0, 0];
  const rootId = 0;

  if (Object.keys(recursionTree.vertices).length > 0) {
    const root = {
      id: rootId,
      parent: null,
      children: [],
      x: 0,
      y: 0,
      mod: 0, // modifier, pending value to add to the x of all children of this node (not itself)
      thread: undefined, // points to the next node of the contour
    };

    initNodes(root); // builds the root object from the adjList
    firstTraversal(root); // post-order traversal
    lastTraversal(root); // pre-order traversal
  }

  return { tree: recursionTree, coords: rawCoords, bottomRight: rawBottomRight };

  function initNodes(node, nodeId = rootId, nodeDepth = 0) {
    if (recursionTree.vertices[nodeId]?.adjList === undefined) return;

    // for each child of node
    for (const { childId } of recursionTree.vertices[nodeId].adjList) {
      const child = {
        id: childId,
        parent: node,
        x: 0,
        y: nodeDepth + 1,
        mod: 0,
        children: [],
      };
      node.children.push(child);
      initNodes(child, childId, nodeDepth + 1);
    }
  }

  function firstTraversal(node) {
    if (node.children.length === 0) return node;
    if (node.children.length === 1) {
      node.x = firstTraversal(node.children[0]).x;
      return node;
    }

    // for each pair of child subtrees leftChild and rightChild
    const [firstChild, ...children] = node.children;
    let leftChild = firstTraversal(firstChild);

    for (const child of children) {
      const rightChild = firstTraversal(child);

      // post-order traversal below
      shiftRightSubtree(leftChild, rightChild);
      leftChild = rightChild;
    }

    node.x = centralX(node.children);
    return node;
  }

  /** Shifts the whole subtree rooted at right as close as possible to the subtree rooted at left without any conflict */
  function shiftRightSubtree(left, right) {
    let { li, ri, lo, ro, diff, leftOffset, rightOffset } = contour(left, right);

    // shift right
    right.x += diff;
    right.mod += diff;

    if (right.children.length > 0) rightOffset += diff;

    // if the left and right subtrees have different heights
    if (ri && !li) {
      lo.thread = ri; // set the thread lo -> ri
      lo.mod = rightOffset - leftOffset;
    } else if (li && !ri) {
      ro.thread = li; // set the thread ro -> li
      ro.mod = leftOffset - rightOffset;
      ro.mod += li.parent?.mod || 0; // preserve the mod li had from its parent onto ro's mod
    }
  }

  /** Returns the contours of the left and right subtrees */
  function contour(left, right, leftOuter, rightOuter, maxDiff, leftOffset = 0, rightOffset = 0) {
    const currDiff = left.x + leftOffset - (right.x + rightOffset) + 1;
    maxDiff = Math.max(maxDiff || currDiff, currDiff);

    const li = nextRight(left); // left inner
    const ri = nextLeft(right); // right inner
    let lo = nextLeft(leftOuter || left); // left outer
    let ro = nextRight(rightOuter || right); // right outer

    if (li && ri) {
      leftOffset += left.mod;
      rightOffset += right.mod;
      return contour(li, ri, lo, ro, maxDiff, leftOffset, rightOffset);
    }

    lo = leftOuter || left;
    ro = rightOuter || right;
    return { li, ri, lo, ro, diff: maxDiff, leftOffset, rightOffset };
  }

  /** Updates the real x of the nodes */
  function lastTraversal(node, accMod = 0) {
    node.x += accMod;

    rawCoords[node.id] = [node.x, node.y];
    rawBottomRight[0] = Math.max(rawBottomRight[0], node.x);
    rawBottomRight[1] = Math.max(rawBottomRight[1], node.y);

    for (const child of node.children) lastTraversal(child, accMod + node.mod);
  }
}

/** returns the next node after node on the contour */
function nextRight(node) {
  return node.thread || node.children[node.children.length - 1] || null;
}
function nextLeft(node) {
  return node.thread || node.children[0] || null;
}

/** returns the central x of nodes */
function centralX(nodes) {
  const { length } = nodes;

  return length % 2 === 0
    ? (nodes[0].x + nodes[length - 1].x) / 2
    : nodes[(length - 1) / 2].x;
}

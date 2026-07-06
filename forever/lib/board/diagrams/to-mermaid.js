// Convert a structured diagram spec into Mermaid syntax (pure, testable). Mermaid then
// auto-lays-out a READABLE diagram — no more hand-positioned overlapping SVG. Comparison
// tables are NOT mermaid (they render as an HTML table); this handles flowchart/cycle/tree.

export function toMermaid(content) {
  switch (content.diagramType) {
    case 'flowchart':
      return flowchart(content.steps ?? [], false);
    case 'cycle':
      return flowchart(content.steps ?? [], true);
    case 'tree':
      return tree(content.root);
    default:
      throw new Error(`toMermaid: ${content.diagramType} is not a mermaid diagram (comparison renders as HTML table)`);
  }
}

function flowchart(steps, isCycle) {
  if (!steps.length) throw new Error('flowchart/cycle needs steps');
  const lines = ['flowchart LR'];
  steps.forEach((step, i) => {
    lines.push(`  n${i}["${escape(step)}"]`);
    if (i > 0) lines.push(`  n${i - 1} --> n${i}`);
  });
  if (isCycle && steps.length > 1) lines.push(`  n${steps.length - 1} --> n0`);
  return lines.join('\n');
}

function tree(root) {
  if (!root) throw new Error('tree needs a root');
  const lines = ['flowchart TD', `  root["${escape(root.label)}"]`];
  (root.children ?? []).forEach((child, i) => {
    lines.push(`  c${i}["${escape(child.label)}"]`);
    lines.push(`  root --> c${i}`);
    if (child.children?.length) {
      child.children.forEach((gc, j) => {
        lines.push(`  c${i}_${j}["${escape(gc.label)}"]`);
        lines.push(`  c${i} --> c${i}_${j}`);
      });
    }
  });
  return lines.join('\n');
}

// Mermaid label escaping: quotes wrap the label; escape embedded quotes and strip
// characters that break the parser.
function escape(text) {
  return String(text)
    .replace(/"/g, "'")
    .replace(/[\n\r]+/g, ' ')
    .replace(/[[\]{}|]/g, '')
    .slice(0, 120)
    .trim();
}

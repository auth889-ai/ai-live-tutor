export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function pct(value, max) {
  if (!max) return 0;
  return Math.max(0, Math.min(1, value / max));
}

export function activeIn(action, currentMs) {
  return currentMs >= action.startMs && currentMs <= action.endMs;
}

export function started(action, currentMs) {
  return currentMs >= action.startMs;
}


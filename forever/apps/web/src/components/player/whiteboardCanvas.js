import { activeIn, pct, started } from "../../lib/dom.js";

export function renderWhiteboard(container, manifest, currentMs) {
  const boardObjects = manifest.objects.filter((item) => item.regionId === "board");
  const activeActions = manifest.actions.filter((action) => activeIn(action, currentMs));
  const startedActions = manifest.actions.filter((action) => started(action, currentMs));
  const visibleIds = new Set(startedActions.map((action) => action.objectId).filter(Boolean));
  const underline = startedActions.find((action) => action.type === "underline");

  container.innerHTML = `
    <div class="board-grid">
      <div class="board-heading">Pattern intuition</div>
      ${boardObjects.map((object) => renderBoardObject(object, visibleIds, manifest.actions, currentMs)).join("")}
      ${underline ? renderUnderline(underline, boardObjects, currentMs) : ""}
      ${renderPointer(activeActions, boardObjects)}
    </div>
  `;
}

function renderBoardObject(object, visibleIds, actions, currentMs) {
  const action = actions.find((item) => item.objectId === object.objectId);
  if (!visibleIds.has(object.objectId) && currentMs < action?.startMs) return "";
  const text = object.content.text || "";
  const progress = action ? pct(currentMs - action.startMs, action.endMs - action.startMs) : 1;
  const revealCount = Math.ceil(text.length * progress);
  const visibleText = text.slice(0, revealCount);

  return `
    <div class="board-text" style="left:${object.x}px; top:${object.y}px; font-size:${object.style.size}px; color:${object.style.color}">
      ${escapeHtml(visibleText)}
    </div>
  `;
}

function renderUnderline(action, objects, currentMs) {
  const target = objects.find((object) => object.objectId === action.targetObjectId);
  if (!target) return "";
  const width = Math.floor(330 * pct(currentMs - action.startMs, action.endMs - action.startMs));
  return `<div class="board-underline" style="left:${target.x}px; top:${target.y + 42}px; width:${width}px"></div>`;
}

function renderPointer(activeActions, objects) {
  const write = activeActions.find((action) => action.objectId);
  const target = write ? objects.find((object) => object.objectId === write.objectId) : objects[0];
  if (!target) return "";
  return `<div class="pointer-dot" style="left:${target.x + 12}px; top:${target.y - 12}px"></div>`;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

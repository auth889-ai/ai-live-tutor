import { started } from "../../lib/dom.js";

export function renderMediaPanel(container, manifest, regionId, currentMs) {
  const object = manifest.objects.find((item) => item.regionId === regionId);
  if (!object) return;
  const action = manifest.actions.find((item) => item.objectId === object.objectId);
  const visible = action ? started(action, currentMs) : true;

  container.innerHTML = `
    <div class="panel-title">${titleFor(regionId)}</div>
    <div class="${visible ? "panel-body is-visible" : "panel-body"}">
      ${renderObject(object, currentMs)}
    </div>
  `;
}

function renderObject(object, currentMs) {
  if (object.type === "code") return renderCode(object, currentMs);
  if (object.type === "table") return renderTable(object);
  if (object.type === "output") return renderOutput(object);
  return "";
}

function renderCode(object, currentMs) {
  return `<pre class="code-block">${object.content.lines.map((line, index) => {
    const active = currentMs > 25270 + index * 450 && currentMs < 29200;
    return `<code class="${active ? "active-line" : ""}"><span>${String(index + 1).padStart(2, " ")}</span>${escapeHtml(line)}</code>`;
  }).join("")}</pre>`;
}

function renderTable(object) {
  return `
    <table class="trace-table">
      <thead><tr>${object.content.headers.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead>
      <tbody>${object.content.rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
  `;
}

function renderOutput(object) {
  return `<pre class="output-block">${object.content.lines.map((line) => `<span>${line}</span>`).join("")}</pre>`;
}

function titleFor(regionId) {
  if (regionId === "code") return "Code";
  if (regionId === "trace") return "Dry Run";
  if (regionId === "output") return "Output";
  return regionId;
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

import { el } from "../../lib/dom.js";

export function renderSourceProof(sourceEvidence) {
  const panel = el("aside", "source-proof");
  panel.innerHTML = `
    <div class="proof-title">Source Proof</div>
    ${sourceEvidence.map((source) => `
      <div class="proof-item">
        <div class="proof-ref">${source.sourceRef}</div>
        <p>${escapeHtml(source.quote)}</p>
      </div>
    `).join("")}
  `;
  return panel;
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

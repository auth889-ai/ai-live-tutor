export function renderSubtitles(container, manifest, currentMs) {
  const activeLine = manifest.voiceLines.find((line) => currentMs >= line.startMs && currentMs <= line.endMs);
  if (!activeLine) {
    container.innerHTML = `<div class="subtitle-empty">Ready</div>`;
    return;
  }

  const words = manifest.subtitles.filter((word) => word.beatId === activeLine.beatId);
  container.innerHTML = `
    <div class="subtitle-line">
      ${words.map((word) => {
        const active = currentMs >= word.startMs && currentMs <= word.endMs;
        const past = currentMs > word.endMs;
        return `<span class="${active ? "active-word" : past ? "past-word" : ""}">${escapeHtml(word.word)}</span>`;
      }).join(" ")}
    </div>
  `;
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


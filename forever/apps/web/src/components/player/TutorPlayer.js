import { AudioClock } from "../../lib/AudioClock.js";
import { el } from "../../lib/dom.js";
import { renderMediaPanel } from "./mediaPanel.js";
import { renderSourceProof } from "./sourceProofPanel.js";
import { renderSubtitles } from "./subtitleBar.js";
import { renderWhiteboard } from "./whiteboardCanvas.js";

export function createTutorPlayer(manifest) {
  const clock = new AudioClock();
  const root = el("section", "tutor-player");
  const viewport = el("div", "lesson-viewport");
  const teacher = renderTeacherPresence();
  const board = el("div", "board-region");
  const code = el("div", "code-region");
  const trace = el("div", "trace-region");
  const output = el("div", "output-region");
  const subtitles = el("div", "subtitle-region");
  const proof = renderSourceProof(manifest.sourceEvidence);
  const controls = renderControls(clock, manifest.durationMs);

  viewport.append(teacher, board, code, trace, output, subtitles, proof);
  root.append(viewport, controls);

  clock.subscribe((currentMs) => {
    if (currentMs >= manifest.durationMs) clock.pause();
    renderWhiteboard(board, manifest, currentMs);
    renderMediaPanel(code, manifest, "code", currentMs);
    renderMediaPanel(trace, manifest, "trace", currentMs);
    renderMediaPanel(output, manifest, "output", currentMs);
    renderSubtitles(subtitles, manifest, currentMs);
    controls.update(currentMs);
  });

  return root;
}

function renderTeacherPresence() {
  const panel = el("aside", "teacher-region");
  const face = el("div", "teacher-face");
  const eyes = el("div", "teacher-eyes");
  const hoodie = el("div", "teacher-hoodie");
  const label = el("div", "teacher-label", "Forever Tutor");
  eyes.append(el("span"), el("span"));
  face.append(eyes);
  panel.append(face, hoodie, label);
  return panel;
}

function renderControls(clock, durationMs) {
  const controls = el("div", "player-controls");
  const play = el("button", "control-button", "Play");
  const pause = el("button", "control-button", "Pause");
  const time = el("span", "time-readout", "0:00");
  const range = document.createElement("input");
  range.type = "range";
  range.min = "0";
  range.max = String(durationMs);
  range.value = "0";
  range.className = "timeline-range";

  play.addEventListener("click", () => clock.play());
  pause.addEventListener("click", () => clock.pause());
  range.addEventListener("input", () => clock.seek(Number(range.value)));

  controls.update = (currentMs) => {
    range.value = String(Math.min(currentMs, durationMs));
    time.textContent = formatTime(currentMs);
  };

  controls.append(play, pause, range, time);
  return controls;
}

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const min = Math.floor(total / 60);
  const sec = String(total % 60).padStart(2, "0");
  return `${min}:${sec}`;
}

import { demoCourse } from "../../data/demoCourse.js";
import { demoManifest } from "../../data/demoManifest.js";
import { startCourse } from "../../lib/apiClient.js";
import { el } from "../../lib/dom.js";
import { createTutorPlayer } from "../player/TutorPlayer.js";

const SAMPLE_INPUT = `Patterns teach nested loops. The outer loop counts the number of rows or lines. The inner loop focuses on the columns and connects them to the current row. Whatever we print, like stars, numbers, or characters, is printed inside the inner loop. After each row, we move to a new line. For a triangle pattern, row zero prints one star, row one prints two stars, and row two prints three stars.`;

export function createCourseShell() {
  const root = el("section", "course-shell");
  const sidebar = renderCourseSidebar(demoCourse);
  const main = el("section", "course-main");
  const header = renderCourseHeader(demoCourse);
  const builder = renderBuilderPanel();
  const status = el("div", "studio-status", "Episode 3 ready. Generate with Qwen or play the saved demo lecture.");
  const playerSlot = el("div", "player-slot");
  const timeline = renderSceneTimeline(demoCourse.timeline);
  const notebookNotice = el("div", "notebook-notice", "All notes are saved automatically in My Notebook");

  playerSlot.append(createTutorPlayer(demoManifest));
  main.append(header, builder.element, status, playerSlot, timeline, notebookNotice);
  root.append(sidebar, main);

  builder.onGenerate(async (options) => {
    status.textContent = options.useQwen ? "Calling Qwen Cloud and compiling one tutor scene..." : "Generating deterministic tutor scene...";
    try {
      const result = await startCourse(options);
      playerSlot.replaceChildren(createTutorPlayer(result.manifest));
      status.textContent = `${result.title} ready. Mode: ${result.generationMode}. Qwen used: ${result.qwenUsed ? "yes" : "no"}.`;
    } catch (error) {
      playerSlot.replaceChildren(createTutorPlayer(demoManifest));
      status.textContent = `API unavailable or generation failed. Showing local demo fallback. ${error.message}`;
    }
  });

  return root;
}

function renderCourseSidebar(course) {
  const element = el("aside", "course-sidebar");
  element.innerHTML = `
    <div class="course-brand">
      <div class="brand-mark">F</div>
      <div><strong>Forever</strong><span>AI Tutor</span></div>
    </div>
    <div class="course-progress-card">
      <strong>${escapeHtml(course.subject)}</strong>
      <span>Episode ${course.currentEpisode} of ${course.totalEpisodes}</span>
      <div class="progress-row"><div><span style="width: ${course.progressPercent}%"></span></div><b>${course.progressPercent}%</b></div>
    </div>
    <div class="episodes-block">
      <div class="sidebar-heading">Episodes</div>
      ${renderEpisodeList(course.episodes)}
    </div>
    <div class="tools-block">
      <div class="sidebar-heading">Tools</div>
      <div class="tool-grid">
        <span>My Notebook</span><span>Quizzes</span><span>Bookmarks</span><span>Downloads</span>
      </div>
    </div>
    <div class="streak-card">
      <strong>Learning Streak</strong>
      <span>12 days in a row</span>
      <div class="streak-dots"><i></i><i></i><i></i><i></i><i></i><i></i><i class="muted"></i></div>
      <button>View Progress</button>
    </div>
  `;
  return element;
}

function renderEpisodeList(episodes) {
  return episodes.map(({ number, title, duration, state }) => `
    <div class="episode-item ${state}">
      <span>${number}</span>
      <div><strong>${escapeHtml(title)}</strong>${duration ? `<small>${duration}</small>` : ""}</div>
      <b>${state === "done" ? "✓" : state === "active" ? "▶" : "⌕"}</b>
    </div>
  `).join("");
}

function renderCourseHeader(course) {
  const header = el("header", "course-header");
  header.innerHTML = `
    <div>
      <h1>${escapeHtml(course.title)}</h1>
      <p>${escapeHtml(course.episodeLabel)} <span>•</span> ${escapeHtml(course.lessonLabel)}</p>
    </div>
    <div class="header-actions">
      <button class="soft-button">Save Notebook</button>
      <button class="accent-button">Export PDF</button>
      <button class="icon-button">☼</button>
      <button class="icon-button">♡</button>
    </div>
  `;
  return header;
}

function renderBuilderPanel() {
  const element = el("section", "builder-panel");
  const inputLabel = el("label", "field-label", "Learning Material");
  const text = document.createElement("textarea");
  text.className = "source-input";
  text.value = SAMPLE_INPUT;

  const controls = el("div", "studio-form-grid");
  const inputType = selectField("Input", ["topic", "transcript", "code", "pdf_text"]);
  const level = selectField("Level", ["beginner", "intermediate", "advanced"]);
  const qwen = checkboxField("Use Qwen Cloud", true);
  controls.append(inputType.wrap, level.wrap, qwen.wrap);

  const generate = el("button", "primary-action", "Generate Tutor Scene");
  const fallback = el("button", "secondary-action", "Use Local Demo");

  const intro = el("div", "builder-intro");
  intro.innerHTML = `<strong>Course Builder</strong><span>Paste material, then Qwen creates the next tutor scene.</span>`;

  element.append(intro, inputLabel, text, controls, generate, fallback);

  let handler = () => {};
  generate.addEventListener("click", () => handler(readOptions(text, inputType.input, level.input, qwen.input)));
  fallback.addEventListener("click", () => {
    qwen.input.checked = false;
    handler(readOptions(text, inputType.input, level.input, qwen.input));
  });

  return {
    element,
    onGenerate(next) {
      handler = next;
    }
  };
}

function renderSceneTimeline(scenes) {
  const timeline = el("section", "scene-timeline");
  timeline.innerHTML = `
    <div class="timeline-tabs"><b>Timeline</b><span>Notebook Pages</span><span>Bookmarks</span></div>
    <div class="timeline-cards">
      ${scenes.map(({ number, title, timeRange, thumbnailType, active }) => `
        <div class="timeline-card ${active ? "active" : ""}">
          <div class="timeline-thumb ${thumbnailType}"></div>
          <div><strong>${number}. ${escapeHtml(title)}</strong><span>${escapeHtml(timeRange)}</span></div>
        </div>
      `).join("")}
    </div>
  `;
  return timeline;
}

function readOptions(text, inputType, learnerLevel, useQwen) {
  return {
    text: text.value.trim() || SAMPLE_INPUT,
    inputType: inputType.value,
    learnerLevel: learnerLevel.value,
    targetMinutes: 8,
    useQwen: useQwen.checked
  };
}

function selectField(label, options) {
  const wrap = el("label", "select-field");
  const span = el("span", "", label);
  const input = document.createElement("select");
  for (const option of options) {
    const item = document.createElement("option");
    item.value = option;
    item.textContent = option;
    input.append(item);
  }
  wrap.append(span, input);
  return { wrap, input };
}

function checkboxField(label, checked) {
  const wrap = el("label", "checkbox-field");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  wrap.append(input, el("span", "", label));
  return { wrap, input };
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

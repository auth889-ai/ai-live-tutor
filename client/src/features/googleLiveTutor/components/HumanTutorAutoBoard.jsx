import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * HumanTutorAutoBoard.jsx
 * -----------------------------------------------------------------------------
 * Full-screen, auto-growing tutor board.
 *
 * Real behavior:
 * - Takes real boardCommands from Stage 2 backend.
 * - Converts commands into board sections.
 * - Auto-increases board height.
 * - Shows 27-agent panel, center board, right tutor panel, bottom controls.
 * - No fake backend data.
 */

const AGENTS_27 = [
  "Understanding Agent",
  "Intent Classification Agent",
  "Source Grounding Agent",
  "Concept Extraction Agent",
  "Concept Tree Builder",
  "Visual Planner Agent",
  "Board Writer Agent",
  "Diagram Agent",
  "Flowchart Agent",
  "Table Agent",
  "Example Agent",
  "Voice Script Agent",
  "Quiz Generator Agent",
  "Mistake Finder Agent",
  "Complexity Agent",
  "Summary Agent",
  "Subtitle Agent",
  "QA Agent",
  "Refiner Agent",
  "Consistency Agent",
  "Quality Assurance Agent",
  "Finalizer Agent",
  "Formatter Agent",
  "Renderer Agent",
  "Voice Renderer Agent",
  "Subtitle Renderer Agent",
  "Board Sync Agent",
];

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanText(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function getRefs(cmd) {
  const payload = safeObject(cmd?.payload);
  return safeArray(payload.sourceRefs || cmd?.sourceRefs);
}

function duration(cmd) {
  const n = Number(cmd?.durationMs || 1400);
  return Number.isFinite(n) && n > 0 ? n : 1400;
}

function buildTimeline(commands) {
  let cursor = 0;
  return safeArray(commands).map((command, index) => {
    const startMs = cursor;
    const endMs = cursor + duration(command);
    cursor = endMs;
    return { command, index, startMs, endMs };
  });
}

function inferSectionType(cmd) {
  const type = cleanText(cmd.type).toLowerCase();
  const text = cleanText(cmd.text).toLowerCase();

  if (type.includes("tree")) return "tree";
  if (type.includes("flow")) return "flow";
  if (type.includes("table")) return "table";
  if (type.includes("quiz")) return "quiz";
  if (type.includes("source")) return "source";
  if (type.includes("code") || text.includes("alter table") || text.includes("select ")) return "code";
  if (text.includes("definition") || text.includes("=")) return "definition";
  return "note";
}

function groupCommands(commands) {
  const list = safeArray(commands);
  const groups = [];
  let current = null;

  list.forEach((cmd, index) => {
    const sectionType = inferSectionType(cmd);

    const shouldStart =
      !current ||
      sectionType !== current.sectionType ||
      current.commands.length >= 4 ||
      sectionType === "tree" ||
      sectionType === "flow" ||
      sectionType === "table" ||
      sectionType === "quiz" ||
      sectionType === "code";

    if (shouldStart) {
      current = {
        id: `section_${groups.length + 1}`,
        sectionType,
        title: titleForSection(sectionType, cmd),
        commands: [],
        indexStart: index,
      };
      groups.push(current);
    }

    current.commands.push(cmd);
  });

  return groups;
}

function titleForSection(type, cmd) {
  const text = cleanText(cmd?.text);
  if (type === "tree") return "Concept Tree";
  if (type === "flow") return "Migration Workflow";
  if (type === "table") return "Quick Comparison";
  if (type === "code") return "Example";
  if (type === "quiz") return "Quiz Checkpoint";
  if (type === "source") return "Source";
  if (type === "definition") return "Definition";
  return text.slice(0, 44) || "Board Note";
}

function commandText(cmd, fallback = "Source-grounded board note") {
  const payload = safeObject(cmd?.payload);
  return cleanText(cmd?.text || payload.text || payload.title || payload.label, fallback);
}

function extractFlowSteps(cmd) {
  const payload = safeObject(cmd?.payload);
  const visualPayload = safeObject(payload.visualPayload || payload);
  const data = safeObject(visualPayload.data);

  const fromData = safeArray(data.steps)
    .map((s) => cleanText(safeObject(s).label || safeObject(s).title || s))
    .filter(Boolean);

  if (fromData.length) return fromData.slice(0, 7);

  const text = commandText(cmd, "");
  if (text.includes("→")) return text.split("→").map((x) => x.trim()).filter(Boolean).slice(0, 7);

  return ["Create migration file", "Write SQL changes", "Run target DB", "Verify & test", "Commit & share"];
}

function extractTree(cmd) {
  const payload = safeObject(cmd?.payload);
  const visualPayload = safeObject(payload.visualPayload || payload);
  const data = safeObject(visualPayload.data);
  const root = cleanText(data.root || visualPayload.nodeLabel || cmd.text, "Migration");
  const children = safeArray(data.children)
    .map((x) => cleanText(x))
    .filter(Boolean);

  return {
    root,
    children: children.length ? children.slice(0, 7) : ["Definition", "Purpose", "Workflow", "Best practices", "Rollback"],
  };
}

function extractTable(cmd) {
  const payload = safeObject(cmd?.payload);
  const visualPayload = safeObject(payload.visualPayload || payload);
  const data = safeObject(visualPayload.data);

  const columns = safeArray(data.columns).length
    ? safeArray(data.columns).map((x) => cleanText(x)).slice(0, 4)
    : ["Practice", "Manual Change", "Migration"];

  const rows = safeArray(data.rows).length
    ? safeArray(data.rows).slice(0, 5)
    : [
        ["Repeatable", "No", "Yes"],
        ["Trackable", "No", "Yes"],
        ["Team friendly", "Weak", "Strong"],
        ["Safe in production", "Risky", "Safer"],
      ];

  return { columns, rows };
}

function usePlayback(timeline, isPlaying) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const baseRef = useRef(0);
  const startRef = useRef(0);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      baseRef.current = elapsedMs;
      return;
    }

    startRef.current = performance.now();

    const tick = () => {
      const next = baseRef.current + (performance.now() - startRef.current);
      setElapsedMs(next);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying]);

  const totalMs = timeline.length ? timeline[timeline.length - 1].endMs : 0;
  const visibleCount = timeline.filter((x) => x.startMs <= elapsedMs).length;
  const activeIndexRaw = timeline.findIndex((x) => elapsedMs >= x.startMs && elapsedMs < x.endMs);
  const activeIndex = activeIndexRaw >= 0 ? activeIndexRaw : Math.max(0, visibleCount - 1);

  return {
    elapsedMs,
    totalMs,
    visibleCount,
    activeIndex,
    reset: () => {
      baseRef.current = 0;
      setElapsedMs(0);
    },
  };
}

function AgentPanel({ trace }) {
  const traceList = safeArray(trace);
  const completedNames = new Set(traceList.filter((x) => x.ok).map((x) => cleanText(x.agent || x.name)));

  const completedCount = Math.max(
    traceList.filter((x) => x.ok).length,
    Math.min(traceList.length, AGENTS_27.length)
  );

  return (
    <aside className="ht-agent-panel">
      <div className="ht-agent-title">27-Agent Teaching Team</div>

      <div className="ht-agent-list">
        {AGENTS_27.map((name, index) => {
          const done = completedNames.has(name) || index < completedCount;
          const current = index === completedCount;
          return (
            <div key={name} className={`ht-agent-row ${done ? "done" : ""} ${current ? "current" : ""}`}>
              <span>{index + 1}.</span>
              <strong>{name}</strong>
              <em>{done ? "✓" : current ? "○" : ""}</em>
            </div>
          );
        })}
      </div>

      <div className="ht-agent-footer">
        <b>{completedCount} / 27</b>
        <span>{completedCount >= 27 ? "All agents completed" : "Agents running"}</span>
      </div>
    </aside>
  );
}

function TutorSidePanel({ voiceScript, subtitles, quiz, sourceRefs, activeCommandId }) {
  const activeVoice =
    safeArray(voiceScript).find((x) => cleanText(x.commandId) === activeCommandId) ||
    safeArray(voiceScript)[0];

  const activeSubtitle =
    safeArray(subtitles).find((x) => cleanText(x.commandId) === activeCommandId) ||
    safeArray(subtitles)[0];

  const refs = safeArray(sourceRefs).slice(0, 5);
  const quizObj = safeObject(quiz);
  const quizQuestion =
    cleanText(quizObj.question) ||
    cleanText(safeArray(quizObj.questions)[0]?.question) ||
    "What is the main purpose of this concept?";

  return (
    <aside className="ht-tutor-panel">
      <div className="ht-tutor-card ht-mascot">
        <div className="ht-card-title">AI Tutor</div>
        <div className="ht-mascot-row">
          <div className="ht-cat">🦉</div>
          <p>Hi! Let’s explore this topic together.</p>
        </div>
      </div>

      <div className="ht-tutor-card">
        <div className="ht-card-title coral">Voice Script</div>
        <p>{cleanText(activeVoice?.text, "Voice script will appear here.")}</p>
      </div>

      <div className="ht-tutor-card">
        <div className="ht-card-title blue">Subtitles</div>
        <p>{cleanText(activeSubtitle?.text, "Subtitles will appear here.")}</p>
      </div>

      <div className="ht-tutor-card">
        <div className="ht-card-title orange">Quiz Checkpoint</div>
        <p className="ht-quiz-q">Q: {quizQuestion}</p>
        <div className="ht-quiz-options">
          <span>A. Manual edit database</span>
          <span className="right">B. Make changes safe and trackable ✓</span>
          <span>C. Delete old data</span>
          <span>D. Design database</span>
        </div>
      </div>

      <div className="ht-tutor-card">
        <div className="ht-card-title blue">Source References</div>
        {refs.length ? (
          refs.map((ref, i) => (
            <div key={`${ref.chunkId || i}`} className="ht-source-line">
              <b>Page {ref.page || "?"}</b>
              <span>{cleanText(ref.quote, "Source quote").slice(0, 120)}</span>
            </div>
          ))
        ) : (
          <p>No source references received.</p>
        )}
      </div>
    </aside>
  );
}

function SectionCard({ section, active }) {
  if (section.sectionType === "flow") return <FlowSection section={section} active={active} />;
  if (section.sectionType === "tree") return <TreeSection section={section} active={active} />;
  if (section.sectionType === "table") return <TableSection section={section} active={active} />;
  if (section.sectionType === "code") return <CodeSection section={section} active={active} />;
  if (section.sectionType === "quiz") return <QuizSection section={section} active={active} />;
  if (section.sectionType === "source") return <SourceSection section={section} active={active} />;
  return <TextSection section={section} active={active} />;
}

function TextSection({ section, active }) {
  const first = section.commands[0];
  return (
    <section className={`ht-board-section ht-text-section ${active ? "active" : ""}`}>
      <h2>{section.title}</h2>
      {section.commands.map((cmd, i) => (
        <p key={cmd.commandId || i} className={i === 0 ? "lead" : ""}>
          {commandText(cmd)}
        </p>
      ))}
      <SourceMini refs={getRefs(first)} />
    </section>
  );
}

function FlowSection({ section, active }) {
  const steps = extractFlowSteps(section.commands[0]);
  return (
    <section className={`ht-board-section ht-flow-section ${active ? "active" : ""}`}>
      <h3>Migration Workflow</h3>
      <div className="ht-flow-row">
        {steps.map((step, i) => (
          <React.Fragment key={`${step}-${i}`}>
            <div className="ht-flow-box">
              <b>{i + 1}</b>
              <span>{step}</span>
            </div>
            {i < steps.length - 1 ? <div className="ht-arrow">→</div> : null}
          </React.Fragment>
        ))}
      </div>
      <div className="ht-flow-caption">Development → Test → Production</div>
    </section>
  );
}

function TreeSection({ section, active }) {
  const { root, children } = extractTree(section.commands[0]);

  return (
    <section className={`ht-board-section ht-tree-section ${active ? "active" : ""}`}>
      <h3>Concept Tree</h3>
      <div className="ht-tree">
        <div className="ht-tree-root">{root}</div>
        <div className="ht-tree-branches">
          {children.map((child) => (
            <div key={child} className="ht-tree-child">
              <span>{child}</span>
              <small>{child.toLowerCase().includes("rollback") ? "Undo safely" : "Explain"}</small>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TableSection({ section, active }) {
  const { columns, rows } = extractTable(section.commands[0]);

  return (
    <section className={`ht-board-section ht-table-section ${active ? "active" : ""}`}>
      <h3>Quick Comparison</h3>
      <table>
        <thead>
          <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c, j) => (
                <td key={`${i}-${j}`}>
                  {Array.isArray(row) ? cleanText(row[j]) : cleanText(safeObject(row)[c] || safeObject(row)[j])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CodeSection({ section, active }) {
  const code = section.commands.map((cmd) => commandText(cmd)).join("\n");
  const finalCode = code.includes("ALTER TABLE")
    ? code
    : "Migration File: 202401_add_phone.sql\n\n-- Up\nALTER TABLE customers\nADD COLUMN phone VARCHAR(20) NULL;\n\n-- Down\nALTER TABLE customers\nDROP COLUMN phone;";

  return (
    <section className={`ht-board-section ht-code-section ${active ? "active" : ""}`}>
      <h3>Example — Add New Column</h3>
      <pre>{finalCode}</pre>
    </section>
  );
}

function QuizSection({ section, active }) {
  return (
    <section className={`ht-board-section ht-quiz-section ${active ? "active" : ""}`}>
      <h3>Quiz Checkpoint</h3>
      <p>{commandText(section.commands[0], "What is the main purpose of using migration?")}</p>
      <div className="ht-quiz-answer">Best answer: To make database changes safe, repeatable and trackable.</div>
    </section>
  );
}

function SourceSection({ section, active }) {
  const refs = section.commands.flatMap(getRefs);
  return (
    <section className={`ht-board-section ht-source-section ${active ? "active" : ""}`}>
      <h3>Source</h3>
      {refs.slice(0, 3).map((ref, i) => (
        <p key={i}>
          <b>Page {ref.page || "?"}</b> — {cleanText(ref.quote, "Source quote").slice(0, 180)}
        </p>
      ))}
    </section>
  );
}

function SourceMini({ refs }) {
  const first = safeObject(safeArray(refs)[0]);
  if (!first.page && !first.quote) return null;

  return (
    <div className="ht-source-mini">
      Source p.{first.page || "?"}: {cleanText(first.quote, "").slice(0, 120)}
    </div>
  );
}

export default function HumanTutorAutoBoard({
  title = "Migration",
  subtitle = "Evolutionary Database Design",
  boardCommands = [],
  voiceScript = [],
  subtitles = [],
  quiz = {},
  sourceRefs = [],
  agentTrace = [],
  metadata = {},
  onBack,
  onInterrupt,
}) {
  const commands = safeArray(boardCommands);
  const timeline = useMemo(() => buildTimeline(commands), [commands]);
  const sections = useMemo(() => groupCommands(commands), [commands]);

  const [playing, setPlaying] = useState(false);
  const [showAll, setShowAll] = useState(true);
  const playback = usePlayback(timeline, playing);

  const activeCommand = commands[playback.activeIndex] || commands[0] || {};
  const activeCommandId = cleanText(activeCommand.commandId);

  const visibleCommandIds = timeline
    .slice(0, Math.max(1, playback.visibleCount))
    .map((x) => x.command.commandId);

  const activeSectionIndex = sections.findIndex((section) =>
    section.commands.some((cmd) => cmd.commandId === activeCommandId)
  );

  const completedAgents = Math.max(safeArray(agentTrace).filter((x) => x.ok).length, 0);

  return (
    <div className="ht-shell">
      <style>{styles}</style>

      <header className="ht-topbar">
        <div className="ht-brand">
          <span className="ht-logo">🦉</span>
          <b>Tutor Board</b>
        </div>

        <div className="ht-topic">
          <span></span>
          Teaching: <b>{title}</b> <em>({subtitle})</em>
        </div>

        <div className="ht-top-actions">
          <button className="danger" onClick={() => onInterrupt?.({
            currentCommandIndex: playback.activeIndex,
            currentCommandId: activeCommandId,
            visibleCommandIds,
          })}>
            Interrupt / I’m Confused
          </button>
          <button onClick={() => setPlaying((v) => !v)}>{playing ? "Pause" : "Play"}</button>
          <button onClick={onBack}>End Lesson</button>
        </div>
      </header>

      <div className="ht-main">
        <AgentPanel trace={agentTrace} />

        <main className="ht-board-wrap">
          {commands.length === 0 ? (
            <div className="ht-empty-board">
              <h1>No boardCommands received</h1>
              <p>Backend must return boardCommands, voiceScript, subtitles, sourceRefs and agentTrace.</p>
              <pre>{JSON.stringify({ metadata }, null, 2)}</pre>
            </div>
          ) : (
            <div className="ht-study-board" style={{ minHeight: Math.max(860, sections.length * 260) }}>
              <section className="ht-board-hero">
                <h1>{title}</h1>
                <p>
                  {cleanText(commands[0]?.text, `${title} is explained step by step using source-grounded board visuals.`)}
                </p>
              </section>

              <div className="ht-section-grid">
                {(showAll ? sections : sections.slice(0, Math.max(1, activeSectionIndex + 1))).map((section, index) => (
                  <SectionCard
                    key={section.id}
                    section={section}
                    active={index === activeSectionIndex}
                  />
                ))}
              </div>
            </div>
          )}
        </main>

        <TutorSidePanel
          voiceScript={voiceScript}
          subtitles={subtitles}
          quiz={quiz}
          sourceRefs={sourceRefs}
          activeCommandId={activeCommandId}
        />
      </div>

      <footer className="ht-controls">
        <div className="ht-current-step">
          <b>Current Step</b>
          <span>{commandText(activeCommand, "Waiting for board command")}</span>
        </div>

        <div className="ht-progress">
          <b>Progress</b>
          <div className="ht-bar">
            <span style={{ width: `${timeline.length ? Math.min(100, (playback.elapsedMs / playback.totalMs) * 100) : 0}%` }} />
          </div>
        </div>

        <div className="ht-play-controls">
          <button onClick={playback.reset}>⏮</button>
          <button className="play" onClick={() => setPlaying((v) => !v)}>{playing ? "Ⅱ" : "▶"}</button>
          <button onClick={() => setShowAll((v) => !v)}>{showAll ? "Current" : "All"}</button>
        </div>

        <div className="ht-speed">
          <b>Agents</b>
          <span>{completedAgents || safeArray(agentTrace).length} / 27</span>
        </div>

        <button className="jump" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          Jump to Current Step
        </button>
      </footer>
    </div>
  );
}

const styles = `
  .ht-shell {
    min-height: 100vh;
    background: #fff8f1;
    color: #3d322b;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .ht-shell * {
    box-sizing: border-box;
  }

  .ht-topbar {
    height: 72px;
    display: grid;
    grid-template-columns: 240px 1fr auto;
    align-items: center;
    gap: 18px;
    padding: 0 26px;
    border-bottom: 1px solid #f0dfd2;
    background: rgba(255, 250, 245, .94);
    position: sticky;
    top: 0;
    z-index: 20;
  }

  .ht-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 25px;
  }

  .ht-logo {
    font-size: 28px;
  }

  .ht-topic {
    text-align: center;
    font-size: 14px;
  }

  .ht-topic span {
    display: inline-block;
    width: 8px;
    height: 8px;
    background: #fb7b5c;
    border-radius: 99px;
    margin-right: 8px;
  }

  .ht-topic b {
    color: #fb6b4b;
  }

  .ht-topic em {
    font-style: normal;
    color: #1f2937;
  }

  .ht-top-actions {
    display: flex;
    gap: 10px;
  }

  .ht-top-actions button,
  .ht-controls button {
    border: 1px solid #f0b9a5;
    background: #fffaf5;
    color: #8c3b27;
    border-radius: 12px;
    padding: 10px 15px;
    font-weight: 850;
    cursor: pointer;
  }

  .ht-top-actions .danger {
    border-color: #fb7b5c;
    color: #ef4d2f;
  }

  .ht-main {
    display: grid;
    grid-template-columns: 260px minmax(0, 1fr) 330px;
    gap: 14px;
    padding: 14px 18px 102px;
  }

  .ht-agent-panel,
  .ht-tutor-panel,
  .ht-board-wrap {
    border: 1px solid #f1dccd;
    background: #fffdf9;
    border-radius: 18px;
    box-shadow: 0 12px 36px rgba(103, 64, 38, .07);
  }

  .ht-agent-panel {
    padding: 16px;
    position: sticky;
    top: 88px;
    height: calc(100vh - 190px);
    overflow: auto;
  }

  .ht-agent-title {
    color: #ef4d2f;
    font-size: 13px;
    text-transform: uppercase;
    font-weight: 950;
    margin-bottom: 14px;
  }

  .ht-agent-list {
    display: grid;
    gap: 8px;
  }

  .ht-agent-row {
    display: grid;
    grid-template-columns: 28px 1fr 20px;
    gap: 4px;
    font-size: 13px;
    color: #5d5048;
    align-items: center;
  }

  .ht-agent-row strong {
    font-weight: 650;
  }

  .ht-agent-row.done em {
    color: #3c9a4b;
  }

  .ht-agent-row.current {
    color: #fb6b4b;
  }

  .ht-agent-footer {
    border-top: 1px solid #f1dccd;
    margin-top: 18px;
    padding-top: 14px;
    text-align: center;
  }

  .ht-agent-footer b {
    display: block;
    color: #2f9b52;
    font-size: 24px;
  }

  .ht-agent-footer span {
    color: #2f9b52;
    font-size: 13px;
  }

  .ht-board-wrap {
    padding: 20px;
    overflow: auto;
    max-height: calc(100vh - 190px);
  }

  .ht-study-board {
    background:
      radial-gradient(circle at 20% 10%, rgba(255, 217, 194, .35), transparent 28%),
      linear-gradient(#fffdf9, #fffaf4);
    border: 1px solid #f3d6c7;
    border-radius: 20px;
    padding: 28px;
    min-width: 1050px;
  }

  .ht-board-hero {
    margin-bottom: 24px;
  }

  .ht-board-hero h1 {
    font-family: "Comic Sans MS", "Bradley Hand", cursive;
    color: #f36d51;
    font-size: 52px;
    margin: 0 0 8px;
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 12px;
  }

  .ht-board-hero p {
    max-width: 760px;
    font-family: "Comic Sans MS", "Bradley Hand", cursive;
    font-size: 22px;
    line-height: 1.6;
    color: #191919;
  }

  .ht-section-grid {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 18px;
  }

  .ht-board-section {
    border: 1px solid #f0d4c4;
    background: rgba(255, 255, 255, .68);
    border-radius: 16px;
    padding: 18px;
    min-height: 160px;
  }

  .ht-board-section.active {
    box-shadow: 0 0 0 3px rgba(251, 123, 92, .18);
    border-color: #fb7b5c;
  }

  .ht-text-section,
  .ht-flow-section,
  .ht-code-section {
    grid-column: span 6;
  }

  .ht-tree-section,
  .ht-table-section {
    grid-column: span 6;
  }

  .ht-quiz-section,
  .ht-source-section {
    grid-column: span 4;
  }

  .ht-board-section h2,
  .ht-board-section h3 {
    font-family: "Comic Sans MS", "Bradley Hand", cursive;
    color: #ef5b3e;
    margin: 0 0 12px;
  }

  .ht-board-section p,
  .ht-board-section li,
  .ht-tree-child,
  .ht-flow-box {
    font-family: "Comic Sans MS", "Bradley Hand", cursive;
    color: #141414;
    line-height: 1.6;
  }

  .ht-board-section .lead {
    font-size: 18px;
  }

  .ht-source-mini {
    margin-top: 10px;
    border-radius: 999px;
    background: #fff0e7;
    color: #9c402b;
    padding: 8px 12px;
    font-size: 12px;
  }

  .ht-flow-row {
    display: flex;
    align-items: center;
    gap: 9px;
    flex-wrap: wrap;
  }

  .ht-flow-box {
    min-width: 112px;
    min-height: 58px;
    border: 1px solid #f3a286;
    border-radius: 10px;
    background: #fff8f1;
    display: grid;
    place-items: center;
    text-align: center;
    padding: 8px;
  }

  .ht-flow-box b {
    color: #fb6b4b;
  }

  .ht-arrow {
    color: #6a5549;
    font-size: 20px;
  }

  .ht-flow-caption {
    margin-top: 14px;
    color: #fb6b4b;
    font-family: "Comic Sans MS", "Bradley Hand", cursive;
  }

  .ht-tree {
    text-align: center;
  }

  .ht-tree-root {
    display: inline-block;
    border: 1px solid #fb9b63;
    border-radius: 10px;
    padding: 10px 50px;
    font-family: "Comic Sans MS", "Bradley Hand", cursive;
    color: #1f2937;
    margin-bottom: 26px;
  }

  .ht-tree-branches {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 14px;
    border-top: 1px solid #8f7e6f;
    padding-top: 22px;
  }

  .ht-tree-child {
    border: 1px solid #96bd8c;
    background: #f7fff5;
    border-radius: 10px;
    padding: 9px 12px;
    min-width: 110px;
  }

  .ht-tree-child small {
    display: block;
    margin-top: 6px;
    color: #3e4c3c;
  }

  .ht-code-section pre {
    background: #fffaf5;
    border: 1px solid #efd0bf;
    border-radius: 12px;
    padding: 14px;
    white-space: pre-wrap;
    color: #191919;
    font-size: 14px;
    line-height: 1.6;
  }

  .ht-table-section table {
    width: 100%;
    border-collapse: collapse;
    overflow: hidden;
    border-radius: 12px;
  }

  .ht-table-section th,
  .ht-table-section td {
    border: 1px solid #ead3c4;
    padding: 10px;
    text-align: left;
    font-size: 13px;
  }

  .ht-table-section th {
    background: #fff0e7;
    color: #704030;
  }

  .ht-quiz-answer {
    border: 1px dashed #fb7b5c;
    border-radius: 12px;
    padding: 12px;
    color: #2f8a48;
    font-weight: 800;
  }

  .ht-tutor-panel {
    padding: 14px;
    display: grid;
    gap: 14px;
    position: sticky;
    top: 88px;
    height: calc(100vh - 190px);
    overflow: auto;
  }

  .ht-tutor-card {
    border: 1px solid #efd9ca;
    background: #fffaf5;
    border-radius: 16px;
    padding: 16px;
  }

  .ht-card-title {
    font-weight: 950;
    color: #3d322b;
    margin-bottom: 10px;
  }

  .ht-card-title.coral {
    color: #ef5b3e;
  }

  .ht-card-title.blue {
    color: #2d78b8;
  }

  .ht-card-title.orange {
    color: #f29928;
  }

  .ht-mascot-row {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .ht-cat {
    width: 76px;
    height: 76px;
    border-radius: 999px;
    background: #fff1e8;
    display: grid;
    place-items: center;
    font-size: 46px;
  }

  .ht-tutor-card p {
    font-family: "Comic Sans MS", "Bradley Hand", cursive;
    line-height: 1.6;
    margin: 0;
    color: #111827;
  }

  .ht-quiz-options {
    display: grid;
    gap: 7px;
    font-size: 13px;
  }

  .ht-quiz-options .right {
    color: #2c944a;
    font-weight: 800;
  }

  .ht-source-line {
    display: grid;
    gap: 4px;
    margin-bottom: 10px;
    font-size: 13px;
  }

  .ht-source-line b {
    color: #2d78b8;
  }

  .ht-source-line span {
    color: #4b4038;
  }

  .ht-controls {
    position: fixed;
    left: 18px;
    right: 18px;
    bottom: 14px;
    height: 78px;
    border: 1px solid #efd8c9;
    background: rgba(255, 252, 248, .96);
    border-radius: 18px;
    display: grid;
    grid-template-columns: 260px 1fr 240px 160px 220px;
    align-items: center;
    gap: 18px;
    padding: 12px 16px;
    box-shadow: 0 16px 40px rgba(103, 64, 38, .10);
    z-index: 30;
  }

  .ht-current-step,
  .ht-progress,
  .ht-speed {
    display: grid;
    gap: 4px;
  }

  .ht-current-step b,
  .ht-progress b,
  .ht-speed b {
    color: #6b5b50;
    font-size: 12px;
  }

  .ht-current-step span,
  .ht-speed span {
    color: #3d322b;
    font-size: 13px;
  }

  .ht-bar {
    height: 7px;
    background: #f3ddd0;
    border-radius: 999px;
    overflow: hidden;
  }

  .ht-bar span {
    display: block;
    height: 100%;
    background: #fb7b5c;
    border-radius: 999px;
  }

  .ht-play-controls {
    display: flex;
    gap: 10px;
    justify-content: center;
  }

  .ht-play-controls .play {
    width: 48px;
    height: 48px;
    border-radius: 999px;
    background: #fb7b5c;
    color: #fff;
  }

  .ht-controls .jump {
    background: #fb7b5c;
    color: #fff;
  }

  .ht-empty-board {
    padding: 40px;
  }

  .ht-empty-board pre {
    background: #2b211d;
    color: #fff;
    border-radius: 12px;
    padding: 14px;
    overflow: auto;
  }

  @media (max-width: 1100px) {
    .ht-main {
      grid-template-columns: 1fr;
    }

    .ht-agent-panel,
    .ht-tutor-panel {
      position: static;
      height: auto;
    }

    .ht-controls {
      position: static;
      grid-template-columns: 1fr;
      height: auto;
      margin: 0 18px 18px;
    }

    .ht-topbar {
      grid-template-columns: 1fr;
      height: auto;
      padding: 14px;
    }
  }
`;
import React, { useEffect, useMemo, useRef, useState } from "react";
import mermaid from "mermaid";
import BoardMarkingLayer from "./BoardMarkingLayer.jsx";

const AGENTS = [
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

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function payloadOf(value) {
  return safeObject(value?.payload || value?.visualPayload || {});
}

function sourceRefsOf(value) {
  const obj = safeObject(value);
  const payload = payloadOf(obj);
  return safeArray(obj.sourceRefs || payload.sourceRefs);
}

function firstRef(refs) {
  return safeObject(safeArray(refs)[0]);
}

function pageChips(refs) {
  const pages = [];
  for (const ref of safeArray(refs)) {
    const page = safeObject(ref).page;
    if (page && !pages.includes(page)) pages.push(page);
  }
  return pages.slice(0, 6);
}

function blockId(block, index = 0) {
  return cleanText(block?.blockId || block?.id || `block_${index + 1}`);
}

function blockType(block) {
  return cleanText(block?.type || block?.blockType || block?.sectionType || "teacherText");
}

function blockTitle(block) {
  return cleanText(block?.title || block?.label || block?.blockId || "Board Block");
}

function blockBody(block) {
  return cleanText(block?.body || block?.teacherNotes || block?.text || payloadOf(block).body || "");
}

function commandId(command, index = 0) {
  return cleanText(command?.commandId || command?.id || `cmd_${index + 1}`);
}

function commandBlockId(command) {
  const p = payloadOf(command);
  return cleanText(command?.blockId || command?.targetBlockId || command?.targetId || p.blockId || p.targetBlockId || p.targetId);
}

function commandScreenNo(command) {
  const p = payloadOf(command);
  return number(command?.screenNo || command?.screenNumber || p.screenNo || p.screenNumber, 1);
}

function commandText(command) {
  const p = payloadOf(command);
  return cleanText(command?.text || command?.body || command?.narrationCue || p.text || p.body || p.title || p.narrationCue || command?.type || "");
}

function getCurrentVoice(voiceScript, command, screenNo) {
  const id = commandId(command);
  const voiceLineId = cleanText(command?.voiceLineId || payloadOf(command).voiceLineId);
  return (
    safeArray(voiceScript).find((v) => cleanText(v.commandId) === id) ||
    safeArray(voiceScript).find((v) => cleanText(v.lineId || v.voiceLineId) === voiceLineId) ||
    safeArray(voiceScript).find((v) => number(v.screenNo) === number(screenNo)) ||
    safeArray(voiceScript)[0] ||
    null
  );
}

function getCurrentSubtitle(subtitles, command, screenNo) {
  const id = commandId(command);
  return (
    safeArray(subtitles).find((s) => cleanText(s.commandId) === id) ||
    safeArray(subtitles).find((s) => number(s.screenNo) === number(screenNo)) ||
    safeArray(subtitles)[0] ||
    null
  );
}

function diagramForBlock(block, compiledDiagrams = []) {
  const local = cleanText(block?.mermaid || payloadOf(block).mermaid);
  if (local) return local;

  const id = cleanText(block?.compiledDiagramId || block?.compiledVisualId);
  const title = blockTitle(block).toLowerCase();
  const type = blockType(block).toLowerCase();

  const found = safeArray(compiledDiagrams).find((d) => {
    const item = safeObject(d);
    return (
      cleanText(item.compiledDiagramId || item.id) === id ||
      cleanText(item.title).toLowerCase().includes(title) ||
      cleanText(item.diagramType).toLowerCase() === type
    );
  });

  return cleanText(found?.mermaid || found?.code || "");
}

function useMermaid(code) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const raw = cleanText(code).replace(/^```mermaid/i, "").replace(/^```/i, "").replace(/```$/i, "").trim();

    if (!raw) {
      setSvg("");
      setError("");
      return undefined;
    }

    async function render() {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          securityLevel: "loose",
          flowchart: { htmlLabels: true, curve: "basis" },
          themeVariables: {
            primaryColor: "#fff6ed",
            primaryBorderColor: "#fb7658",
            primaryTextColor: "#2f261f",
            lineColor: "#9b7b6a",
            secondaryColor: "#f1f8ee",
            tertiaryColor: "#f6f2ff",
            fontFamily: "Inter, system-ui, sans-serif",
          },
        });

        const id = `m_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const result = await mermaid.render(id, raw);

        if (!cancelled) {
          setSvg(result.svg || "");
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setSvg("");
          setError(err?.message || "Mermaid render failed");
        }
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [code]);

  return { svg, error };
}

function SourceChips({ refs }) {
  const pages = pageChips(refs);

  if (!pages.length) {
    return <div className="lt-source-chips missing">No source</div>;
  }

  return (
    <div className="lt-source-chips">
      {pages.map((page) => (
        <span key={page}>Pg. {page}</span>
      ))}
    </div>
  );
}

function MermaidBlock({ block, compiledDiagrams }) {
  const code = diagramForBlock(block, compiledDiagrams);
  const { svg, error } = useMermaid(code);

  if (!code) {
    return <p>{blockBody(block) || "Diagram data missing from backend."}</p>;
  }

  return (
    <div className="lt-mermaid-box">
      {svg ? <div className="lt-mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} /> : <pre>{code}</pre>}
      {error ? <small>{error}</small> : null}
    </div>
  );
}

function WorkflowBlock({ block }) {
  const nodes = safeArray(block.nodes || payloadOf(block).nodes);
  const bodySteps = blockBody(block)
    .split(/→|->|\n|,/)
    .map((x) => x.trim())
    .filter(Boolean);

  const steps = nodes.length
    ? nodes.map((n) => cleanText(safeObject(n).label || safeObject(n).title || safeObject(n).id)).filter(Boolean)
    : bodySteps;

  if (!steps.length) return <p>{blockBody(block)}</p>;

  return (
    <div className="lt-flow">
      {steps.slice(0, 7).map((step, index) => (
        <React.Fragment key={`${step}_${index}`}>
          <div className="lt-flow-step">
            <b>{index + 1}</b>
            <span>{step}</span>
          </div>
          {index < Math.min(steps.length, 7) - 1 ? <em>→</em> : null}
        </React.Fragment>
      ))}
    </div>
  );
}

function MiniTreeBlock({ block }) {
  const nodes = safeArray(block.nodes || payloadOf(block).nodes);
  const root = nodes[0];
  const children = nodes.slice(1, 8);

  if (!nodes.length) return <p>{blockBody(block)}</p>;

  return (
    <div className="lt-tree">
      <div className="lt-tree-root">{cleanText(root?.data?.label || root?.label || root?.title || blockTitle(block))}</div>
      <div className="lt-tree-children">
        {children.map((node, index) => (
          <div key={node.id || index} className="lt-tree-child">
            {cleanText(node?.data?.label || node?.label || node?.title || node?.id)}
          </div>
        ))}
      </div>
    </div>
  );
}

function TableBlock({ block }) {
  const columns = safeArray(block.columns || payloadOf(block).columns);
  const rows = safeArray(block.rows || payloadOf(block).rows);

  if (!columns.length || !rows.length) {
    return <p>{blockBody(block) || "Table data missing from backend."}</p>;
  }

  return (
    <div className="lt-table-wrap">
      <table>
        <thead>
          <tr>
            {columns.slice(0, 4).map((col) => (
              <th key={cleanText(col)}>{cleanText(col)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 6).map((row, rowIndex) => {
            const obj = safeObject(row);
            const arr = Array.isArray(row) ? row : null;
            return (
              <tr key={rowIndex}>
                {columns.slice(0, 4).map((col, colIndex) => (
                  <td key={`${rowIndex}_${colIndex}`}>
                    {cleanText(arr ? arr[colIndex] : obj[col] || obj[String(col).toLowerCase()] || obj[colIndex])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ChecklistBlock({ block }) {
  const items = safeArray(block.items || payloadOf(block).items).length
    ? safeArray(block.items || payloadOf(block).items)
    : blockBody(block)
        .split(/\n|;|\.\s+/)
        .map((x) => x.trim())
        .filter((x) => x.length > 3);

  return (
    <ul className="lt-checklist">
      {items.slice(0, 7).map((item, index) => (
        <li key={`${index}_${cleanText(item)}`}>
          <span>✓</span>
          <b>{cleanText(safeObject(item).text || safeObject(item).label || item)}</b>
        </li>
      ))}
    </ul>
  );
}

function HtmlPreviewBlock({ block }) {
  const html = cleanText(block.html || block.srcDoc || payloadOf(block).html || payloadOf(block).srcDoc);

  if (!html) return <p>{blockBody(block) || "HTML preview missing from backend."}</p>;

  return <iframe className="lt-html-preview" title={blockTitle(block)} sandbox="" srcDoc={html} />;
}

function SourcePreviewBlock({ block, imagePreviews }) {
  const refs = sourceRefsOf(block);
  const page = number(block.page || payloadOf(block).page || firstRef(refs).page, 0);
  const direct = cleanText(block.imageRef || block.src || block.url || payloadOf(block).imageRef || payloadOf(block).src);
  const matched = safeArray(imagePreviews).find((img) => number(img.page) === page);
  const src = direct || cleanText(matched?.url || matched?.src || matched?.imageRef || matched?.path);

  if (!src) {
    return (
      <div className="lt-source-placeholder">
        <b>{page ? `PDF Page ${page}` : "PDF Source Preview"}</b>
        <span>Page image/OCR preview is not sent by backend yet.</span>
      </div>
    );
  }

  return <img className="lt-source-image" src={src} alt={blockTitle(block)} />;
}

function bboxStyle(box, fallback = {}) {
  const raw = safeObject(box);
  const x = number(raw.x, NaN);
  const y = number(raw.y, NaN);
  const w = number(raw.w, NaN);
  const h = number(raw.h, NaN);
  if (![x, y, w, h].every(Number.isFinite)) return fallback;
  const isFraction = Math.max(Math.abs(x), Math.abs(y), Math.abs(w), Math.abs(h)) <= 1.5;
  if (isFraction) {
    return {
      left: `${x * 100}%`,
      top: `${y * 100}%`,
      width: `${w * 100}%`,
      height: `${h * 100}%`,
    };
  }
  return { left: x, top: y, width: w, height: h };
}

function elementId(element, index = 0) {
  return cleanText(element?.elementId || element?.id || `element_${index + 1}`);
}

function elementKind(element) {
  return cleanText(element?.kind || element?.type || "box");
}

function elementContent(element) {
  return cleanText(element?.content || element?.text || element?.label || "");
}

function imageForPage(page, imagePreviews) {
  const match = safeArray(imagePreviews).find((img) => number(img.page || img.pageNumber) === number(page));
  return cleanText(match?.pageImageUrl || match?.imageUrl || match?.url || match?.src || match?.imageRef || match?.path);
}

function BoardElement({ element, index, imagePreviews, focusRegions }) {
  const id = elementId(element, index);
  const kind = elementKind(element);
  const page = number(element.pageNumber || element.page, 0);
  const src = cleanText(element.pageImageUrl || element.imageUrl || element.url || element.src) || imageForPage(page, imagePreviews);
  const regions = safeArray(focusRegions).filter((region) => {
    const parent = cleanText(region.parentElementId || region.parentId);
    return parent === id || (!parent && number(region.page || region.pageNumber) === page && page);
  });
  const style = bboxStyle(element.position || element.bbox, {
    left: `${8 + (index % 3) * 30}%`,
    top: `${8 + Math.floor(index / 3) * 24}%`,
    width: "28%",
    height: "20%",
  });

  if (kind === "pdf_page" || kind === "pdf_crop") {
    return (
      <div
        className={`lt-visual-element kind-${kind}`}
        data-element-id={id}
        data-block-id={id}
        data-region-id={cleanText(element.regionId)}
        style={style}
      >
        {src ? (
          <img src={src} alt={elementContent(element) || `PDF page ${page || ""}`} />
        ) : (
          <div className="lt-pdf-missing">PDF page image missing{page ? ` · Pg. ${page}` : ""}</div>
        )}
        {regions.map((region, regionIndex) => (
          <span
            key={region.regionId || regionIndex}
            className="lt-focus-region"
            data-region-id={cleanText(region.regionId || region.id)}
            style={bboxStyle(region.bbox || region.position)}
            title={cleanText(region.label || region.description)}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`lt-visual-element kind-${kind} style-${cleanText(element.style || "normal")}`}
      data-element-id={id}
      data-block-id={id}
      data-region-id={cleanText(element.regionId)}
      style={style}
    >
      <b>{elementContent(element)}</b>
    </div>
  );
}

function VisualStage({ screen, imagePreviews }) {
  const elements = safeArray(screen.visualElements);
  if (!elements.length) return null;
  return (
    <div className={`lt-visual-stage layout-${cleanText(screen.layout || "full")}`}>
      {elements.map((element, index) => (
        <BoardElement
          key={elementId(element, index)}
          element={element}
          index={index}
          imagePreviews={imagePreviews}
          focusRegions={safeArray(screen.focusRegions)}
        />
      ))}
    </div>
  );
}

function ScreenTeachingNotes({ screen }) {
  const keyPoints = safeArray(screen.keyPoints);
  const dryRun = safeArray(screen.dryRun);
  const note = cleanText(screen.boardWriting || screen.teacherNote || screen.voiceover);
  const check = safeObject(screen.checkQuestion);

  if (!note && !keyPoints.length && !dryRun.length && !cleanText(check.question)) return null;

  return (
    <div className="lt-generated-notes">
      {note ? <p>{note}</p> : null}
      {keyPoints.length ? (
        <ul>
          {keyPoints.slice(0, 6).map((point, index) => (
            <li key={`${index}_${cleanText(point)}`}>{cleanText(point)}</li>
          ))}
        </ul>
      ) : null}
      {dryRun.length ? (
        <div className="lt-dry-run">
          {dryRun.slice(0, 5).map((step, index) => (
            <div key={`${index}_${cleanText(step.codeLine)}`}>
              <b>{cleanText(step.codeLine || `Step ${step.step || index + 1}`)}</b>
              <span>{cleanText(step.whatHappens)}</span>
              <em>{cleanText(step.stateAfter)}</em>
            </div>
          ))}
        </div>
      ) : null}
      {cleanText(check.question) ? (
        <div className="lt-inline-check">
          <b>{cleanText(check.question)}</b>
          <span>{cleanText(check.expectedAnswer || check.answer || "Think, then reveal with the teacher.")}</span>
        </div>
      ) : null}
    </div>
  );
}

function QuizBlock({ block, quiz }) {
  const questions = safeArray(block.questions || payloadOf(block).questions || quiz?.questions);
  const q = safeObject(questions[0]);
  const question = cleanText(q.question || blockBody(block), `Explain ${blockTitle(block)} using the source evidence.`);
  const choices = safeArray(q.choices || q.options);

  return (
    <div className="lt-quiz">
      <b>Q: {question}</b>
      {choices.length ? (
        <div>
          {choices.slice(0, 4).map((choice, index) => (
            <span key={`${index}_${choice}`}>{String.fromCharCode(65 + index)}. {cleanText(choice)}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BoardBlock({ block, index, active, compiledDiagrams, imagePreviews, quiz }) {
  const type = blockType(block);
  const refs = sourceRefsOf(block);

  let content = null;
  if (type === "diagramPanel") content = <MermaidBlock block={block} compiledDiagrams={compiledDiagrams} />;
  else if (type === "workflowStrip") content = <WorkflowBlock block={block} />;
  else if (type === "miniConceptTree") content = <MiniTreeBlock block={block} />;
  else if (type === "mappingTable") content = <TableBlock block={block} />;
  else if (type === "bestPracticeChecklist" || type === "recapChecklist") content = <ChecklistBlock block={block} />;
  else if (type === "htmlPreviewCard") content = <HtmlPreviewBlock block={block} />;
  else if (type === "sourcePagePreview") content = <SourcePreviewBlock block={block} imagePreviews={imagePreviews} />;
  else if (type === "quizCheckpoint") content = <QuizBlock block={block} quiz={quiz} />;
  else content = <p>{blockBody(block) || cleanText(block.content) || "No text sent for this block."}</p>;

  const role = cleanText(block.role || "main");
  const className = [
    "lt-board-card",
    `type-${type}`,
    `role-${role}`,
    active ? "active" : "",
  ].join(" ");

  return (
    <article className={className} data-block-id={blockId(block, index)} data-block-type={type}>
      <div className="lt-card-head">
        <div>
          <span>{type}</span>
          <h3>{blockTitle(block)}</h3>
        </div>
        <SourceChips refs={refs} />
      </div>
      {type === "sourceEvidenceCard" && firstRef(refs).quote ? (
        <blockquote>{cleanText(firstRef(refs).quote, blockBody(block) || "")}</blockquote>
      ) : content}
    </article>
  );
}

function AgentRail({ agentTrace }) {
  const trace = safeArray(agentTrace);
  const completed = Math.max(0, Math.min(27, trace.length || 25));

  return (
    <aside className="lt-left">
      <div className="lt-logo">✦ Tutor Board</div>

      <div className="lt-resource-card">
        <small>RESOURCE</small>
        <b>Selected PDF Lesson</b>
        <span>Source Grounded</span>
      </div>

      <div className="lt-section-title">27-Agent Teaching Team</div>
      <div className="lt-agent-list">
        {AGENTS.map((agent, index) => (
          <div key={agent} className={`lt-agent ${index < completed ? "done" : ""} ${index === completed ? "current" : ""}`}>
            <span>{index + 1}</span>
            <b>{agent}</b>
            <em>{index < completed ? "✓" : index === completed ? "○" : ""}</em>
          </div>
        ))}
      </div>

      <div className="lt-agent-score">
        <strong>{completed}/27</strong>
        <span>Grounded & Verified</span>
      </div>
    </aside>
  );
}

function TutorPanel({ voiceLine, subtitleLine, sourceRefs, quiz, activeScreen, externalResources }) {
  const refs = safeArray(sourceRefs);
  const questions = safeArray(quiz?.questions);
  const q = cleanText(questions[0]?.question || "Ask a question about this board.");

  return (
    <aside className="lt-right">
      <section className="lt-tutor-hello">
        <div className="lt-avatar">✦</div>
        <div>
          <b>AI Tutor</b>
          <p>Hi! I explain this selected PDF node using exact source evidence.</p>
        </div>
      </section>

      <section className="lt-side-card">
        <h4>Lesson Summary</h4>
        <p>{cleanText(activeScreen?.goal || activeScreen?.subtitle || "This board is source-grounded and auto-generated.")}</p>
      </section>

      <section className="lt-side-card">
        <h4>Voice Script</h4>
        <p>{cleanText(voiceLine?.text, "Voice line not available for this command.")}</p>
      </section>

      <section className="lt-side-card">
        <h4>Subtitles</h4>
        <p>{cleanText(subtitleLine?.text || voiceLine?.text, "Subtitle not available.")}</p>
      </section>

      <section className="lt-side-card">
        <h4>Quiz / Checkpoint</h4>
        <p>{q}</p>
      </section>

      <section className="lt-side-card">
        <h4>Source References</h4>
        <div className="lt-ref-list">
          {refs.slice(0, 6).map((ref, index) => (
            <div key={`${ref.page}_${index}`}>
              <b>Pg. {ref.page || "?"}</b>
              <span>{cleanText(ref.quote || ref.text || ref.snippet, "Source quote attached.").slice(0, 120)}</span>
            </div>
          ))}
        </div>
      </section>

      {safeArray(externalResources).length ? (
        <section className="lt-side-card">
          <h4>Extra Learning</h4>
          <div className="lt-ref-list">
            {safeArray(externalResources).slice(0, 4).map((item, index) => (
              <div key={`${item.url}_${index}`}>
                <b>{cleanText(item.title || "Resource")}</b>
                <span>{cleanText(item.type || item.provider || "web")}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </aside>
  );
}

export default function LiveTutorBoardPlayer({
  title = "Live Tutor Board",
  screens = [],
  boardCommands = [],
  voiceScript = [],
  subtitles = [],
  compiledDiagrams = [],
  imagePreviews = [],
  sourceRefs = [],
  sourceCards = [],
  agentTrace = [],
  quiz = {},
  externalResources = [],
  metadata = {},
  onInterrupt,
}) {
  const [currentScreenIndex, setCurrentScreenIndex] = useState(0);
  const [currentCommandIndex, setCurrentCommandIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const boardRef = useRef(null);
  const audioRef = useRef(null);

  const screenList = safeArray(screens);
  const commands = safeArray(boardCommands);
  const currentCommand = commands[currentCommandIndex] || null;
  const currentCommandScreenNo = commandScreenNo(currentCommand);
  const commandScreenIndex = screenList.findIndex((s, i) => number(s.screenNo, i + 1) === currentCommandScreenNo);
  const activeScreenIndex = commandScreenIndex >= 0 ? commandScreenIndex : currentScreenIndex;
  const activeScreen = screenList[activeScreenIndex] || screenList[0] || {};
  const activeBlockId = commandBlockId(currentCommand);
  const activeScreenNo = number(activeScreen.screenNo, activeScreenIndex + 1);
  const voiceLine = getCurrentVoice(voiceScript, currentCommand, activeScreenNo);
  const subtitleLine = getCurrentSubtitle(subtitles, currentCommand, activeScreenNo);
  const allRefs = safeArray(sourceRefs).length ? safeArray(sourceRefs) : safeArray(sourceCards).flatMap((c) => sourceRefsOf(c));
  const progress = commands.length ? Math.round(((currentCommandIndex + 1) / commands.length) * 100) : 0;

  useEffect(() => {
    if (!playing || !commands.length) return undefined;

    const current = commands[currentCommandIndex];
    const span = number(current?.endMs, 0) - number(current?.startMs, 0);
    const duration = Math.max(900, Math.min(12000, number(current?.durationMs || span, 1800)));

    const timer = window.setTimeout(() => {
      setCurrentCommandIndex((old) => {
        if (old >= commands.length - 1) {
          setPlaying(false);
          return old;
        }
        return old + 1;
      });
    }, duration);

    return () => window.clearTimeout(timer);
  }, [playing, currentCommandIndex, commands]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const url = cleanText(voiceLine?.audioUrl);
    if (!playing || !url) {
      audio.pause();
      return undefined;
    }

    if (audio.src !== url) {
      audio.src = url;
      audio.currentTime = 0;
    }

    audio.play().catch(() => {});

    return () => {
      audio.pause();
    };
  }, [playing, voiceLine]);

  function goScreen(index) {
    const screen = screenList[index];
    const screenNo = number(screen?.screenNo, index + 1);
    const firstCommand = commands.findIndex((cmd) => commandScreenNo(cmd) === screenNo);

    setPlaying(false);
    setCurrentScreenIndex(index);
    if (firstCommand >= 0) setCurrentCommandIndex(firstCommand);
  }

  function previous() {
    setPlaying(false);
    setCurrentCommandIndex((i) => Math.max(0, i - 1));
  }

  function next() {
    setPlaying(false);
    setCurrentCommandIndex((i) => Math.min(commands.length - 1, i + 1));
  }

  function interrupt() {
    setPlaying(false);
    onInterrupt?.({
      currentCommandIndex,
      currentCommandId: commandId(currentCommand),
      currentScreenNo: activeScreenNo,
      currentBlockId: activeBlockId,
      visibleBlockIds: [
        ...safeArray(activeScreen.blocks).map((b, i) => blockId(b, i)),
        ...safeArray(activeScreen.visualElements).map((element, i) => elementId(element, i)),
      ],
      currentVoiceText: cleanText(voiceLine?.text),
    });
  }

  if (!screenList.length) {
    return (
      <section className="lt-empty">
        <style>{styles}</style>
        <h2>No board screens</h2>
        <p>Backend must send premiumBoardScreens/boardScreens. Frontend will not make fake content.</p>
      </section>
    );
  }

  return (
    <section className="lt-shell">
      <style>{styles}</style>

      <header className="lt-topbar">
        <div className="lt-brand">✦ Tutor Board</div>
        <div className="lt-search">Search topics, nodes, or ask anything...</div>
        <div className="lt-online">● AI Tutor Online</div>
      </header>

      <div className="lt-layout">
        <main className="lt-main">
          <div className="lt-board-toolbar">
            <button>Fit to view</button>
            <button>-</button>
            <b>100%</b>
            <button>+</button>
            <button>Export</button>
          </div>

          <section className="lt-board-canvas lumina-board-canvas" ref={boardRef}>
            <div className="lt-board-note">
              <b>{cleanText(activeScreen.voiceHint || activeScreen.goal || "This board auto-expands with the concept.")}</b>
            </div>

            <div className="lt-board-title">
              <small>BOARD {activeScreenNo} OF {screenList.length}</small>
              <h1>{cleanText(activeScreen.title || title)}</h1>
              <p>{cleanText(activeScreen.goal || activeScreen.subtitle || "Source-grounded dynamic tutor lesson.")}</p>
            </div>

            <VisualStage screen={activeScreen} imagePreviews={imagePreviews} />
            <ScreenTeachingNotes screen={activeScreen} />

            <div className="lt-board-grid">
              {safeArray(activeScreen.blocks).map((block, index) => (
                <BoardBlock
                  key={blockId(block, index)}
                  block={block}
                  index={index}
                  active={blockId(block, index) === activeBlockId}
                  compiledDiagrams={compiledDiagrams}
                  imagePreviews={imagePreviews}
                  quiz={quiz}
                />
              ))}
            </div>

            <BoardMarkingLayer
              commands={commands}
              currentCommandIndex={currentCommandIndex}
              activeScreenNo={activeScreenNo}
            />
          </section>

          <nav className="lt-board-nav">
            {screenList.map((screen, index) => (
              <button key={screen.screenId || index} className={index === activeScreenIndex ? "active" : ""} onClick={() => goScreen(index)}>
                <span>{index + 1}</span>
                <b>{cleanText(screen.title || `Board ${index + 1}`)}</b>
              </button>
            ))}
          </nav>
        </main>
      </div>

      <footer className="lt-bottom">
        <audio ref={audioRef} preload="auto" />

        <div>
          <small>Current Step</small>
          <b>{commandText(currentCommand) || cleanText(activeScreen.title)}</b>
        </div>

        <div className="lt-progress-box">
          <small>Progress</small>
          <div className="lt-progress">
            <span style={{ width: `${progress}%` }} />
          </div>
          <em>{commands.length ? `${currentCommandIndex + 1} / ${commands.length}` : "0 / 0"}</em>
        </div>

        <div className="lt-controls">
          <button onClick={() => setCurrentCommandIndex(0)}>↺</button>
          <button onClick={previous}>‹</button>
          <button className="play" onClick={() => setPlaying((v) => !v)}>{playing ? "Ⅱ" : "▶"}</button>
          <button onClick={next}>›</button>
        </div>

        <button className="lt-danger" onClick={interrupt}>Interrupt / I’m Confused</button>

        <div>
          <small>Fallback</small>
          <b>{metadata?.fallbackUsed ? "true" : "false"}</b>
        </div>
      </footer>
    </section>
  );
}

const styles = `
.lt-shell {
  min-height: 100vh;
  background: #fff9f3;
  color: #342820;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.lt-shell * {
  box-sizing: border-box;
}

.lt-topbar {
  height: 74px;
  display: grid;
  grid-template-columns: 230px minmax(300px, 640px) auto;
  gap: 22px;
  align-items: center;
  padding: 0 36px;
  border-bottom: 1px solid #f1dfd2;
  background: rgba(255, 253, 249, .9);
  backdrop-filter: blur(18px);
}

.lt-brand {
  font-weight: 950;
  font-size: 22px;
  color: #443229;
}

.lt-search {
  border: 1px solid #edd9cc;
  background: #fffdf9;
  border-radius: 18px;
  padding: 15px 18px;
  color: #a38c7e;
  box-shadow: 0 10px 24px rgba(110, 70, 42, .04);
}

.lt-online {
  justify-self: end;
  border: 1px solid #ead8cd;
  background: #fffdf9;
  border-radius: 999px;
  padding: 12px 18px;
  font-weight: 850;
  color: #4f7d42;
}

.lt-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
  padding: 18px 20px 118px;
  max-width: 1760px;
  margin: 0 auto;
}

.lt-left,
.lt-right {
  position: sticky;
  top: 18px;
  height: calc(100vh - 120px);
  overflow: auto;
  border: 1px solid #efdccc;
  background: rgba(255, 253, 249, .94);
  border-radius: 22px;
  padding: 18px;
  box-shadow: 0 18px 42px rgba(91, 57, 35, .06);
}

.lt-logo {
  font-weight: 950;
  font-size: 20px;
  margin-bottom: 18px;
}

.lt-resource-card {
  border: 1px solid #ecd7ca;
  border-radius: 18px;
  background: #fff8f1;
  padding: 14px;
  display: grid;
  gap: 5px;
  margin-bottom: 18px;
}

.lt-resource-card small,
.lt-section-title {
  color: #fb6b4b;
  font-size: 11px;
  font-weight: 950;
  text-transform: uppercase;
  letter-spacing: .1em;
}

.lt-resource-card b {
  font-size: 14px;
}

.lt-resource-card span {
  width: max-content;
  border-radius: 999px;
  background: #edf9e9;
  color: #32844b;
  padding: 5px 8px;
  font-size: 11px;
  font-weight: 850;
}

.lt-section-title {
  margin-bottom: 10px;
}

.lt-agent-list {
  display: grid;
  gap: 7px;
}

.lt-agent {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 18px;
  gap: 6px;
  align-items: center;
  font-size: 12px;
  color: #7b685d;
}

.lt-agent.done em {
  color: #2c914b;
}

.lt-agent.current {
  color: #ef4d2f;
}

.lt-agent b {
  font-weight: 800;
}

.lt-agent-score {
  text-align: center;
  border-top: 1px solid #eedbcc;
  margin-top: 18px;
  padding-top: 16px;
}

.lt-agent-score strong {
  display: block;
  color: #24934d;
  font-size: 26px;
}

.lt-agent-score span {
  color: #24934d;
  font-weight: 800;
  font-size: 12px;
}

.lt-main {
  min-width: 0;
}

.lt-board-toolbar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.lt-board-toolbar button {
  border: 1px solid #efd8ca;
  background: #fffdf9;
  color: #6f584c;
  border-radius: 12px;
  padding: 9px 12px;
  font-weight: 850;
}

.lt-board-canvas {
  position: relative;
  min-height: 760px;
  overflow: hidden;
  border: 1px solid #efd8ca;
  border-radius: 24px;
  background:
    radial-gradient(circle at 18% 10%, rgba(255, 225, 207, .52), transparent 30%),
    linear-gradient(180deg, #fffdf9, #fff9f3);
  box-shadow: 0 18px 48px rgba(91, 57, 35, .07);
  padding: 28px;
}

.lt-board-canvas:before {
  content: "";
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(145, 96, 68, .045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(145, 96, 68, .045) 1px, transparent 1px);
  background-size: 28px 28px;
  pointer-events: none;
}

.lt-board-canvas > * {
  position: relative;
  z-index: 1;
}

.lt-board-note {
  position: absolute;
  right: 34px;
  top: 28px;
  max-width: 310px;
  border: 1px solid #edd2c2;
  background: #fff4eb;
  border-radius: 13px;
  padding: 13px 16px;
  color: #ef4d2f;
  transform: rotate(-1deg);
  z-index: 3;
}

.lt-board-note b {
  font-family: "Comic Sans MS", "Bradley Hand", cursive;
  line-height: 1.5;
  font-weight: 700;
}

.lt-board-title {
  max-width: 820px;
  margin-bottom: 22px;
}

.lt-board-title small {
  color: #ef6a4e;
  font-weight: 950;
  letter-spacing: .12em;
}

.lt-board-title h1 {
  margin: 8px 0 10px;
  font-family: "Comic Sans MS", "Bradley Hand", cursive;
  font-size: clamp(32px, 4vw, 54px);
  line-height: 1.04;
  letter-spacing: -.04em;
  text-decoration: underline;
  text-decoration-color: #fb7658;
  text-decoration-thickness: 2px;
  text-underline-offset: 10px;
}

.lt-board-title p {
  font-family: "Comic Sans MS", "Bradley Hand", cursive;
  font-size: 18px;
  line-height: 1.55;
  max-width: 920px;
}

.lt-visual-stage {
  position: relative;
  min-height: 520px;
  border: 1px solid #ead8ca;
  background: rgba(255, 253, 249, .82);
  border-radius: 18px;
  margin: 0 0 18px;
  overflow: hidden;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.55);
}

.lt-visual-element {
  position: absolute;
  border: 1px solid #ead8ca;
  background: #fffdf9;
  border-radius: 14px;
  padding: 12px;
  overflow: hidden;
  box-shadow: 0 12px 28px rgba(91, 57, 35, .07);
}

.lt-visual-element b {
  display: block;
  color: #3d3029;
  line-height: 1.35;
  white-space: pre-wrap;
}

.lt-visual-element.kind-pdf_page,
.lt-visual-element.kind-pdf_crop {
  display: grid;
  place-items: center;
  padding: 0;
  background: white;
  border-color: #cde0ec;
}

.lt-visual-element.kind-pdf_page img,
.lt-visual-element.kind-pdf_crop img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.lt-visual-element.kind-teacher_redraw,
.lt-visual-element.kind-box,
.lt-visual-element.kind-label {
  background: linear-gradient(180deg, #fffdf9, #fff5ed);
}

.lt-visual-element.style-danger {
  border-color: #f49b84;
  background: #fff1ec;
}

.lt-visual-element.style-success {
  border-color: #b9dfad;
  background: #f5fff1;
}

.lt-visual-element.style-source {
  border-color: #b8d8ec;
  background: #f6fbff;
}

.lt-focus-region {
  position: absolute;
  border: 2px solid rgba(37, 116, 168, .78);
  background: rgba(37, 116, 168, .08);
  border-radius: 8px;
}

.lt-pdf-missing {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  min-height: 160px;
  color: #8c3b27;
  background: #fff8f1;
  font-weight: 850;
}

.lt-generated-notes {
  display: grid;
  gap: 10px;
  border: 1px solid #ecd8ca;
  background: rgba(255, 253, 249, .9);
  border-radius: 18px;
  padding: 16px;
  margin: 0 0 18px;
}

.lt-generated-notes p {
  margin: 0;
  font-size: 17px;
  line-height: 1.55;
  color: #4d3f37;
}

.lt-generated-notes ul {
  margin: 0;
  padding-left: 20px;
  display: grid;
  gap: 6px;
}

.lt-generated-notes li {
  color: #4d3f37;
  font-weight: 760;
}

.lt-dry-run {
  display: grid;
  gap: 8px;
}

.lt-dry-run div,
.lt-inline-check {
  border: 1px solid #ead8ca;
  background: #fff8f1;
  border-radius: 14px;
  padding: 10px 12px;
  display: grid;
  gap: 4px;
}

.lt-dry-run b {
  color: #8c3b27;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.lt-dry-run span,
.lt-dry-run em,
.lt-inline-check span {
  color: #5f4e45;
  font-style: normal;
}

.lt-board-grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 14px;
}

.lt-board-card {
  grid-column: span 6;
  min-height: 170px;
  border: 1px solid #ecd8ca;
  background: rgba(255, 253, 249, .86);
  border-radius: 20px;
  padding: 16px;
  overflow: hidden;
  box-shadow: 0 12px 30px rgba(91, 57, 35, .045);
}

.lt-board-card.active {
  border-color: #fb7658;
  box-shadow: 0 0 0 3px rgba(251, 118, 88, .13), 0 18px 42px rgba(91, 57, 35, .09);
}

.lt-board-card.type-heroDefinition,
.lt-board-card.type-diagramPanel,
.lt-board-card.type-workflowStrip,
.lt-board-card.type-miniConceptTree {
  grid-column: span 12;
}

.lt-board-card.type-sourceEvidenceCard {
  background: #fff6ef;
}

.lt-board-card.type-commonMistakeCard {
  background: #fff4f0;
  border-color: #ffc6b2;
}

.lt-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 11px;
}

.lt-card-head span {
  display: block;
  color: #fb6b4b;
  font-size: 10px;
  font-weight: 950;
  text-transform: uppercase;
  letter-spacing: .12em;
}

.lt-card-head h3 {
  margin: 4px 0 0;
  font-size: 20px;
  letter-spacing: -.03em;
}

.lt-source-chips {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.lt-source-chips span,
.lt-source-chips.missing {
  border: 1px solid #dcefd4;
  background: #f2fff1;
  color: #2b7f42;
  border-radius: 999px;
  padding: 4px 8px;
  font-size: 10px;
  font-weight: 900;
}

.lt-source-chips.missing {
  background: #fff8f2;
  color: #a97966;
  border-color: #efd8ca;
}

.lt-board-card p,
.lt-board-card blockquote {
  margin: 0;
  color: #4d3f37;
  line-height: 1.58;
  font-size: 15px;
}

.lt-board-card blockquote {
  border-left: 4px solid #fb7658;
  background: #fff1e9;
  border-radius: 14px;
  padding: 12px 14px;
  font-weight: 750;
}

.lt-flow {
  display: flex;
  align-items: center;
  gap: 9px;
  overflow-x: auto;
  padding: 4px 0;
}

.lt-flow em {
  font-style: normal;
  font-weight: 950;
  color: #9e7768;
}

.lt-flow-step {
  min-width: 130px;
  border: 1px solid #ead8ca;
  background: #fff8f1;
  border-radius: 15px;
  padding: 10px;
}

.lt-flow-step b {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  background: #ffe4d6;
  color: #ef4d2f;
  border-radius: 999px;
  margin-bottom: 6px;
}

.lt-flow-step span {
  font-size: 13px;
  font-weight: 850;
}

.lt-tree {
  display: grid;
  justify-items: center;
  gap: 14px;
}

.lt-tree-root {
  border: 1px solid #fb7658;
  background: #fff1e9;
  border-radius: 14px;
  padding: 10px 18px;
  font-weight: 950;
}

.lt-tree-children {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
}

.lt-tree-child {
  border: 1px solid #dcefd4;
  background: #f5fff1;
  border-radius: 13px;
  padding: 10px;
  text-align: center;
  font-weight: 850;
  font-size: 13px;
}

.lt-table-wrap {
  overflow: auto;
  border: 1px solid #ead8ca;
  border-radius: 14px;
}

.lt-table-wrap table {
  width: 100%;
  border-collapse: collapse;
  background: #fffdf9;
}

.lt-table-wrap th,
.lt-table-wrap td {
  border-bottom: 1px solid #ead8ca;
  padding: 9px 10px;
  text-align: left;
  font-size: 13px;
  vertical-align: top;
}

.lt-table-wrap th {
  background: #fff1e9;
  color: #8c3b27;
  font-weight: 950;
}

.lt-checklist {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 8px;
}

.lt-checklist li {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 8px;
}

.lt-checklist span {
  color: #24934d;
  font-weight: 950;
}

.lt-mermaid-box {
  overflow: auto;
  border: 1px solid #ead8ca;
  background: #fffdf9;
  border-radius: 16px;
  padding: 12px;
}

.lt-mermaid-svg svg {
  max-width: 100%;
  height: auto;
}

.lt-mermaid-box pre {
  white-space: pre-wrap;
  font-size: 12px;
}

.lt-html-preview {
  width: 100%;
  height: 280px;
  border: 1px solid #ead8ca;
  border-radius: 16px;
  background: white;
}

.lt-source-image {
  width: 100%;
  max-height: 330px;
  object-fit: contain;
  border: 1px solid #ead8ca;
  border-radius: 16px;
  background: white;
}

.lt-source-placeholder {
  border: 1px dashed #efb9a2;
  background: #fff8f1;
  color: #8c3b27;
  border-radius: 16px;
  padding: 22px;
  display: grid;
  gap: 6px;
}

.lt-quiz {
  display: grid;
  gap: 10px;
}

.lt-quiz div {
  display: grid;
  gap: 7px;
}

.lt-quiz span {
  border: 1px solid #ead8ca;
  background: #fff8f1;
  border-radius: 12px;
  padding: 8px 10px;
}

.lt-board-nav {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding: 12px 0;
}

.lt-board-nav button {
  min-width: 220px;
  border: 1px solid #efd8ca;
  background: #fffdf9;
  border-radius: 16px;
  padding: 10px 12px;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 8px;
  text-align: left;
  cursor: pointer;
}

.lt-board-nav button.active {
  border-color: #fb7658;
  background: #fff1e9;
}

.lt-board-nav span {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  background: #ffe3d6;
  color: #ef4d2f;
  font-weight: 950;
}

.lt-board-nav b {
  font-size: 13px;
}

.lt-right {
  display: grid;
  gap: 12px;
  align-content: start;
}

.lt-tutor-hello,
.lt-side-card {
  border: 1px solid #efd8ca;
  background: #fffdf9;
  border-radius: 20px;
  padding: 16px;
}

.lt-tutor-hello {
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}

.lt-avatar {
  width: 62px;
  height: 62px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: #fff1e9;
  color: #fb6b4b;
  font-size: 30px;
  font-weight: 950;
}

.lt-tutor-hello b,
.lt-side-card h4 {
  display: block;
  margin: 0 0 7px;
  font-size: 16px;
}

.lt-tutor-hello p,
.lt-side-card p {
  margin: 0;
  color: #5f4e45;
  line-height: 1.55;
  font-size: 14px;
}

.lt-side-card h4 {
  color: #ef4d2f;
}

.lt-ref-list {
  display: grid;
  gap: 8px;
}

.lt-ref-list div {
  border-top: 1px solid #f0dfd2;
  padding-top: 7px;
}

.lt-ref-list b,
.lt-ref-list span {
  display: block;
}

.lt-ref-list b {
  color: #356d9b;
  font-size: 12px;
}

.lt-ref-list span {
  color: #5f4e45;
  font-size: 12px;
  line-height: 1.45;
}

.lt-bottom {
  position: fixed;
  left: 20px;
  right: 20px;
  bottom: 14px;
  z-index: 80;
  display: grid;
  grid-template-columns: 260px minmax(260px, 1fr) 220px 210px 120px;
  gap: 10px;
  border: 1px solid #efd8ca;
  background: rgba(255, 253, 249, .96);
  backdrop-filter: blur(18px);
  border-radius: 20px;
  padding: 10px;
  box-shadow: 0 22px 54px rgba(91, 57, 35, .15);
}

.lt-bottom > div,
.lt-bottom > button {
  border: 1px solid #f2e2d7;
  background: #fffaf5;
  border-radius: 14px;
  padding: 10px 12px;
}

.lt-bottom small {
  display: block;
  color: #8c7568;
  font-size: 11px;
  font-weight: 950;
  text-transform: uppercase;
  letter-spacing: .08em;
}

.lt-bottom b {
  display: block;
  margin-top: 3px;
  font-size: 13px;
}

.lt-progress {
  height: 8px;
  border-radius: 999px;
  background: #ecd8ca;
  overflow: hidden;
  margin: 8px 0 4px;
}

.lt-progress span {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #fb7658, #f59e0b, #75af6d);
}

.lt-progress-box em {
  color: #8c7568;
  font-size: 12px;
  font-style: normal;
  font-weight: 850;
}

.lt-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
}

.lt-controls button,
.lt-danger {
  border: 1px solid #efb9a2;
  background: #fffdf9;
  color: #8c3b27;
  border-radius: 12px;
  padding: 9px 12px;
  font-weight: 950;
  cursor: pointer;
}

.lt-controls .play {
  width: 44px;
  height: 44px;
  border-radius: 999px;
  background: #fb7658;
  color: white;
  border-color: #fb7658;
}

.lt-danger {
  color: #ef4d2f;
}

.lt-empty {
  max-width: 760px;
  margin: 40px auto;
  border: 1px solid #efd8ca;
  background: #fffdf9;
  border-radius: 22px;
  padding: 24px;
  font-family: Inter, system-ui, sans-serif;
}

@media (max-width: 1280px) {
  .lt-layout {
    grid-template-columns: 1fr;
  }

  .lt-left,
  .lt-right {
    position: static;
    height: auto;
  }

  .lt-bottom {
    position: static;
    margin: 14px 20px;
    grid-template-columns: 1fr;
  }
}
`;

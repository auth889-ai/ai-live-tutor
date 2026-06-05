import React, { useMemo, useRef, useEffect } from "react";
import mermaid from "mermaid";

/**
 * PremiumBoardScreenRenderer.jsx
 * =============================================================================
 * Real premium board screen renderer.
 *
 * This component renders backend-provided premiumBoardScreens only.
 * It does not invent PDF facts, section text, source quotes, or diagrams.
 *
 * Supported block types:
 * - heroDefinition
 * - workflowStrip
 * - miniConceptTree
 * - sourceEvidenceCard
 * - bestPracticeChecklist
 * - commonMistakeCard
 * - diagramPanel
 * - examplePanel
 * - mappingTable
 * - codeOrSqlExample
 * - dryRunPanel
 * - htmlPreviewCard
 * - sourcePagePreview
 * - quizCheckpoint
 * - voiceSubtitlePanel
 * - recapChecklist
 * - tutorActionRail
 * =============================================================================
 */

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

function htmlEscape(value) {
  return cleanText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function firstRef(refs) {
  return safeObject(safeArray(refs)[0]);
}

function refLabel(ref) {
  const item = safeObject(ref);
  return `p.${item.page || "?"}`;
}

function SourceChip({ ref }) {
  const item = safeObject(ref);
  if (!Object.keys(item).length) return null;

  return (
    <span className="source-chip" title={cleanText(item.quote)}>
      {refLabel(item)}
    </span>
  );
}

function SourceStrip({ refs, limit = 4 }) {
  const list = safeArray(refs).slice(0, limit);
  if (!list.length) {
    return <div className="source-strip missing">No sourceRefs on this block</div>;
  }

  return (
    <div className="source-strip">
      {list.map((ref, index) => (
        <SourceChip key={`${refLabel(ref)}-${index}`} ref={ref} />
      ))}
    </div>
  );
}

function BlockShell({ block, className = "", children }) {
  const refs = safeArray(block.sourceRefs);
  return (
    <article className={`premium-block ${className}`}>
      <div className="block-glow" />
      <div className="block-head">
        <div>
          <div className="block-type">{cleanText(block.type || block.sectionType, "block")}</div>
          <h3>{cleanText(block.title, "Untitled source-grounded block")}</h3>
        </div>
        <SourceStrip refs={refs} limit={3} />
      </div>
      {children}
    </article>
  );
}

function MissingBlockData({ title, message }) {
  return (
    <div className="missing-block-data">
      <b>{title}</b>
      <span>{message}</span>
    </div>
  );
}

function HeroBlock({ block }) {
  const body = cleanText(block.body || block.teacherNotes);
  return (
    <BlockShell block={block} className="hero-block">
      {body ? (
        <p className="hero-body">{body}</p>
      ) : (
        <MissingBlockData title="Hero text missing" message="Backend did not provide source-grounded hero body." />
      )}
      <EvidenceQuote refs={block.sourceRefs} />
    </BlockShell>
  );
}

function EvidenceQuote({ refs }) {
  const ref = firstRef(refs);
  const quote = cleanText(ref.quote);

  if (!quote) return null;

  return (
    <div className="evidence-quote">
      <strong>{refLabel(ref)} evidence</strong>
      <span>{quote}</span>
    </div>
  );
}

function EvidenceBlock({ block }) {
  const body = cleanText(block.body || block.teacherNotes);
  return (
    <BlockShell block={block} className="evidence-block">
      {body ? <p>{body}</p> : <EvidenceQuote refs={block.sourceRefs} />}
      <EvidenceQuote refs={block.sourceRefs} />
    </BlockShell>
  );
}

function WorkflowBlock({ block }) {
  const nodes = getNodes(block);
  const edges = getEdges(block);

  return (
    <BlockShell block={block} className="workflow-block">
      {nodes.length ? (
        <div className="workflow-row">
          {nodes.slice(0, 5).map((node, index) => (
            <React.Fragment key={node.id || `${node.label}-${index}`}>
              <div className="workflow-step">
                <span>{index + 1}</span>
                <b>{cleanText(node.label || node.title || node.id, `Step ${index + 1}`)}</b>
              </div>
              {index < Math.min(nodes.length, 5) - 1 ? <div className="workflow-arrow">→</div> : null}
            </React.Fragment>
          ))}
        </div>
      ) : (
        <p>{cleanText(block.body || block.teacherNotes, "Workflow data missing from backend.")}</p>
      )}

      {edges.length ? (
        <div className="edge-notes">
          {edges.slice(0, 4).map((edge, index) => (
            <span key={edge.id || index}>{cleanText(edge.label || "connects")}</span>
          ))}
        </div>
      ) : null}
    </BlockShell>
  );
}

function getNodes(block) {
  const fromBlock = safeArray(block.nodes);
  const diagram = safeObject(block.diagram);
  const fromDiagram = safeArray(diagram.nodes);
  return (fromBlock.length ? fromBlock : fromDiagram).map((node, index) => {
    const item = safeObject(node);
    return {
      id: cleanText(item.id || item.nodeId || `node_${index + 1}`),
      label: cleanText(item.label || item.title || item.text || item.name || `Node ${index + 1}`),
      type: cleanText(item.type || "concept"),
    };
  });
}

function getEdges(block) {
  const fromBlock = safeArray(block.edges);
  const diagram = safeObject(block.diagram);
  const fromDiagram = safeArray(diagram.edges);
  return (fromBlock.length ? fromBlock : fromDiagram).map((edge, index) => {
    const item = safeObject(edge);
    return {
      id: cleanText(item.id || `edge_${index + 1}`),
      from: cleanText(item.from || item.source),
      to: cleanText(item.to || item.target),
      label: cleanText(item.label || ""),
    };
  });
}

function ConceptTreeBlock({ block }) {
  const nodes = getNodes(block);
  const edges = getEdges(block);
  const root = nodes[0];

  return (
    <BlockShell block={block} className="tree-block">
      {nodes.length ? (
        <div className="tree-canvas">
          <div className="tree-root">{cleanText(root?.label, block.title)}</div>
          <div className="tree-children">
            {nodes.slice(1, 7).map((node, index) => (
              <div key={node.id || index} className="tree-child">
                <span />
                <b>{cleanText(node.label, `Concept ${index + 1}`)}</b>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <MissingBlockData title="Tree data missing" message="Backend did not send nodes for miniConceptTree." />
      )}

      {edges.length ? <small>{edges.length} source-grounded relations</small> : null}
    </BlockShell>
  );
}

function MappingTableBlock({ block }) {
  const columns = safeArray(block.columns).map((col) => cleanText(col)).filter(Boolean);
  const rows = safeArray(block.rows);

  return (
    <BlockShell block={block} className="table-block">
      {columns.length && rows.length ? (
        <div className="premium-table-wrap">
          <table className="premium-table">
            <thead>
              <tr>
                {columns.slice(0, 4).map((col) => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 6).map((row, rowIndex) => {
                const item = safeObject(row);
                return (
                  <tr key={rowIndex}>
                    {columns.slice(0, 4).map((col, colIndex) => (
                      <td key={`${col}-${colIndex}`}>
                        {cleanText(item[col] || item[col.toLowerCase()] || item[String(colIndex)] || "")}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p>{cleanText(block.body || block.teacherNotes, "Mapping table rows/columns missing.")}</p>
      )}
    </BlockShell>
  );
}

function ChecklistBlock({ block }) {
  const items = safeArray(block.items)
    .map((item) => cleanText(item))
    .filter(Boolean);

  const fallback = cleanText(block.body || block.teacherNotes)
    .split(/\n|\.|;/)
    .map((item) => item.trim())
    .filter((item) => item.length > 5)
    .slice(0, 5);

  const list = items.length ? items : fallback;

  return (
    <BlockShell block={block} className="checklist-block">
      {list.length ? (
        <ul className="premium-checklist">
          {list.slice(0, 6).map((item, index) => (
            <li key={`${item}-${index}`}>
              <span>✓</span>
              <b>{item}</b>
            </li>
          ))}
        </ul>
      ) : (
        <MissingBlockData title="Checklist missing" message="Backend did not send items/body." />
      )}
    </BlockShell>
  );
}

function WarningBlock({ block }) {
  return (
    <BlockShell block={block} className="warning-block">
      <div className="warning-icon">!</div>
      <p>{cleanText(block.body || block.teacherNotes, "Common mistake body missing.")}</p>
    </BlockShell>
  );
}

function ExampleBlock({ block }) {
  return (
    <BlockShell block={block} className="example-block">
      <p>{cleanText(block.body || block.teacherNotes, "Example body missing.")}</p>
    </BlockShell>
  );
}

function QuizBlock({ block, quiz }) {
  const quizObj = safeObject(quiz);
  const firstQuestion = safeArray(quizObj.questions || quizObj.quiz)[0];
  const questionObj = safeObject(firstQuestion);

  const question =
    cleanText(block.body) ||
    cleanText(questionObj.question) ||
    cleanText(quizObj.question);

  const choices = safeArray(questionObj.choices || questionObj.options);

  return (
    <BlockShell block={block} className="quiz-block">
      {question ? (
        <>
          <div className="quiz-question">{question}</div>
          {choices.length ? (
            <div className="quiz-options">
              {choices.slice(0, 4).map((choice, index) => (
                <span key={`${choice}-${index}`}>
                  {String.fromCharCode(65 + index)}. {cleanText(choice)}
                </span>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <MissingBlockData title="Quiz question missing" message="Backend did not send quiz text." />
      )}
    </BlockShell>
  );
}

function CodeBlock({ block }) {
  const code = cleanText(block.code || block.sql || block.body || block.teacherNotes);
  return (
    <BlockShell block={block} className="code-block">
      {code ? <pre>{code}</pre> : <MissingBlockData title="Code/dry-run missing" message="Backend did not send code trace." />}
    </BlockShell>
  );
}

function HtmlPreviewBlock({ block }) {
  const html = cleanText(block.html || block.srcDoc);
  return (
    <BlockShell block={block} className="html-preview-block">
      {html ? (
        <iframe title={cleanText(block.title, "HTML preview")} sandbox="" srcDoc={html} />
      ) : (
        <p>{cleanText(block.body || block.teacherNotes, "HTML preview content missing.")}</p>
      )}
    </BlockShell>
  );
}

function SourcePagePreviewBlock({ block, imagePreviews }) {
  const direct = cleanText(block.imageRef || block.src || block.url);
  const page = Number(block.page || firstRef(block.sourceRefs).page || 0);
  const matching = safeArray(imagePreviews).find((item) => Number(safeObject(item).page) === page);
  const matchObj = safeObject(matching);
  const src = direct || cleanText(matchObj.url || matchObj.src || matchObj.imageRef);

  return (
    <BlockShell block={block} className="source-page-preview-block">
      {src ? (
        <img src={src} alt={cleanText(block.title, "Source page preview")} />
      ) : (
        <div className="source-page-placeholder">
          <b>{page ? `Source page ${page}` : "Source page preview"}</b>
          <span>Backend has not sent a page screenshot/imageRef yet.</span>
        </div>
      )}
    </BlockShell>
  );
}

function MermaidBlock({ block, compiledDiagrams, diagramArtifacts }) {
  const localMermaid = cleanText(block.mermaid);
  const visualType = cleanText(block.visualType || block.sectionType || block.type).toLowerCase();
  const compiled = safeArray(compiledDiagrams).find((item) => {
    const d = safeObject(item);
    return cleanText(d.diagramType).toLowerCase() === visualType || cleanText(d.title).toLowerCase().includes(cleanText(block.title).toLowerCase());
  });
  const artifact = safeArray(diagramArtifacts.mermaid).find((item) => {
    const d = safeObject(item);
    return cleanText(d.diagramType).toLowerCase() === visualType || cleanText(d.title).toLowerCase().includes(cleanText(block.title).toLowerCase());
  });

  const code = localMermaid || cleanText(safeObject(compiled).mermaid) || cleanText(safeObject(artifact).code);
  const nodes = getNodes(block);

  return (
    <BlockShell block={block} className="diagram-block">
      {code ? (
        <MermaidRenderer code={code} title={cleanText(block.title, "Diagram")} />
      ) : nodes.length ? (
        <WorkflowBlock block={{ ...block, type: "workflowStrip" }} />
      ) : (
        <p>{cleanText(block.body || block.teacherNotes, "Diagram data missing.")}</p>
      )}
    </BlockShell>
  );
}

function MermaidRenderer({ code, title }) {
  const id = useMemo(() => `premium_mermaid_${Math.random().toString(36).slice(2)}`, []);
  const ref = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      if (!ref.current || !code) return;

      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "strict",
        });
        const result = await mermaid.render(id, code);
        if (!cancelled && ref.current) ref.current.innerHTML = result.svg;
      } catch {
        if (!cancelled && ref.current) {
          ref.current.innerHTML = `<pre>${htmlEscape(code)}</pre>`;
        }
      }
    }

    render();

    return () => {
      cancelled = true;
    };
  }, [code, id]);

  return (
    <div className="mermaid-shell">
      <div className="mermaid-title">{title}</div>
      <div ref={ref} className="mermaid-rendered" />
    </div>
  );
}

function VoiceSubtitlePanel({ voiceScript, subtitles, screenIndex }) {
  const voice = safeArray(voiceScript);
  const subs = safeArray(subtitles);
  const voiceLine = safeObject(voice[Math.min(screenIndex, Math.max(0, voice.length - 1))] || voice[0]);
  const subtitle = safeObject(subs[Math.min(screenIndex, Math.max(0, subs.length - 1))] || subs[0]);

  return (
    <aside className="tutor-rail-card voice-card">
      <div className="rail-kicker">Tutor voice</div>
      <p>{cleanText(voiceLine.text || voiceLine.line, "Voice script not received for this screen.")}</p>
      <div className="rail-kicker">Subtitle</div>
      <p>{cleanText(subtitle.text || subtitle.caption, "Subtitle not received for this screen.")}</p>
    </aside>
  );
}

function SourceRail({ refs, sourceCards }) {
  const list = safeArray(sourceCards).length ? safeArray(sourceCards) : safeArray(refs);

  return (
    <aside className="tutor-rail-card source-rail">
      <div className="rail-kicker">Source evidence</div>
      {list.length ? (
        list.slice(0, 4).map((ref, index) => {
          const item = safeObject(ref);
          return (
            <div key={`${item.chunkId || item.page || "ref"}-${index}`} className="rail-source">
              <b>{refLabel(item)}</b>
              <span>{cleanText(item.quote, "Source quote missing").slice(0, 220)}</span>
            </div>
          );
        })
      ) : (
        <p>No sourceRefs received.</p>
      )}
    </aside>
  );
}

function renderBlock(block, context) {
  const type = cleanText(block.type);

  if (type === "heroDefinition") return <HeroBlock block={block} />;
  if (type === "workflowStrip") return <WorkflowBlock block={block} />;
  if (type === "miniConceptTree") return <ConceptTreeBlock block={block} />;
  if (type === "sourceEvidenceCard") return <EvidenceBlock block={block} />;
  if (type === "bestPracticeChecklist" || type === "recapChecklist") return <ChecklistBlock block={block} />;
  if (type === "commonMistakeCard") return <WarningBlock block={block} />;
  if (type === "diagramPanel") return <MermaidBlock block={block} compiledDiagrams={context.compiledDiagrams} diagramArtifacts={context.diagramArtifacts} />;
  if (type === "examplePanel") return <ExampleBlock block={block} />;
  if (type === "mappingTable") return <MappingTableBlock block={block} />;
  if (type === "codeOrSqlExample" || type === "dryRunPanel") return <CodeBlock block={block} />;
  if (type === "htmlPreviewCard") return <HtmlPreviewBlock block={block} />;
  if (type === "sourcePagePreview") return <SourcePagePreviewBlock block={block} imagePreviews={context.imagePreviews} />;
  if (type === "quizCheckpoint") return <QuizBlock block={block} quiz={context.quiz} />;
  if (type === "voiceSubtitlePanel") {
    return (
      <VoiceSubtitlePanel
        voiceScript={context.voiceScript}
        subtitles={context.subtitles}
        screenIndex={context.screenIndex}
      />
    );
  }

  return <ExampleBlock block={block} />;
}

function splitBlocks(blocks) {
  const list = safeArray(blocks).map((item) => safeObject(item)).filter(Boolean);

  const hero = list.find((block) => block.role === "hero" || block.type === "heroDefinition") || list[0];
  const visual = list.find((block) => ["visual", "top"].includes(block.role) || ["diagramPanel", "workflowStrip", "miniConceptTree"].includes(block.type));
  const evidence = list.find((block) => block.role === "evidence" || block.type === "sourceEvidenceCard");
  const support = list.filter((block) => block !== hero && block !== visual && block !== evidence);

  return {
    hero,
    visual,
    evidence,
    support,
  };
}

export default function PremiumBoardScreenRenderer({
  screen,
  screenIndex = 0,
  screenCount = 1,
  voiceScript = [],
  subtitles = [],
  sourceRefs = [],
  sourceCards = [],
  diagramArtifacts = {},
  compiledDiagrams = [],
  htmlPreviews = [],
  imagePreviews = [],
  quiz = null,
  lessonTranscript = "",
  onNext,
  onPrev,
  canNext = false,
  canPrev = false,
}) {
  const screenObj = safeObject(screen);
  const blocks = safeArray(screenObj.blocks);
  const refs = safeArray(screenObj.sourceRefs).length ? safeArray(screenObj.sourceRefs) : safeArray(sourceRefs);
  const parts = splitBlocks(blocks);

  const context = {
    screenIndex,
    voiceScript,
    subtitles,
    sourceRefs: refs,
    sourceCards,
    diagramArtifacts: safeObject(diagramArtifacts),
    compiledDiagrams,
    htmlPreviews,
    imagePreviews,
    quiz,
    lessonTranscript,
  };

  return (
    <main className="premium-board-wrap">
      <style>{styles}</style>

      <section className={`premium-board template-${cleanText(screenObj.layoutTemplate || "default")}`}>
        <div className="board-top">
          <div>
            <div className="board-kicker">Board {screenIndex + 1} of {screenCount}</div>
            <h2>{cleanText(screenObj.title, `Board ${screenIndex + 1}`)}</h2>
            <p>{cleanText(screenObj.goal, "Source-grounded lesson screen.")}</p>
          </div>

          <div className="board-nav">
            <button type="button" onClick={onPrev} disabled={!canPrev}>Prev</button>
            <button type="button" onClick={onNext} disabled={!canNext}>Next</button>
          </div>
        </div>

        <div className="board-content-grid">
          <section className="board-main">
            {parts.hero ? (
              <div className="hero-zone">{renderBlock(parts.hero, context)}</div>
            ) : (
              <MissingBlockData title="Hero block missing" message="Backend did not send heroDefinition block." />
            )}

            {parts.visual ? (
              <div className="visual-zone">{renderBlock(parts.visual, context)}</div>
            ) : (
              <MissingBlockData title="Visual block missing" message="Backend did not send diagram/workflow/tree block." />
            )}
          </section>

          <aside className="board-side">
            {parts.evidence ? renderBlock(parts.evidence, context) : <EvidenceQuote refs={refs} />}
            <VoiceSubtitlePanel voiceScript={voiceScript} subtitles={subtitles} screenIndex={screenIndex} />
          </aside>
        </div>

        <section className="support-grid">
          {parts.support.length ? (
            parts.support.slice(0, 4).map((block, index) => (
              <div key={cleanText(block.blockId || index)}>
                {renderBlock(block, context)}
              </div>
            ))
          ) : (
            <MissingBlockData title="Support blocks missing" message="Backend did not send example/table/quiz/checklist blocks for this screen." />
          )}
        </section>

        <footer className="board-footer">
          <div className="footer-sources">
            <span>Sources</span>
            <SourceStrip refs={refs} limit={8} />
          </div>
          <div className="footer-meta">
            <span>{cleanText(screenObj.layoutTemplate, "premium layout")}</span>
            <span>{blocks.length} blocks</span>
          </div>
        </footer>
      </section>

      <section className="right-rail">
        <SourceRail refs={refs} sourceCards={sourceCards} />
      </section>
    </main>
  );
}

const styles = `
  .premium-board-wrap {
    max-width: 1480px;
    margin: 0 auto 18px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 330px;
    gap: 16px;
    align-items: start;
  }

  .premium-board {
    position: relative;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,.12);
    border-radius: 34px;
    min-height: 820px;
    padding: 22px;
    background:
      linear-gradient(135deg, rgba(15,23,42,.92), rgba(2,6,23,.95)),
      radial-gradient(circle at top left, rgba(20,184,166,.20), transparent 36%),
      radial-gradient(circle at bottom right, rgba(168,85,247,.18), transparent 36%);
    box-shadow: 0 32px 110px rgba(0,0,0,.46);
  }

  .premium-board:before {
    content: "";
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
    background-size: 32px 32px;
    mask-image: linear-gradient(to bottom, rgba(0,0,0,.85), rgba(0,0,0,.35));
    pointer-events: none;
  }

  .premium-board > * {
    position: relative;
    z-index: 1;
  }

  .board-top {
    display: flex;
    justify-content: space-between;
    gap: 18px;
    align-items: flex-start;
    margin-bottom: 18px;
  }

  .board-kicker,
  .block-type,
  .rail-kicker {
    color: #67e8f9;
    text-transform: uppercase;
    letter-spacing: .16em;
    font-weight: 950;
    font-size: 11px;
  }

  .board-top h2 {
    margin: 4px 0 0;
    font-size: 34px;
    line-height: 1.05;
    letter-spacing: -.055em;
  }

  .board-top p {
    margin: 8px 0 0;
    color: #cbd5e1;
    line-height: 1.55;
    max-width: 860px;
  }

  .board-nav {
    display: flex;
    gap: 8px;
  }

  .board-nav button {
    border: 0;
    border-radius: 14px;
    padding: 10px 13px;
    background: linear-gradient(135deg, #67e8f9, #a78bfa);
    color: #020617;
    font-weight: 950;
    cursor: pointer;
  }

  .board-nav button:disabled {
    opacity: .45;
    cursor: not-allowed;
  }

  .board-content-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: 14px;
  }

  .board-main {
    display: grid;
    gap: 14px;
  }

  .hero-zone .premium-block {
    min-height: 170px;
  }

  .visual-zone .premium-block {
    min-height: 350px;
  }

  .board-side {
    display: grid;
    gap: 14px;
    align-content: start;
  }

  .support-grid {
    margin-top: 14px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }

  .premium-block,
  .tutor-rail-card,
  .missing-block-data {
    position: relative;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,.12);
    border-radius: 26px;
    padding: 16px;
    background: rgba(15,23,42,.72);
    box-shadow: 0 18px 60px rgba(0,0,0,.28);
  }

  .block-glow {
    position: absolute;
    inset: auto -20% -40% auto;
    width: 180px;
    height: 180px;
    border-radius: 999px;
    background: rgba(103,232,249,.10);
    filter: blur(22px);
    pointer-events: none;
  }

  .block-head {
    position: relative;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
    margin-bottom: 12px;
  }

  .premium-block h3 {
    margin: 4px 0 0;
    font-size: 20px;
    letter-spacing: -.03em;
  }

  .premium-block p,
  .tutor-rail-card p,
  .missing-block-data span {
    color: #dbeafe;
    line-height: 1.62;
    margin: 0;
  }

  .hero-block {
    background:
      linear-gradient(135deg, rgba(14,165,233,.22), rgba(15,23,42,.82)),
      rgba(15,23,42,.72);
  }

  .hero-body {
    font-size: 22px;
    font-weight: 850;
    color: #f8fafc !important;
  }

  .evidence-quote {
    margin-top: 14px;
    border-left: 4px solid #67e8f9;
    background: rgba(8,145,178,.14);
    border-radius: 16px;
    padding: 12px;
  }

  .evidence-quote strong,
  .evidence-quote span {
    display: block;
  }

  .evidence-quote strong {
    color: #67e8f9;
    margin-bottom: 4px;
  }

  .evidence-quote span {
    color: #cffafe;
    line-height: 1.45;
  }

  .source-strip {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }

  .source-strip.missing {
    color: #fecaca;
    font-size: 12px;
  }

  .source-chip {
    border: 1px solid rgba(103,232,249,.28);
    background: rgba(8,145,178,.16);
    color: #cffafe;
    border-radius: 999px;
    padding: 5px 8px;
    font-size: 12px;
    font-weight: 900;
  }

  .workflow-row {
    display: flex;
    align-items: stretch;
    gap: 9px;
    overflow-x: auto;
    padding-bottom: 8px;
  }

  .workflow-step {
    flex: 1 0 130px;
    min-height: 92px;
    border: 1px solid rgba(125,211,252,.28);
    background: rgba(2,6,23,.58);
    border-radius: 20px;
    padding: 12px;
  }

  .workflow-step span {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border-radius: 11px;
    background: rgba(103,232,249,.18);
    color: #cffafe;
    font-weight: 950;
    margin-bottom: 8px;
  }

  .workflow-step b {
    color: #f8fafc;
    line-height: 1.25;
  }

  .workflow-arrow {
    display: grid;
    place-items: center;
    color: #67e8f9;
    font-size: 24px;
    font-weight: 950;
  }

  .edge-notes {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }

  .edge-notes span {
    border-radius: 999px;
    padding: 5px 8px;
    background: rgba(255,255,255,.07);
    color: #cbd5e1;
    font-size: 12px;
  }

  .tree-canvas {
    display: grid;
    grid-template-columns: 210px minmax(0, 1fr);
    gap: 14px;
    align-items: center;
  }

  .tree-root {
    min-height: 100px;
    display: grid;
    place-items: center;
    text-align: center;
    border-radius: 24px;
    background: rgba(20,184,166,.18);
    border: 1px solid rgba(94,234,212,.38);
    color: #ccfbf1;
    font-weight: 950;
    padding: 14px;
  }

  .tree-children {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 9px;
  }

  .tree-child {
    display: flex;
    gap: 8px;
    align-items: center;
    border: 1px solid rgba(255,255,255,.10);
    background: rgba(2,6,23,.52);
    border-radius: 16px;
    padding: 10px;
  }

  .tree-child span {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: #67e8f9;
    box-shadow: 0 0 18px rgba(103,232,249,.80);
  }

  .tree-child b {
    color: #e0f2fe;
    font-size: 13px;
  }

  .premium-table-wrap {
    overflow: auto;
  }

  .premium-table {
    width: 100%;
    border-collapse: collapse;
    overflow: hidden;
    border-radius: 16px;
    font-size: 13px;
  }

  .premium-table th,
  .premium-table td {
    border: 1px solid rgba(255,255,255,.09);
    padding: 10px;
    text-align: left;
    vertical-align: top;
  }

  .premium-table th {
    color: #cffafe;
    background: rgba(8,145,178,.18);
  }

  .premium-table td {
    color: #dbeafe;
    background: rgba(2,6,23,.42);
  }

  .premium-checklist {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 9px;
  }

  .premium-checklist li {
    display: flex;
    gap: 9px;
    align-items: flex-start;
    color: #dbeafe;
  }

  .premium-checklist li span {
    width: 24px;
    height: 24px;
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    border-radius: 9px;
    background: rgba(34,197,94,.16);
    color: #86efac;
    font-weight: 950;
  }

  .warning-block {
    background: linear-gradient(135deg, rgba(127,29,29,.38), rgba(15,23,42,.78));
    border-color: rgba(248,113,113,.28);
  }

  .warning-icon {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border-radius: 13px;
    color: #fecaca;
    background: rgba(220,38,38,.24);
    border: 1px solid rgba(248,113,113,.30);
    font-weight: 950;
    margin-bottom: 10px;
  }

  .quiz-question {
    font-size: 20px;
    font-weight: 900;
    line-height: 1.35;
    color: #f8fafc;
  }

  .quiz-options {
    display: grid;
    gap: 8px;
    margin-top: 12px;
  }

  .quiz-options span {
    border: 1px solid rgba(255,255,255,.10);
    background: rgba(2,6,23,.46);
    border-radius: 14px;
    padding: 10px;
    color: #dbeafe;
  }

  .code-block pre,
  .mermaid-rendered pre {
    margin: 0;
    max-height: 260px;
    overflow: auto;
    white-space: pre-wrap;
    background: #020617;
    border: 1px solid rgba(255,255,255,.10);
    border-radius: 16px;
    padding: 13px;
    color: #dbeafe;
    font-size: 12px;
    line-height: 1.5;
  }

  .html-preview-block iframe {
    width: 100%;
    min-height: 220px;
    border: 1px solid rgba(255,255,255,.12);
    border-radius: 16px;
    background: white;
  }

  .source-page-preview-block img {
    width: 100%;
    max-height: 300px;
    object-fit: contain;
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,.10);
    background: #020617;
  }

  .source-page-placeholder {
    min-height: 180px;
    border: 1px dashed rgba(103,232,249,.32);
    border-radius: 18px;
    display: grid;
    place-items: center;
    text-align: center;
    padding: 18px;
    color: #cbd5e1;
  }

  .source-page-placeholder b,
  .source-page-placeholder span {
    display: block;
  }

  .mermaid-shell {
    border: 1px solid rgba(255,255,255,.09);
    background: rgba(2,6,23,.50);
    border-radius: 18px;
    padding: 12px;
    overflow: auto;
  }

  .mermaid-title {
    color: #c4b5fd;
    font-weight: 900;
    margin-bottom: 8px;
  }

  .mermaid-rendered {
    min-height: 180px;
    display: grid;
    place-items: center;
  }

  .mermaid-rendered svg {
    max-width: 100%;
    height: auto;
  }

  .board-footer {
    margin-top: 14px;
    display: flex;
    justify-content: space-between;
    gap: 14px;
    align-items: center;
    border-top: 1px solid rgba(255,255,255,.09);
    padding-top: 14px;
  }

  .footer-sources {
    display: flex;
    align-items: center;
    gap: 9px;
    flex-wrap: wrap;
  }

  .footer-sources > span,
  .footer-meta span {
    color: #94a3b8;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: .10em;
    font-weight: 900;
  }

  .footer-meta {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .right-rail {
    display: grid;
    gap: 14px;
  }

  .tutor-rail-card {
    background: rgba(15,23,42,.84);
  }

  .voice-card p {
    margin: 8px 0 14px;
  }

  .source-rail {
    max-height: 650px;
    overflow: auto;
  }

  .rail-source {
    border: 1px solid rgba(103,232,249,.18);
    background: rgba(8,145,178,.10);
    border-radius: 16px;
    padding: 11px;
    margin-top: 9px;
  }

  .rail-source b {
    display: block;
    color: #67e8f9;
    margin-bottom: 5px;
  }

  .rail-source span {
    display: block;
    color: #dbeafe;
    font-size: 13px;
    line-height: 1.45;
  }

  .missing-block-data {
    color: #fecaca;
    background: rgba(127,29,29,.24);
    border-color: rgba(248,113,113,.32);
  }

  .missing-block-data b,
  .missing-block-data span {
    display: block;
  }

  .missing-block-data span {
    margin-top: 5px;
  }

  @media (max-width: 1180px) {
    .premium-board-wrap {
      grid-template-columns: 1fr;
    }

    .right-rail {
      grid-template-columns: 1fr 1fr;
    }
  }

  @media (max-width: 900px) {
    .premium-board {
      padding: 14px;
      border-radius: 24px;
    }

    .board-content-grid,
    .support-grid,
    .tree-canvas,
    .right-rail {
      grid-template-columns: 1fr;
    }

    .board-top,
    .board-footer {
      flex-direction: column;
      align-items: flex-start;
    }

    .board-top h2 {
      font-size: 26px;
    }

    .workflow-row {
      flex-direction: column;
    }

    .workflow-arrow {
      transform: rotate(90deg);
    }
  }
`;
import React, { useMemo, useState } from "react";
import PremiumBoardScreenRenderer from "./PremiumBoardScreenRenderer.jsx";
import LiveTutorBoardPlayer from "./LiveTutorBoardPlayer.jsx";

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

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function firstArray(...values) {
  for (const value of values) {
    const arr = safeArray(value);
    if (arr.length) return arr;
  }
  return [];
}

function nestedResult(value) {
  const root = safeObject(value);
  const inner = safeObject(root.result);
  return Object.keys(inner).length ? inner : root;
}

function blockPayload(block) {
  return safeObject(block?.payload || block?.visualPayload || block?.diagram || {});
}

function normalizeElement(element, index, screenNo) {
  const raw = safeObject(element);
  const elementId = cleanText(
    raw.elementId ||
      raw.id ||
      raw.targetElementId ||
      `screen_${screenNo}_element_${index + 1}`
  );

  return {
    ...raw,
    elementId,
    id: elementId,
    kind: cleanText(raw.kind || raw.type || "box"),
    content: cleanText(raw.content || raw.text || raw.label || ""),
    style: cleanText(raw.style || "normal"),
    position: safeObject(raw.position || raw.bbox),
    bbox: safeObject(raw.bbox || raw.position),
    pageNumber: num(raw.pageNumber || raw.page, 0),
    pageImageUrl: cleanText(raw.pageImageUrl || raw.imageUrl || raw.url || raw.src || ""),
    parentElementId: cleanText(raw.parentElementId || ""),
    regionId: cleanText(raw.regionId || raw.targetRegionId || ""),
    sourceMode: cleanText(raw.sourceMode || ""),
  };
}

function normalizeFocusRegion(region, index) {
  const raw = safeObject(region);
  return {
    ...raw,
    regionId: cleanText(raw.regionId || raw.id || `region_${index + 1}`),
    parentElementId: cleanText(raw.parentElementId || raw.parentId || ""),
    label: cleanText(raw.label || raw.description || raw.type || ""),
    type: cleanText(raw.type || "source_region"),
    bbox: safeObject(raw.bbox || raw.position),
  };
}

function normalizeBlock(block, index, screenNo) {
  const raw = safeObject(block);
  const payload = blockPayload(raw);

  const blockId = cleanText(
    raw.blockId ||
      raw.id ||
      raw.targetId ||
      payload.blockId ||
      payload.targetBlockId ||
      `screen_${screenNo}_block_${index + 1}`
  );

  const rows = firstArray(raw.rows, payload.rows, payload.table?.rows);
  const columns = firstArray(raw.columns, payload.columns, payload.table?.columns);
  const items = firstArray(raw.items, payload.items, payload.checklist, payload.mistakes);
  const nodes = firstArray(raw.nodes, payload.nodes, payload.reactFlow?.nodes, payload.diagram?.nodes);
  const edges = firstArray(raw.edges, payload.edges, payload.reactFlow?.edges, payload.diagram?.edges);
  const sourceRefs = firstArray(raw.sourceRefs, payload.sourceRefs);

  return {
    ...raw,
    blockId,
    id: blockId,
    screenNo,
    type: cleanText(raw.type || raw.blockType || payload.type || "heroDefinition"),
    title: cleanText(raw.title || payload.title || `Block ${index + 1}`),
    body: cleanText(
        raw.body ||
        raw.text ||
        raw.content ||
        raw.teacherNotes ||
        payload.body ||
        payload.content ||
        payload.teacherMeaning ||
        payload.description ||
        ""
    ),
    teacherNotes: cleanText(raw.teacherNotes || payload.teacherNotes || raw.body || payload.body || ""),
    sourceRefs,
    rows,
    columns,
    items,
    nodes,
    edges,
    mermaid: cleanText(raw.mermaid || payload.mermaid || payload.code || ""),
    html: cleanText(raw.html || raw.srcDoc || payload.html || payload.srcDoc || ""),
    imageRef: cleanText(raw.imageRef || raw.src || raw.url || payload.imageRef || payload.src || payload.url || ""),
    page: num(raw.page || payload.page, 0),
    diagram: safeObject(raw.diagram || payload.diagram || payload),
    payload: {
      ...payload,
      blockId,
      targetBlockId: blockId,
      screenNo,
      sourceRefs,
      rows,
      columns,
      items,
      nodes,
      edges,
    },
  };
}

function normalizeScreen(screen, index) {
  const raw = safeObject(screen);
  const screenNo = num(raw.screenNo || raw.screenNumber || raw.screenIndex, index + 1);
  const screenId = cleanText(raw.screenId || raw.id || `screen_${screenNo}`);
  const visualElements = safeArray(raw.visualElements).map((element, elementIndex) =>
    normalizeElement(element, elementIndex, screenNo)
  );
  const focusRegions = safeArray(raw.focusRegions).map(normalizeFocusRegion);

  return {
    ...raw,
    screenId,
    id: screenId,
    screenNo,
    screenNumber: screenNo,
    screenIndex: screenNo,
    title: cleanText(raw.title || `Board ${screenNo}`),
    goal: cleanText(raw.goal || raw.tutorGoal || raw.subtitle || raw.voiceHint || ""),
    subtitle: cleanText(raw.subtitle || raw.goal || raw.tutorGoal || ""),
    voiceHint: cleanText(raw.voiceHint || ""),
    sourceRefs: firstArray(raw.sourceRefs, raw.sourceRef ? [raw.sourceRef] : []),
    sourceRef: safeObject(raw.sourceRef),
    visualElements,
    focusRegions,
    boardActions: safeArray(raw.boardActions),
    voiceover: cleanText(raw.voiceover || ""),
    voiceLines: safeArray(raw.voiceLines),
    teacherNote: cleanText(raw.teacherNote || ""),
    boardWriting: cleanText(raw.boardWriting || ""),
    keyPoints: safeArray(raw.keyPoints),
    dryRun: safeArray(raw.dryRun),
    pageElement: safeObject(raw.pageElement),
    blocks: safeArray(raw.blocks).map((block, blockIndex) => normalizeBlock(block, blockIndex, screenNo)),
    layout: {
      ...safeObject(raw.layout),
      autoScale: true,
      autoGrow: true,
      avoidOverlap: true,
      variant: "dynamicSourceGroundedTeacherBoard",
    },
  };
}

function commandType(type) {
  const value = cleanText(type);
  if (value === "write") return "writeText";
  if (value === "drawDiagram") return "drawFlowchart";
  if (value === "showScreen") return "writeText";
  if (value === "mark") return "highlightNode";
  return value || "writeText";
}

function findScreenNoById(screens, screenId, fallback = 1) {
  const found = safeArray(screens).find(
    (screen) => cleanText(screen.screenId || screen.id) === cleanText(screenId)
  );
  return num(found?.screenNo, fallback);
}

function normalizeCommand(command, index, screens) {
  const raw = safeObject(command);
  const payload = safeObject(raw.payload || raw.visualPayload);

  const screenNo = num(
    raw.screenNo ||
      raw.screenNumber ||
      raw.screenIndex ||
      payload.screenNo ||
      payload.screenNumber ||
      payload.screenIndex ||
      findScreenNoById(screens, raw.screenId || payload.screenId, 1),
    1
  );

  const blockId = cleanText(
    raw.blockId ||
      raw.targetBlockId ||
      raw.targetId ||
      raw.targetElementId ||
      raw.parentElementId ||
      payload.blockId ||
      payload.targetBlockId ||
      payload.targetId ||
      payload.targetElementId ||
      payload.parentElementId ||
      ""
  );

  const commandId = cleanText(raw.commandId || raw.id || `cmd_${index + 1}`);
  const durationMs = Math.max(500, num(raw.durationMs || (num(raw.endMs, 0) - num(raw.startMs, 0)), 1200));

  return {
    ...raw,
    id: commandId,
    commandId,
    type: commandType(raw.type || raw.action),
    text: cleanText(raw.text || raw.body || payload.text || payload.body || raw.type || "Tutor action"),
    durationMs,
    startMs: num(raw.startMs || raw.timeMs, index * durationMs),
    endMs: num(raw.endMs, index * durationMs + durationMs),
    screenNo,
    screenId: cleanText(raw.screenId || payload.screenId || ""),
    voiceLineId: cleanText(raw.voiceLineId || payload.voiceLineId || ""),
    targetElementId: cleanText(raw.targetElementId || payload.targetElementId || blockId),
    parentElementId: cleanText(raw.parentElementId || payload.parentElementId || ""),
    targetRegionId: cleanText(raw.targetRegionId || raw.regionId || payload.targetRegionId || payload.regionId || ""),
    regionId: cleanText(raw.regionId || raw.targetRegionId || payload.regionId || payload.targetRegionId || ""),
    bbox: safeObject(raw.bbox || payload.bbox),
    blockId,
    targetBlockId: blockId,
    sourceRefs: firstArray(raw.sourceRefs, payload.sourceRefs, raw.sourceRef ? [raw.sourceRef] : []),
    payload: {
      ...payload,
      screenNo,
      blockId,
      targetBlockId: blockId,
      targetElementId: cleanText(raw.targetElementId || payload.targetElementId || blockId),
      parentElementId: cleanText(raw.parentElementId || payload.parentElementId || ""),
      targetRegionId: cleanText(raw.targetRegionId || raw.regionId || payload.targetRegionId || payload.regionId || ""),
      regionId: cleanText(raw.regionId || raw.targetRegionId || payload.regionId || payload.targetRegionId || ""),
      bbox: safeObject(raw.bbox || payload.bbox),
      sourceRefs: firstArray(raw.sourceRefs, payload.sourceRefs, raw.sourceRef ? [raw.sourceRef] : []),
    },
  };
}

function normalizeVoiceLine(line, index, commands, screens) {
  const raw = safeObject(line);

  const screenNo = num(
    raw.screenNo ||
      raw.screenNumber ||
      raw.screenIndex ||
      findScreenNoById(screens, raw.screenId, index + 1),
    1
  );

  let commandId = cleanText(raw.commandId || raw.id || raw.voiceId || "");

  if (!commandId && commands.length) {
    const byScreen = commands.find((cmd) => num(cmd.screenNo) === screenNo);
    commandId =
      cleanText(byScreen?.commandId) ||
      cleanText(commands[Math.min(index, commands.length - 1)]?.commandId);
  }

  return {
    ...raw,
    id: cleanText(raw.id || raw.voiceId || `voice_${index + 1}`),
    voiceId: cleanText(raw.voiceId || raw.id || `voice_${index + 1}`),
    commandId,
    screenNo,
    text: cleanText(raw.text || raw.voiceText || raw.line || ""),
    startMs: num(raw.startMs, index * 4200),
    endMs: num(raw.endMs, index * 4200 + 4200),
    audioUrl: cleanText(raw.audioUrl || raw.dataUrl || raw.url || ""),
    screenId: cleanText(raw.screenId || ""),
    lineId: cleanText(raw.lineId || raw.id || raw.voiceId || `voice_${index + 1}`),
    sourceRefs: firstArray(raw.sourceRefs, raw.sourceRef ? [raw.sourceRef] : []),
  };
}

function normalizeSubtitle(line, index, voiceLines, commands) {
  const raw = safeObject(line);

  let commandId = cleanText(raw.commandId || "");

  if (!commandId) {
    commandId =
      cleanText(voiceLines[index]?.commandId) ||
      cleanText(commands[Math.min(index, Math.max(0, commands.length - 1))]?.commandId);
  }

  return {
    ...raw,
    id: cleanText(raw.id || raw.subtitleId || `sub_${index + 1}`),
    subtitleId: cleanText(raw.subtitleId || raw.id || `sub_${index + 1}`),
    commandId,
    text: cleanText(raw.text || raw.caption || voiceLines[index]?.text || ""),
    startMs: num(raw.startMs || voiceLines[index]?.startMs, index * 4200),
    endMs: num(raw.endMs || voiceLines[index]?.endMs, index * 4200 + 4200),
    sourceRefs: safeArray(raw.sourceRefs || voiceLines[index]?.sourceRefs),
  };
}

function extractData(props) {
  const root = safeObject(props.result || props);
  const nested = nestedResult(root);
  const visualPlan = safeObject(root.visualPlan || nested.visualPlan);
  const diagramArtifactsRaw = safeObject(props.diagramArtifacts || root.diagramArtifacts || nested.diagramArtifacts);

  const rawScreens = firstArray(
    props.boardSections,
    props.premiumBoardScreens,
    props.boardScreens,
    root.boardSections,
    root.premiumBoardScreens,
    root.boardScreens,
    nested.boardSections,
    nested.premiumBoardScreens,
    nested.boardScreens,
    visualPlan.boardSections,
    visualPlan.premiumBoardScreens,
    visualPlan.boardScreens
  );

  const screens = rawScreens.map(normalizeScreen);

  const boardCommands = firstArray(
    props.boardCommands,
    props.commands,
    root.boardCommands,
    root.commands,
    nested.boardCommands,
    nested.commands,
    visualPlan.boardCommands,
    visualPlan.commands
  ).map((cmd, index) => normalizeCommand(cmd, index, screens));

  const voiceScript = firstArray(
    props.voiceScript,
    root.voiceScript,
    nested.voiceScript,
    visualPlan.voiceScript
  ).map((line, index) => normalizeVoiceLine(line, index, boardCommands, screens));

  const subtitles = firstArray(
    props.subtitles,
    root.subtitles,
    nested.subtitles,
    visualPlan.subtitles
  ).map((line, index) => normalizeSubtitle(line, index, voiceScript, boardCommands));

  const diagramArtifacts = {
    mermaid: firstArray(diagramArtifactsRaw.mermaid),
    reactFlow: firstArray(diagramArtifactsRaw.reactFlow),
    excalidrawElements: firstArray(diagramArtifactsRaw.excalidrawElements),
    htmlPreview: firstArray(diagramArtifactsRaw.htmlPreview, diagramArtifactsRaw.htmlPreviews),
    imagePreviews: firstArray(diagramArtifactsRaw.imagePreviews),
    tables: firstArray(diagramArtifactsRaw.tables),
  };

  return {
    screens,
    boardCommands,
    voiceScript,
    subtitles,
    boardSections: firstArray(
      props.boardSections,
      root.boardSections,
      nested.boardSections,
      visualPlan.boardSections,
      visualPlan.sections
    ),
    compiledDiagrams: firstArray(props.compiledDiagrams, root.compiledDiagrams, nested.compiledDiagrams, visualPlan.compiledDiagrams),
    diagramArtifacts,
    htmlPreviews: firstArray(props.htmlPreviews, root.htmlPreviews, nested.htmlPreviews, diagramArtifacts.htmlPreview),
    imagePreviews: firstArray(props.imagePreviews, root.imagePreviews, nested.imagePreviews, diagramArtifacts.imagePreviews),
    sourceCards: firstArray(props.sourceCards, root.sourceCards, nested.sourceCards),
    sourceRefs: firstArray(props.sourceRefs, root.sourceRefs, nested.sourceRefs, visualPlan.sourceRefs),
    agentTrace: firstArray(props.agentTrace, root.agentTrace, nested.agentTrace),
    quiz: safeObject(props.quiz || root.quiz || nested.quiz || visualPlan.quiz),
    lessonTranscript: cleanText(props.lessonTranscript || root.lessonTranscript || nested.lessonTranscript || visualPlan.lessonTranscript),
    metadata: safeObject(props.metadata || root.metadata || nested.metadata || visualPlan.metadata),
  };
}

function QualityBadge({ label, value, ok }) {
  return (
    <div className={`s2q-badge ${ok ? "ok" : "bad"}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function MissingData({ data }) {
  return (
    <section className="s2q-missing">
      <style>{styles}</style>
      <h2>Board data incomplete</h2>
      <p>
        Frontend fake board বানাবে না। Backend থেকে real premiumBoardScreens, boardCommands,
        voiceScript, subtitles, sourceRefs আসতে হবে।
      </p>

      <div className="s2q-grid">
        <QualityBadge label="screens" value={data.screens.length} ok={data.screens.length >= 1} />
        <QualityBadge label="commands" value={data.boardCommands.length} ok={data.boardCommands.length > 0} />
        <QualityBadge label="voice" value={data.voiceScript.length} ok={data.voiceScript.length > 0} />
        <QualityBadge label="subtitles" value={data.subtitles.length} ok={data.subtitles.length > 0} />
        <QualityBadge label="sources" value={data.sourceRefs.length} ok={data.sourceRefs.length > 0} />
        <QualityBadge label="diagrams" value={data.compiledDiagrams.length} ok={data.compiledDiagrams.length > 0} />
      </div>

      <pre className="s2q-debug">
        {JSON.stringify(
          {
            screens: data.screens.length,
            commands: data.boardCommands.length,
            voice: data.voiceScript.length,
            subtitles: data.subtitles.length,
            sources: data.sourceRefs.length,
            diagrams: data.compiledDiagrams.length,
            metadata: data.metadata,
          },
          null,
          2
        )}
      </pre>
    </section>
  );
}

export default function Stage2PremiumBoardRenderer(props) {
  const [mode, setMode] = useState("live");
  const data = useMemo(() => extractData(props), [props]);

  const ready =
    data.screens.length >= 1 &&
    data.boardCommands.length >= 1 &&
    data.voiceScript.length >= 1 &&
    data.subtitles.length >= 1;

  const strictReady =
    data.screens.length >= 5 &&
    data.boardCommands.length >= 5 &&
    data.voiceScript.length >= 3 &&
    data.sourceRefs.length >= 1;

  if (!ready) return <MissingData data={data} />;

  return (
    <section className="s2q-page">
      <style>{styles}</style>

      <header className="s2q-top">
        <div>
          <div className="s2q-kicker">Stage 2 · dynamic source-grounded board</div>
          <h1>{cleanText(props.title || "Live Tutor Board")}</h1>
          <p>
            {data.screens.length} screens · {data.boardCommands.length} commands ·{" "}
            {data.voiceScript.length} voice lines · {data.subtitles.length} subtitles ·{" "}
            {data.compiledDiagrams.length} diagrams
          </p>
        </div>

        <div className="s2q-actions">
          {props.onBack ? (
            <button type="button" onClick={props.onBack}>
              Back
            </button>
          ) : null}

          <button
            type="button"
            className={mode === "live" ? "active" : ""}
            onClick={() => setMode("live")}
          >
            Live teacher board
          </button>

          <button
            type="button"
            className={mode === "static" ? "active" : ""}
            onClick={() => setMode("static")}
          >
            Static screens
          </button>

          <button
            type="button"
            className={mode === "debug" ? "active" : ""}
            onClick={() => setMode("debug")}
          >
            Debug
          </button>
        </div>
      </header>

      <div className="s2q-quality">
        <QualityBadge label="Auto board" value={strictReady ? "ready" : "weak"} ok={strictReady} />
        <QualityBadge label="Source grounded" value={data.sourceRefs.length} ok={data.sourceRefs.length > 0} />
        <QualityBadge label="Fallback" value={data.metadata?.fallbackUsed ? "true" : "false"} ok={!data.metadata?.fallbackUsed} />
        <QualityBadge label="Screens" value={data.screens.length} ok={data.screens.length >= 3} />
      </div>

      {mode === "live" ? (
        <LiveTutorBoardPlayer
          title={cleanText(props.title || "Live Tutor Board")}
          screens={data.screens}
          boardCommands={data.boardCommands}
          voiceScript={data.voiceScript}
          subtitles={data.subtitles}
          compiledDiagrams={data.compiledDiagrams}
          diagramArtifacts={data.diagramArtifacts}
          htmlPreviews={data.htmlPreviews}
          imagePreviews={data.imagePreviews}
          sourceCards={data.sourceCards}
          sourceRefs={data.sourceRefs}
          agentTrace={data.agentTrace}
          quiz={data.quiz}
          metadata={data.metadata}
          lessonTranscript={data.lessonTranscript}
          onInterrupt={props.onInterrupt}
        />
      ) : null}

      {mode === "static" ? (
        <div className="s2q-static">
          {data.screens.map((screen, index) => (
            <PremiumBoardScreenRenderer
              key={screen.screenId || index}
              screen={screen}
              screenIndex={index}
              screenCount={data.screens.length}
              compiledDiagrams={data.compiledDiagrams}
              diagramArtifacts={data.diagramArtifacts}
              htmlPreviews={data.htmlPreviews}
              imagePreviews={data.imagePreviews}
              sourceCards={data.sourceCards}
              sourceRefs={data.sourceRefs}
              voiceScript={data.voiceScript}
              subtitles={data.subtitles}
              quiz={data.quiz}
              lessonTranscript={data.lessonTranscript}
            />
          ))}
        </div>
      ) : null}

      {mode === "debug" ? (
        <pre className="s2q-debug">
          {JSON.stringify(
            {
              screens: data.screens.length,
              commands: data.boardCommands.length,
              voice: data.voiceScript.length,
              subtitles: data.subtitles.length,
              sections: data.boardSections.length,
              diagrams: data.compiledDiagrams.length,
              sourceRefs: data.sourceRefs.length,
              metadata: data.metadata,
              sampleCommand: data.boardCommands[0],
              sampleScreen: data.screens[0],
            },
            null,
            2
          )}
        </pre>
      ) : null}
    </section>
  );
}

const styles = `
.s2q-page {
  min-height: 100vh;
  padding: 16px;
  background: #fff8f1;
  color: #2f261f;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.s2q-page * {
  box-sizing: border-box;
}

.s2q-top {
  max-width: 1720px;
  margin: 0 auto 12px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  border: 1px solid #f1dccd;
  background: rgba(255, 253, 249, .94);
  border-radius: 22px;
  padding: 16px 18px;
  box-shadow: 0 14px 36px rgba(103, 64, 38, .07);
}

.s2q-kicker {
  color: #fb6b4b;
  font-size: 11px;
  font-weight: 950;
  letter-spacing: .16em;
  text-transform: uppercase;
  margin-bottom: 4px;
}

.s2q-top h1 {
  margin: 0;
  font-size: clamp(24px, 3vw, 38px);
  letter-spacing: -.045em;
}

.s2q-top p {
  margin: 6px 0 0;
  color: #7a675c;
  font-weight: 650;
}

.s2q-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.s2q-actions button {
  border: 1px solid #f0b9a5;
  background: #fffaf5;
  color: #8c3b27;
  border-radius: 14px;
  padding: 10px 13px;
  font-weight: 900;
  cursor: pointer;
}

.s2q-actions button.active {
  background: #fb7658;
  color: #fff;
  border-color: #fb7658;
}

.s2q-quality {
  max-width: 1720px;
  margin: 0 auto 12px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.s2q-badge {
  border: 1px solid #f1dccd;
  background: #fffdf9;
  border-radius: 16px;
  padding: 10px 12px;
  box-shadow: 0 10px 26px rgba(103, 64, 38, .05);
}

.s2q-badge span {
  display: block;
  color: #7a675c;
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: .08em;
}

.s2q-badge b {
  display: block;
  margin-top: 3px;
  font-size: 18px;
  color: #ef4d2f;
}

.s2q-badge.ok b {
  color: #25824a;
}

.s2q-badge.bad {
  background: #fff8f1;
}

.s2q-static {
  display: grid;
  gap: 16px;
}

.s2q-debug {
  max-width: 1720px;
  margin: 0 auto;
  white-space: pre-wrap;
  overflow: auto;
  border: 1px solid #ead0bf;
  background: #201713;
  color: #fff7ed;
  border-radius: 20px;
  padding: 18px;
  font-size: 12px;
  line-height: 1.55;
}

.s2q-missing {
  max-width: 980px;
  margin: 34px auto;
  border: 1px solid #f1dccd;
  background: #fffdf9;
  border-radius: 24px;
  padding: 22px;
  color: #2f261f;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  box-shadow: 0 18px 46px rgba(103, 64, 38, .08);
}

.s2q-missing h2 {
  margin: 0 0 8px;
  font-size: 28px;
}

.s2q-missing p {
  margin: 0 0 16px;
  color: #7a675c;
  line-height: 1.6;
}

.s2q-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

@media (max-width: 980px) {
  .s2q-top {
    grid-template-columns: 1fr;
  }

  .s2q-actions {
    justify-content: flex-start;
  }

  .s2q-quality,
  .s2q-grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 640px) {
  .s2q-quality,
  .s2q-grid {
    grid-template-columns: 1fr;
  }
}
`;

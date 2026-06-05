import React, { useMemo, useState } from "react";

/**
 * VoiceSubtitleSyncPlayer.jsx
 * =============================================================================
 * Lightweight sync monitor for Stage 2 live tutor board.
 *
 * It does not invent voice/subtitle content.
 * It verifies and previews:
 * - boardCommands.commandId
 * - voiceScript.commandId
 * - subtitles.commandId
 * - invalid/missing commandId counts
 *
 * LiveTutorBoardPlayer handles actual playback.
 * This component gives a quick proof that backend sync is frontend-ready.
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

function commandIdOf(item) {
  return cleanText(safeObject(item).commandId || safeObject(item).id);
}

function sourceRefsOf(item) {
  const obj = safeObject(item);
  const payload = safeObject(obj.payload || obj.visualPayload);
  return safeArray(obj.sourceRefs || payload.sourceRefs);
}

function textOf(item) {
  const obj = safeObject(item);
  const payload = safeObject(obj.payload || obj.visualPayload);
  return cleanText(obj.text || obj.body || obj.subtitle || obj.line || obj.speech || payload.text || payload.title || "");
}

function buildSyncReport(boardCommands, voiceScript, subtitles) {
  const commands = safeArray(boardCommands);
  const voice = safeArray(voiceScript);
  const subs = safeArray(subtitles);

  const commandIds = new Set(commands.map(commandIdOf).filter(Boolean));
  const voiceMissing = voice.filter((line) => !commandIdOf(line));
  const voiceInvalid = voice.filter((line) => {
    const id = commandIdOf(line);
    return id && !commandIds.has(id);
  });

  const subtitleMissing = subs.filter((line) => !commandIdOf(line));
  const subtitleInvalid = subs.filter((line) => {
    const id = commandIdOf(line);
    return id && !commandIds.has(id);
  });

  const voiceByCommand = new Map();
  const subtitleByCommand = new Map();

  for (const line of voice) {
    const id = commandIdOf(line);
    if (!id || voiceByCommand.has(id)) continue;
    voiceByCommand.set(id, line);
  }

  for (const line of subs) {
    const id = commandIdOf(line);
    if (!id || subtitleByCommand.has(id)) continue;
    subtitleByCommand.set(id, line);
  }

  const rows = commands.slice(0, 160).map((command, index) => {
    const id = commandIdOf(command);
    const voiceLine = voiceByCommand.get(id);
    const subtitleLine = subtitleByCommand.get(id);

    return {
      index,
      command,
      commandId: id,
      commandType: cleanText(command.type || command.action || "command"),
      commandText: textOf(command),
      voiceLine,
      voiceText: textOf(voiceLine),
      subtitleLine,
      subtitleText: textOf(subtitleLine),
      hasVoice: Boolean(voiceLine),
      hasSubtitle: Boolean(subtitleLine),
      sourceRefCount:
        sourceRefsOf(command).length ||
        sourceRefsOf(voiceLine).length ||
        sourceRefsOf(subtitleLine).length,
    };
  });

  return {
    commandCount: commands.length,
    voiceCount: voice.length,
    subtitleCount: subs.length,
    commandIdCount: commandIds.size,
    voiceMissingCount: voiceMissing.length,
    voiceInvalidCount: voiceInvalid.length,
    subtitleMissingCount: subtitleMissing.length,
    subtitleInvalidCount: subtitleInvalid.length,
    rows,
    ok:
      commands.length > 0 &&
      voice.length > 0 &&
      subs.length > 0 &&
      voiceMissing.length === 0 &&
      voiceInvalid.length === 0 &&
      subtitleMissing.length === 0 &&
      subtitleInvalid.length === 0,
  };
}

function StatusPill({ ok, children }) {
  return <span className={ok ? "vsp-pill ok" : "vsp-pill bad"}>{children}</span>;
}

export default function VoiceSubtitleSyncPlayer({
  boardCommands,
  voiceScript,
  subtitles,
  sourceRefs,
  initiallyOpen = false,
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [activeIndex, setActiveIndex] = useState(0);

  const report = useMemo(
    () => buildSyncReport(boardCommands, voiceScript, subtitles),
    [boardCommands, voiceScript, subtitles]
  );

  const activeRow = report.rows[Math.min(activeIndex, Math.max(0, report.rows.length - 1))];

  return (
    <section className="voice-subtitle-sync-player">
      <style>{styles}</style>

      <header className="vsp-head">
        <div>
          <div className="vsp-kicker">Voice/subtitle sync proof</div>
          <h2>CommandId sync monitor</h2>
          <p>
            {report.commandCount} commands · {report.voiceCount} voice lines · {report.subtitleCount} subtitles ·{" "}
            {safeArray(sourceRefs).length} top-level source refs
          </p>
        </div>

        <div className="vsp-actions">
          <StatusPill ok={report.ok}>{report.ok ? "sync ok" : "sync issue"}</StatusPill>
          <button type="button" onClick={() => setOpen((value) => !value)}>
            {open ? "Hide sync" : "Show sync"}
          </button>
        </div>
      </header>

      <div className="vsp-stats">
        <div>
          <b>{report.voiceMissingCount}</b>
          <span>voice missing commandId</span>
        </div>
        <div>
          <b>{report.voiceInvalidCount}</b>
          <span>voice invalid commandId</span>
        </div>
        <div>
          <b>{report.subtitleMissingCount}</b>
          <span>subtitle missing commandId</span>
        </div>
        <div>
          <b>{report.subtitleInvalidCount}</b>
          <span>subtitle invalid commandId</span>
        </div>
      </div>

      {open ? (
        <div className="vsp-body">
          <aside className="vsp-list">
            {report.rows.map((row, index) => (
              <button
                key={row.commandId || index}
                type="button"
                className={index === activeIndex ? "active" : ""}
                onClick={() => setActiveIndex(index)}
              >
                <span>{index + 1}</span>
                <b>{row.commandType}</b>
                <small>{row.commandId}</small>
              </button>
            ))}
          </aside>

          <article className="vsp-detail">
            {activeRow ? (
              <>
                <div className="vsp-detail-top">
                  <StatusPill ok={activeRow.hasVoice}>voice {activeRow.hasVoice ? "mapped" : "missing"}</StatusPill>
                  <StatusPill ok={activeRow.hasSubtitle}>
                    subtitle {activeRow.hasSubtitle ? "mapped" : "missing"}
                  </StatusPill>
                  <StatusPill ok={activeRow.sourceRefCount > 0}>
                    sourceRefs {activeRow.sourceRefCount}
                  </StatusPill>
                </div>

                <h3>{activeRow.commandType}</h3>
                <p className="vsp-id">{activeRow.commandId}</p>

                <div className="vsp-card">
                  <b>Board command</b>
                  <p>{activeRow.commandText || "No command text."}</p>
                </div>

                <div className="vsp-card">
                  <b>Teacher voice</b>
                  <p>{activeRow.voiceText || "No voice line mapped to this command."}</p>
                </div>

                <div className="vsp-card">
                  <b>Subtitle</b>
                  <p>{activeRow.subtitleText || "No subtitle mapped to this command."}</p>
                </div>
              </>
            ) : (
              <p>No command rows to inspect.</p>
            )}
          </article>
        </div>
      ) : null}
    </section>
  );
}

const styles = `
  .voice-subtitle-sync-player {
    max-width: 1480px;
    margin: 0 auto 16px;
    border: 1px solid rgba(255,255,255,.11);
    background: rgba(15,23,42,.82);
    backdrop-filter: blur(18px);
    border-radius: 28px;
    box-shadow: 0 26px 90px rgba(0,0,0,.34);
    color: #f8fafc;
    overflow: hidden;
  }

  .voice-subtitle-sync-player * {
    box-sizing: border-box;
  }

  .vsp-head {
    padding: 16px;
    display: flex;
    justify-content: space-between;
    gap: 14px;
    align-items: flex-start;
  }

  .vsp-kicker {
    color: #67e8f9;
    font-weight: 950;
    letter-spacing: .18em;
    text-transform: uppercase;
    font-size: 11px;
    margin-bottom: 6px;
  }

  .vsp-head h2 {
    margin: 0;
    letter-spacing: -.035em;
  }

  .vsp-head p {
    margin: 7px 0 0;
    color: #cbd5e1;
  }

  .vsp-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .vsp-actions button {
    border: 0;
    border-radius: 15px;
    background: linear-gradient(135deg, #67e8f9, #a78bfa);
    color: #020617;
    padding: 10px 13px;
    font-weight: 950;
    cursor: pointer;
  }

  .vsp-pill {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 7px 10px;
    font-size: 12px;
    font-weight: 950;
    white-space: nowrap;
  }

  .vsp-pill.ok {
    color: #bbf7d0;
    background: rgba(22,163,74,.16);
    border: 1px solid rgba(74,222,128,.30);
  }

  .vsp-pill.bad {
    color: #fecaca;
    background: rgba(127,29,29,.28);
    border: 1px solid rgba(248,113,113,.35);
  }

  .vsp-stats {
    border-top: 1px solid rgba(255,255,255,.08);
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .vsp-stats div {
    padding: 12px 16px;
    border-right: 1px solid rgba(255,255,255,.08);
  }

  .vsp-stats div:last-child {
    border-right: 0;
  }

  .vsp-stats b {
    display: block;
    font-size: 24px;
  }

  .vsp-stats span {
    display: block;
    margin-top: 2px;
    color: #94a3b8;
    font-size: 12px;
    font-weight: 850;
    text-transform: uppercase;
    letter-spacing: .08em;
  }

  .vsp-body {
    border-top: 1px solid rgba(255,255,255,.08);
    display: grid;
    grid-template-columns: 330px minmax(0, 1fr);
    min-height: 360px;
  }

  .vsp-list {
    padding: 10px;
    border-right: 1px solid rgba(255,255,255,.08);
    max-height: 520px;
    overflow: auto;
  }

  .vsp-list button {
    width: 100%;
    border: 1px solid rgba(255,255,255,.09);
    background: rgba(2,6,23,.40);
    color: #e2e8f0;
    border-radius: 15px;
    padding: 9px;
    margin-bottom: 8px;
    display: grid;
    grid-template-columns: 32px 1fr;
    gap: 3px 8px;
    text-align: left;
    cursor: pointer;
  }

  .vsp-list button.active {
    border-color: rgba(34,211,238,.58);
    background: rgba(8,47,73,.75);
  }

  .vsp-list button span {
    grid-row: span 2;
    width: 28px;
    height: 28px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: rgba(15,23,42,.92);
    color: #67e8f9;
    font-weight: 950;
  }

  .vsp-list button b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .vsp-list button small {
    color: #94a3b8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .vsp-detail {
    padding: 18px;
  }

  .vsp-detail-top {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 13px;
  }

  .vsp-detail h3 {
    margin: 0;
    font-size: 26px;
    letter-spacing: -.04em;
  }

  .vsp-id {
    margin: 5px 0 14px;
    color: #94a3b8;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    overflow-wrap: anywhere;
  }

  .vsp-card {
    border: 1px solid rgba(255,255,255,.10);
    background: rgba(2,6,23,.36);
    border-radius: 18px;
    padding: 13px;
    margin-bottom: 10px;
  }

  .vsp-card b {
    display: block;
    color: #67e8f9;
    margin-bottom: 6px;
  }

  .vsp-card p {
    margin: 0;
    color: #e2e8f0;
    line-height: 1.6;
  }

  @media (max-width: 900px) {
    .vsp-head {
      flex-direction: column;
    }

    .vsp-stats {
      grid-template-columns: 1fr 1fr;
    }

    .vsp-body {
      grid-template-columns: 1fr;
    }

    .vsp-list {
      border-right: 0;
      border-bottom: 1px solid rgba(255,255,255,.08);
      max-height: 280px;
    }
  }
`;
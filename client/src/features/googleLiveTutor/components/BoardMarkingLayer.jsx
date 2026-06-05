import React, { useEffect, useMemo, useRef, useState } from "react";

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

function payloadOf(command) {
  return safeObject(command?.payload || command?.visualPayload || {});
}

function commandScreenNo(command) {
  const p = payloadOf(command);
  return number(command?.screenNo || command?.screenNumber || p.screenNo || p.screenNumber, 1);
}

function commandBlockId(command) {
  const p = payloadOf(command);
  return cleanText(command?.blockId || command?.targetBlockId || command?.targetId || p.blockId || p.targetBlockId || p.targetId);
}

function commandType(command) {
  return cleanText(command?.type || command?.action || payloadOf(command).action || "highlight");
}

function commandText(command) {
  const p = payloadOf(command);
  return cleanText(command?.text || p.text || p.title || commandType(command));
}

function shouldShow(type) {
  return [
    "underline",
    "drawCircle",
    "circle",
    "highlight",
    "highlightNode",
    "drawBox",
    "showSourceBadge",
    "drawArrow",
    "drawFlowchart",
    "drawTree",
    "drawTable",
    "writeText",
    "showQuiz",
    "showHtmlPreview",
  ].includes(type);
}

function findCanvas(layer) {
  if (!layer) return null;
  return layer.closest(".lumina-board-canvas") || layer.closest(".lt-board-canvas") || layer.parentElement;
}

function rectForBlock(layer, command) {
  const canvas = findCanvas(layer);
  if (!canvas) return null;

  const id = commandBlockId(command);
  const canvasRect = canvas.getBoundingClientRect();

  if (!id) {
    return {
      x: 28,
      y: 28,
      width: Math.max(240, canvasRect.width - 56),
      height: 90,
    };
  }

  const selector = `[data-block-id="${CSS.escape(id)}"]`;
  const target = canvas.querySelector(selector);

  if (!target) {
    return {
      x: 36,
      y: 110,
      width: Math.min(520, canvasRect.width - 72),
      height: 120,
    };
  }

  const rect = target.getBoundingClientRect();

  return {
    x: rect.left - canvasRect.left,
    y: rect.top - canvasRect.top,
    width: rect.width,
    height: rect.height,
  };
}

export default function BoardMarkingLayer({
  commands = [],
  currentCommandIndex = 0,
  activeScreenNo = 1,
}) {
  const layerRef = useRef(null);
  const [box, setBox] = useState(null);

  const command = safeArray(commands)[currentCommandIndex] || null;
  const type = commandType(command);

  const visible = useMemo(() => {
    if (!command) return false;
    if (commandScreenNo(command) !== number(activeScreenNo, 1)) return false;
    return shouldShow(type);
  }, [command, activeScreenNo, type]);

  useEffect(() => {
    if (!visible) {
      setBox(null);
      return undefined;
    }

    let frame = 0;

    function update() {
      const next = rectForBlock(layerRef.current, command);
      setBox(next);
    }

    frame = window.requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [command, visible]);

  if (!visible || !box) {
    return (
      <div ref={layerRef} className="board-mark-layer">
        <style>{styles}</style>
      </div>
    );
  }

  const label = commandText(command).slice(0, 78);
  const isArrow = type === "drawArrow" || type === "drawFlowchart" || type === "drawTree";
  const isUnderline = type === "underline" || type === "writeText";
  const isCircle = type === "drawCircle" || type === "circle";
  const isSource = type === "showSourceBadge";
  const isBox = !isArrow && !isUnderline && !isCircle;

  const pad = 10;
  const x = Math.max(8, box.x - pad);
  const y = Math.max(8, box.y - pad);
  const w = Math.max(80, box.width + pad * 2);
  const h = Math.max(48, box.height + pad * 2);

  return (
    <div ref={layerRef} className="board-mark-layer" aria-hidden="true">
      <style>{styles}</style>

      {isBox ? (
        <div
          className={`bm-box ${isSource ? "source" : ""}`}
          style={{ left: x, top: y, width: w, height: h }}
        />
      ) : null}

      {isCircle ? (
        <div
          className="bm-circle"
          style={{ left: x, top: y, width: w, height: h }}
        />
      ) : null}

      {isUnderline ? (
        <div
          className="bm-underline"
          style={{ left: x + 16, top: y + h - 18, width: Math.max(80, w - 32) }}
        />
      ) : null}

      {isArrow ? (
        <svg className="bm-svg">
          <defs>
            <marker id="bmArrowHead" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
              <path d="M0,0 L0,6 L9,3 z" className="bm-arrow-head" />
            </marker>
          </defs>
          <path
            className="bm-arrow"
            d={`M ${x + 20} ${y + Math.min(80, h / 2)} C ${x + w * 0.35} ${y - 28}, ${x + w * 0.65} ${y + h + 28}, ${x + w - 18} ${y + h / 2}`}
            markerEnd="url(#bmArrowHead)"
          />
        </svg>
      ) : null}

      <div className={`bm-label ${isSource ? "source" : ""}`} style={{ left: x + Math.min(24, w * 0.1), top: Math.max(8, y - 34) }}>
        {isSource ? "📌 Source" : "✦ Tutor points"} · {label}
      </div>
    </div>
  );
}

const styles = `
.board-mark-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 20;
}

.bm-box,
.bm-circle,
.bm-underline,
.bm-label {
  position: absolute;
}

.bm-box {
  border: 3px solid rgba(251, 118, 88, .95);
  border-radius: 22px;
  box-shadow:
    0 0 0 5px rgba(251, 118, 88, .11),
    0 12px 28px rgba(239, 77, 47, .11);
  animation: bmPulse 1.1s ease-in-out infinite alternate;
}

.bm-box.source {
  border-color: rgba(37, 116, 168, .95);
  box-shadow:
    0 0 0 5px rgba(37, 116, 168, .12),
    0 12px 28px rgba(37, 116, 168, .10);
}

.bm-circle {
  border: 3px solid rgba(251, 118, 88, .95);
  border-radius: 50%;
  transform: rotate(-2deg);
  box-shadow: 0 0 0 5px rgba(251, 118, 88, .10);
  animation: bmPulse 1.1s ease-in-out infinite alternate;
}

.bm-underline {
  height: 5px;
  border-radius: 999px;
  background: linear-gradient(90deg, #fb7658, #f59e0b, #8bcf70);
  box-shadow: 0 0 0 4px rgba(251, 118, 88, .08);
  animation: bmSlide .35s ease-out both;
}

.bm-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.bm-arrow {
  fill: none;
  stroke: rgba(251, 118, 88, .95);
  stroke-width: 4;
  stroke-linecap: round;
  stroke-dasharray: 8 7;
  animation: bmDash 1.4s linear infinite;
}

.bm-arrow-head {
  fill: rgba(251, 118, 88, .95);
}

.bm-label {
  max-width: 360px;
  border: 1px solid rgba(239, 184, 162, .9);
  background: rgba(255, 253, 249, .96);
  color: #8c3b27;
  border-radius: 999px;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 950;
  box-shadow: 0 12px 28px rgba(91, 57, 35, .12);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bm-label.source {
  color: #2574a8;
  border-color: rgba(37, 116, 168, .3);
}

@keyframes bmPulse {
  from {
    opacity: .82;
    transform: scale(.996);
  }
  to {
    opacity: 1;
    transform: scale(1.004);
  }
}

@keyframes bmSlide {
  from {
    transform: scaleX(.1);
    transform-origin: left center;
    opacity: .2;
  }
  to {
    transform: scaleX(1);
    opacity: 1;
  }
}

@keyframes bmDash {
  to {
    stroke-dashoffset: -30;
  }
}
`;
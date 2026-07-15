'use client';

// Konva draw-on annotation layer (adoption #47): teaching marks DRAW THEMSELVES over the
// source figure like a real pen — encircle sweeps around, underline strokes across, the
// arrow flies in — instead of popping in. Draw-on = dash [len, len] with dashOffset len -> 0
// tweened over ~650ms, the classic pen illusion. Geometry comes from the pure, tested
// lib/board/annotations/annotation-geometry.js; this file only tweens what it computed.
// The layer is a transparent Stage absolutely positioned over the figure; the parent passes
// pixel dimensions and how many marks are visible (the narration clock owns the reveal).

import { useEffect, useRef } from 'react';
import { Stage, Layer, Ellipse, Line, Rect, Circle, Arrow, Text } from 'react-konva';

import { markSpec } from '../../../lib/board/annotations/annotation-geometry.js';

const INK = '#e8604c';
const DRAW_MS = 650;

// One mark: mounts with its stroke fully "undrawn" (dashOffset = length) and tweens to 0.
function DrawnMark({ spec }) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (spec.length) {
      node.dashOffset(spec.length);
      node.to({ dashOffset: 0, duration: DRAW_MS / 1000 });
    } else {
      node.opacity(0);
      node.to({ opacity: 1, duration: 0.35 });
    }
  }, [spec]);

  const stroke = { stroke: INK, strokeWidth: 3, lineCap: 'round', lineJoin: 'round' };
  const dash = spec.length ? { dash: [spec.length, spec.length] } : {};

  if (spec.kind === 'ellipse') {
    return <Ellipse ref={ref} x={spec.cx} y={spec.cy} radiusX={spec.rx} radiusY={spec.ry} {...stroke} {...dash} />;
  }
  if (spec.kind === 'line') {
    return <Line ref={ref} points={spec.points} {...stroke} {...dash} />;
  }
  if (spec.kind === 'cross') {
    return (
      <>
        <Line ref={ref} points={spec.points} {...stroke} dash={[spec.length / 2, spec.length / 2]} />
        <Line points={spec.points2} {...stroke} />
      </>
    );
  }
  if (spec.kind === 'rect') {
    return <Rect ref={ref} x={spec.x} y={spec.y} width={spec.w} height={spec.h} fill="rgba(253,234,167,0.45)" />;
  }
  if (spec.kind === 'dot') {
    return <Circle ref={ref} x={spec.cx} y={spec.cy} radius={spec.r} fill={INK} stroke="#fff" strokeWidth={1.5} />;
  }
  if (spec.kind === 'arrow') {
    return (
      <>
        <Arrow ref={ref} points={spec.points} {...stroke} fill={INK} pointerLength={10} pointerWidth={9} {...dash} />
        {spec.text && <Text x={spec.textX} y={spec.textY} text={spec.text} fontSize={14} fontStyle="bold" fill="#8f2f27" />}
      </>
    );
  }
  if (spec.kind === 'label') {
    return (
      <Text
        ref={ref}
        x={spec.cx - 60}
        y={spec.textY}
        width={120}
        align="center"
        text={spec.text}
        fontSize={14.5}
        fontStyle="bold"
        fill="#8f2f27"
        shadowColor="#fff"
        shadowBlur={4}
      />
    );
  }
  return null;
}

export function AnnotationLayer({ annotations, shown, width, height }) {
  if (!width || !height || !annotations?.length) return null;
  const specs = annotations
    .slice(0, shown)
    .map((a) => markSpec(a, width, height))
    .filter(Boolean);
  if (!specs.length) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <Stage width={width} height={height}>
        <Layer listening={false}>
          {specs.map((spec, i) => <DrawnMark key={i} spec={spec} />)}
        </Layer>
      </Stage>
    </div>
  );
}

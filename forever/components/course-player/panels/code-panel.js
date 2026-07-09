'use client';

// Real code-editor panel (the mockup's right-side dark panel): filename tab, line numbers,
// syntax highlighting, and an Output panel showing REAL executed output. The CODE POINTER is a
// first-class object (target tree2.png, code line 15): a bright arrow in the gutter rides the
// active line, a solid highlight band crosses the row, and the panel AUTO-SCROLLS so the
// pointer is always in view — the "finger on the line" a tutor keeps as the dry run steps.
// Self-contained (inline styles, offline, CSP-safe) via react-syntax-highlighter/Prism.

import { useEffect, useRef } from 'react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import js from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

SyntaxHighlighter.registerLanguage('javascript', js);
SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('cpp', cpp);
SyntaxHighlighter.registerLanguage('java', java);

const EXT = { javascript: 'main.js', js: 'main.js', node: 'main.js', python: 'main.py', cpp: 'main.cpp', java: 'Main.java' };

// A fixed line box so the pointer overlay's Y math is exact regardless of the Prism theme.
const LH = 21; // px per code line
const PAD_TOP = 12; // customStyle top padding

export function CodePanel({ codeObject, revealProgress = 1, outputShown = false, activeLine = null, maxHeight = 420 }) {
  const language = normalizeLang(codeObject.language || guessLang(codeObject));
  const allLines = String(codeObject.content).split('\n');
  const visibleCount = Math.max(1, Math.floor(revealProgress * allLines.length + 1e-9));
  const shown = allLines.slice(0, visibleCount).join('\n');

  const scrollRef = useRef(null);
  const active = Number.isInteger(activeLine) && activeLine >= 1 && activeLine <= visibleCount ? activeLine : null;
  const pointerTop = active != null ? PAD_TOP + (active - 1) * LH : null;

  // Keep the pointer in view — scroll only when the active line drifts outside the viewport,
  // so a stable line doesn't cause jitter every clock tick.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || pointerTop == null) return;
    const top = pointerTop;
    const bottom = pointerTop + LH;
    if (top < el.scrollTop + LH) el.scrollTo({ top: Math.max(0, top - LH * 2), behavior: 'smooth' });
    else if (bottom > el.scrollTop + el.clientHeight - LH) el.scrollTo({ top: bottom - el.clientHeight + LH * 2, behavior: 'smooth' });
  }, [pointerTop]);

  // The active line gets a solid band + accent left bar (a real highlight, not a faint tint).
  const lineProps = (lineNumber) => ({
    style: {
      display: 'block',
      lineHeight: `${LH}px`,
      ...(active && lineNumber === active
        ? { background: 'rgba(97,175,239,0.20)', borderLeft: '3px solid #61afef', margin: '0 -8px', padding: '0 5px' }
        : {}),
    },
  });

  return (
    <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid #2b3240', background: '#282c34' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#21252b', color: '#9aa4b2', fontSize: 13, fontFamily: 'ui-monospace, monospace' }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#e06c75' }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#e5c07b' }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#98c379' }} />
        <span style={{ marginLeft: 8 }}>{EXT[language] || 'code'}</span>
      </div>
      <div ref={scrollRef} style={{ position: 'relative', maxHeight, overflow: 'auto' }}>
        {/* The moving code pointer: a bright arrow in the gutter that glides to the active line. */}
        {pointerTop != null ? (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: pointerTop,
              left: 2,
              height: LH,
              display: 'flex',
              alignItems: 'center',
              color: '#e5c07b',
              fontSize: 13,
              fontWeight: 900,
              zIndex: 3,
              pointerEvents: 'none',
              transition: 'top 0.25s cubic-bezier(0.4,0,0.2,1)',
              textShadow: '0 0 6px rgba(229,192,123,0.7)',
            }}
          >
            ▶
          </div>
        ) : null}
        <SyntaxHighlighter
          language={language}
          style={oneDark}
          showLineNumbers
          wrapLines
          lineProps={lineProps}
          customStyle={{ margin: 0, background: '#282c34', fontSize: 13, lineHeight: `${LH}px`, padding: `${PAD_TOP}px 8px 12px 22px` }}
          codeTagProps={{ style: { fontFamily: 'ui-monospace, Menlo, monospace', lineHeight: `${LH}px` } }}
          lineNumberStyle={{ minWidth: '2.2em', color: '#5c6370' }}
        >
          {shown}
        </SyntaxHighlighter>
      </div>
      {outputShown && codeObject.output != null && (
        <div style={{ borderTop: '1px solid #2b3240' }}>
          <div style={{ padding: '6px 12px', color: '#9aa4b2', fontSize: 12, background: '#21252b' }}>Output</div>
          <pre style={{ margin: 0, padding: '10px 14px', color: '#98c379', fontSize: 13, fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap' }}>
            {codeObject.output}
          </pre>
        </div>
      )}
    </div>
  );
}

function normalizeLang(lang) {
  const l = String(lang || '').toLowerCase();
  if (['js', 'node', 'javascript'].includes(l)) return 'javascript';
  if (['py', 'python', 'python3'].includes(l)) return 'python';
  if (['c++', 'cpp'].includes(l)) return 'cpp';
  if (l === 'java') return 'java';
  return 'javascript';
}

function guessLang(codeObject) {
  const c = String(codeObject.content);
  if (/\b(def|print\()/.test(c) && !/;\s*$/m.test(c)) return 'python';
  if (/#include|std::|cout/.test(c)) return 'cpp';
  return 'javascript';
}

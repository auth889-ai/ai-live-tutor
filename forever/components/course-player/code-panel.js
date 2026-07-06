'use client';

// Real code-editor panel (the mockup's right-side dark panel): filename tab, line numbers,
// syntax highlighting, and an Output panel showing REAL executed output. Highlighting is
// static; the clock only controls how many lines are revealed (the code "types out" as the
// tutor explains) and whether the output is shown yet. Self-contained (inline styles,
// offline, CSP-safe) via react-syntax-highlighter/Prism.

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

export function CodePanel({ codeObject, revealProgress = 1, outputShown = false }) {
  const language = normalizeLang(codeObject.language || guessLang(codeObject));
  const allLines = String(codeObject.content).split('\n');
  const visibleCount = Math.max(1, Math.floor(revealProgress * allLines.length + 1e-9));
  const shown = allLines.slice(0, visibleCount).join('\n');

  return (
    <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid #2b3240', background: '#282c34' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#21252b', color: '#9aa4b2', fontSize: 13, fontFamily: 'ui-monospace, monospace' }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#e06c75' }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#e5c07b' }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#98c379' }} />
        <span style={{ marginLeft: 8 }}>{EXT[language] || 'code'}</span>
      </div>
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        showLineNumbers
        customStyle={{ margin: 0, background: '#282c34', fontSize: 13, padding: '12px 8px' }}
        codeTagProps={{ style: { fontFamily: 'ui-monospace, Menlo, monospace' } }}
      >
        {shown}
      </SyntaxHighlighter>
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

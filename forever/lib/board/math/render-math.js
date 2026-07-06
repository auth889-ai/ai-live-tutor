// Math rendering via KaTeX (pure — renderToString works headless, so it's unit-tested AND
// usable in server-side notebook export). Graceful: invalid LaTeX renders an error node
// rather than throwing (throwOnError:false), so one bad formula never breaks a lesson.

import katex from 'katex';

export function renderMath(latex, { display = true } = {}) {
  return katex.renderToString(String(latex ?? ''), { throwOnError: false, displayMode: display, output: 'html' });
}

// A math board object is either a single equation {latex} or a step derivation {steps:[{latex,note}]}.
export function validateMathContent(content, context = 'math') {
  if (!content || typeof content !== 'object') throw new Error(`${context} content must be an object`);
  if (typeof content.latex === 'string' && content.latex.trim()) return content;
  if (Array.isArray(content.steps) && content.steps.length > 0) {
    for (const step of content.steps) {
      if (typeof step.latex !== 'string' || !step.latex.trim()) throw new Error(`${context} step needs a latex string`);
    }
    return content;
  }
  throw new Error(`${context} needs a latex string or a non-empty steps[] of {latex}`);
}

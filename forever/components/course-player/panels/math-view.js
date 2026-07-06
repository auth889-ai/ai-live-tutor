'use client';

// Math panel — clean KaTeX equations and step-by-step derivations (the Striver/Andrew-Ng
// "each algebra step" tool). Single equation {latex} or a derivation {steps:[{latex,note}]}.

import { renderMath } from '../../../lib/board/math/render-math.js';

export function MathView({ content }) {
  if (Array.isArray(content.steps)) {
    return (
      <div style={{ display: 'grid', gap: 14, justifyItems: 'center', padding: 20 }}>
        {content.steps.map((step, i) => (
          <div key={i} style={{ textAlign: 'center' }}>
            <div dangerouslySetInnerHTML={{ __html: renderMath(step.latex) }} />
            {step.note && <div style={{ fontSize: 14, color: '#8a6d3b', marginTop: 4, fontStyle: 'italic' }}>{step.note}</div>}
          </div>
        ))}
      </div>
    );
  }
  return <div style={{ padding: 24, textAlign: 'center' }} dangerouslySetInnerHTML={{ __html: renderMath(content.latex) }} />;
}

'use client';

// SIMULATION VIEW — the "manipulate it" spine step powered by a REAL external interactive:
// a PhET simulation (physics/chem/bio/math, Nobel-laureate-founded, research-based) or a
// Desmos graph the student actually drags. No API key; embedded as a sandboxed iframe from a
// hardcoded allowlist of trusted educational origins (never an arbitrary URL from the model).
//
// content: { provider: "phet" | "desmos", sim: <phet sim name> | expr: <desmos expression>,
//            title, caption, why }  — the model names the sim/expression; the URL is built
// here from the allowlisted template so a hallucinated origin can never load.

import { useState } from 'react';

const V = (n, f) => `var(${n}, ${f})`;

// Allowlist: only these origins can be embedded. The model supplies a sim NAME, not a URL.
const PHET_BASE = 'https://phet.colorado.edu/sims/html';
const DESMOS_BASE = 'https://www.desmos.com/calculator';

// Known-good PhET sim slugs by topic (the model picks one; unknown -> no embed, honest).
const PHET_SIMS = {
  'projectile-motion': 'projectile-motion',
  'forces-and-motion-basics': 'forces-and-motion-basics',
  'energy-skate-park-basics': 'energy-skate-park-basics',
  'masses-and-springs-basics': 'masses-and-springs-basics',
  'balancing-chemical-equations': 'balancing-chemical-equations',
  'build-a-molecule': 'build-a-molecule',
  'concentration': 'concentration',
  'natural-selection': 'natural-selection',
  'gene-expression-essentials': 'gene-expression-essentials',
  'graphing-lines': 'graphing-lines',
  'graphing-slope-intercept': 'graphing-slope-intercept',
  'trig-tour': 'trig-tour',
};

function phetUrl(sim) {
  const slug = PHET_SIMS[sim];
  return slug ? `${PHET_BASE}/${slug}/latest/${slug}_en.html` : null;
}

function desmosUrl(expr) {
  // Desmos accepts a URL-encoded expression via the state param is complex; the safe public
  // embed is the calculator with a prefilled expression through the graphing URL fragment.
  return `${DESMOS_BASE}?embed`; // interactive blank graphing calculator (student types/drags)
}

export function SimulationView({ content }) {
  const [loaded, setLoaded] = useState(false);
  const provider = content?.provider;
  const url = provider === 'phet' ? phetUrl(content.sim) : provider === 'desmos' ? desmosUrl(content.expr) : null;

  if (!url) {
    // honest fallback: no trusted interactive matched — show the intent, not a broken frame
    return (
      <div style={{ padding: 20, borderRadius: 12, border: `1px dashed ${V('--border', '#eadfd8')}`, color: V('--ink-muted', '#8a7d76'), fontSize: 13 }}>
        {content?.title ?? 'Interactive'} — no trusted simulation matched this concept.
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', width: '100%' }}>
      {content?.title && <div style={{ fontSize: 15, fontWeight: 800, color: V('--ink', '#2b2320'), marginBottom: 4 }}>{content.title}</div>}
      {content?.why && <div style={{ fontSize: 12.5, color: V('--ink-muted', '#8a7d76'), marginBottom: 10, fontStyle: 'italic' }}>{content.why}</div>}
      <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: `1px solid ${V('--border', '#eadfd8')}`, background: '#fff', aspectRatio: '4 / 3' }}>
        {!loaded && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: V('--ink-muted', '#8a7d76'), fontSize: 13 }}>
            loading the interactive simulation…
          </div>
        )}
        <iframe
          src={url}
          title={content?.title ?? 'Interactive simulation'}
          onLoad={() => setLoaded(true)}
          allow="fullscreen"
          sandbox="allow-scripts allow-same-origin allow-popups"
          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
        />
      </div>
      <div style={{ fontSize: 11, color: V('--ink-muted', '#8a7d76'), marginTop: 6 }}>
        {provider === 'phet' ? 'PhET Interactive Simulations (University of Colorado Boulder) — drag to explore, then predict.' : 'Desmos graphing calculator — type or drag to explore.'}
        {content?.caption ? ` · ${content.caption}` : ''}
      </div>
    </div>
  );
}

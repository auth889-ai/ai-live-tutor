'use client';

// MOLECULE VIEW — the interactive "manipulate it" for chemistry & biology: a REAL 3D structure
// the student rotates, zooms, and inspects. 3Dmol.js downloads the actual structure from NCBI
// (a PubChem CID) or the RCSB Protein Data Bank (a PDB id) — the same data the evidence engines
// already verified. No API key; the model supplies an id, never markup.

import { useEffect, useRef, useState } from 'react';

export function MoleculeView({ content }) {
  const hostRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const pdbId = content?.pdbId ? String(content.pdbId).toUpperCase() : null;
  const cid = content?.cid ?? null;

  useEffect(() => {
    let viewer;
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('3dmol');
        const $3Dmol = mod.default ?? mod;
        if (cancelled || !hostRef.current) return;
        viewer = $3Dmol.createViewer(hostRef.current, { backgroundColor: '#0d1117' });
        const style = pdbId ? { cartoon: { color: 'spectrum' } } : { stick: {}, sphere: { scale: 0.28 } };
        const spec = pdbId ? `pdb:${pdbId}` : cid ? `cid:${cid}` : null;
        if (!spec) { setStatus('error'); return; }
        $3Dmol.download(spec, viewer, {}, () => {
          if (cancelled) return;
          viewer.setStyle({}, style);
          viewer.zoomTo();
          viewer.render();
          viewer.spin('y', 0.4); // gentle auto-rotate; drag to control
          setStatus('ready');
        });
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; try { viewer?.clear(); } catch { /* gone */ } };
  }, [pdbId, cid]);

  if (!pdbId && !cid) return null;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', width: '100%' }}>
      {content?.title && <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink, #2b2320)', marginBottom: 4 }}>{content.title}</div>}
      <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border, #eadfd8)', height: 400, background: '#0d1117' }}>
        <div ref={hostRef} style={{ width: '100%', height: '100%', position: 'relative' }} />
        {status !== 'ready' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a7d76', fontSize: 13, pointerEvents: 'none' }}>
            {status === 'error' ? 'could not load the 3D structure' : 'loading the real 3D structure…'}
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-muted, #8a7d76)', marginTop: 6 }}>
        {pdbId ? `RCSB Protein Data Bank · ${pdbId}` : `PubChem · CID ${cid}`} — drag to rotate, scroll to zoom. Real experimental structure.
        {content?.caption ? ` · ${content.caption}` : ''}
      </div>
    </div>
  );
}

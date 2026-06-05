import React, { memo, useEffect, useMemo, useState } from "react";

function safeArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function safeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = safeText(value).trim();
    if (text) return text;
  }
  return "";
}

function stripFence(value) {
  return safeText(value).replace(/^```(?:mermaid)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function useMermaidSvg(code) {
  const [state, setState] = useState({ loading: false, svg: "", error: "" });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const chart = stripFence(code);
      if (!chart) {
        setState({ loading: false, svg: "", error: "No Mermaid code." });
        return;
      }

      setState({ loading: true, svg: "", error: "" });

      try {
        const mod = await import("mermaid");
        const mermaid = mod.default || mod;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "loose",
          theme: "base",
          flowchart: { curve: "basis", htmlLabels: true },
          themeVariables: {
            primaryColor: "#fff7ed",
            primaryTextColor: "#201713",
            primaryBorderColor: "#7c3aed",
            lineColor: "#7c3aed",
            secondaryColor: "#eef2ff",
            tertiaryColor: "#ecfdf5",
            fontFamily: "Inter, system-ui, sans-serif",
          },
        });
        const id = `agent1_mermaid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const result = await mermaid.render(id, chart);
        if (!cancelled) setState({ loading: false, svg: result.svg || "", error: "" });
      } catch (error) {
        if (!cancelled) setState({ loading: false, svg: "", error: error?.message || "Mermaid render failed." });
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [code]);

  return state;
}

function TableBlock({ output }) {
  const table = safeObject(output.table);
  const columns = safeArray(table.columns);
  const rows = safeArray(table.rows).map((row) => safeArray(row));

  if (!columns.length || !rows.length) {
    return <p className="a1-muted">No table rows returned.</p>;
  }

  return (
    <div className="a1-table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((col, index) => (
              <th key={`${index}_${safeText(col)}`}>{safeText(col)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`row_${rowIndex}`}>
              {columns.map((_, colIndex) => (
                <td key={`cell_${rowIndex}_${colIndex}`}>{safeText(row[colIndex])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MermaidBlock({ output }) {
  const code = stripFence(output.mermaidCode || output.code);
  const { loading, svg, error } = useMermaidSvg(code);

  return (
    <div className="a1-mermaid-card">
      <div className="a1-diagram-bar">
        <span>Mermaid · {safeText(output.diagramType || "diagram")}</span>
        {loading ? <b>Rendering...</b> : null}
        {error ? <b className="a1-warn">fallback/raw view</b> : null}
      </div>
      {svg ? (
        <div className="a1-mermaid-output" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <pre className="a1-code">{code}</pre>
      )}
      {error ? <div className="a1-error">{error}</div> : null}
    </div>
  );
}

function SourcePills({ output }) {
  const pages = safeArray(output.sourcePages).filter(Boolean);
  const refs = safeArray(output.usedSourceRefIds || output.sourceRefIds).filter(Boolean);

  if (!pages.length && !refs.length) return null;

  return (
    <div className="a1-pills">
      {pages.slice(0, 8).map((page) => (
        <span key={`p_${page}`}>Pg. {safeText(page)}</span>
      ))}
      {refs.slice(0, 4).map((ref) => (
        <span key={`r_${ref}`} title={safeText(ref)}>{safeText(ref).slice(0, 24)}</span>
      ))}
    </div>
  );
}

function VisualCard({ output }) {
  const visualFormat = safeText(output.visualFormat);

  return (
    <article className="a1-card">
      <header>
        <div>
          <div className="a1-kicker">{visualFormat} · {safeText(output.diagramType)}</div>
          <h3>{firstNonEmpty(output.title, output.diagramType, "Agent 1 visual")}</h3>
        </div>
        <span className="a1-agent">PdfTextVisualAgent</span>
      </header>

      {visualFormat === "mermaid" ? <MermaidBlock output={output} /> : null}
      {visualFormat === "table" ? <TableBlock output={output} /> : null}

      {output.explanation ? <p className="a1-explain">{safeText(output.explanation)}</p> : null}

      {safeArray(output.teacherScript).length ? (
        <div className="a1-script">
          {safeArray(output.teacherScript).slice(0, 8).map((line, index) => (
            <div key={`${index}_${safeText(line).slice(0, 18)}`}>{safeText(line)}</div>
          ))}
        </div>
      ) : null}

      <SourcePills output={output} />
    </article>
  );
}

function outputsFromSceneGraph(sceneGraph) {
  const pages = safeArray(sceneGraph?.pages);
  return pages.flatMap((page) =>
    safeArray(page?.blocks).map((block) => ({
      id: block.id,
      title: block.title,
      visualFormat: block.visualFormat,
      diagramType: block.diagramType,
      mermaidCode: block.mermaidCode,
      table: block.table,
      explanation: block.text,
      teacherScript: block.teacherScript,
      sourcePages: block.sourcePages,
      sourceRefIds: block.sourceRefIds,
      usedSourceRefIds: block.sourceRefIds,
    }))
  );
}

function Agent1VisualRenderer({ result, sceneGraph, outputs, title }) {
  const finalOutputs = useMemo(() => {
    const direct = safeArray(outputs || result?.outputs);
    if (direct.length) return direct;
    return outputsFromSceneGraph(sceneGraph || result?.sceneGraph);
  }, [outputs, result, sceneGraph]);

  if (!finalOutputs.length) {
    return (
      <div className="a1-shell">
        <Agent1Styles />
        <div className="a1-empty">No Agent 1 visuals yet.</div>
      </div>
    );
  }

  return (
    <div className="a1-shell">
      <Agent1Styles />
      <div className="a1-header">
        <div>
          <div className="a1-kicker">Agent 1 test</div>
          <h2>{firstNonEmpty(title, result?.title, "PDF/Text → Mermaid/Table Visuals")}</h2>
          <p>{firstNonEmpty(result?.summary, "Source-grounded Mermaid diagrams and tables from PDF/transcript text.")}</p>
        </div>
        <div className="a1-badges">
          <span>{finalOutputs.length} visuals</span>
          <span>text only</span>
          <span>no fake image</span>
        </div>
      </div>
      <div className="a1-grid">
        {finalOutputs.map((output, index) => (
          <VisualCard key={firstNonEmpty(output.id, `${output.visualFormat}_${index}`)} output={safeObject(output)} />
        ))}
      </div>
    </div>
  );
}

function Agent1Styles() {
  return (
    <style>{`
      .a1-shell { color:#211713; font-family: Inter, system-ui, sans-serif; background:linear-gradient(135deg,#fffaf1,#f7efe2); border:1px solid rgba(214,197,172,.72); border-radius:28px; padding:20px; }
      .a1-header { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; margin-bottom:18px; }
      .a1-kicker { color:#7c3aed; text-transform:uppercase; letter-spacing:.16em; font-size:11px; font-weight:900; }
      .a1-header h2 { margin:4px 0; font-size:24px; }
      .a1-header p { margin:0; color:#6f6258; line-height:1.45; }
      .a1-badges { display:flex; flex-wrap:wrap; gap:7px; justify-content:flex-end; }
      .a1-badges span, .a1-pills span, .a1-agent { border:1px solid rgba(124,58,237,.16); background:rgba(124,58,237,.07); color:#5b21b6; border-radius:999px; padding:6px 9px; font-size:11px; font-weight:900; }
      .a1-grid { display:grid; grid-template-columns:1fr; gap:16px; }
      .a1-card { border:1px solid rgba(214,197,172,.72); background:rgba(255,255,255,.84); border-radius:22px; overflow:hidden; box-shadow:0 14px 48px rgba(87,59,31,.08); }
      .a1-card header { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; padding:14px 16px; border-bottom:1px solid rgba(214,197,172,.55); background:linear-gradient(90deg,rgba(255,247,237,.95),rgba(238,242,255,.9)); }
      .a1-card h3 { margin:3px 0 0; font-size:17px; }
      .a1-diagram-bar { display:flex; justify-content:space-between; gap:10px; padding:10px 12px; font-size:12px; font-weight:900; color:#4c1d95; border-bottom:1px solid rgba(214,197,172,.55); }
      .a1-warn { color:#b45309; }
      .a1-mermaid-output { padding:14px; overflow:auto; background:#fff; }
      .a1-mermaid-output svg { max-width:100%; height:auto; }
      .a1-code { margin:0; padding:14px; overflow:auto; background:#1f1b24; color:#f8fafc; font-size:12px; line-height:1.5; }
      .a1-error { padding:10px 12px; color:#991b1b; background:#fef2f2; font-size:12px; }
      .a1-table-wrap { margin:14px; overflow:auto; border:1px solid rgba(214,197,172,.72); border-radius:16px; }
      .a1-table-wrap table { width:100%; border-collapse:collapse; font-size:13px; background:#fff; }
      .a1-table-wrap th { background:rgba(124,58,237,.09); color:#4c1d95; font-weight:900; text-align:left; padding:10px; }
      .a1-table-wrap td { padding:10px; border-top:1px solid rgba(214,197,172,.52); vertical-align:top; line-height:1.4; }
      .a1-explain { margin:14px 16px 0; color:#3f352e; line-height:1.55; }
      .a1-script { margin:14px 16px; display:grid; gap:8px; }
      .a1-script div { border-left:3px solid rgba(124,58,237,.45); background:rgba(124,58,237,.06); border-radius:0 12px 12px 0; padding:8px 10px; color:#4f463f; font-size:13px; line-height:1.45; }
      .a1-pills { display:flex; flex-wrap:wrap; gap:7px; padding:0 16px 16px; }
      .a1-muted, .a1-empty { padding:20px; color:#6f6258; }
    `}</style>
  );
}

export default memo(Agent1VisualRenderer);

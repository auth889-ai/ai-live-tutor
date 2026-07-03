"""
tests/python/render_lesson_html.py
===============================================================================
LESSON BOARD RENDERER — turns a generated lesson content JSON into a VISUAL board
HTML you can open in a browser (so the lesson is no longer invisible JSON).

Renders, per screen: the REAL PDF page image (fetched, base64-embedded — never
generated), the element cards (definition / key points / table / code / executed
dry-run / source quote), and the teacher's voice-script panel. Styled like the
sample board screenshots.

Run:
  python tests/python/render_lesson_html.py [lesson.json]   # default node_full_lesson.json
Output:
  agent_output/lesson_preview.html
===============================================================================
"""

import base64
import html
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
OUT = ROOT / "agent_output"
RESOURCE = "glt_resource_1780558985921_5f1ea0e3"
IMG_DIR = ROOT / "server" / "public" / "live-tutor-page-images" / RESOURCE


def L(x): return x if isinstance(x, list) else []
def D(x): return x if isinstance(x, dict) else {}
def esc(s): return html.escape(str(s or ""))


def page_img_b64(page: int) -> str:
    p = IMG_DIR / f"page-{int(page):02d}.png"
    if not p.exists():
        return ""
    return "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode()


def render_element(e: dict) -> str:
    e = D(e)
    et = esc(e.get("elementType"))
    title = esc(e.get("title"))
    parts = [f'<div class="el"><div class="el-type">{et}</div>']
    if title:
        parts.append(f'<div class="el-title">{title}</div>')
    if e.get("body"):
        parts.append(f'<div class="el-body">{esc(e.get("body"))}</div>')
    for b in L(e.get("bullets")):
        parts.append(f'<div class="bullet">✓ {esc(b)}</div>')
    tbl = D(e.get("table"))
    if tbl.get("rows"):
        cols = L(tbl.get("columns"))
        th = "".join(f"<th>{esc(c)}</th>" for c in cols)
        trs = "".join("<tr>" + "".join(f"<td>{esc(c)}</td>" for c in L(r)) + "</tr>" for r in L(tbl.get("rows")))
        parts.append(f'<table class="tbl"><tr>{th}</tr>{trs}</table>')
    code = D(e.get("code"))
    if code.get("content"):
        parts.append(f'<pre class="code"><span class="lang">{esc(code.get("language"))}</span>{esc(code.get("content"))}</pre>')
    if e.get("sandboxOutput"):
        parts.append(f'<div class="sandbox"><div class="sb-h">▶ Executed (real code_execution)</div>'
                     f'<pre>{esc(e.get("sandboxOutput"))}</pre></div>')
    elif L(e.get("dryRun")):
        rows = "".join(f"<div>• step {D(s).get('step')}: {esc(D(s).get('action'))} → {esc(D(s).get('result'))}</div>"
                       for s in L(e.get("dryRun")))
        parts.append(f'<div class="dryrun">{rows}</div>')
    meta = []
    if e.get("regionId"):
        meta.append(f'region {esc(e.get("regionId"))}')
    if e.get("sourceRef"):
        meta.append(f'source {esc(e.get("sourceRef"))}')
    if meta:
        parts.append(f'<div class="el-meta">📍 {" · ".join(meta)}</div>')
    parts.append("</div>")
    return "".join(parts)


def render_screen(scr: dict, idx: int) -> str:
    scr = D(scr)
    pages = L(scr.get("pages"))
    img = ""
    for p in pages:
        b = page_img_b64(p)
        if b:
            img = f'<div class="pageimg"><div class="pi-cap">Real PDF page {int(p)} (fetched)</div><img src="{b}"/></div>'
            break
    els = "".join(render_element(e) for e in L(scr.get("elements")))
    voices = "".join(f'<div class="vl">🔊 {esc(D(v).get("text"))}'
                     + (f' <span class="vtarget">→ {esc(D(v).get("targetRegionId"))}</span>' if D(v).get("targetRegionId") else "")
                     + '</div>' for v in L(scr.get("voiceLines")))
    mode = esc(scr.get("mode") or "")
    return f"""
    <div class="screen">
      <div class="screen-head"><span class="badge">SCREEN {idx}</span>
        <span class="mode">{mode}</span>
        <h2>{esc(scr.get("title"))}</h2></div>
      <div class="screen-body">
        <div class="board">{els}{img}</div>
        <div class="voice"><div class="voice-h">🎙 Teacher voice ({len(L(scr.get("voiceLines")))} lines)</div>{voices}</div>
      </div>
    </div>"""


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else OUT / "node_full_lesson.json"
    data = json.load(open(src))
    segs = L(data.get("segments"))
    screens_html = []
    i = 0
    for s in segs:
        s = D(s)
        screens_html.append(f'<div class="seg-title">▎ Segment: {esc(s.get("title") or s.get("segmentId"))}</div>')
        for scr in L(s.get("screens")):
            i += 1
            screens_html.append(render_screen(scr, i))
    n_el = sum(len(L(D(scr).get("elements"))) for s in segs for scr in L(D(s).get("screens")))
    n_v = sum(len(L(D(scr).get("voiceLines"))) for s in segs for scr in L(D(s).get("screens")))

    css = """
    body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#faf7f2;color:#2b2b2b;margin:0;padding:24px;}
    h1{font-size:30px;margin:0 0 4px;} .sub{color:#888;margin-bottom:20px;}
    .seg-title{font-size:20px;color:#d2691e;margin:30px 0 10px;font-weight:700;}
    .screen{background:#fff;border:1px solid #eee;border-radius:14px;margin:16px 0;padding:18px;box-shadow:0 2px 10px rgba(0,0,0,.04);}
    .screen-head{display:flex;align-items:center;gap:10px;border-bottom:1px solid #f0f0f0;padding-bottom:10px;margin-bottom:12px;}
    .screen-head h2{font-size:19px;margin:0;} .badge{background:#ff6b35;color:#fff;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;}
    .mode{background:#eef;color:#446;border-radius:6px;padding:2px 8px;font-size:11px;}
    .screen-body{display:grid;grid-template-columns:1fr 320px;gap:16px;}
    .board{display:flex;flex-direction:column;gap:10px;}
    .el{border:1px solid #eee;border-radius:10px;padding:12px;background:#fdfdfd;}
    .el-type{font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:.5px;}
    .el-title{font-weight:700;font-size:15px;margin:2px 0 6px;}
    .el-body{font-size:14px;line-height:1.55;color:#333;}
    .bullet{font-size:14px;margin:3px 0;color:#2a7;}
    .tbl{border-collapse:collapse;margin:8px 0;font-size:13px;} .tbl th,.tbl td{border:1px solid #ddd;padding:5px 9px;} .tbl th{background:#f6f6f6;}
    .code{background:#1e1e2e;color:#cdd6f4;padding:12px;border-radius:8px;font-size:12px;overflow:auto;position:relative;}
    .code .lang{position:absolute;right:8px;top:4px;color:#888;font-size:10px;}
    .sandbox{background:#0f2417;border:1px solid #1f5e3a;border-radius:8px;padding:10px;margin-top:6px;}
    .sandbox .sb-h{color:#4ade80;font-size:11px;margin-bottom:4px;} .sandbox pre{color:#a7f3d0;margin:0;font-size:12px;white-space:pre-wrap;}
    .dryrun{font-size:13px;color:#555;background:#f7f7ff;border-radius:8px;padding:8px;}
    .el-meta{font-size:11px;color:#c08457;margin-top:6px;}
    .pageimg{border:1px dashed #d2b48c;border-radius:10px;padding:8px;background:#fffdf8;}
    .pi-cap{font-size:11px;color:#b8860b;margin-bottom:4px;} .pageimg img{width:100%;border-radius:6px;}
    .voice{background:#0b1220;color:#cbd5e1;border-radius:10px;padding:12px;height:fit-content;}
    .voice-h{color:#7dd3fc;font-size:12px;margin-bottom:8px;font-weight:700;}
    .vl{font-size:12.5px;line-height:1.5;margin:6px 0;border-bottom:1px solid #1e293b;padding-bottom:6px;}
    .vtarget{color:#fbbf24;font-size:11px;}
    """
    htmlout = f"""<!doctype html><html><head><meta charset="utf-8"><title>Lesson Board</title>
    <style>{css}</style></head><body>
    <h1>{esc(data.get("title") or "Lesson")}</h1>
    <div class="sub">{len(segs)} segments · {i} screens · {n_el} element cards · {n_v} voice lines · images fetched from the real PDF</div>
    {''.join(screens_html)}
    </body></html>"""

    out = OUT / "lesson_preview.html"
    out.write_text(htmlout)
    print(f"  rendered {len(segs)} segments, {i} screens, {n_el} cards, {n_v} voice lines")
    print(f"  → open: {out}")


if __name__ == "__main__":
    main()

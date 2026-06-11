"""
scripts/render_board_ascii.py
Renders REAL generated screens from agent_output/backend_preview.json
in the user's sample-board style — proving the data contains everything
the sample images show. (The W4 frontend does this with React/Framer.)

Run: python scripts/render_board_ascii.py [screen_index ...]
"""

import json
import sys
from pathlib import Path

W = 78

def line(ch="─"):
    return "│" + ch * (W - 2) + "│"

def row(text="", indent=2):
    text = str(text)
    avail = W - 2 - indent
    out = []
    while text:
        out.append("│" + " " * indent + text[:avail].ljust(avail) + "│")
        text = text[avail:]
    return "\n".join(out) or "│" + " " * (W - 2) + "│"

def top(title, right=""):
    inner = f" {title}".ljust(W - 2 - len(right) - 1) + right + " "
    return "┌" + "─" * (W - 2) + "┐\n│" + inner[:W - 2].ljust(W - 2) + "│\n├" + "─" * (W - 2) + "┤"

def bottom():
    return "└" + "─" * (W - 2) + "┘"

EMO = {"success": "✅", "danger": "❌", "highlight": "💡", "normal": "  "}


def render_screen(s, commands, voice_line):
    parts = [top(f"LUMINA LIVE BOARD — {s.get('screenType', '')}",
                 f"seg{s.get('segmentIndex')}")]
    parts.append(row(""))
    parts.append(row(f"【 {s.get('title', '')} 】", 4))
    if s.get("subtitle"):
        parts.append(row(s["subtitle"], 6))
    parts.append(row(""))

    # visual elements at their positions (sorted by y)
    elements = sorted(s.get("visualElements") or [], key=lambda e: (e.get("position") or {}).get("y", 0))
    if elements:
        parts.append(row("── ON THE BOARD (drawn live, in order) " + "─" * 20, 2))
        for el in elements:
            p = el.get("position") or {}
            kind = el.get("kind")
            marker = {"box": "▭", "arrow": "→", "code_line": "⌨",
                      "label": "◦", "pdf_crop": "🖼REAL-PDF-CROP",
                      "highlight_zone": "▒", "table_drawing": "▦"}.get(kind, "·")
            pos = f"({p.get('x')},{p.get('y')})"
            content = (el.get("content") or "")[:52]
            region = f" ←region:{el.get('regionId')}" if el.get("regionId") else ""
            parts.append(row(f"{marker} [{kind}@{pos}] {content}{region}", 4))
    parts.append(row(""))

    # blocks
    for b in s.get("blocks") or []:
        em = EMO.get(b.get("emphasis"), "  ")
        btype = b.get("type")
        content = b.get("content") or ""
        if btype == "comparison_left":
            parts.append(row(f"┌─ LEFT ──  {em} {content[:55]}", 3))
        elif btype == "comparison_right":
            parts.append(row(f"└─ RIGHT ─  {em} {content[:55]}", 3))
        elif btype == "quote_from_source":
            parts.append(row(f"📖 SOURCE: “{content[:58]}”", 3))
        elif btype == "warning":
            parts.append(row(f"⚠️  {content[:60]}", 3))
        elif btype == "step":
            parts.append(row(f"STEP ▸ {content[:58]}", 3))
        elif btype == "heading":
            parts.append(row(f"■ {content[:60]}", 3))
        else:
            parts.append(row(f"{em} {content[:62]}", 3))

    # dry run
    if s.get("dryRun"):
        parts.append(row(""))
        parts.append(row("── DRY RUN (execute it mentally) " + "─" * 26, 2))
        for st in s["dryRun"]:
            parts.append(row(f"{st.get('step')}. {st.get('codeLine', '')[:58]}", 4))
            parts.append(row(f"   → {st.get('whatHappens', '')[:58]}", 4))
            parts.append(row(f"   state: {st.get('stateAfter', '')[:54]}", 4))
            if st.get("beginnerTrap"):
                parts.append(row(f"   ⚠ trap: {st['beginnerTrap'][:52]}", 4))

    parts.append(row(""))
    parts.append(row(f"❓ CHECK: {s.get('checkQuestion', '')[:58]}", 3))
    ref = s.get("sourceRef") or {}
    parts.append(row(f"📄 p.{ref.get('page')} “{(ref.get('quote') or '')[:52]}”", 3))
    parts.append(bottom())

    # teacher voice
    parts.append("\n🗣  TEACHER VOICE:")
    vo = s.get("voiceover") or (voice_line or {}).get("text") or ""
    for i in range(0, min(len(vo), 360), 72):
        parts.append("   " + vo[i:i + 72])

    # timed board actions
    cmds = [c for c in commands if c.get("screenId") == s.get("screenId")][:8]
    if cmds:
        parts.append("\n⏱  BOARD ACTIONS (timed, like your samples):")
        for c in cmds:
            bbox = c.get("bbox") or {}
            parts.append(f"   {c.get('startMs', 0)/1000:6.1f}s  {c.get('commandType', ''):12s}"
                         f" bbox=({bbox.get('x')},{bbox.get('y')},{bbox.get('w')},{bbox.get('h')})"
                         f"  “{(c.get('narrationCue') or '')[:34]}”")
    return "\n".join(parts)


lesson = json.loads(Path("agent_output/backend_preview.json").read_text())
screens = lesson["boardScreens"]
commands = lesson["boardCommands"]
voice = {v.get("screenId"): v for v in lesson.get("voiceScript", [])}

indices = [int(a) for a in sys.argv[1:]] if len(sys.argv) > 1 else None
if indices is None:
    # pick a showcase: the hook, a dryRun screen, a comparison/repair screen
    picks = []
    for i, s in enumerate(screens):
        if not picks and "hook" in (s.get("screenType") or ""):
            picks.append(i)
        if len(picks) == 1 and s.get("dryRun"):
            picks.append(i)
        if len(picks) == 2 and any(
                b.get("type", "").startswith("comparison")
                for b in s.get("blocks") or []):
            picks.append(i)
            break
    indices = picks or [0, 1, 2]

for i in indices:
    s = screens[i]
    print(f"\n{'═' * W}\nSCREEN {i + 1} of {len(screens)}\n{'═' * W}")
    print(render_screen(s, commands, voice.get(s.get("screenId"))))

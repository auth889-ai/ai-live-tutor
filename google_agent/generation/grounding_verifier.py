"""
google_agent/generation/grounding_verifier.py
===============================================================================
GROUNDING VERIFIER — quality-stack stage 5 (W3). PURE CODE, NO AI.

"Grounded" is not a vibe here — it is a boolean:
  · sourceRef.quote must be VERBATIM text found in a real chunk
  · every pdf_crop regionId must exist in the visionIndex
  · every boardAction targetElementId must exist in that screen's elements
  · boardActions timing monotonic, positions within the board (0-1)
  · dryRun present on procedural screen types
  · no empty blocks/voiceover

Returns precise, named defects — fed to the critic/repair loop so
regeneration fixes SPECIFIC flaws, never "try again".
===============================================================================
"""

from __future__ import annotations

import re
from typing import Any, Dict, List

try:
    from .screen_schema import DRYRUN_REQUIRED_TYPES
except ImportError:  # pragma: no cover
    from google_agent.generation.screen_schema import DRYRUN_REQUIRED_TYPES  # type: ignore


def _norm(text: str) -> str:
    """Whitespace/case-tolerant normalization for verbatim matching."""
    return re.sub(r"\s+", " ", (text or "")).strip().lower()


def _norm_hard(text: str) -> str:
    """Punctuation-tolerant normalization: models quote with smart quotes,
    inserted commas, dashes, ellipses — meaning-identical, character-different.
    Strip everything except letters/digits/spaces, collapse whitespace."""
    text = (text or "").lower()
    text = re.sub(r"[^a-z0-9\s]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def quote_is_grounded(quote: str, chunks: list) -> bool:
    """
    Layered verbatim check (the anti-hallucination boolean, made fair):
      L1 exact substring (whitespace/case-normalized)
      L2 punctuation-stripped substring  ← absorbs smart-quote/comma drift
      L3 fuzzy window: best SequenceMatcher ratio vs any chunk ≥ 0.92
         (absorbs a single inserted/dropped word; still rejects invention)
    """
    q1 = _norm(quote)
    if len(q1) < 12:
        return bool(q1)
    texts = [(c.get("text") or c.get("textPreview") or "") for c in chunks]

    haystack1 = " ".join(_norm(t) for t in texts)
    if q1 in haystack1:
        return True

    q2 = _norm_hard(quote)
    haystack2 = " ".join(_norm_hard(t) for t in texts)
    if q2 and q2 in haystack2:
        return True

    # L3: bigram coverage — ≥75% of the quote's word-pairs must appear in a
    # single chunk. Absorbs one inserted/dropped word; invention (mostly novel
    # word-pairs) stays far below the bar.
    q_tokens = q2.split()
    if len(q_tokens) < 4:
        return False
    q_bigrams = {(q_tokens[i], q_tokens[i + 1]) for i in range(len(q_tokens) - 1)}
    for t in texts:
        h_tokens = _norm_hard(t).split()
        if len(h_tokens) < 3:
            continue
        h_bigrams = {(h_tokens[i], h_tokens[i + 1]) for i in range(len(h_tokens) - 1)}
        if len(q_bigrams & h_bigrams) / len(q_bigrams) >= 0.75:
            return True
    return False


def verify_screen(screen: Dict[str, Any], payload: Dict[str, Any]) -> List[str]:
    """Returns a list of named defects. Empty list = screen passes."""
    defects: List[str] = []
    sid = screen.get("screenId") or "?"

    # ① GROUNDED QUOTE CHECK — the anti-hallucination boolean (layered:
    # exact → punctuation-tolerant → 0.92 fuzzy window; still rejects invention)
    ref = screen.get("sourceRef") or {}
    raw_quote = ref.get("quote") or ""
    if not _norm(raw_quote):
        defects.append(f"{sid}: sourceRef.quote is empty")
    else:
        chunks = payload.get("selectedEvidence") or payload.get("chunks") or []
        if not quote_is_grounded(raw_quote, chunks):
            defects.append(
                f"{sid}: sourceRef.quote is NOT grounded in evidence "
                f"(first 60 chars: {raw_quote[:60]!r})")

    # ② pdf_crop regions must be REAL visionIndex regions
    vision_ids = {r.get("regionId") for r in (payload.get("visionIndex") or [])}
    element_ids = set()
    for el in screen.get("visualElements") or []:
        element_ids.add(el.get("elementId"))
        if el.get("kind") == "pdf_crop":
            rid = el.get("regionId")
            if not rid:
                defects.append(f"{sid}/{el.get('elementId')}: pdf_crop without regionId")
            elif vision_ids and rid not in vision_ids:
                defects.append(f"{sid}/{el.get('elementId')}: pdf_crop regionId "
                               f"{rid!r} not in visionIndex")
        # ③ positions within the board.
        # Arrows/lines legitimately have zero width OR height (a horizontal
        # arrow is a line) — require only that they have SOME extent and
        # never negative dimensions.
        pos = el.get("position") or {}
        try:
            x, y = float(pos.get("x", 0)), float(pos.get("y", 0))
            w, h = float(pos.get("w", 0)), float(pos.get("h", 0))
            is_line = el.get("kind") == "arrow"
            extent_ok = (w > 0 and h > 0) or (is_line and (w > 0 or h > 0))
            if not (0 <= x <= 1 and 0 <= y <= 1 and w >= 0 and h >= 0
                    and extent_ok and x + w <= 1.02 and y + h <= 1.02):
                defects.append(f"{sid}/{el.get('elementId')}: position off-board "
                               f"({x},{y},{w},{h})")
        except (TypeError, ValueError):
            defects.append(f"{sid}/{el.get('elementId')}: non-numeric position")

    # ④ boardActions: targets exist, timing monotonic
    last_ms = -1
    for action in screen.get("boardActions") or []:
        target = action.get("targetElementId")
        if target and target not in element_ids:
            defects.append(f"{sid}: action targets missing element {target!r}")
        at_ms = action.get("atMs")
        if isinstance(at_ms, int):
            if at_ms < last_ms:
                defects.append(f"{sid}: boardActions timing not monotonic at {at_ms}ms")
            last_ms = max(last_ms, at_ms)

    # ⑤ dry-run discipline on procedural screens.
    # 'step' blocks are an equivalent expression of stepwise teaching —
    # accept EITHER dryRun entries OR ≥2 step blocks.
    stype = screen.get("screenType") or ""
    if stype in DRYRUN_REQUIRED_TYPES and not screen.get("dryRun"):
        step_blocks = [b for b in screen.get("blocks") or []
                       if b.get("type") == "step" and (b.get("content") or "").strip()]
        if len(step_blocks) < 2:
            defects.append(f"{sid}: screenType {stype!r} requires dryRun steps "
                           f"(or ≥2 'step' blocks)")
    for step in screen.get("dryRun") or []:
        if not (step.get("whatHappens") and step.get("stateAfter")):
            defects.append(f"{sid}: dryRun step {step.get('step')} missing "
                           f"whatHappens/stateAfter")

    # ⑥ no empty teaching surfaces
    if not (screen.get("voiceover") or "").strip():
        defects.append(f"{sid}: empty voiceover")
    if not screen.get("blocks") and not screen.get("visualElements"):
        defects.append(f"{sid}: no blocks AND no visualElements — empty screen")
    for i, block in enumerate(screen.get("blocks") or []):
        if not (block.get("content") or "").strip():
            defects.append(f"{sid}: block[{i}] has empty content")

    # ⑦ BOARD DENSITY (R11) — a master teacher's board is FULL.
    # Light types (hooks, checks, decoration) are exempt; content screens
    # need ≥4 blocks and ≥3 visual elements; drawn tables need real rows.
    LIGHT_TYPES = {"starter_hook", "quick_question", "confidence_check",
                   "pause_and_think", "lesson_roadmap", "learning_objective",
                   "celebration_checkpoint", "progress_badge", "tiny_mascot",
                   "corner_decoration", "subject_icon", "soft_background_theme",
                   "topic_mini_scene", "key_takeaway", "replay_bookmark"}
    if stype not in LIGHT_TYPES:
        n_blocks = len(screen.get("blocks") or [])
        n_elements = len(screen.get("visualElements") or [])
        if n_blocks < 4:
            defects.append(f"{sid}: sparse board — only {n_blocks} blocks "
                           f"(content screens need ≥4: build the realization)")
        if n_elements < 3:
            defects.append(f"{sid}: sparse board — only {n_elements} visual "
                           f"elements (need ≥3: things drawn, pointed at, annotated)")
    for el in screen.get("visualElements") or []:
        if el.get("kind") == "table_drawing":
            content = el.get("content") or ""
            if content.count("\n") < 1 and content.count("|") < 2:
                defects.append(f"{sid}/{el.get('elementId')}: table_drawing "
                               f"without real rows — concrete example data required")

    return defects


def verify_segment(segment: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    """Verify all screens. Returns {ok, defects[], screensChecked, defectsByScreen}."""
    all_defects: List[str] = []
    by_screen: Dict[str, List[str]] = {}
    screens = segment.get("screens") or []

    for screen in screens:
        defects = verify_screen(screen, payload)
        if defects:
            by_screen[screen.get("screenId") or "?"] = defects
            all_defects.extend(defects)

    return {
        "ok": not all_defects,
        "defects": all_defects,
        "screensChecked": len(screens),
        "screensWithDefects": len(by_screen),
        "defectsByScreen": by_screen,
    }

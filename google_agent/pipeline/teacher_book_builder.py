"""
teacher_book_builder.py — saves the lesson as a readable book (markdown + HTML).
Student can read lesson notes, review sources, study for exams.
"""
from __future__ import annotations
import time
from typing import List

try:
    from ..live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, safe_dict, safe_list, clean_text

try:
    from ..source.rag.citation_builder import build_lesson_bibliography
except ImportError:
    from google_agent.source.rag.citation_builder import build_lesson_bibliography


def build_lesson_book(lesson_plan: JsonDict, segments: List[JsonDict]) -> JsonDict:
    plan  = safe_dict(lesson_plan)
    title = clean_text(plan.get("nodeTitle") or "Lesson", 100)
    mode  = plan.get("lessonMode") or "standard"

    chapters, all_refs, all_key_points = [], [], []

    for seg in safe_list(segments):
        s       = safe_dict(seg)
        chapter = _build_chapter(s)
        chapters.append(chapter)
        all_refs.extend(chapter.get("sourceQuotes") or [])
        all_key_points.extend(chapter.get("keyPoints") or [])

    md   = _build_markdown(title, mode, chapters, all_refs)
    html = _build_html(title, mode, chapters)

    return {
        "lessonId":        plan.get("lessonId") or "",
        "nodeTitle":       title,
        "lessonMode":      mode,
        "totalSegments":   len(chapters),
        "totalDurationMs": plan.get("estimatedMs") or 0,
        "markdown":        md,
        "html":            html,
        "chapters":        chapters,
        "allKeyPoints":    all_key_points,
        "sourceCitations": list({r for r in all_refs if r}),
        "savedAt":         int(time.time() * 1000),
        "metadata":        {"fallbackUsed": False, "canExport": True},
    }


def _build_chapter(segment: JsonDict) -> JsonDict:
    voice_lines = safe_list(segment.get("voiceScript") or segment.get("voiceLines") or [])
    narration   = [clean_text(safe_dict(v).get("text") or "", 400) for v in voice_lines if safe_dict(v).get("text")]
    source_refs = safe_list(segment.get("sourceRefs") or [])
    quotes      = [f'[Page {safe_dict(r).get("page")}]: "{clean_text(safe_dict(r).get("quote") or "", 200)}"' for r in source_refs if safe_dict(r).get("quote")]
    quizzes     = [s for s in safe_list(segment.get("boardScreens") or []) if safe_dict(s).get("screenType") == "quiz"]
    key_points  = _extract_key_points(narration)

    return {
        "segmentId":       segment.get("segmentId") or "",
        "segmentType":     segment.get("segmentType") or "",
        "title":           segment.get("title") or "",
        "teacherNarration": narration[:50],
        "sourceQuotes":    quotes[:8],
        "keyPoints":       key_points,
        "quiz":            safe_dict(quizzes[0]).get("boardCommands") if quizzes else None,
    }


def _extract_key_points(narration: List[str]) -> List[str]:
    points = []
    for s in narration:
        low = s.lower()
        if any(w in low for w in ["is a", "means", "defined as", "key", "important", "remember", "always"]):
            points.append(s[:120])
        if len(points) >= 8:
            break
    return points


def _build_markdown(title: str, mode: str, chapters: List[JsonDict], all_refs: List[str]) -> str:
    lines = [f"# {title}\n", f"*Lesson mode: {mode}*\n", "---\n"]
    for i, ch in enumerate(chapters):
        lines.append(f"\n## Chapter {i+1}: {ch.get('title', '')}\n")
        for line in (ch.get("teacherNarration") or [])[:10]:
            lines.append(f"{line}\n")
        if ch.get("keyPoints"):
            lines.append("\n**Key Points:**\n")
            for kp in ch["keyPoints"]:
                lines.append(f"- {kp}\n")
        if ch.get("sourceQuotes"):
            lines.append("\n**Sources:**\n")
            for q in ch["sourceQuotes"]:
                lines.append(f"> {q}\n")
    return "".join(lines)


def _build_html(title: str, mode: str, chapters: List[JsonDict]) -> str:
    h = [f"<h1>{title}</h1><p><em>Lesson: {mode}</em></p>"]
    for i, ch in enumerate(chapters):
        h.append(f"<h2>Chapter {i+1}: {ch.get('title','')}</h2>")
        for line in (ch.get("teacherNarration") or [])[:10]:
            h.append(f"<p>{line}</p>")
        if ch.get("keyPoints"):
            h.append("<ul>" + "".join(f"<li>{kp}</li>" for kp in ch["keyPoints"]) + "</ul>")
    return "".join(h)

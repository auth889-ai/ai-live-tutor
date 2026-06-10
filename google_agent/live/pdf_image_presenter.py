"""
pdf_image_presenter.py — builds board commands for real PDF page images.
Teacher points at exact diagram/table area with pointer + highlight + circle.
No invented images. Only real files from disk.
"""
from __future__ import annotations
import time, uuid
from typing import List, Optional

try:
    from ..live_tutor_agents.contracts import JsonDict, safe_dict, safe_list
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, safe_dict, safe_list

try:
    from ..source.vision.image_loader import image_path, get_all_page_images
    from ..visual.board.command_contract import BoardCommand
    from ..visual.board.teacher_marks import move_pointer, highlight, circle
except ImportError:
    from google_agent.source.vision.image_loader import image_path, get_all_page_images
    from google_agent.visual.board.command_contract import BoardCommand
    from google_agent.visual.board.teacher_marks import move_pointer, highlight, circle


def _cid() -> str:
    return f"pdf_{int(time.time()*1000)}_{uuid.uuid4().hex[:4]}"


def build_pdf_page_commands(
    resource_id: str,
    page_num: int,
    screen_id: str,
    segment_id: str,
    start_ms: int,
    voice_line_id: str = "",
    diagram_area: Optional[dict] = None,
    table_area: Optional[dict] = None,
    marking_hints: List[str] = None,
    source_ref_id: str = "",
) -> List[dict]:
    p = image_path(resource_id, page_num)
    if not p:
        return []   # no real image exists — caller falls back to generated board

    cmds      = []
    cur_ms    = start_ms
    marks     = marking_hints or []

    # 1. Show full page image
    cmds.append(BoardCommand(
        commandId=_cid(), type="showPdfPageImage",
        screenId=screen_id, segmentId=segment_id,
        startMs=cur_ms, durationMs=12000,
        voiceLineId=voice_line_id, sourceRefId=source_ref_id,
        pdfImageRef={"resourceId": resource_id, "pageNum": page_num, "imagePath": p,
                     "imageUrl": f"/live-tutor-page-images/{resource_id}/page-{str(page_num).zfill(2)}.png"},
        teacherIntent="show_real_pdf_page",
    ).to_dict())
    cur_ms += 2000

    # 2. Move pointer to diagram area if detected
    da = safe_dict(diagram_area or {})
    if da:
        cx = da.get("x", 0.5) + da.get("w", 0.2) / 2
        cy = da.get("y", 0.3) + da.get("h", 0.2) / 2
        cmds.append(move_pointer(cx, cy, screen_id, segment_id, cur_ms, voice_line_id))
        cur_ms += 500

        # 3. Circle around diagram
        r = min(da.get("w", 0.2), da.get("h", 0.2)) / 2 * 0.8
        cmds.append(circle(cx, cy, r, screen_id, segment_id, cur_ms, voice_line_id, "#f59e0b"))
        cur_ms += 600

    # 4. Highlight table area if detected
    ta = safe_dict(table_area or {})
    if ta:
        cmds.append(highlight("", ta.get("x",0.1), ta.get("y",0.5), ta.get("w",0.8), ta.get("h",0.15),
                               screen_id, segment_id, cur_ms, voice_line_id))
        cur_ms += 500

    return cmds


def get_page_commands_for_node(resource_id: str, page_nums: List[int], screen_id: str, segment_id: str,
                                vision_packet: JsonDict, start_ms: int = 0) -> List[dict]:
    vp      = safe_dict(vision_packet)
    diagrams = {safe_dict(d).get("page"): safe_dict(d).get("area") for d in safe_list(vp.get("detectedDiagrams") or [])}
    tables   = {safe_dict(t).get("page"): safe_dict(t).get("area") for t in safe_list(vp.get("detectedTables")   or [])}
    hints    = [clean_hint(h) for h in safe_list(vp.get("teacherMarkingHints") or [])]

    all_cmds = []
    cur_ms   = start_ms
    for page in page_nums[:4]:
        cmds = build_pdf_page_commands(
            resource_id, page, screen_id, segment_id, cur_ms,
            diagram_area=diagrams.get(page), table_area=tables.get(page), marking_hints=hints,
        )
        all_cmds.extend(cmds)
        cur_ms += 14000

    return all_cmds


def clean_hint(h) -> str:
    return str(h)[:100] if h else ""

"""
command_contract.py — BoardCommand dataclass: every timed action on the teaching board.
Every command: commandId + type + timing + voice sync + source reference.
"""
from __future__ import annotations
import uuid, time
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional

ALLOWED_TYPES = {
    "write","drawBox","drawArrow","drawCircle","underline","highlight",
    "drawTable","codeBlock","showQuiz","movePointer","showPdfPageImage",
    "zoomDiagram","erase","revealBullet","showSourceBadge","premiumHtml",
    "svgDiagram","mermaidChart","pauseForStudent",
}


def _cid() -> str:
    return f"cmd_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"


@dataclass
class BoardCommand:
    type:          str
    text:          str          = ""
    screenId:      str          = ""
    segmentId:     str          = ""
    commandId:     str          = field(default_factory=_cid)
    startMs:       int          = 0
    durationMs:    int          = 1200
    voiceLineId:   str          = ""
    sourceRefId:   str          = ""
    x:             float        = 0.0
    y:             float        = 0.0
    width:         float        = 0.0
    height:        float        = 0.0
    color:         str          = "#1a1a2e"
    fontSize:      int          = 18
    revealOrder:   int          = 0
    teacherIntent: str          = ""
    # PDF image mode
    pdfImageRef:   Optional[Dict] = None   # {resourceId, pageNum, imagePath}
    pointerTarget: Optional[Dict] = None   # {x, y}  normalized 0-1
    highlightBox:  Optional[Dict] = None   # {x, y, w, h, color}
    circleTarget:  Optional[Dict] = None   # {x, y, r}  normalized 0-1
    arrowTarget:   Optional[Dict] = None   # {fromX, fromY, toX, toY, label}
    # Premium board mode
    premiumContent: Optional[Dict] = None  # {html, svg, mermaid, table}
    metadata:      Dict[str, Any] = field(default_factory=dict)

    def validate(self) -> List[str]:
        errs = []
        if self.type not in ALLOWED_TYPES:
            errs.append(f"Unknown type: {self.type}")
        if self.type in {"write","revealBullet","drawBox"} and not self.text:
            errs.append(f"{self.type} requires text")
        if self.durationMs <= 0:
            errs.append("durationMs must be positive")
        return errs

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None and v != "" and v != 0.0}

"""
scripts/measure_region.py
─────────────────────────
MEASUREMENT, not estimation: snap a rough AI bbox to the EXACT pixel bounds
of the connected structure it points at (diagrams = connected lines/boxes;
text columns = small disconnected specks → filtered out).

Pure computer vision: threshold → connected components → keep components
that overlap the rough bbox and are structurally large → exact union bounds.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def snap_bbox(page_png: str, rough: dict, expand: float = 0.10) -> dict:
    """rough = {x,y,w,h} fractions (AI estimate). Returns measured fractions."""
    img = np.asarray(Image.open(page_png).convert("L"))
    H, W = img.shape

    # search window: rough bbox grown by `expand` on every side
    x0 = max(0, int((rough["x"] - expand) * W))
    y0 = max(0, int((rough["y"] - expand) * H))
    x1 = min(W, int((rough["x"] + rough["w"] + expand) * W))
    y1 = min(H, int((rough["y"] + rough["h"] + expand) * H))
    window = img[y0:y1, x0:x1]

    # dark ink mask; slight dilation connects dashed/anti-aliased strokes
    mask = window < 160
    mask = ndimage.binary_dilation(mask, iterations=3)

    labels, n = ndimage.label(mask)
    if n == 0:
        return rough

    # rough bbox in window coordinates
    rx0 = int(rough["x"] * W) - x0
    ry0 = int(rough["y"] * H) - y0
    rx1 = rx0 + int(rough["w"] * W)
    ry1 = ry0 + int(rough["h"] * H)

    keep = np.zeros(n + 1, dtype=bool)
    slices = ndimage.find_objects(labels)
    win_area = window.shape[0] * window.shape[1]
    for i, sl in enumerate(slices, start=1):
        cy0, cy1 = sl[0].start, sl[0].stop
        cx0, cx1 = sl[1].start, sl[1].stop
        # overlap with the rough bbox?
        ov_x = max(0, min(cx1, rx1) - max(cx0, rx0))
        ov_y = max(0, min(cy1, ry1) - max(cy0, ry0))
        if ov_x <= 0 or ov_y <= 0:
            continue
        comp_area = (cy1 - cy0) * (cx1 - cx0)
        # diagrams are LARGE connected structures; stray words are tiny.
        # keep components whose box covers ≥2% of the window, or that sit
        # mostly inside the rough bbox (small labels of the diagram itself).
        mostly_inside = (ov_x * ov_y) / comp_area > 0.6
        if comp_area / win_area >= 0.02 or mostly_inside:
            keep[i] = True

    kept = keep[labels]
    if not kept.any():
        return rough

    ys, xs = np.where(kept)
    pad = 6  # px of breathing room
    mx0 = max(0, xs.min() - pad) + x0
    my0 = max(0, ys.min() - pad) + y0
    mx1 = min(window.shape[1] - 1, xs.max() + pad) + x0
    my1 = min(window.shape[0] - 1, ys.max() + pad) + y0

    return {"x": mx0 / W, "y": my0 / H,
            "w": (mx1 - mx0) / W, "h": (my1 - my0) / H}


if __name__ == "__main__":
    import json
    regions = json.loads(Path("/tmp/diagram_regions.json").read_text())
    r = next(x for x in regions if x["regionId"] == "p6_r3")
    page = ("server/public/live-tutor-page-images/"
            "glt_resource_1780558985921_5f1ea0e3/page-06.png")
    measured = snap_bbox(page, r["bbox"])
    print("AI estimate :", r["bbox"])
    print("MEASURED    :", {k: round(v, 4) for k, v in measured.items()})
    Path("/tmp/measured_bbox.json").write_text(json.dumps(measured))

"""
image_loader.py — loads real PDF page images from disk for Gemini Vision.
Correct path: server/public/live-tutor-page-images/{resourceId}/page-01.png
"""
from __future__ import annotations
import os
from typing import Optional

try:
    from ...live_tutor_agents.contracts import JsonDict, clean_text
except ImportError:
    from google_agent.live_tutor_agents.contracts import JsonDict, clean_text

# Resolve: google_agent/ → project root → server/public/live-tutor-page-images/
_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
_IMAGE_BASE   = os.path.join(_PROJECT_ROOT, "server", "public", "live-tutor-page-images")


def image_path(resource_id: str, page_num: int) -> Optional[str]:
    pad      = str(page_num).zfill(2)
    primary  = os.path.join(_IMAGE_BASE, resource_id, f"page-{pad}.png")
    fallback = os.path.join(_IMAGE_BASE, resource_id, f"pdftocairo-page-{pad}.png")
    if os.path.exists(primary):  return primary
    if os.path.exists(fallback): return fallback
    return None


def load_image_bytes(resource_id: str, page_num: int) -> Optional[bytes]:
    p = image_path(resource_id, page_num)
    if not p:
        return None
    try:
        size = os.path.getsize(p)
        if size > 6 * 1024 * 1024:   # skip >6MB
            return None
        with open(p, "rb") as f:
            return f.read()
    except OSError:
        return None


def load_image_base64(resource_id: str, page_num: int) -> Optional[str]:
    import base64
    data = load_image_bytes(resource_id, page_num)
    return base64.b64encode(data).decode("utf-8") if data else None


def get_all_page_images(resource_id: str) -> list:
    """Returns all page image records for a resource."""
    dir_path = os.path.join(_IMAGE_BASE, resource_id)
    if not os.path.isdir(dir_path):
        return []
    results = []
    for filename in sorted(os.listdir(dir_path)):
        if not filename.startswith("page-") or not filename.endswith(".png"):
            continue
        parts = filename.replace("page-", "").replace(".png", "")
        try:
            page = int(parts)
        except ValueError:
            continue
        p = os.path.join(dir_path, filename)
        results.append({
            "page":      page,
            "imagePath": p,
            "imageUrl":  f"/live-tutor-page-images/{resource_id}/{filename}",
            "exists":    True,
            "mimeType":  "image/png",
        })
    return results

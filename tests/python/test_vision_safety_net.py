"""
tests/python/test_vision_safety_net.py
Tests for the Vision Safety Net (W2.2) — bbox map of every node page.
Gemini Vision calls are mocked; one separate live script proves real output.
"""

import base64
from pathlib import Path
from unittest.mock import patch

import pytest

from google_agent.source.vision_safety_net import (
    VISION_INDEX_SCHEMA,
    build_vision_index,
    scan_page_image,
    _load_image_bytes,
)

_MODULE = "google_agent.source.vision_safety_net"

FAKE_PNG = base64.b64encode(b"\x89PNG fake image bytes").decode()


def _gemini_regions(n=2):
    return {
        "regions": [
            {
                "regionId": f"r{i + 1}",
                "type": "diagram" if i == 0 else "table",
                "description": f"Region {i + 1} description",
                "content": f"Region {i + 1} content",
                "bbox": {"x": 0.1, "y": 0.1 + i * 0.4, "w": 0.8, "h": 0.3},
                "teachingValue": "high",
            }
            for i in range(n)
        ]
    }


# ── Schema contract ───────────────────────────────────────────────────────────

class TestSchema:
    def test_bbox_is_required(self):
        item = VISION_INDEX_SCHEMA["properties"]["regions"]["items"]
        assert "bbox" in item["required"]
        assert set(item["properties"]["bbox"]["required"]) == {"x", "y", "w", "h"}

    def test_all_teaching_fields_required(self):
        item = VISION_INDEX_SCHEMA["properties"]["regions"]["items"]
        for field in ("regionId", "type", "description", "content", "teachingValue"):
            assert field in item["required"]


# ── scan_page_image ───────────────────────────────────────────────────────────

class TestScanPageImage:
    @pytest.mark.asyncio
    async def test_regions_get_page_prefix_and_page_number(self):
        async def fake(prompt, schema, **kw):
            return _gemini_regions(2)
        with patch(f"{_MODULE}.generate_structured_async", side_effect=fake):
            regions = await scan_page_image(5, b"png")
        assert regions[0]["regionId"] == "p5_r1"
        assert all(r["page"] == 5 for r in regions)

    @pytest.mark.asyncio
    async def test_bbox_clamped_to_page(self):
        async def fake(prompt, schema, **kw):
            return {"regions": [{
                "regionId": "r1", "type": "diagram", "description": "d",
                "content": "c", "teachingValue": "high",
                "bbox": {"x": 0.9, "y": -0.2, "w": 0.5, "h": 2.0},
            }]}
        with patch(f"{_MODULE}.generate_structured_async", side_effect=fake):
            regions = await scan_page_image(1, b"png")
        bbox = regions[0]["bbox"]
        assert 0.0 <= bbox["x"] <= 1.0 and 0.0 <= bbox["y"] <= 1.0
        assert bbox["x"] + bbox["w"] <= 1.0001   # pointer can never leave the page
        assert bbox["y"] + bbox["h"] <= 1.0001


# ── build_vision_index ────────────────────────────────────────────────────────

class TestBuildVisionIndex:
    @pytest.mark.asyncio
    async def test_step3_contract_scans_real_page_images_and_returns_bbox_regions(self, tmp_path):
        page5 = tmp_path / "page-05.png"
        page6 = tmp_path / "page-06.png"
        page5.write_bytes(b"\x89PNG real page five bytes")
        page6.write_bytes(b"\x89PNG real page six bytes")
        payload = {
            "selectedNode": {
                "nodeId": "example_sales_reports",
                "pageRefs": [5, 6],
            },
            "pageImages": [
                {"page": 5, "imagePath": str(page5), "imageUrl": "/page-05.png"},
                {"page": 6, "imagePath": str(page6), "imageUrl": "/page-06.png"},
            ],
        }
        scanned = []

        async def fake_scan(page, image_bytes, *, model=None):
            scanned.append({"page": page, "bytes": image_bytes})
            return [
                {
                    "regionId": f"p{page}_r1",
                    "page": page,
                    "type": "table" if page == 5 else "diagram",
                    "description": f"Teaching region on page {page}",
                    "content": f"Visible content on page {page}",
                    "contains": ["sales", "report"],
                    "bbox": {"x": 0.12, "y": 0.22, "w": 0.68, "h": 0.31},
                    "teachingValue": "high",
                }
            ]

        with patch(f"{_MODULE}.scan_page_image", side_effect=fake_scan):
            result = await build_vision_index(payload)

        assert result["ok"] is True
        assert result["step"] == "step3_gemini_vision"
        assert result["pagesScanned"] == 2
        assert result["selectedNodePages"] == [5, 6]
        assert result["regionCount"] == 2
        assert len(result["regions"]) == 2
        assert result["allRegionsHaveBbox"] is True
        assert result["fallbackUsed"] is False
        assert [call["page"] for call in scanned] == [5, 6]
        assert scanned[0]["bytes"] == page5.read_bytes()
        assert scanned[1]["bytes"] == page6.read_bytes()
        for region in result["regions"]:
            assert region["regionId"].startswith(f"p{region['page']}_")
            assert region["page"] in (5, 6)
            assert region["type"]
            assert region["description"]
            assert set(region["bbox"]) == {"x", "y", "w", "h"}

    @pytest.mark.asyncio
    async def test_scans_all_pages_regardless_of_sourcerefs(self):
        """GOLDEN RULE #7 — sourceRefs are never a fence."""
        payload = {
            "pageImages": [
                {"page": p, "base64": FAKE_PNG} for p in (5, 6, 7)
            ],
            "sourceRefs": [{"page": 5}],   # refs only mention page 5
        }
        calls = []
        async def fake(prompt, schema, **kw):
            calls.append(1)
            return _gemini_regions(1)
        with patch(f"{_MODULE}.generate_structured_async", side_effect=fake):
            result = await build_vision_index(payload)
        assert result["pagesScanned"] == 3        # ALL pages, not just page 5
        assert len(calls) == 3

    @pytest.mark.asyncio
    async def test_duplicate_pages_scanned_once(self):
        payload = {"pageImages": [
            {"page": 5, "base64": FAKE_PNG},
            {"page": 5, "base64": FAKE_PNG},
        ]}
        async def fake(prompt, schema, **kw):
            return _gemini_regions(1)
        with patch(f"{_MODULE}.generate_structured_async", side_effect=fake):
            result = await build_vision_index(payload)
        assert result["pagesScanned"] == 1

    @pytest.mark.asyncio
    async def test_one_page_failure_does_not_kill_others(self):
        payload = {"pageImages": [
            {"page": 1, "base64": FAKE_PNG},
            {"page": 2, "base64": FAKE_PNG},
        ]}
        call_count = {"n": 0}
        async def fake(prompt, schema, **kw):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise RuntimeError("Gemini choked on page 1")
            return _gemini_regions(2)
        with patch(f"{_MODULE}.generate_structured_async", side_effect=fake):
            result = await build_vision_index(payload)
        assert result["ok"] is True
        assert result["pagesScanned"] == 1
        assert result["pagesFailed"] == 1
        assert any("page 1" in w for w in result["warnings"])

    @pytest.mark.asyncio
    async def test_no_images_is_honest_not_fake(self):
        result = await build_vision_index({"pageImages": []})
        assert result["ok"] is False
        assert result["visionIndex"] == []   # never invented regions

    @pytest.mark.asyncio
    async def test_scanned_images_with_no_regions_is_not_ok(self):
        payload = {
            "selectedNode": {"pageRefs": [5, 6]},
            "pageImages": [
                {"page": 5, "base64": FAKE_PNG},
                {"page": 6, "base64": FAKE_PNG},
            ],
        }

        async def fake_scan(page, image_bytes, *, model=None):
            return []

        with patch(f"{_MODULE}.scan_page_image", side_effect=fake_scan):
            result = await build_vision_index(payload)

        assert result["ok"] is False
        assert result["pagesScanned"] == 2
        assert result["selectedNodePages"] == [5, 6]
        assert result["regionCount"] == 0
        assert result["visionIndex"] == []
        assert result["allRegionsHaveBbox"] is True
        assert any("no usable bbox regions" in w for w in result["warnings"])

    @pytest.mark.asyncio
    async def test_discoveries_become_evidence(self):
        """Vision discoveries are ADDED to evidence (visionDiscovered: true)."""
        payload = {"pageImages": [{"page": 9, "base64": FAKE_PNG}]}
        async def fake(prompt, schema, **kw):
            return _gemini_regions(2)
        with patch(f"{_MODULE}.generate_structured_async", side_effect=fake):
            result = await build_vision_index(payload)
        ev = result["visionEvidence"]
        assert len(ev) == 2
        assert all(e["visionDiscovered"] is True for e in ev)
        assert all(e["page"] == 9 for e in ev)
        assert all("bbox" in e for e in ev)

    @pytest.mark.asyncio
    async def test_unresolvable_image_warns_and_continues(self):
        payload = {"pageImages": [
            {"page": 1, "imagePath": "/does/not/exist.png"},
            {"page": 2, "base64": FAKE_PNG},
        ]}
        async def fake(prompt, schema, **kw):
            return _gemini_regions(1)
        with patch(f"{_MODULE}.generate_structured_async", side_effect=fake):
            result = await build_vision_index(payload)
        assert result["pagesScanned"] == 1
        assert result["pagesFailed"] == 1


# ── image loading ─────────────────────────────────────────────────────────────

class TestLoadImageBytes:
    def test_base64_with_data_url_prefix(self):
        raw = b"\x89PNG real bytes"
        image = {"base64": "data:image/png;base64," + base64.b64encode(raw).decode()}
        assert _load_image_bytes(image) == raw

    def test_plain_base64(self):
        raw = b"\x89PNG plain"
        image = {"base64": base64.b64encode(raw).decode()}
        assert _load_image_bytes(image) == raw

    def test_nothing_resolvable_returns_none(self):
        assert _load_image_bytes({"imagePath": "/nope.png"}) is None

from __future__ import annotations

from typing import Any

from forever_api.services.source_pack_service import create_source_pack_response_or_error


def create_source_pack_endpoint(payload: dict[str, Any]) -> tuple[int, dict]:
    """Dependency-free route behavior for POST /api/source-packs.

    A FastAPI router can wrap this later. Keeping this function framework-free
    lets the route contract stay tested without requiring server dependencies.
    """

    input_type = str(payload.get("inputType") or payload.get("input_type") or "").strip()
    text = payload.get("text")
    if not input_type:
        return 422, {"status": "error", "error": "inputType is required."}
    if text is not None and not isinstance(text, str):
        return 422, {"status": "error", "error": "text must be a string."}

    body = create_source_pack_response_or_error(input_type=input_type, text=text)
    status_code = 200 if body["status"] == "ready" else 422
    return status_code, body


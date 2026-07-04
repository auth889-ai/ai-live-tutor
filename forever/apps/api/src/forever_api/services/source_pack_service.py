from __future__ import annotations

from forever_api.ingestion.source_pack import SourcePackError, build_source_pack


def create_source_pack_response(*, input_type: str, text: str | None = None) -> dict:
    source_pack = build_source_pack(input_type=input_type, text=text)
    return {
        "status": "ready",
        "sourcePack": source_pack.to_dict(),
    }


def create_source_pack_response_or_error(*, input_type: str, text: str | None = None) -> dict:
    try:
        return create_source_pack_response(input_type=input_type, text=text)
    except SourcePackError as exc:
        return {
            "status": "error",
            "error": str(exc),
        }


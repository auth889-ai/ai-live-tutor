from __future__ import annotations


def elapsed_ms(current_time_seconds: float, scene_start_seconds: float) -> int:
    return max(0, int((current_time_seconds - scene_start_seconds) * 1000))


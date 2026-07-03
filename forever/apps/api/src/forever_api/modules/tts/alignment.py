from __future__ import annotations


def align_voice(beats: list[dict]) -> dict:
    voice_lines = []
    subtitles = []
    cursor = 0

    for index, beat in enumerate(beats):
        words = beat["text"].split()
        duration = max(4200, len(words) * 360)
        start = cursor
        end = cursor + duration
        voice_lines.append(
            {
                "voiceLineId": f"voice_{index + 1:03d}",
                "beatId": beat["beatId"],
                "text": beat["text"],
                "startMs": start,
                "endMs": end,
            }
        )

        word_span = max(120, duration // max(1, len(words)))
        for offset, word in enumerate(words):
            word_start = start + offset * word_span
            subtitles.append(
                {
                    "word": word,
                    "startMs": word_start,
                    "endMs": min(word_start + word_span - 20, end),
                    "beatId": beat["beatId"],
                }
            )
        cursor = end + 450

    return {"voiceLines": voice_lines, "subtitles": subtitles, "durationMs": cursor}


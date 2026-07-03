from __future__ import annotations


def generate_script_beats() -> list[dict]:
    return [
        {
            "beatId": "beat_hook",
            "beatType": "hook",
            "text": "Patterns are not important because interviewers love stars. They are important because patterns train your control over nested loops.",
            "sourceRefs": ["Teacher transcript 0:27-1:06"],
        },
        {
            "beatId": "beat_outer",
            "beatType": "explain",
            "text": "Rule one: the outer loop counts the number of lines. If the pattern has five rows, the outer loop runs five times.",
            "sourceRefs": ["Teacher transcript 2:20-2:40"],
        },
        {
            "beatId": "beat_inner",
            "beatType": "trace_process",
            "text": "Rule two: the inner loop focuses on columns and connects them to the current row. For row zero print one star, for row one print two stars, and so on.",
            "sourceRefs": ["Teacher transcript 2:45-3:15"],
        },
        {
            "beatId": "beat_code",
            "beatType": "demonstrate",
            "text": "Now the code becomes simple. The outer loop chooses the row, the inner loop prints the stars, and after each row we move to a new line.",
            "sourceRefs": ["Teacher transcript 6:49-8:38"],
        },
    ]


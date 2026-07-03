from __future__ import annotations


def compile_timeline(alignment: dict) -> dict:
    voice = {line["beatId"]: line for line in alignment["voiceLines"]}

    return {
        "version": "1.0",
        "sceneId": "scene_nested_loop_rules",
        "learningUnitId": "lu_inner_loop_columns",
        "teachingIntent": "trace_process",
        "durationMs": alignment["durationMs"],
        "layout": {
            "regions": [
                {"regionId": "teacher", "capability": "teacher_presence", "x": 0, "y": 0, "w": 280, "h": 720},
                {"regionId": "board", "capability": "handwritten_text", "x": 280, "y": 0, "w": 620, "h": 430},
                {"regionId": "code", "capability": "code_line_highlight", "x": 900, "y": 0, "w": 380, "h": 430},
                {"regionId": "trace", "capability": "variable_table", "x": 280, "y": 430, "w": 420, "h": 210},
                {"regionId": "output", "capability": "output_panel", "x": 700, "y": 430, "w": 580, "h": 210},
            ]
        },
        "objects": [
            {
                "objectId": "title_rules",
                "type": "text",
                "regionId": "board",
                "x": 44,
                "y": 34,
                "content": {"text": "Patterns -> Nested loops"},
                "style": {"size": 34, "color": "#f8fafc"},
            },
            {
                "objectId": "rule_outer",
                "type": "text",
                "regionId": "board",
                "x": 54,
                "y": 116,
                "content": {"text": "1) Outer loop -> rows / lines"},
                "style": {"size": 27, "color": "#f8fafc"},
            },
            {
                "objectId": "rule_inner",
                "type": "text",
                "regionId": "board",
                "x": 54,
                "y": 184,
                "content": {"text": "2) Inner loop -> columns"},
                "style": {"size": 27, "color": "#f8fafc"},
            },
            {
                "objectId": "code_triangle",
                "type": "code",
                "regionId": "code",
                "content": {
                    "language": "cpp",
                    "lines": [
                        "void print2(int n) {",
                        "  for (int i = 0; i < n; i++) {",
                        "    for (int j = 0; j <= i; j++) {",
                        "      cout << \"* \";",
                        "    }",
                        "    cout << endl;",
                        "  }",
                        "}",
                    ],
                },
            },
            {
                "objectId": "trace_table",
                "type": "table",
                "regionId": "trace",
                "content": {
                    "headers": ["row i", "j values", "stars"],
                    "rows": [["0", "0", "1"], ["1", "0, 1", "2"], ["2", "0, 1, 2", "3"]],
                },
            },
            {
                "objectId": "output_triangle",
                "type": "output",
                "regionId": "output",
                "content": {"lines": ["*", "* *", "* * *", "* * * *"]},
            },
        ],
        "actions": [
            {"actionId": "write_title", "type": "write_text", "objectId": "title_rules", "startMs": 400, "endMs": 2200},
            {"actionId": "write_outer", "type": "write_text", "objectId": "rule_outer", "startMs": voice["beat_outer"]["startMs"] + 300, "endMs": voice["beat_outer"]["startMs"] + 2600},
            {"actionId": "underline_outer", "type": "underline", "targetObjectId": "rule_outer", "startMs": voice["beat_outer"]["startMs"] + 2700, "endMs": voice["beat_outer"]["startMs"] + 3600},
            {"actionId": "write_inner", "type": "write_text", "objectId": "rule_inner", "startMs": voice["beat_inner"]["startMs"] + 200, "endMs": voice["beat_inner"]["startMs"] + 2500},
            {"actionId": "show_trace", "type": "reveal", "objectId": "trace_table", "startMs": voice["beat_inner"]["startMs"] + 2800, "endMs": voice["beat_inner"]["startMs"] + 4200},
            {"actionId": "show_code", "type": "reveal", "objectId": "code_triangle", "startMs": voice["beat_code"]["startMs"], "endMs": voice["beat_code"]["startMs"] + 1200},
            {"actionId": "show_output", "type": "reveal", "objectId": "output_triangle", "startMs": voice["beat_code"]["startMs"] + 1900, "endMs": voice["beat_code"]["startMs"] + 3300},
            {"actionId": "circle_output", "type": "circle", "targetObjectId": "output_triangle", "startMs": voice["beat_code"]["startMs"] + 3600, "endMs": voice["beat_code"]["startMs"] + 5000},
        ],
        "voiceLines": alignment["voiceLines"],
        "subtitles": alignment["subtitles"],
        "interactions": [],
        "sourceEvidence": [
            {
                "sourceId": "src_transcript_001",
                "sourceRef": "Teacher transcript 2:20-3:15",
                "quote": "Outer loop counts lines; inner loop focuses on columns and connects them to rows.",
            }
        ],
    }


from __future__ import annotations


def extract_learning_units(source_pack: dict) -> list[dict]:
    return [
        {
            "unitId": "lu_outer_loop_rows",
            "title": "Outer loop counts rows",
            "conceptType": "algorithmic_rule",
            "teachingGoal": "Explain why the outer loop controls number of lines.",
            "difficulty": "beginner",
            "sourceRefs": ["Teacher transcript 2:20-2:40"],
            "representableAs": ["whiteboard_rule", "row_count_visual", "code_highlight"],
        },
        {
            "unitId": "lu_inner_loop_columns",
            "title": "Inner loop controls columns",
            "conceptType": "algorithmic_rule",
            "teachingGoal": "Connect columns to the current row.",
            "difficulty": "beginner",
            "sourceRefs": ["Teacher transcript 2:45-3:15"],
            "representableAs": ["loop_trace", "variable_table", "output_panel"],
        },
    ]


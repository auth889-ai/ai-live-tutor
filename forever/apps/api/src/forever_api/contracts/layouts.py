from __future__ import annotations


LAYOUT_REGIONS: dict[str, dict[str, dict[str, int]]] = {
    "teacher_notebook": {
        "notebook_title": {"x": 40, "y": 60, "w": 500, "maxLines": 1},
        "notebook_body": {"x": 40, "y": 110, "w": 500, "maxLines": 6},
        "notebook_footer": {"x": 40, "y": 360, "w": 500, "maxLines": 2},
        "pointer_zone": {"x": 40, "y": 60, "w": 500, "h": 380},
    },
    "teacher_code_dryrun": {
        "code_panel": {"x": 40, "y": 60, "w": 320, "maxLines": 20},
        "variable_table": {"x": 380, "y": 60, "w": 260, "maxLines": 10},
        "output_panel": {"x": 380, "y": 280, "w": 260, "maxLines": 8},
        "pointer_zone": {"x": 40, "y": 60, "w": 600, "h": 380},
    },
    "teacher_diagram_source": {
        "diagram_area": {"x": 40, "y": 60, "w": 380, "h": 320},
        "source_sidebar": {"x": 440, "y": 60, "w": 220, "maxLines": 12},
        "notebook_footer": {"x": 40, "y": 400, "w": 600, "maxLines": 2},
    },
}


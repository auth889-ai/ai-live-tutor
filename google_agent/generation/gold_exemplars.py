"""
google_agent/generation/gold_exemplars.py
===============================================================================
GOLD EXEMPLARS — quality anchors (quality-stack stage 3).

Models match the quality of examples they see. Every segment-generation prompt
includes ONE exemplar matched to the segment's dominant work — so all 110
screens anchor to the user-approved depth (live-generated 2026-06-11, from
the real EDD PDF), never drift to bland listicles.

These are PRESENTATION anchors only — content always comes from the actual
SourceTruthPacket. The exemplar shows DEPTH and SHAPE, not subject matter.
===============================================================================
"""

from __future__ import annotations

# Distilled from the live-approved misconception_repair screen.
EXEMPLAR_REALIZATION = """{
 "screenId": "misconception_repair_not_null",
 "screenType": "misconception_repair",
 "title": "Adding Columns: Not Always Safe!",
 "subtitle": "The Tricky Case of NOT NULL Columns",
 "layout": "comparison",
 "visualElements": [
  {"elementId": "safe_code", "kind": "code_line",
   "content": "ADD COLUMN email VARCHAR(255);",
   "position": {"x": 0.05, "y": 0.30, "w": 0.42, "h": 0.07}, "style": "success"},
  {"elementId": "danger_code", "kind": "code_line",
   "content": "ADD COLUMN status VARCHAR(50) NOT NULL;",
   "position": {"x": 0.53, "y": 0.30, "w": 0.42, "h": 0.07}, "style": "danger"}
 ],
 "blocks": [
  {"type": "body", "content": "Most of the time, adding a new column is safe, especially if it can be empty (NULL).", "emphasis": "normal"},
  {"type": "comparison_left", "content": "Nullable column: existing rows get NULL, old code still works.", "emphasis": "success"},
  {"type": "warning", "content": "But what if the new column CANNOT be empty? This is a common trap!", "emphasis": "danger"},
  {"type": "comparison_right", "content": "NOT NULL: old code inserting without 'status' will BREAK.", "emphasis": "danger"},
  {"type": "quote_from_source", "content": "Simply adding NOT NULL without a default will break inserts from old code that doesn't send the field.", "emphasis": "normal"},
  {"type": "annotation", "content": "NOT NULL columns need special care: a default value or a multi-step process.", "emphasis": "highlight"}
 ],
 "boardActions": [
  {"atMs": 0, "action": "writeText", "targetElementId": "safe_code", "narrationCue": "start with the safe case"},
  {"atMs": 4000, "action": "highlight", "targetElementId": "safe_code", "narrationCue": "why it is safe"},
  {"atMs": 9000, "action": "writeText", "targetElementId": "danger_code", "narrationCue": "now the trap"},
  {"atMs": 14000, "action": "circle", "targetElementId": "danger_code", "narrationCue": "NOT NULL is the dangerous part"}
 ],
 "voiceover": "Many beginners assume that adding a column is always safe and easy. And for a simple, nullable column, that's often true. However, there's a very common scenario where adding a column can actually break your application: when you add a column that cannot be empty. Without careful planning, any old code that inserts data will fail, because it won't know what to put in your brand new, mandatory column.",
 "teacherNote": "Moves the student beyond 'adding columns is safe' by springing the NOT NULL trap AFTER establishing the safe case — realization, not information.",
 "boardWriting": "Add NULLABLE column: SAFE / Add NOT NULL column: TRICKY!",
 "keyPoints": ["Nullable column additions are backwards-compatible",
               "NOT NULL without a default breaks old INSERTs",
               "The details (NULL vs NOT NULL) decide safety"],
 "sourceRef": {"page": 15, "quote": "adding NOT NULL without a default will break inserts"},
 "checkQuestion": "Why is adding a NOT NULL column more dangerous than a NULLABLE one for a running application?"
}"""

# Distilled from the live-approved line_by_line_dry_run screen.
EXEMPLAR_DRYRUN = """{
 "screenId": "create_table_dry_run",
 "screenType": "line_by_line_dry_run",
 "title": "CREATE TABLE wishlists — line by line",
 "layout": "code_walkthrough",
 "visualElements": [
  {"elementId": "code1", "kind": "code_line", "content": "CREATE TABLE wishlists (",
   "position": {"x": 0.05, "y": 0.10, "w": 0.40, "h": 0.05}, "style": "normal"},
  {"elementId": "code2", "kind": "code_line", "content": "  id INT PRIMARY KEY,",
   "position": {"x": 0.05, "y": 0.15, "w": 0.40, "h": 0.05}, "style": "normal"},
  {"elementId": "tableBox", "kind": "box", "content": "wishlists",
   "position": {"x": 0.55, "y": 0.15, "w": 0.40, "h": 0.40}, "style": "normal"},
  {"elementId": "idCol", "kind": "label", "content": "id (INT, PK)",
   "position": {"x": 0.57, "y": 0.25, "w": 0.36, "h": 0.05}, "style": "measure"}
 ],
 "blocks": [
  {"type": "heading", "content": "Watch the table BUILD as each line executes", "emphasis": "normal"}
 ],
 "dryRun": [
  {"step": 1, "codeLine": "CREATE TABLE wishlists (",
   "whatHappens": "The database begins defining a new table named 'wishlists'.",
   "stateAfter": "A new empty table definition is initiated in the schema."},
  {"step": 2, "codeLine": "id INT PRIMARY KEY,",
   "whatHappens": "Column 'id' is defined: stores integers, serves as the primary key — each row gets a unique identifier.",
   "stateAfter": "Table has one column: id (INT, PRIMARY KEY).",
   "beginnerTrap": "Forgetting the comma when more columns follow."}
 ],
 "boardActions": [
  {"atMs": 0, "action": "writeText", "targetElementId": "code1", "narrationCue": "read line 1"},
  {"atMs": 3000, "action": "drawBox", "targetElementId": "tableBox", "narrationCue": "the table appears"},
  {"atMs": 6000, "action": "writeText", "targetElementId": "code2", "narrationCue": "line 2: the id column"},
  {"atMs": 9000, "action": "drawArrow", "targetElementId": "idCol", "narrationCue": "watch it land in the table"}
 ],
 "voiceover": "Let's execute this code in our heads, one line at a time, and watch the table build on the right. Line one tells the database: start a new table called wishlists. Nothing exists yet except the name. Line two creates our first column — id — an integer, and the primary key, which means every row must have a unique value here.",
 "teacherNote": "Dry-run discipline: never show a finished result — execute mentally with state visible after each step, trap flagged where beginners slip.",
 "boardWriting": "wishlists: id PK -> item_name -> user_id",
 "keyPoints": ["Each DDL line changes schema state",
               "PRIMARY KEY = unique row identity",
               "State after each line is checkable"],
 "sourceRef": {"page": 11, "quote": "CREATE TABLE wishlists"},
 "checkQuestion": "After line 2 executes, what exactly exists in the database?"
}"""

# Exemplar selection per segment's dominant work
EXEMPLARS = {
    "realization": EXEMPLAR_REALIZATION,   # explanation / repair / comparison segments
    "dryrun": EXEMPLAR_DRYRUN,             # worked-example / walkthrough segments
}


def pick_exemplar(phase: str, screen_types: list) -> str:
    """Choose the anchor that matches the segment's dominant work."""
    walkthrough_signals = {"worked", "dry_run", "trace", "derivation",
                           "calculation", "practice", "step"}
    text = (phase or "") + " " + " ".join(screen_types or [])
    if any(s in text for s in walkthrough_signals):
        return EXEMPLARS["dryrun"]
    return EXEMPLARS["realization"]

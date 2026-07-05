# Forever — Player UI Specification

Source of truth: the user's 6 approved mockups (Java nested-loops lesson, Star Schema
lesson, Binary Search lesson, Notebook library, Home dashboard, full-board Migration
lesson). The renderer is built to THESE pictures. Phase 1 implements the lesson player;
dashboard and notebook library land in Phase 5.

## 1. Lesson player — three proven layout families

**A. Tutor + board + code rail** (nested loops / binary search mockups)
- Left: tutor panel (avatar asset, idle/talking states — never generative video),
  optional "About <topic>" info card under it.
- Center: handwritten board.
- Right: dark code panel — filename tab, syntax highlighting, line numbers, active-line
  highlight synced to narration, copy button; Output panel below showing REAL captured
  stdout (green-on-dark).

**B. Tutor + board + Source & Proof rail** (star schema mockup)
- Right rail: Course Material card (PDF icon, title, author, page N), Related Diagrams
  (page thumbnails), Key Takeaways (quoted, attributed, page-linked), Learn More links.
- Every card's page number is a live link that opens the full page image with bbox
  overlay highlight (FULL-PAGE RULE).

**C. Full board, no tutor panel** (migration mockup)
- Board takes the whole stage: title + underline, intro sentence, chip-labelled sections
  (Why?, Example, Best Practices), flowchart boxes with arrows, concept tree, comparison
  table, code block with Up/Down diff coloring, sticky-note Source card (page range),
  checkmark lists, rollback callout.
- Chrome: progress bar, prev/next scene, play, speed, voice indicator.

The Board Director picks the layout family per scene (it's the `layout` field —
LAYOUT_REGIONS registry grows to cover B and C; TYPES hardcoded, content never).

## 2. Board visual language (all mockups agree)

- Handwriting font for board text (Caveat/Patrick Hand class), warm paper background,
  dotted-grid hint.
- Ink palette: red/orange primary ink, blue/green/purple for diagram entity boxes,
  yellow highlight chips behind section labels (Rules:, Key Ideas:, Pro Tip:).
- Annotation devices the renderer must support: underlines under titles, curly braces
  with side labels ("4 rows"), labelled arrows (→ Outer loop (rows)), check/cross marks,
  star doodles, sticky notes, callout boxes with dashed borders.
- Writing animates stroke-by-stroke at narration pace (action engine progress 0..1);
  the pointer is a visible cursor that RESTS where it last pointed.

## 3. Player chrome (identical across mockups)

- Transport: play/pause, back 10s / forward 10s, elapsed/total time, scrubber with
  buffered region, volume, playback speed (0.75–2x, mockups show 1.25x), settings,
  fullscreen. ALL driven by the one audio clock.
- Caption/transcript strip under the player: current narration sentence with inline
  emphasis (e.g. "central fact table" in red) — driven by activeSpeech voiceLine.
- Bottom thumbnail strip with tabs: Timeline / Lesson Steps / Notebook Pages / Bookmarks.
  Each thumbnail = scene snapshot + label + time range (e.g. "3. Dry Run 4:20–9:15");
  the Binary Search mockup's steps (Intro/Concept/Dry Run/Code/Output/Quiz) map 1:1 to
  our scene types. Click = seek. Active thumbnail highlighted.
- Autosave bar: "All your notes are saved automatically in My Notebook" + Open Notebook.
- Header: lesson title, Episode N · Lesson M breadcrumb, Save Notebook, Export PDF,
  theme toggle, account.

## 4. Course sidebar (player left edge)

- Course title + "Episode N of M" + course progress bar + %.
- Episode list: number, title, duration, state (✓ done / ▶ playing / 🔒 locked).
- Tools: My Notebook, Quizzes, Bookmarks, Downloads.
- Learning streak (day dots + count) and View Progress.

## 5. Home dashboard (Phase 5)

- My Courses grid: icon, title, subtitle, lessons done/total, progress bar, status chip
  (In Progress / Not Started).
- Continue Learning hero: last scene's board snapshot + play overlay + timestamp,
  course/episode/lesson breadcrumb, resume button, progress.
- Learning streak card, Weekly Goal card (n/10 lessons, %).
- Recent Notebooks row: board-snapshot thumbnails + course + updated-ago.

## 6. Notebook library (Phase 5)

- Grid of saved notebook pages (each IS the lesson's final board state re-rendered),
  filter tabs (Saved/Recent Exports/Bookmarks), sort, grid/list toggle.
- Preview pane: full notebook page + Page Info tab + Export as PDF.
- Study tip card. Every page: Episode N · Lesson M · saved-at.

## 7. What Phase 1 builds vs defers

- Phase 1 (fixtures, no AI): layout A + C shells, board renderer with the §2 visual
  language, full chrome of §3, sidebar of §4. Layout B's rail renders from fixture data.
- Phase 5: dashboard, notebook library, locking/resume across episodes.
- Explicitly OUT (post-hackathon product chrome): Upgrade to Pro, multi-user accounts.

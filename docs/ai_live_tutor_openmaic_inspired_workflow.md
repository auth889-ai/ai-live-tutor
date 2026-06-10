# AI Live Tutor Workflow

This workflow adapts the strongest ideas from OpenMAIC to this project, but
changes the target from "generic generated classroom" to "selected-node,
source-grounded, human tutor board lesson".

## Core Product Contract

The app must not produce only:

```text
lesson text
board commands
voice script
```

The app must produce a replayable teacher session:

```text
source truth
-> vision proof
-> lesson book plan
-> board screens
-> board objects
-> timed board commands
-> teacher voice lines
-> subtitles
-> quizzes and repair routes
-> saved flipable lesson book
-> interrupt/resume state
```

Every teacher sentence must map to a visible board action.

## Why OpenMAIC Is Stronger Than The Current Flow

OpenMAIC does not rely on one huge agent response.

It uses this shape:

```text
requirements
-> async classroom job
-> scene outlines
-> scene content
-> scene actions
-> media/TTS
-> saved classroom
-> playback engine
```

Your Live Tutor should use this shape:

```text
selected node
-> async tutor session
-> source truth packet
-> PDF vision index
-> lesson book outline
-> segment plan
-> segment content
-> board actions
-> TTS/subtitles
-> saved lesson book
-> playback/interrupt engine
```

## Runtime API Workflow

### 1. Start Tutor Session

Endpoint:

```text
POST /api/live-tutor/sessions/start
```

Input:

```json
{
  "ownerKey": "jana_test",
  "resourceId": "glt_resource_...",
  "treeId": "tree_...",
  "nodeId": "example_sales_reports",
  "studentLevel": "beginner",
  "lessonMode": "deep",
  "durationTargetMinutes": 120,
  "language": "bengali_english"
}
```

Immediate output:

```json
{
  "sessionId": "tutor_sess_001",
  "status": "planning",
  "pollUrl": "/api/live-tutor/sessions/tutor_sess_001",
  "firstPlayableSegmentUrl": null
}
```

Reason:

A 2-hour lesson cannot safely be generated inside one blocking HTTP request.
The frontend should show progress while the backend builds the lesson in
background.

### 2. Poll Session Progress

Endpoint:

```text
GET /api/live-tutor/sessions/:sessionId
```

Output:

```json
{
  "status": "generating_segment",
  "step": "vision_index",
  "progress": 32,
  "message": "Analyzing selected PDF pages",
  "segmentsReady": 1,
  "segmentsPlanned": 16,
  "firstPlayableSegmentUrl": "/api/live-tutor/sessions/tutor_sess_001/segments/seg_001"
}
```

### 3. Play Segment While Next Segment Generates

Endpoint:

```text
GET /api/live-tutor/sessions/:sessionId/segments/:segmentId
```

Each segment is 5-8 minutes:

```json
{
  "segmentId": "seg_004_source_reading",
  "startMs": 900000,
  "endMs": 1260000,
  "boardScreens": [],
  "boardCommands": [],
  "voiceScript": [],
  "subtitles": [],
  "lessonBookPages": [],
  "studentChecks": [],
  "repairRoutes": [],
  "sourceRefs": []
}
```

The frontend starts playing segment 1 while the backend generates segment 2.
That is how the system supports long lessons without making the student wait
for the full 2 hours of content.

## Backend Pipeline

### Stage A: Source Truth Packet

Purpose:

Collect the real source material for the selected node.

Input:

- ownerKey
- resourceId
- treeId
- nodeId

Output:

```json
{
  "selectedNode": {},
  "selectedEvidence": [],
  "samePageChunks": [],
  "previousPageChunks": [],
  "nextPageChunks": [],
  "selectedPageFullText": "",
  "fullPdfSummary": "",
  "fullPdfOutline": [],
  "pageImages": [],
  "sourceRefs": []
}
```

Quality gates:

- `selectedEvidence.length >= 5`
- `sourceRefs.length >= 5`
- selected page text must not be empty
- if node has page refs, page images must be present or a clear error must be
  saved

Current weak point:

The current system can pass text chunks, but it still behaves too much like
"small evidence in, short lesson out". The lesson planner must receive full
selected-page context plus nearby page context.

### Stage B: PDF Vision Index

Purpose:

Gemini Vision must inspect the real PDF page images for the selected node.
Generated images are not allowed for source explanation.

Input:

- selected node title
- page image paths
- selected page full text
- source refs

Output:

```json
{
  "visionIndex": [
    {
      "page": 6,
      "imagePath": "/server/public/live-tutor-page-images/.../page-06.png",
      "detectedRegions": [
        {
          "regionId": "region_sale_product_join",
          "type": "table_row",
          "label": "Sale joins Product for report query",
          "bbox": { "x": 0.12, "y": 0.35, "w": 0.72, "h": 0.08 }
        }
      ],
      "teachingTargets": [
        {
          "targetId": "main_report_query",
          "bbox": { "x": 0.18, "y": 0.28, "w": 0.62, "h": 0.06 },
          "whyImportant": "This is the source line the teacher must explain."
        }
      ],
      "metadata": {
        "geminiVisionCalled": true,
        "imageBytesLoaded": true,
        "modelVisionUsed": true
      }
    }
  ]
}
```

Quality gates:

- if page images exist, `geminiVisionCalled` must be true
- every PDF pointer target must come from `visionIndex`
- every `showPdfPageImage` command must use a real file path
- every `circle`, `highlight`, or `zoom` on the PDF must target a detected bbox

Current weak point:

When `SelectedPageVisionAgent` fails, the teacher can still talk from text, but
it cannot truly see the PDF image. That is not acceptable for the target
product.

### Stage C: Domain Understanding

Purpose:

Make the app dynamic across domains. Do not hardcode migration/database lesson
patterns.

Output:

```json
{
  "domain": "database_engineering",
  "conceptType": ["workflow", "performance_tradeoff", "case_study"],
  "studentLevel": "beginner",
  "prerequisites": ["tables", "primary key", "join"],
  "likelyMisconceptions": [
    "denormalization means bad design",
    "joins are always wrong",
    "reports should always query normalized tables"
  ],
  "bestBoardPatterns": [
    "motivation_board",
    "source_pdf_reading",
    "comparison_table",
    "workflow_diagram",
    "mistake_repair",
    "quiz_board"
  ]
}
```

Dynamic mapping examples:

```text
database topic -> schema diagram, SQL code, workflow, rollback, mistakes
math topic -> definition, visual intuition, derivation, proof, examples
biology topic -> real diagram labeling, process flow, analogy, quiz
law topic -> facts, issue, rule, application, case comparison
finance topic -> formula, table, chart, risk example, scenario practice
programming topic -> code walkthrough, dry run, bug repair, exercises
```

### Stage D: Lesson Book Planner

Purpose:

Plan the full 2-hour lesson before generating board details.

Input:

- source truth packet
- vision index
- domain understanding
- student profile
- lesson mode

Output:

```json
{
  "lessonBookPlan": {
    "title": "Sales Reports Queries",
    "durationTargetMinutes": 120,
    "expectedScreenCount": 100,
    "sections": [
      {
        "sectionId": "warmup",
        "title": "Why report queries become slow",
        "minutes": 5,
        "screenTarget": 4,
        "teachingGoal": "Student understands why this topic matters."
      },
      {
        "sectionId": "source_reading",
        "title": "Read the PDF page together",
        "minutes": 12,
        "screenTarget": 10,
        "teachingGoal": "Student connects lesson to the real source."
      }
    ]
  }
}
```

Planning rules:

- beginner: more screens, more examples, more repair moments
- intermediate: fewer basics, more tradeoffs and real workflow
- advanced: architecture, edge cases, performance, production constraints
- 2 hours: usually 12-20 sections and 60-140 screens
- source-heavy node: more PDF reading screens
- image-heavy node: more PDF crop/circle/zoom screens
- code-heavy node: more code walkthrough screens

### Stage E: Segment Generator

Purpose:

Generate one 5-8 minute segment at a time.

Each segment receives:

- one section from the lesson book plan
- source truth packet
- vision index
- previous segment summary
- student level
- board pattern requirements

Each segment outputs:

```json
{
  "segmentId": "seg_005_real_example",
  "durationMs": 420000,
  "screens": [],
  "teacherScript": [],
  "boardCommands": [],
  "subtitles": [],
  "studentChecks": [],
  "repairRoutes": [],
  "lessonBookPages": []
}
```

Quality gates:

- each segment must have at least 4 board screens
- each screen must have a teaching goal
- each screen must use sourceRefs
- if a PDF image is relevant, screen must include a real `showPdfPageImage`
- no segment can be only generic explanation

### Stage F: Board Screen Designer

Purpose:

Create rich board screens, not plain text slides.

Board screen object:

```json
{
  "screenId": "screen_022_source_pdf",
  "title": "Source: why this report query needs joins",
  "layout": "pdf_left_clean_redraw_right",
  "teachingGoal": "Student sees the exact source and understands the join cost.",
  "boardObjects": [
    {
      "objectId": "pdf_page_06",
      "type": "pdfPageImage",
      "page": 6,
      "imagePath": "/server/public/live-tutor-page-images/.../page-06.png"
    },
    {
      "objectId": "source_join_row",
      "type": "pdfRegion",
      "parentId": "pdf_page_06",
      "bbox": { "x": 0.18, "y": 0.32, "w": 0.65, "h": 0.06 }
    },
    {
      "objectId": "clean_join_flow",
      "type": "diagram",
      "nodes": ["Sale", "Product", "Category", "Report"]
    }
  ]
}
```

Required board patterns:

- motivation board
- definition board
- PDF source reading board
- PDF crop plus clean redraw board
- comparison board
- workflow board
- code walkthrough board
- formula/proof board
- mistake repair board
- quiz/checkpoint board
- recap board

### Stage G: Board Action Director

Purpose:

Convert board screens into micro-timed teacher actions.

Every action must have:

```json
{
  "commandId": "cmd_042",
  "screenId": "screen_022_source_pdf",
  "voiceLineId": "voice_042",
  "type": "circlePdfRegion",
  "startMs": 215000,
  "endMs": 220000,
  "targetObjectId": "source_join_row",
  "sourceRefs": [
    { "page": 6, "chunkId": "chunk_abc", "quote": "..." }
  ]
}
```

Allowed actions:

- setViewport
- showPdfPageImage
- showPdfCrop
- zoomPdfRegion
- movePointer
- circlePdfRegion
- highlightPdfText
- writeText
- writeCode
- drawBox
- drawArrow
- drawTable
- drawFlow
- underline
- erase
- askStudentCheck
- showQuiz
- revealAnswer

Non-negotiable rule:

```text
one voice line -> one visible board action -> one target object
```

### Stage H: Teacher Voice Script

Purpose:

Generate human teacher narration, not short generic AI text.

Each voice line:

```json
{
  "voiceLineId": "voice_042",
  "commandId": "cmd_042",
  "startMs": 215000,
  "endMs": 220000,
  "text": "Look at this exact row on page 6. The report is asking for product sales, so the database must connect the Sale table with Product.",
  "teachingMove": "source_grounding",
  "tone": "human_tutor",
  "sourceRefs": []
}
```

Voice rules:

- explain why, not only what
- beginner mode uses small steps and analogies
- use examples, mistakes, repair, and checkpoints
- no long speech while board stays static
- no fake source claim
- no generated PDF image when real PDF image exists

### Stage I: Timing And Subtitle Engine

Purpose:

Assign precise `startMs` and `endMs`.

Timing rules:

- each command has start/end time
- each voice line maps to a command
- each subtitle maps to a voice line
- pointer/highlight starts before or at the same time as the spoken reference
- screen transition cannot cut off voice

Subtitle object:

```json
{
  "subtitleId": "sub_042",
  "voiceLineId": "voice_042",
  "startMs": 215000,
  "endMs": 220000,
  "text": "Look at this exact row on page 6..."
}
```

### Stage J: Lesson Book Saver

Purpose:

Save the session as a flipable book.

Book page:

```json
{
  "pageId": "book_page_014",
  "sectionId": "source_reading",
  "screenIds": ["screen_022", "screen_023"],
  "title": "Reading the source page",
  "studentNotes": [
    "Report queries often join multiple normalized tables.",
    "Denormalization can reduce joins for read-heavy reports."
  ],
  "teacherScript": [],
  "sourceRefs": [],
  "practice": [],
  "mistakes": []
}
```

The student should be able to replay, read, revise, and export the lesson.

### Stage K: Interrupt, Repair, Resume

Purpose:

The student can interrupt during a 2-hour lesson.

When interrupt happens:

```json
{
  "sessionId": "tutor_sess_001",
  "currentSegmentId": "seg_004",
  "currentScreenId": "screen_022",
  "currentCommandId": "cmd_042",
  "visibleObjects": [],
  "studentQuestion": "Why not just keep everything normalized?"
}
```

Flow:

```text
pause playback
save cursor
classify question
retrieve relevant source/vision targets
generate repair mini-segment
play repair mini-segment
ask check question
resume original segment at next command
```

Repair segment output:

```json
{
  "repairSegmentId": "repair_003_normalization_confusion",
  "trigger": "student_confused_about_denormalization",
  "boardScreens": [],
  "boardCommands": [],
  "voiceScript": [],
  "resumeAt": {
    "segmentId": "seg_004",
    "commandId": "cmd_043"
  }
}
```

## Required Tools And Providers

Minimum strong setup:

- LLM: Gemini 2.5 Pro / GPT-5 class model for planning and long reasoning
- Vision: Gemini Vision or GPT vision for PDF page/crop analysis
- PDF parser: MinerU preferred for tables, formulas, OCR, layout, images
- Vector DB / retrieval: MongoDB vector, pgvector, Qdrant, or similar
- TTS: OpenAI TTS, ElevenLabs, Azure, or provider with stable timestamps
- Storage: persisted sessions, segments, book pages, audio, PDF crops
- Queue: background job runner for long generation
- Frontend player: board command playback engine
- Eval tests: source proof, vision proof, timing proof, board layout proof

Optional power tools:

- web search for current topics
- code execution sandbox for programming lessons
- math renderer for formulas
- diagram/layout engine for board object placement
- speech-to-text for student voice interruption
- analytics for confusion points and lesson quality

## Quality Gates

The lesson cannot be marked ready unless:

- source truth exists
- selectedEvidence >= 5
- sourceRefs >= 5
- vision was called when page images exist
- every PDF pointer has a real bbox
- every voice line has commandId
- every command has voiceLineId or explicit silent reason
- every subtitle maps to a voice line
- no board object overlaps badly
- no command points to missing object
- lesson book pages are saved
- interrupt state can resume from current command
- beginner 2-hour mode has enough sections/screens

## Implementation Order

### Phase 1: Make Current ADK Pipeline Reliable

- keep the current `/teach-node` path for compatibility
- fix `SelectedPageVisionAgent` completely
- ensure source context includes enough evidence and real page images
- ensure ADK packet handoffs are correct
- add curl contract tests for boardCommands, voiceScript, subtitles, vision

### Phase 2: Add Session Job Architecture

- add `POST /sessions/start`
- add `GET /sessions/:id`
- persist session progress
- generate in background
- return first playable segment as soon as ready

### Phase 3: Build Vision Index

- analyze all selected node page images
- store detected regions and teaching targets
- make board commands use these targets
- fail quality gate if vision is skipped

### Phase 4: Build Lesson Book Planner

- create full 2-hour outline
- split into 5-8 minute sections
- generate screen targets dynamically by student level and domain

### Phase 5: Segment Generation

- generate one segment at a time
- play segment N while generating segment N+1
- save segment output and book pages

### Phase 6: Board Playback Engine

- implement typed command executor
- support pointer, PDF crop, circle, highlight, write, draw, quiz
- support pause/resume/interrupt

### Phase 7: Quality Eval Harness

- test with multiple domains
- reject shallow lessons
- reject missing vision
- reject unsynced voice/board
- reject bad board layout

## Final Target

The final system should feel like this:

```text
Teacher opens with motivation.
Teacher shows the real PDF page.
Teacher points to the exact source line.
Teacher redraws the idea cleanly.
Teacher explains step by step.
Teacher gives example.
Teacher shows mistake.
Teacher repairs confusion.
Teacher asks checkpoint.
Student interrupts.
Teacher answers with mini-board.
Teacher resumes the original lesson.
Full lesson is saved as a flipable book.
```

That is the target workflow for the AI Live Tutor.

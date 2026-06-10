# Power Tutor Implementation Workflow

This is the build workflow for making the Live Tutor powerful across domains,
not hardcoded to migrations, databases, or one sample lesson.

## Non-Negotiable Product Rule

The output is not "text lesson plus board".

The output is:

```text
teacher voice line
-> exact board action
-> exact target object or PDF image region
-> exact timing
-> source proof
-> saved lesson book page
```

Every teacher sentence must map to a visible board action.

Bad:

```text
Teacher speaks for 2 minutes. Board stays static.
```

Good:

```text
voice_001 -> write title
voice_002 -> point old schema
voice_003 -> highlight danger
voice_004 -> show PDF crop
voice_005 -> circle source phrase
voice_006 -> redraw clean diagram
voice_007 -> ask checkpoint
```

## Runtime Shape

The current single `/teach-node` request is not enough for a 2-hour lesson.

Correct runtime:

```text
click node
-> create tutor session immediately
-> return first loading/preview state
-> generate lesson plan in background
-> generate segment 1
-> frontend starts playing segment 1
-> backend generates segment 2 while segment 1 plays
-> save each segment as replayable book pages
-> support interrupt/repair/resume at every command
```

## Required Services

### 1. Source Truth Service

Input:

- resourceId
- treeId
- nodeId
- studentLevel
- lessonMode

Output:

- selectedNode
- exact selected chunks
- same page chunks
- previous/next page chunks
- selectedPageFullText
- fullPdfSummary
- fullPdfOutline
- pageImages
- sourceRefs

Quality gate:

- selectedEvidence >= 5
- sourceRefs >= 5
- if selected node has pageRefs, pageImages must exist or explain why missing
- no generated lesson starts from only 1 chunk

### 2. Vision Service

Purpose:

Gemini Vision must inspect real PDF page images. It must not generate fake
images. It reads the actual PDF page screenshot and returns coordinates.

Input:

- page image paths
- selectedPageFullText
- node title
- sourceRefs

Output:

```json
{
  "page": 6,
  "imagePath": ".../page-06.png",
  "detectedRegions": [
    {
      "regionId": "source_row_2",
      "type": "text_row",
      "label": "products with most number of sales",
      "bbox": { "x": 0.08, "y": 0.31, "w": 0.78, "h": 0.05 }
    }
  ],
  "teachingTargets": [
    {
      "targetId": "main_definition",
      "page": 6,
      "bbox": { "x": 0.12, "y": 0.18, "w": 0.60, "h": 0.08 },
      "whyImportant": "This is the phrase the teacher should read and explain."
    }
  ],
  "metadata": {
    "imageBytesLoaded": true,
    "geminiVisionCalled": true,
    "modelVisionUsed": true
  }
}
```

Quality gate:

- if pageImages exist, `geminiVisionCalled` must be true
- every `showPdfPageImage` command must use a real image path
- every pointer/circle/zoom on PDF must use a detected region bbox

### 3. Domain Understanding Service

This makes the system dynamic for every domain.

It detects:

- domain: database, biology, law, math, architecture, medicine, finance, etc.
- concept type: definition, process, comparison, theorem, formula, case study,
  diagram, workflow, table, code, proof, timeline
- student difficulty
- prerequisite gaps
- likely misconceptions
- board pattern to use

Example dynamic mapping:

```text
database migration -> workflow + code + rollback table + CI/CD sequence
neural network -> layered diagram + neuron formula + forward pass animation
biology cell -> labeled PDF image + organelle map + process animation
math theorem -> statement + proof steps + example + mistake repair
law case -> facts + issue + rule + application + holding table
```

### 4. Lesson Book Planner

This plans the 2-hour session as a book, not one response.

For each selected node:

```json
{
  "durationTargetMinutes": 120,
  "studentLevel": "beginner",
  "sections": [
    {
      "sectionId": "warmup",
      "minutes": 5,
      "goal": "Motivate why this concept matters.",
      "screenTarget": 3
    },
    {
      "sectionId": "source_reading",
      "minutes": 12,
      "goal": "Read and explain the real PDF source.",
      "screenTarget": 8
    }
  ],
  "expectedScreenCount": 90
}
```

Screen count is dynamic:

- beginner: more screens, slower voice, more repair moments
- advanced: fewer basics, more edge cases and production patterns
- image-heavy node: more PDF pointing screens
- formula-heavy node: more step-by-step derivation screens
- code-heavy node: more dry-run screens

### 5. Segment Generator

Generates one segment at a time.

Segment output:

```json
{
  "segmentId": "seg_04_source_reading",
  "startMs": 2880000,
  "endMs": 3600000,
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

### 6. Board Director

Chooses the best visual board pattern for the domain and section.

Available board patterns:

- motivation board
- definition board
- real PDF source reading board
- PDF crop + clean redraw board
- flowchart board
- timeline board
- mind map board
- comparison table board
- code walkthrough board
- formula derivation board
- proof board
- mistake repair board
- quiz board
- recap board

The board director must not choose randomly. It chooses based on source shape.

### 7. Micro-Timing Engine

Creates exact sync between voice and board.

Every voice line gets:

- commandId
- targetObjectId
- startMs
- endMs
- visualAction
- sourceRef

Example:

```json
{
  "voiceId": "voice_044",
  "commandId": "cmd_044",
  "targetObjectId": "pdf_region_source_row_2",
  "startMs": 312000,
  "endMs": 322000,
  "text": "Look exactly at this row. The business question is asking for products with the most sales.",
  "visualAction": "drawCircle",
  "sourceRefs": [{ "page": 5, "chunkId": "p.5_chunk_1" }]
}
```

### 8. Lesson Book Saver

The complete lesson must be saved as a flipable book.

Each book page contains:

- board screenshot/preview
- teacher voice script
- subtitles
- source references
- notes for student
- key takeaways
- quiz/checkpoint
- replay command range

Book page example:

```json
{
  "pageNo": 14,
  "title": "Why Direct Database Change Is Dangerous",
  "screenIds": ["screen_014", "screen_015"],
  "voiceLineIds": ["voice_080", "voice_081"],
  "sourceRefs": [{ "page": 4, "quote": "All database changes are migrations." }],
  "studentNotes": [
    "Manual DB edits are risky because they are not tracked.",
    "Migration files make DB changes repeatable and reviewable."
  ],
  "practice": [
    "Explain why a migration file is safer than manually running ALTER TABLE."
  ]
}
```

### 9. Interrupt Repair Engine

Interrupt must be command-aware.

When student interrupts:

```json
{
  "sessionId": "session_123",
  "currentSegmentId": "seg_04_source_reading",
  "currentScreenId": "screen_021",
  "currentCommandId": "cmd_144",
  "currentVoiceId": "voice_144",
  "visiblePdfRegionId": "pdf_region_6_2",
  "studentQuestion": "Why NULL first?"
}
```

Repair output:

- short mini-board
- direct answer
- example
- misconception fix
- checkpoint
- resume pointer back to original command

## External Tools And APIs

Required:

- Gemini text model for lesson reasoning
- Gemini Vision for PDF page image analysis
- MongoDB for resource/session/artifact persistence
- MongoDB MCP for tool-call proof and context/session save
- Google TTS or equivalent for real voice audio

Strongly recommended:

- background job queue for segment generation
- object/file storage for page images, book pages, audio
- vector/rerank retrieval for stronger evidence selection
- Playwright screenshot QA for board rendering
- image crop service for PDF region extraction

Optional:

- web search only as supplementary external context, never as PDF truth
- YouTube/video search only if the student asks for extra resources

## API Workflow

### Start session

```text
POST /stage2/sessions/start
```

Returns quickly:

```json
{
  "ok": true,
  "sessionId": "session_123",
  "status": "planning",
  "firstPlayableSegmentReady": false
}
```

### Poll session

```text
GET /stage2/sessions/:sessionId/status
```

### Get next playable segment

```text
GET /stage2/sessions/:sessionId/segments/next
```

### Save playback state

```text
POST /stage2/sessions/:sessionId/playback-state
```

### Interrupt

```text
POST /stage2/interrupt
```

### Get lesson book

```text
GET /stage2/sessions/:sessionId/book
```

## Quality Gates

The product should not call a lesson "deep" unless:

- durationTargetMinutes >= requested duration
- expectedScreenCount is calculated from student level and source complexity
- first playable segment returns under 60 seconds
- every factual board object has sourceRefs
- page images are vision-analyzed when available
- every voiceLine has commandId
- every command has startMs/endMs
- PDF pointer commands have bbox coordinates
- lessonBookPages are saved
- interrupt route can insert a repair segment and resume

## Implementation Order

### Phase 1: Stabilize Source And Vision

- selected node source packet quality gate
- page image detection for `imagePath`, `imageUrl`, `pageImagePath`, `pageImageUrl`
- Gemini Vision cache per resource/page
- fail clearly when image exists but vision did not run

### Phase 2: Build Lesson Book Plan

- replace one-shot 2-hour generation with section/segment plan
- produce expected screen count dynamically
- save plan to session

### Phase 3: Generate First Segment Fast

- generate 3 to 6 screens for first segment
- return first playable segment quickly
- generate later segments in background

### Phase 4: Micro-Timed Board/Voice Contract

- enforce voiceLine -> command -> targetObject mapping
- enforce PDF region commands
- add timing validation

### Phase 5: Flipable Book

- save each segment as book pages
- frontend book viewer
- export/share

### Phase 6: Interrupt/Repair/Resume

- wire frontend interrupt button to backend
- repair mini-segment
- resume from commandId

### Phase 7: Visual QA

- Playwright screenshots
- check non-overlap
- check source images render
- check pointer visible on image
- check mobile/desktop layouts


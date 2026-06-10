# Current To World-Best Tutor Conversion Workflow

This document explains how to convert the current AI Live Tutor pipeline into a
world-class, long-form, source-grounded board tutor.

It is not a sample lesson. It is the engineering conversion plan.

## Current Workflow

The current Stage 2 flow is roughly:

```text
frontend clicks node
-> server builds source context
-> Node calls Python ADK orchestrator
-> Python runs many ADK agents
-> agents produce boardCommands, voiceScript, subtitles, boardScreens
-> server returns one large response
```

Current important files:

- `server/services/googleAgent/sourceContext/sourceContextPipeline.js`
- `server/services/googleAgent/stage2/stage2LessonOrchestrator.js`
- `google_agent/stage2_adk_orchestrator.py`
- `google_agent/pipeline/adk_pipeline_runner.py`
- `google_agent/source/selected_page_vision_agent.py`
- `google_agent/teaching/detailed_explanation_agent.py`
- `google_agent/visual/visual_planner_agent.py`
- `google_agent/visual/board_scene_agent.py`
- `google_agent/visual/board_command_agent.py`
- `google_agent/live/voice_script_agent.py`
- `google_agent/live/subtitle_sync_agent.py`

The current ADK order is close to:

```text
MongoDbMcpToolAgent
-> RagRetrievalAgent
-> SelectedPageVisionAgent
-> ConceptExtractionAgent
-> KnowledgeGraphAgent
-> TeachingStrategyAgent
-> CoursePlannerAgent
-> SegmentPlannerAgent
-> DetailedExplanationAgent
-> AnalogyExampleAgent
-> AssessmentQuizAgent
-> VisualPlannerAgent
-> DiagramCompilerAgent
-> BoardSceneAgent
-> BoardCommandAgent
-> LayoutAgent
-> HandwritingDrawingAgent
-> VoiceScriptAgent
-> SubtitleSyncAgent
-> ValidatorSafetyAgent
```

## Why The Current Workflow Looks Poor

### 1. One Huge Request Is The Wrong Shape

A 2-hour lesson cannot be produced reliably in one blocking request.

Current problem:

```text
click node
-> wait many minutes
-> maybe timeout
-> maybe fallback
-> one JSON response
```

World-best shape:

```text
click node
-> create session immediately
-> generate plan in background
-> generate segment 1
-> start playing segment 1
-> generate segment 2 while segment 1 plays
-> continue until 2-hour lesson is complete
```

### 2. Agents Are Connected, But Not Product-Orchestrated

Many agents do not automatically make the product powerful.

The current pipeline is agent-first:

```text
run agents
collect outputs
return result
```

The world-best pipeline must be product-first:

```text
source proof
vision proof
lesson book plan
segment plan
screen plan
board object plan
action timeline
voice sync
quality gate
saved replay
```

### 3. Vision Is Still A Gate, Not A Nice-To-Have

If real PDF page images exist and `SelectedPageVisionAgent` does not actually
call Gemini Vision, the tutor cannot point to the correct diagram/table/text.

Text-only output can still produce board commands, but it will not be the target
product.

Required rule:

```text
pageImages exist -> Gemini Vision must inspect image bytes -> bbox targets saved
```

### 4. Lesson Quality Is Too Short

Current ADK can produce:

```text
5 screens
50-70 commands
50-70 voice lines
```

That is not enough for a beginner 2-hour tutor.

Target for deep beginner mode:

```text
12-20 sections
60-140 screens
600-1200 voice/action pairs
many repair routes
many quizzes/checkpoints
saved lesson book pages
```

### 5. Board Commands Are Not Yet A Full Teaching Contract

Current commands are useful, but the target contract must be stricter:

```text
voiceLineId
-> commandId
-> screenId
-> targetObjectId
-> sourceRef
-> startMs/endMs
```

If the teacher says "look here", the command must point to a real object or PDF
region at that exact time.

## Conversion Architecture

Convert the current single-response pipeline into this:

```text
Stage 2A: Session Job
Stage 2B: Source Truth
Stage 2C: Vision Index
Stage 2D: Domain Understanding
Stage 2E: Lesson Book Plan
Stage 2F: Segment Generation
Stage 2G: Board Screen + Object Design
Stage 2H: Board Action Timeline
Stage 2I: Voice + Subtitle Sync
Stage 2J: Quality Gate
Stage 2K: Playback + Interrupt + Resume
Stage 2L: Saved Flipable Lesson Book
```

## Step-By-Step Conversion

### Step 1: Keep Current `/teach-node` As Compatibility Mode

Do not delete the current pipeline.

Keep:

```text
POST /api/google-agent/live-tutor/stage2/teach-node
```

Use it for:

- fast contract testing
- debugging ADK agents
- proving boardCommands/voiceScript/subtitles exist
- fallback short lesson mode

But do not use it as the final 2-hour architecture.

### Step 2: Add Tutor Session Job API

Add new endpoints:

```text
POST /api/google-agent/live-tutor/stage2/sessions/start
GET  /api/google-agent/live-tutor/stage2/sessions/:sessionId
GET  /api/google-agent/live-tutor/stage2/sessions/:sessionId/segments/:segmentId
GET  /api/google-agent/live-tutor/stage2/sessions/:sessionId/book
POST /api/google-agent/live-tutor/stage2/sessions/:sessionId/interrupt
POST /api/google-agent/live-tutor/stage2/sessions/:sessionId/playback-state
```

Start response:

```json
{
  "sessionId": "glt_stage2_session_001",
  "status": "planning",
  "pollUrl": "/stage2/sessions/glt_stage2_session_001",
  "firstPlayableSegmentUrl": null
}
```

This copies the OpenMAIC lesson:

```text
job created -> progress stored -> frontend polls -> classroom opens when ready
```

### Step 3: Persist Session State

Create a Stage 2 session document:

```json
{
  "sessionId": "glt_stage2_session_001",
  "ownerKey": "jana_test",
  "resourceId": "glt_resource_...",
  "treeId": "tree_...",
  "nodeId": "example_sales_reports",
  "status": "planning",
  "step": "source_truth",
  "progress": 12,
  "sourceTruth": {},
  "visionIndex": {},
  "domainUnderstanding": {},
  "lessonBookPlan": {},
  "segments": [],
  "lessonBook": {},
  "playbackState": {},
  "qualityGate": {},
  "createdAt": 0,
  "updatedAt": 0
}
```

Use MongoDB first because your MCP agent already knows `stage2Sessions`.

### Step 4: Convert Source Context Into Source Truth

Current:

```text
buildSourceContext()
```

Target:

```text
buildSourceTruthPacket()
```

It must return:

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

Quality gate:

```text
selectedEvidence >= 5
sourceRefs >= 5
selectedPageFullText not empty
pageImages present when selected page images exist
```

Do not allow a deep lesson to start with only one chunk.

### Step 5: Make Vision Index A Required Stage

Current:

```text
SelectedPageVisionAgent runs inside big ADK pipeline
```

Target:

```text
Vision Index runs before lesson planning
```

Why:

The lesson plan itself should know which real PDF figures/tables/regions can be
taught visually.

Output:

```json
{
  "page": 6,
  "imagePath": "/server/public/live-tutor-page-images/.../page-06.png",
  "detectedRegions": [
    {
      "regionId": "region_001",
      "type": "text_row",
      "label": "products with most number of sales",
      "bbox": { "x": 0.1, "y": 0.3, "w": 0.7, "h": 0.05 }
    }
  ],
  "teachingTargets": [],
  "metadata": {
    "geminiVisionCalled": true,
    "imageBytesLoaded": true,
    "modelVisionUsed": true
  }
}
```

Hard rule:

```text
if pageImages.length > 0 and requireSelectedPageVision=true,
missing geminiVisionCalled must fail the quality gate.
```

### Step 6: Add Domain Understanding Before Detailed Lesson

Current:

```text
ConceptExtractionAgent + KnowledgeGraphAgent
```

Keep them, but add a product-level normalized output:

```json
{
  "domain": "database_engineering",
  "conceptType": ["case_study", "workflow", "performance_tradeoff"],
  "studentLevel": "beginner",
  "requiredPrerequisites": [],
  "likelyMisconceptions": [],
  "bestBoardPatterns": [],
  "sourceUsePlan": []
}
```

This prevents hardcoding. The same engine can teach:

```text
database -> SQL/schema/workflow
math -> derivation/proof/examples
biology -> labeled source image/process diagram
law -> case facts/rule/application
programming -> code walkthrough/dry run/debug repair
finance -> formula/table/scenario/risk
```

### Step 7: Replace "One Explanation" With Lesson Book Plan

Current:

```text
DetailedExplanationAgent produces worldTeacherLesson
```

Target:

```text
LessonBookPlanner produces full session plan first
```

Output:

```json
{
  "title": "Sales Reports Queries",
  "durationTargetMinutes": 120,
  "studentLevel": "beginner",
  "expectedScreenCount": 100,
  "sections": [
    {
      "sectionId": "warmup",
      "title": "Why this topic matters",
      "minutes": 5,
      "screenTarget": 4,
      "teachingGoal": "Motivate the topic."
    },
    {
      "sectionId": "source_reading",
      "title": "Read the PDF page together",
      "minutes": 12,
      "screenTarget": 10,
      "teachingGoal": "Ground the lesson in the source."
    }
  ]
}
```

This is the moment your product becomes long-form.

### Step 8: Generate Segments, Not Whole Lesson

Each section becomes one segment:

```text
segment = 5-8 minutes
segment = 4-8 screens
segment = 30-80 voice/action pairs
```

Segment generation input:

```json
{
  "sessionId": "glt_stage2_session_001",
  "section": {},
  "sourceTruth": {},
  "visionIndex": {},
  "domainUnderstanding": {},
  "previousSegmentSummary": {},
  "studentLevel": "beginner"
}
```

Segment output:

```json
{
  "segmentId": "seg_004_source_reading",
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

Frontend rule:

```text
play segment N while backend generates segment N+1
```

### Step 9: Split Board Screens From Board Actions

OpenMAIC separates:

```text
scene content
scene actions
```

Your app should separate:

```text
boardScreens / boardObjects
boardCommands / teacher actions
```

Board screen example:

```json
{
  "screenId": "screen_022",
  "title": "Source: report query joins",
  "layout": "pdf_left_redraw_right",
  "teachingGoal": "Student sees the exact source and clean redraw.",
  "boardObjects": [
    {
      "objectId": "pdf_page_06",
      "type": "pdfPageImage",
      "page": 6,
      "imagePath": "/server/public/live-tutor-page-images/.../page-06.png"
    },
    {
      "objectId": "region_report_query",
      "type": "pdfRegion",
      "parentId": "pdf_page_06",
      "bbox": { "x": 0.18, "y": 0.32, "w": 0.65, "h": 0.06 }
    }
  ]
}
```

Board command example:

```json
{
  "commandId": "cmd_042",
  "screenId": "screen_022",
  "voiceLineId": "voice_042",
  "type": "circlePdfRegion",
  "targetObjectId": "region_report_query",
  "startMs": 215000,
  "endMs": 220000,
  "sourceRefs": []
}
```

### Step 10: Make Voice Script Depend On Board Commands

Current:

```text
VoiceScriptAgent receives boardCommands
```

Keep that, but enforce:

```text
voiceLine.commandId exists
command.voiceLineId exists
voice text refers to the exact board target
```

Voice line:

```json
{
  "voiceLineId": "voice_042",
  "commandId": "cmd_042",
  "startMs": 215000,
  "endMs": 220000,
  "text": "Look at this exact row on page 6. This report asks for product sales, so the database has to connect Sale and Product.",
  "teachingMove": "source_grounding"
}
```

### Step 11: Save Flipable Lesson Book Pages

The lesson book is not just transcript. It is a structured student artifact.

Book page:

```json
{
  "pageId": "book_page_014",
  "sectionId": "source_reading",
  "screenIds": ["screen_022", "screen_023"],
  "title": "Reading the source page",
  "studentNotes": [],
  "teacherScript": [],
  "sourceRefs": [],
  "practice": [],
  "mistakes": [],
  "keyTakeaways": []
}
```

Every segment should append book pages.

### Step 12: Add Playback Engine

Current frontend likely renders returned board commands.

Target frontend must have a command executor:

```text
setViewport
showPdfPageImage
showPdfCrop
zoomPdfRegion
movePointer
circlePdfRegion
highlightPdfText
writeText
writeCode
drawBox
drawArrow
drawTable
drawFlow
askStudentCheck
showQuiz
revealAnswer
```

Playback state:

```json
{
  "sessionId": "glt_stage2_session_001",
  "segmentId": "seg_004",
  "screenId": "screen_022",
  "commandId": "cmd_042",
  "voiceLineId": "voice_042",
  "currentMs": 215000,
  "mode": "playing"
}
```

### Step 13: Add Interrupt / Repair / Resume

When the student interrupts:

```text
pause current command
save playback cursor
classify question
retrieve relevant source/vision target
generate repair mini-segment
play repair
resume original lesson
```

Interrupt API:

```text
POST /api/google-agent/live-tutor/stage2/sessions/:sessionId/interrupt
```

Input:

```json
{
  "segmentId": "seg_004",
  "screenId": "screen_022",
  "commandId": "cmd_042",
  "studentMessage": "Why not keep everything normalized?"
}
```

Output:

```json
{
  "repairSegmentId": "repair_003",
  "resumeAt": {
    "segmentId": "seg_004",
    "commandId": "cmd_043"
  },
  "boardScreens": [],
  "boardCommands": [],
  "voiceScript": [],
  "subtitles": []
}
```

### Step 14: Add Quality Gate Before Segment Is Playable

Do not allow shallow output to play.

Quality checks:

```text
sourceRefs >= 5 for full session
segment sourceRefs >= 1
if page image used -> real imagePath exists
if PDF pointer used -> target bbox exists
every voiceLine has commandId
every command has screenId
every command target exists
subtitles align to voice lines
screen has no severe object overlap
beginner segment has examples/checkpoints
lesson book page saved
```

If a segment fails quality gate:

```text
repair generation
or mark segment failed
or fallback to simpler board screen
```

Do not silently return poor content.

## What To Build First

### Phase 1: Stabilize Current Pipeline

Goal:

Current `/teach-node` must reliably produce real:

```text
boardCommands > 0
voiceScript > 0
subtitles > 0
sourceRefs > 0
vision proof when page images exist
```

Tasks:

- finish `SelectedPageVisionAgent` reliability
- force quality gate when vision is required
- keep ADK packet builders correct
- keep curl proof script
- add a sample output inspector that prints first 10 board commands and voice
  lines

### Phase 2: Add Session Job Wrapper

Goal:

Do not block the user on a 10-15 minute request.

Tasks:

- create `stage2Session.service.js`
- create session start/status endpoints
- persist progress in MongoDB
- run existing `teachNodeWithAdkPipeline()` as background job first
- return session status and final output

This phase does not yet improve quality, but it fixes the product shape.

### Phase 3: Promote Vision To Its Own Saved Artifact

Goal:

Vision runs before the lesson and is stored as `visionIndex`.

Tasks:

- call `SelectedPageVisionAgent` before full ADK content generation
- save `visionIndex` in session
- make VisualPlanner/BoardScene receive `visionIndex`
- fail when pageImages exist but vision not called

### Phase 4: Add Lesson Book Planner

Goal:

The system plans 2 hours before generating screens.

Tasks:

- create `LessonBookPlannerAgent` or product planner module
- generate 12-20 sections for deep mode
- persist plan
- expose plan in status API

### Phase 5: Segment Generator

Goal:

Generate lesson section by section.

Tasks:

- create `generateSegment(sessionId, sectionId)`
- reuse ADK agents inside one section
- save each segment separately
- let frontend play first ready segment

### Phase 6: Real Playback Engine

Goal:

Frontend executes typed board commands like a teacher board.

Tasks:

- build command executor
- support PDF image/crop/region commands
- support pointer/circle/highlight/write/draw
- support pause/resume/current cursor

### Phase 7: Interrupt Engine

Goal:

Student can interrupt during a lesson.

Tasks:

- save playback state
- classify interruption
- generate repair mini-segment
- resume original command timeline

### Phase 8: World-Class Quality Evals

Goal:

Stop accepting poor output.

Add tests:

- source truth test
- vision proof test
- board target existence test
- voice-command sync test
- subtitle sync test
- beginner depth test
- lesson book page test
- interrupt resume test
- multi-domain fixtures

## Final Converted Workflow

The final app should work like this:

```text
1. Student clicks node.
2. Backend creates tutor session immediately.
3. Source truth packet is built.
4. Gemini Vision analyzes real selected PDF page images.
5. Domain understanding detects how this topic should be taught.
6. Lesson book planner creates a 2-hour section plan.
7. Segment 1 is generated and quality checked.
8. Frontend starts playing segment 1.
9. Backend generates segment 2 while segment 1 plays.
10. Board command executor animates PDF, pointer, highlights, writing, diagrams.
11. Teacher voice lines and subtitles stay synced by commandId.
12. Lesson book pages are saved as the lesson plays.
13. Student interrupts.
14. Tutor pauses, generates repair mini-board, answers, then resumes.
15. Full lesson remains replayable as a flipable book.
```

This is the conversion path from the current ADK pipeline to the target
world-best AI Live Tutor.

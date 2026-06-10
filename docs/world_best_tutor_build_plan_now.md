# World-Best Tutor Build Plan: What To Do Now

Your environment is now ready for world-best mode:

```text
Gemini / Google ADK: ready
MongoDB: ready
Redis: ready
Google TTS: ready
OpenAI: ready
MinerU: ready
MongoDB MCP: ready
Tavily: ready
Deepgram: ready
```

This document is the implementation plan from the current app to the powerful
AI Live Tutor.

## Final Product Behavior

When a student clicks a concept-tree node:

```text
1. App creates a tutor session immediately.
2. Backend builds source truth from the selected node.
3. MinerU / existing PDF pipeline extracts better PDF text, layout, tables, images.
4. Gemini Vision analyzes real selected page images.
5. AI creates a 2-hour lesson book plan.
6. AI generates the first 5-8 minute segment.
7. Frontend starts playing segment 1.
8. Backend generates later segments in background.
9. Board shows real PDF pages/crops, pointer, circles, highlights, writing, diagrams.
10. Google TTS creates teacher audio.
11. Deepgram aligns word/line timestamps.
12. Lesson is saved as a flipable book.
13. Student interrupts.
14. Tutor pauses, answers with repair board, then resumes.
```

The core rule:

```text
Every teacher sentence -> one visual board action -> one target object/source region.
```

## Current System We Will Convert

Current flow:

```text
POST /stage2/teach-node
-> buildSourceContext()
-> teachNodeWithAdkPipeline()
-> stage2_adk_orchestrator.py
-> run_adk_pipeline()
-> ADK agents
-> boardCommands + voiceScript + subtitles + boardScreens
-> one response
```

Keep this flow as `quick/single-shot mode`, but the new product should use
session mode.

## New Main Workflow

```text
POST /stage2/sessions/start
-> returns sessionId immediately
-> background job starts
-> source truth stage
-> vision index stage
-> lesson book plan stage
-> segment 1 generation
-> segment 1 quality gate
-> segment 1 ready
-> segment 2 generation while frontend plays segment 1
```

New endpoints:

```text
POST /api/google-agent/live-tutor/stage2/sessions/start
GET  /api/google-agent/live-tutor/stage2/sessions/:sessionId
GET  /api/google-agent/live-tutor/stage2/sessions/:sessionId/segments/:segmentId
GET  /api/google-agent/live-tutor/stage2/sessions/:sessionId/book
POST /api/google-agent/live-tutor/stage2/sessions/:sessionId/playback-state
POST /api/google-agent/live-tutor/stage2/sessions/:sessionId/interrupt
```

## Phase 1: Power Tool Readiness

Already done:

- added `server/services/googleAgent/stage2/stage2PowerToolsConfig.js`
- added `GET /stage2/power-tools`
- added `scripts/check_power_tutor_env.js`
- env now reports `world_best`

Proof command:

```bash
node scripts/check_power_tutor_env.js
```

Expected:

```text
worldBestReady: true
```

## Phase 2: Session Job Architecture

Why:

A 2-hour lesson cannot be one blocking HTTP request.

Build:

```text
server/services/googleAgent/stage2/stage2SessionJob.service.js
server/services/googleAgent/stage2/stage2SessionStore.js
server/controllers/googleLiveTutorStage2.controller.js
server/routes/googleLiveTutorStage2.routes.js
```

Session document:

```json
{
  "sessionId": "glt_stage2_session_001",
  "ownerKey": "jana_test",
  "resourceId": "glt_resource_...",
  "treeId": "tree_...",
  "nodeId": "example_sales_reports",
  "status": "planning",
  "step": "source_truth",
  "progress": 5,
  "sourceTruth": {},
  "visionIndex": {},
  "lessonBookPlan": {},
  "segments": [],
  "lessonBook": {},
  "playbackState": {},
  "qualityGate": {},
  "createdAt": 0,
  "updatedAt": 0
}
```

Implementation:

```text
POST /sessions/start
-> create MongoDB session
-> enqueue background job using Redis
-> return sessionId
```

If Redis queue is not wired yet, start with an in-process background runner,
then replace with BullMQ.

Proof:

```bash
curl -X POST /stage2/sessions/start
```

Expected:

```json
{
  "ok": true,
  "sessionId": "...",
  "status": "planning",
  "pollUrl": "..."
}
```

## Phase 3: Source Truth Packet

Why:

The current pipeline sometimes produces shallow lessons because the generation
starts from limited evidence.

Build:

```text
server/services/googleAgent/stage2/sourceTruthBuilder.js
```

It wraps and strengthens:

```text
buildSourceContext()
richSourcePackAssembler.js
nearbyPageContext.js
pageImageContext.js
```

Output:

```json
{
  "selectedNode": {},
  "selectedEvidence": [],
  "samePageChunks": [],
  "previousPageChunks": [],
  "nextPageChunks": [],
  "selectedPageFullText": "",
  "pageImages": [],
  "sourceRefs": [],
  "quality": {
    "selectedEvidenceCount": 8,
    "sourceRefCount": 12,
    "selectedPageTextChars": 5000,
    "pageImageCount": 2
  }
}
```

Quality gate:

```text
selectedEvidence >= 5
sourceRefs >= 5
selectedPageFullText > 500 chars when available
pageImages exist for selected pages when renderer has them
```

Proof script:

```bash
node scripts/test_source_truth_packet.js
```

Expected:

```text
sourceTruth ok
selectedEvidence >= 5
pageImages >= 1
```

## Phase 4: MinerU PDF Upgrade

Why:

MinerU gives stronger PDF parsing:

- OCR
- markdown layout
- tables
- formulas
- image mapping
- better page structure

Build:

```text
server/services/googleAgent/pdf/mineruClient.js
server/services/googleAgent/stage2/mineruSourceEnhancer.js
```

Use env:

```env
MINERU_BASE_URL=...
MINERU_API_KEY=...
```

Flow:

```text
resource PDF
-> MinerU parse
-> markdown text
-> page layout
-> tables/formulas/images
-> save enhanced source artifact
-> source truth packet uses this artifact
```

Important:

Do not call MinerU every time a node is clicked if resource was already parsed.
Cache by `resourceId` and PDF file hash.

Proof:

```bash
node scripts/test_mineru_source_enhancer.js
```

Expected:

```text
mineru configured
markdown extracted
layout/tables/images available when PDF contains them
```

## Phase 5: Vision Index

Why:

The tutor must see real selected PDF images before it points/circles/highlights.

Build:

```text
google_agent/pipeline/vision_index_runner.py
server/services/googleAgent/stage2/visionIndex.service.js
```

Reuse:

```text
google_agent/source/selected_page_vision_agent.py
google_agent/source/vision/page_visual_analyzer.py
```

Input:

```json
{
  "selectedNode": {},
  "pageImages": [],
  "selectedPageFullText": "",
  "sourceRefs": []
}
```

Output:

```json
{
  "visionIndex": [
    {
      "page": 6,
      "imagePath": ".../page-06.png",
      "detectedRegions": [],
      "teachingTargets": [],
      "metadata": {
        "geminiVisionCalled": true,
        "imageBytesLoaded": true,
        "modelVisionUsed": true
      }
    }
  ]
}
```

Quality gate:

```text
if pageImages exist:
  geminiVisionCalled must be true
  imageBytesLoaded must be true
```

Proof:

```bash
python scripts/test_selected_page_vision.py
```

Expected:

```text
visionIndex ok
detectedRegions > 0
geminiVisionCalled true
```

## Phase 6: Lesson Book Planner

Why:

The system needs a 2-hour teaching plan before making screens.

Build:

```text
google_agent/planning/lesson_book_planner_agent.py
google_agent/pipeline/lesson_book_planner.py
```

Use:

- Gemini for main plan
- OpenAI as optional quality judge

Input:

```json
{
  "sourceTruth": {},
  "visionIndex": {},
  "studentLevel": "beginner",
  "lessonMode": "deep",
  "durationTargetMinutes": 120
}
```

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
        "title": "Why this matters",
        "minutes": 5,
        "screenTarget": 4,
        "teachingGoal": "Motivate the topic."
      }
    ]
  }
}
```

Quality gate:

```text
beginner deep mode:
  sections >= 12
  expectedScreenCount >= 60
  includes warmup, source reading, example, mistake, repair, quiz, recap
```

Proof:

```bash
python scripts/test_lesson_book_plan.py
```

Expected:

```text
lessonBookPlan ok
sections >= 12
expectedScreenCount >= 60
```

## Phase 7: Segment Generator

Why:

Generate and play one segment at a time.

Build:

```text
google_agent/pipeline/segment_generator.py
server/services/googleAgent/stage2/stage2SegmentJob.service.js
```

Each segment:

```text
5-8 minutes
4-8 board screens
30-80 voice/action pairs
sourceRefs included
lessonBookPages included
```

Input:

```json
{
  "sessionId": "...",
  "section": {},
  "sourceTruth": {},
  "visionIndex": {},
  "previousSegmentSummary": {}
}
```

Output:

```json
{
  "segmentId": "seg_001_warmup",
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

Use existing agents inside segment generation:

```text
DetailedExplanationAgent
VisualPlannerAgent
BoardSceneAgent
BoardCommandAgent
VoiceScriptAgent
SubtitleSyncAgent
ValidatorSafetyAgent
```

But constrain them to one section, not the whole 2-hour lesson.

Proof:

```bash
python scripts/test_segment_generator.py
```

Expected:

```text
segment ok
boardScreens >= 4
boardCommands >= 30
voiceScript >= 30
lessonBookPages >= 1
```

## Phase 8: Board Command Contract

Why:

Current board commands are not strict enough for perfect sync.

Every command must have:

```json
{
  "commandId": "cmd_001",
  "screenId": "screen_001",
  "voiceLineId": "voice_001",
  "type": "circlePdfRegion",
  "targetObjectId": "region_001",
  "startMs": 0,
  "endMs": 5000,
  "sourceRefs": []
}
```

Every voice line must have:

```json
{
  "voiceLineId": "voice_001",
  "commandId": "cmd_001",
  "startMs": 0,
  "endMs": 5000,
  "text": "Look at this exact row on page 6..."
}
```

Build:

```text
google_agent/visual/board/command_contract.py
google_agent/pipeline/timing_engine.py
```

Proof:

```bash
python scripts/test_board_voice_contract.py
```

Expected:

```text
all voice lines have commandId
all commands have voiceLineId
all targets exist
all PDF targets have bbox
```

## Phase 9: TTS + Deepgram Timestamp Alignment

Why:

Google TTS gives audio. Deepgram gives accurate timing.

Build:

```text
server/services/googleAgent/stage2/deepgramTimestampAligner.js
server/services/googleAgent/stage2/stage2VoiceTiming.service.js
```

Flow:

```text
voiceScript
-> Google TTS audio
-> Deepgram transcription/alignment
-> word timings
-> line timings
-> subtitle timings
-> board command timing refinement
```

Use env:

```env
GOOGLE_TTS_API_KEY=...
DEEPGRAM_API_KEY=...
```

Proof:

```bash
node scripts/test_deepgram_alignment.js
```

Expected:

```text
audio generated
deepgram words > 0
subtitles have startMs/endMs
voice lines have refined timing
```

## Phase 10: OpenAI Quality Judge

Why:

Use OpenAI as a second expert to reject poor lesson quality.

Build:

```text
google_agent/pipeline/openai_lesson_quality_judge.py
```

Judge checks:

```text
lesson is deep enough
teacher voice is human
beginner explanations are clear
examples exist
mistakes/repairs exist
source grounding exists
PDF vision used when needed
every voice line maps to a visual action
```

Output:

```json
{
  "ok": true,
  "score": 92,
  "issues": [],
  "requiredRepairs": []
}
```

If score is low, regenerate or repair segment before marking it playable.

## Phase 11: Frontend Playback Engine

Why:

The UI must execute commands, not just show JSON.

Build in frontend:

```text
Stage2LiveTutorWorkbench.jsx
BoardPlayer
PdfLayer
PointerLayer
CommandExecutor
SubtitlePanel
LessonBookViewer
```

Command executor supports:

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
  "sessionId": "...",
  "segmentId": "seg_001",
  "screenId": "screen_001",
  "commandId": "cmd_001",
  "voiceLineId": "voice_001",
  "currentMs": 12345,
  "mode": "playing"
}
```

## Phase 12: Interrupt / Repair / Resume

Why:

The tutor must behave like a human teacher when the student interrupts.

Flow:

```text
student interrupts
-> pause playback
-> save current playback state
-> classify question
-> retrieve sourceTruth + vision targets
-> generate repair mini-segment
-> play repair segment
-> resume original segment at next command
```

Build:

```text
google_agent/live/interrupt_agent.py
google_agent/teaching/repair_confusion_agent.py
server/services/googleAgent/stage2/stage2InterruptSession.service.js
```

Repair output:

```json
{
  "repairSegmentId": "repair_001",
  "boardScreens": [],
  "boardCommands": [],
  "voiceScript": [],
  "subtitles": [],
  "resumeAt": {
    "segmentId": "seg_001",
    "commandId": "cmd_018"
  }
}
```

## What To Do First In Code

### Immediate Task 1

Build session start/status API.

Files:

```text
server/services/googleAgent/stage2/stage2SessionStore.js
server/services/googleAgent/stage2/stage2SessionJob.service.js
server/controllers/googleLiveTutorStage2.controller.js
server/routes/googleLiveTutorStage2.routes.js
```

Proof:

```bash
curl -X POST /stage2/sessions/start
curl /stage2/sessions/:sessionId
```

### Immediate Task 2

Build source truth packet and quality gate.

Files:

```text
server/services/googleAgent/stage2/sourceTruthBuilder.js
scripts/test_source_truth_packet.js
```

Proof:

```bash
node scripts/test_source_truth_packet.js
```

### Immediate Task 3

Build vision index as a separate saved artifact.

Files:

```text
google_agent/pipeline/vision_index_runner.py
server/services/googleAgent/stage2/visionIndex.service.js
scripts/test_vision_index.py
```

Proof:

```bash
python scripts/test_vision_index.py
```

### Immediate Task 4

Build lesson book planner.

Files:

```text
google_agent/planning/lesson_book_planner_agent.py
google_agent/pipeline/lesson_book_planner.py
scripts/test_lesson_book_plan.py
```

Proof:

```bash
python scripts/test_lesson_book_plan.py
```

### Immediate Task 5

Build segment generator using existing ADK agents.

Files:

```text
google_agent/pipeline/segment_generator.py
server/services/googleAgent/stage2/stage2SegmentJob.service.js
scripts/test_segment_generator.py
```

Proof:

```bash
python scripts/test_segment_generator.py
```

## Correct Build Order

Do not start with frontend animations.

Build in this order:

```text
1. Session job API
2. Source truth packet
3. Vision index
4. Lesson book planner
5. Segment generator
6. Quality gate
7. TTS + Deepgram timing
8. Frontend playback engine
9. Interrupt/repair/resume
10. Multi-domain quality evals
```

Reason:

If source truth and vision are weak, the beautiful board will still teach poor
content. The first win must be a strong backend teaching artifact.

## Definition Of Done

The system is not world-class until this curl can produce:

```text
sessionId exists
sourceTruth ok
visionIndex ok
lessonBookPlan sections >= 12
first segment ready
boardScreens >= 4
boardCommands >= 30
voiceScript >= 30
subtitles aligned
lessonBookPages >= 1
quality score >= 85
interrupt repair works
```

Then the frontend can make it beautiful.

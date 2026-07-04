# Forever Architecture

Forever uses stable product objects, not a messy diagram of many agents.

```text
Input Adapter
  -> SourcePack
  -> LearningUnitGraph
  -> CoursePlan
  -> ScenePlan
  -> ScriptBeats
  -> VoiceAlignment
  -> TeachingScreenManifest
  -> TutorPlayer
```

Agents are internal workers behind these objects:

- Source Pack Builder
- Learning Unit Planner
- Course Planner
- Episode Planner
- Script Beat Generator
- Visual Director
- TTS Runner
- Timestamp Reconciler
- Grounding Reviewer
- Repair Agent

## Phase 0 Contract

The first implemented object is `SourcePack`. The first implemented input adapter is plain text.

```text
text -> SourcePack -> chunks -> source refs
```

Unsupported adapters must fail honestly until they are implemented.

## SourcePack Contract

```text
sourcePackId
inputType
title
sources
chunks
concepts
```

Each chunk must carry a `sourceRef`. Later scene generation must cite those chunk ids.

## Region Layout Contract

The visual system is based on named regions. Visual Director outputs a region name and a line number, never freeform pixel coordinates.

Examples:

```text
teacher_notebook.notebook_body
teacher_code_dryrun.code_panel
teacher_diagram_source.source_sidebar
```

The renderer maps those names to pixel bounds.

## TeachingScreenManifest Contract

The renderer must not accept raw guesses for layout positions. It renders from named regions.

```text
sceneId
layout
durationMs
voiceLines
visualObjects
timelineActions
subtitles
sourceEvidence
notebookPage
```

The Visual Director selects a region name, not raw pixels. The renderer translates region names to actual coordinates.

The schema must be strict enough that a bad region or a negative timing value fails validation before playback.

## Audio Clock Rule

The browser audio clock is the master clock.

```text
audioContext.currentTime -> currentMs
```

No visual timing should depend on `setTimeout`.
All subtitles, pointer movement, whiteboard writing, code highlights, and quiz pauses must be derived from the audio clock.

## Phase 0 Current Reality

Implemented now:

- text-to-SourcePack ingestion
- named layout contract
- teaching screen contract
- audio clock math
- service wrapper
- tests

Not implemented yet:

- HTTP route
- frontend form
- code sandbox
- TTS
- PDF, URL, YouTube, image adapters

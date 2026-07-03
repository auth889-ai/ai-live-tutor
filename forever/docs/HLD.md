# Forever HLD

## Product Definition

Forever is an AI-powered universal human tutor course player. It converts learning material into a dynamic course lesson that feels like a high-quality YouTube/course teacher: voice explanation, subtitles, board writing, pointer focus, source highlighting, code dry-runs, quizzes, and source proof.

Forever is not a fake AI video generator. The output is an editable timed web lesson.

## Core Principle

```text
Content -> Learning Units -> Teaching Intent -> Required Affordances -> Dynamic Layout -> Timed Tutor Playback
```

No hardcoded screen flow. No fixed episode count. No input-type-based layout switching.

## High-Level Flow

```text
Any Input
  -> Universal Source Pack
  -> Learning Unit Graph
  -> Adaptive Course Planner
  -> Teaching Intent Planner
  -> Representation Planner
  -> Dynamic Layout Composer
  -> Script Beat Generator
  -> TTS + Alignment
  -> Timeline Compiler
  -> Grounding + Pedagogy Reviewer
  -> Audio-Synced Tutor Player
```

## Product Objects

```text
Course
  SourcePack
  Episode[]
    LearningUnit[]
      Scene[]
        TimelineManifest
          LayoutRegion[]
          TimelineObject[]
          BoardAction[]
          VoiceLine[]
          SubtitleWord[]
          Interaction[]
          SourceEvidence[]
```

## Why This Is Cleaner Than Agent-First Architecture

Agents are internal implementation nodes. The product architecture is based on stable course/player objects.

Use these public boxes:

- Source Grounding Engine
- Adaptive Course Engine
- Teaching Representation Engine
- Audio Alignment Engine
- Timeline Compiler
- Quality Gate
- Tutor Playback Engine

Avoid presenting these as top-level boxes:

- concept agent
- quiz agent
- voice agent
- board agent
- accuracy agent

## Hackathon Track Fit

Forever fits **Agent Society** because multiple Qwen-powered specialist nodes collaborate through shared state and strict contracts. It also has real-world education impact and production boundaries.


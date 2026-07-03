# Forever HLD

## Product Definition

Forever is an AI-powered universal human tutor course player. It converts learning material into a dynamic course lecture that feels like a high-quality YouTube, Udemy, or Coursera instructor: voice explanation, subtitles, board writing, pointer focus, source highlighting, code dry-runs, quizzes, source proof, and saved notebook pages.

Forever is not a fake AI video generator. The output is an editable timed web lesson.

The student experience:

```text
I press play.
It feels like a real tutor is teaching with a camera, notebook, code screen, diagrams, subtitles, source proof, quizzes, and saved notes.
```

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
CourseSeries
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
          QuizMoment[]
          NotebookPage
```

## Product Surfaces

```text
1. Course Studio
   Paste/upload material, choose goal, level, language, and style.

2. Course Builder
   Shows generated course outline, episode list, scene plan, source coverage, and lets user approve/regenerate.

3. Lecture Player
   Human tutor video-feeling player:
   teacher panel + notebook/code/source + subtitles + timeline cards + source proof.

4. Notebook
   Saved notebook pages, bookmarks, quiz answers, exports, and replay links.
```

## Product Modes

```text
Coding Lecture:
  teacher panel, notebook board, code editor, output panel, dry-run table, quiz pause

Concept Lecture:
  teacher panel, notebook board, diagram canvas, source proof sidebar, key takeaways

Algorithm Walkthrough:
  teacher panel, notebook board, array/state visualization, code panel, output panel

Notebook Review:
  saved notebook grid, page preview, episode metadata, export PDF
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

## Winning Demo Scope

Do not build every subject first. Build one excellent course path:

```text
Input: nested-loop / binary-search / star-schema material
Output: 1 course episode with 5-6 tutor scenes
Experience: plays like a real course lecture with saved notebook and source proof
```

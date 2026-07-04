# Devpost Submission Draft

## Project Name

Forever

## Track

Track 3: Agent Society

## One-Line Pitch

Forever turns any learning material into an audio-synchronized human tutor course by converting content into Learning Units, selecting teaching intents, composing visual/audio representations, and rendering everything through a source-grounded web lesson player.

## What It Does

Forever accepts learning material such as PDF text, a transcript, code, syllabus notes, or a topic. It builds a source pack, extracts teachable Learning Units, plans a course, generates script beats, aligns narration timing, compiles a strict timeline manifest, validates grounding, and plays the lesson like a real tutor.

The demo shows a coding-pattern lesson in the style of a real YouTube teacher: the tutor introduces nested-loop rules, writes on a dark board, points to important concepts, shows code, dry-runs output, highlights subtitles, and keeps source proof visible.

## Why It Is Different

Most AI education demos generate text, slides, or fake videos. Forever generates an editable timed lesson object:

- `LearningUnit`
- `TeachingIntent`
- `LayoutRegion`
- `BoardAction`
- `VoiceLine`
- `SubtitleWord`
- `SourceEvidence`

This makes the lesson interactive, source-grounded, inspectable, and replayable.

## Qwen Cloud Use

Forever uses Qwen Cloud through Alibaba Cloud Model Studio's OpenAI-compatible interface. Qwen powers planning, representation selection, script beats, and review. The backend includes a concrete Qwen Cloud client and an Alibaba Cloud healthcheck proof script.

## Architecture Diagram

See `docs/diagrams/system_architecture.mmd`.

## Alibaba Cloud Deployment Proof

Alibaba Cloud deployment is mandatory. The submitted backend must run on Alibaba Cloud and expose:

```text
GET /health
GET /api/qwen/health
```

See `infra/alibaba-cloud/qwen_cloud_healthcheck.py` for the repo proof file demonstrating Qwen Cloud API usage. The final Devpost submission must also include a short proof video showing the deployed backend running on Alibaba Cloud.

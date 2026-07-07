# Forever

Forever is an AI-powered human tutor course platform. It turns source material into a course-series experience: episodes, scenes, tutor narration, timed whiteboard writing, source proof, quizzes, notebook pages, and resumable playback.

This repository follows an OpenM11AIC-style root architecture, but the product goal is different: Forever is a source-grounded Udemy/Coursera-style tutor course-series player, not a slide generator and not a fake video generator.

## Current Phase

Phase 0: contracts and architecture foundation.

The first non-negotiable contracts are:

- Region-based board layout. Agents choose region names, never raw coordinates.
- Teaching screen manifest validation.
- Timeline/audio-clock model where every visual action is driven by one playback clock.

## Structure

```text
app/
  api/                    Next-style API route surfaces
  course/[id]/            course player route
  studio/                 upload/generation route

components/
  course-player/          Udemy-like player UI
  source-ingestion/       upload/paste/import controls
  studio/                 generation workspace

lib/                      every folder owns ONE responsibility; files say what they do
  board/
    layout/               named region layouts — agents address regions, never x/y
    objects/              board object contract (free objectType + render hints)
  source-pack/
    build/                ingestion: normalize, chunk, extract concepts
    refs/                 sourceRef contract + resolution against a SourcePack
  course-series/
    outline/              Course -> Episode -> Lesson -> Scene contract (Udemy-calibrated)
    notebook/             notebook page compiled from board objects
  generation/
    stages/               staged pipeline stage names + progress events
    voice/                voice lines bound to board objects
    timeline/             timed action contract: one clock, focus-leads-speech
    manifest/             scene manifest — THE storage gate
  orchestration/
    roles/                faculty roster + review board seats
    messages/             society messages: proposal/objection/evidence/verdict
    persona/              synthesized teacher persona contract
  playback/               clock-driven renderer/runtime (Phase 1)
  qwen/                   Qwen Cloud (DashScope) provider adapter — all model calls
  tts/                    CosyVoice render + Paraformer word alignment (Phase 2)
  storage/                manifest/source/notebook persistence (RDS + OSS)
  memory/                 rubric memory + learner memory (Phase 7)

packages/@forever/
  contracts/              shared contracts — the law of the system
  board-dsl/              board action DSL
  renderer/               reusable manifest renderer

workers/                  BullMQ processors, one per pipeline stage
eval/                     agent-society vs single-agent benchmark harness
infra/                    Alibaba Cloud provisioning + deployment proof
tests/                    domain and orchestration tests
e2e/                      browser/player flows
```

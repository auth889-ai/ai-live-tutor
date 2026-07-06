# Forever — Power Roadmap (to a world-class Udemy/Striver-style course)

Goal: not a summary generator — a course where an AI tutor teaches each topic DEEPLY and
step by step like the best human teacher (Striver/Kunal-style): intuition, worked examples,
dry-runs, edge cases, complexity, visuals, quizzes. Every feature below is built one at a
time, research-first (web + GitHub), tested, gated. Ordered by impact on "feels world-class".

## P1 — DEPTH: deep multi-step lessons (biggest gap; user: "too short")
A great teacher expands a concept into a teaching SEQUENCE, not a summary.
- **Teacher agent** produces a pedagogy plan per concept: motivate -> intuition -> worked
  example -> visual/dry-run -> edge cases -> complexity -> recap -> practice.
- Lesson Planner uses it -> 6-10 scenes/lesson, each 2-5 min (target 20-50 min/lesson).
- Stays grounded: facts from source (auditor enforces); pedagogy/structure is added value.
- Research: teaching-sequence patterns, worked-example effect, cognitive load; how top
  courses sequence a topic.  Tools: Qwen planner (thinking).

## P2 — REAL CODE EXECUTION + TRACING (user: "real tools for code tracing")
- **Code Runner** writes runnable code; a **sandbox** executes it for real; output + a
  step-by-step variable trace (dry-run table) come from the actual run, never invented.
- Research: Judge0 API vs isolated Docker vs Piston; safe sandboxing; trace capture.
  Tools/APIs: Judge0 (or self-hosted Piston/Docker on ECS), language runtimes.

## P3 — REAL DIAGRAMS (user: "code and text mixed"; mockups show boxes/arrows)
- Structured diagram objects (entity boxes, arrows, stack/queue cells, trees) rendered as
  real SVG shapes, not ASCII — matching the Star-Schema / stack mockups.
- Research: how tldraw/excalidraw/mermaid model shapes+arrows; auto-layout (dagre/elk).
  Tools: rough.js shapes, a small layout lib or hand-rolled.

## P4 — REAL VOICE (blocked on TTS access)
- qwen3-tts per line + Paraformer word-alignment -> writing synced to speech (code ready).
- Needs: a TTS-capable Qwen/Alibaba endpoint (owner action).

## P5 — VISUAL POLISH to the mockups
- Handwriting fonts, colored ink, highlight chips, curly braces + labelled arrows, sticky
  notes, tutor avatar panel (idle/talking asset). Research: web-font embedding, SVG brace/
  arrow annotations.

## P6 — MORE INPUTS (any material -> course)
- PDF (page images + vision), YouTube transcript, URL, code, topic-name (web research).
  Research: pdf rasterization quality, transcript APIs, Qwen built-in web_search.

## P7 — COURSE FEATURES (Udemy shell)
- Quizzes (Quiz Master) that pause the clock, notebook autosave + PDF export, progress/
  resume/streak, episode locking, dashboard. Research: course-player UX, PDF export.

## P8 — THE SOCIETY, DEEPER (Track 3 win)
- Full Review Board (pedagogy/sync/clutter critics + arbiter), budget/scope negotiation,
  society memory, and the eval/ benchmark proving gain vs single-agent. Research: multi-
  agent eval metrics judges recognize.

## P9 — PRODUCTION (submission)
- BullMQ async generation + SSE live progress, RDS/OSS storage, Alibaba deploy + proof
  recording, architecture diagram, 3-min demo, blog post.

Build order bias: P1 (depth) -> P2 (real code) -> P3 (diagrams) are what turn the current
skeleton into something that FEELS like a real course. Then polish, inputs, society, prod.

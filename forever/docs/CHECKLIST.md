# Forever — Total Missing Checklist (living)

✅ done · 🟡 partial (started/needs finishing) · ⬜ not started

## DONE ✅ (foundation)
- Contracts + 120 passing tests
- Clock-driven seekable player (play/pause/seek/speed, auto-advance)
- SVG board renderer (flow layout, word-wrap, handwriting reveal, pointer, highlight)
- Real code execution — 3 tiers (Judge0 / Docker / local) + self-debug loop
- Code editor panel (syntax highlight, line numbers, filename tab, output panel)
- Deep multi-line narration (2-4 sentences/point)
- Real voice (ElevenLabs) word-synced + audio clock
- Grounding-debate society (Board Director, Voice Writer, Grounding Auditor, Arbiter, Teacher, Code Runner)
- API layer (generate, lessons) + Studio + home + course route
- Reconciler (timeline synced to real audio)
- Multimodal SourcePack contract + MinerU adapter + page-image render (built, NOT yet wired/proven)

## MISSING — 42 items

### A. Multimodal ingestion (6)
1. ⬜ Wire MinerU output → parse markdown + figures into multimodal SourcePack
2. ⬜ qwen3.7-plus VISION pass (see each page/figure: meaning, arrows, relations, bbox)
3. ⬜ `image` board object — show real figure, tutor points at parts (full-page overlay)
4. ⬜ URL/website ingestion (Qwen web_extractor)
5. ⬜ YouTube ingestion (transcript + optional keyframe vision)
6. ⬜ Bare-topic ingestion (Qwen web_search → cited SourcePack)

### B. Course structure / Udemy UI (6)
7. ⬜ Course → Part/Section → Lesson → Scene hierarchy wired to UI
8. ⬜ Course sidebar (sections, lessons, durations)
9. ⬜ Progress checkmarks + completion tracking
10. ⬜ Next-lesson / prev-lesson navigation
11. ⬜ Section quiz gating
12. ⬜ Dashboard (My Courses, Continue Learning, streak) — from mockups

### C. Teaching depth (5)
13. 🟡 Coding: brute-force → better → optimal progression (Striver style)
14. ⬜ Multiple worked examples per concept
15. ⬜ Dry-run / trace table (variable states per step)
16. 🟡 Analogy + real-world hook + common-mistake callouts
17. ⬜ Prerequisite recall + "what's next" bridges

### D. Visual / diagram tools (7)
18. ⬜ Diagram engine: flowchart
19. ⬜ Cycle diagram
20. ⬜ Tree / graph
21. ⬜ Timeline
22. ⬜ Cause-effect / comparison map + real tables
23. ⬜ Math rendering (KaTeX) + step-by-step derivation
24. ⬜ Charts/plots (from real executed code or SVG)

### E. Visual motion (1)
25. ⬜ Motion layer — draw arrows, slide-in, spotlight ZOOM (the "real video" feeling)

### F. Quizzes / exercises / notebook (5)
26. ⬜ MCQ + section quiz that pauses the clock and grades
27. ⬜ Interactive coding exercise (Monaco + in-browser run)
28. ⬜ Notebook auto-compiled from board
29. ⬜ PDF export of notebook
30. ⬜ Downloadable resources (code files, datasets, notes)

### G. Agent society / orchestration (5)
31. 🟡 Full faculty (Librarian, Researcher, Archivist, Dean, Domain Router, Quiz Master, Notebook Scribe)
32. ⬜ Full Review Board critics (Pedagogy, Clarity, Sync, Clutter) — only Grounding built
33. ⬜ LangGraph cyclic generate→critique→repair loop
34. ⬜ BullMQ async per-scene jobs + retries (currently synchronous)
35. ⬜ SSE live progress — Studio shows the faculty working (demo money-shot)

### H. RAG / memory (2)
36. ⬜ pgvector RAG (embed text + image captions, retrieval + rerank)
37. ⬜ Learner memory (quiz results → remediation) + rubric memory (verdicts → heuristics)

### I. Native Qwen advanced tools (2)
38. ⬜ t2i_search/i2i_search topic image fetch (+ Unsplash fallback)
39. ⬜ Explicit prompt cache (5-10× cost cut) + code_interpreter numeric checks

### J. Production / storage / deploy (2)
40. ⬜ RDS PostgreSQL + OSS storage (currently filesystem seam)
41. ⬜ Alibaba deploy (ECS/SAE) + proof recording + architecture diagram + 3-min demo

### K. Track 3 win + reliability (1)
42. ⬜ eval/ benchmark (society vs single-agent, measurable gain) + reliability hardening (0 dropped scenes)

---
Total: 42 missing (many partial). Build order in MASTER_PLAN.md — Wave 1 (premium lesson) →
Wave 2 (multimodal + course structure) → Wave 3 (parity + hackathon win) → Wave 4 (polish).
Each item: research → one tested slice → commit. No compromise.

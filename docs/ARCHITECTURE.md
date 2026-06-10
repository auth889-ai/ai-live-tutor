# Lumina AI Tutor — Final Architecture Design
# World-Best AI Tutor System

```
═══════════════════════════════════════════════════════════════════════════════
                      LUMINA AI TUTOR — FULL SYSTEM ARCHITECTURE
                      "More powerful than any AI or human tutor"
═══════════════════════════════════════════════════════════════════════════════


┌─────────────────────────────────────────────────────────────────────────────┐
│                            STUDENT BROWSER                                  │
│                         React 18 + Vite + Framer Motion                     │
│                                                                             │
│  ┌──────────────┐  ┌─────────────────────────────────────────────────────┐ │
│  │  Stage 1     │  │              Stage 2 — LIVE CLASSROOM               │ │
│  │  Concept     │  │                                                     │ │
│  │  Tree        │  │  ┌─────────┐  ┌──────────────────────────────────┐ │ │
│  │              │  │  │Progress │  │        BOARD CANVAS              │ │ │
│  │  React Flow  │  │  │Screen   │  │  (full-viewport, no rails)       │ │ │
│  │  Dagre       │  │  │Animated │  │                                  │ │ │
│  │  23 nodes    │  │  │like     │  │  ┌──────────┐ ┌───────────────┐  │ │ │
│  │              │  │  │OpenMAIC │  │  │PDF Page  │ │ Board Writing │  │ │ │
│  │  Click node  │  │  │         │  │  │Real image│ │ Text/Formula  │  │ │ │
│  │      ↓       │  │  └─────────┘  │  │+bbox crop│ │ Diagrams      │  │ │ │
│  │  Start lesson│  │               │  └──────────┘ └───────────────┘  │ │ │
│  └──────────────┘  │               │  ┌──────────────────────────────┐ │ │ │
│                    │               │  │   BoardMarkingLayer           │ │ │ │
│                    │               │  │   pointer·circle·highlight   │ │ │ │
│                    │               │  │   arrow·underline·zoom       │ │ │ │
│                    │               │  └──────────────────────────────┘ │ │ │
│                    │               │  ┌──────────────────────────────┐ │ │ │
│                    │               │  │   Subtitle Bar (word-sync)   │ │ │ │
│                    │               │  └──────────────────────────────┘ │ │ │
│                    │               │  ┌─────────────┐ ┌─────────────┐  │ │ │
│                    │               │  │ Dot Nav     │ │ Flipbook    │  │ │ │
│                    │               │  │ 120+ screens│ │ Audio Book  │  │ │ │
│                    │               │  └─────────────┘ └─────────────┘  │ │ │
│                    │               └──────────────────────────────────┘ │ │
│                    │                                                     │ │
│                    │  ┌─────────────────────────────────────────────┐   │ │
│                    │  │  Student Voice Input (Deepgram STT)         │   │ │
│                    │  │  "I don't understand this part" → interrupt  │   │ │
│                    │  └─────────────────────────────────────────────┘   │ │
│                    └─────────────────────────────────────────────────────┘ │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │  HTTP + SSE
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       NODE.JS / EXPRESS SERVER  (port 3000)                 │
│                                                                             │
│  API ROUTES                                                                 │
│  ──────────────────────────────────────────────────────────────────────    │
│  POST /api/.../resources/upload          → PDF ingestion (Agent 1)         │
│  POST /api/.../concept-tree              → Stage 1 concept tree            │
│                                                                             │
│  POST /api/.../stage2/sessions/start     → create session immediately      │
│  GET  /api/.../stage2/sessions/:id/status → poll progress 0→100%           │
│  GET  /api/.../stage2/sessions/:id/stream → SSE: segment_ready events      │
│  GET  /api/.../stage2/sessions/:id/segments/:segId → get one segment       │
│  GET  /api/.../stage2/sessions/:id/book  → full flipbook                   │
│  POST /api/.../stage2/sessions/:id/interrupt → student question            │
│  POST /api/.../stage2/teach-node         → legacy compat (kept)            │
│                                                                             │
│  SERVICES                                                                   │
│  ──────────────────────────────────────────────────────────────────────    │
│  stage2SessionPersistence.js  createSession·updateStatus·saveSegment       │
│  stage2BackgroundJob.service  enqueue·monitor·SSE notify per segment       │
│  sourceContextPipeline.js     buildSourceTruthPacket (≥5 chunks)           │
│  pdfPageImageRenderer.service serve /public/live-tutor-page-images/        │
│  sharp image processor        pre-crop every visionIndex bbox region       │
│  googleTtsVoice.service       Chirp3-HD SSML per voice line                │
│                                                                             │
└────────────┬────────────────────────────┬───────────────────────────────────┘
             │                            │
             ▼                            ▼
┌────────────────────────┐    ┌───────────────────────────────────────────────┐
│   REDIS + BULLMQ       │    │           MONGODB ATLAS                       │
│                        │    │                                               │
│  Job Queues:           │    │  Collections:                                 │
│  • lesson_plan         │    │  googlelivetutorresources      (7 docs)       │
│  • segment_generate    │    │  googlelivetutorresourcechunks (124 chunks)   │
│  • vision_scan         │    │  googlelivetutorconcepttrees   (5 trees)      │
│  • tts_synthesize      │    │  googlelivetutorstage2sessions (growing)      │
│                        │    │  google_live_tutor_stage2_artifacts           │
│  5 parallel workers    │    │                                               │
│  Auto-retry on crash   │    │  Atlas Vector Search Index:                   │
│  Priority: seg N+1     │    │  Field: embedding (768-dim)                   │
│  always next           │    │  Model: text-embedding-004                    │
│                        │    │  Similarity: cosine                           │
│  SSE events:           │    │  → semantic RAG: find chunks by MEANING       │
│  segment_ready         │    │                                               │
│  plan_complete         │    │  Page Images on Disk:                         │
│  lesson_complete       │    │  /public/live-tutor-page-images/              │
│  error                 │    │    glt_resource_.../page-01.png               │
└────────────┬───────────┘    │    glt_resource_.../page-17.png (17 pages)   │
             │                └───────────────────────────────────────────────┘
             │ spawn per segment
             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PYTHON PIPELINE  (conda: live-tutor-adk)                 │
│                    google_agent/   (Google ADK 2.1.0)                       │
│                                                                             │
│  stage2_adk_orchestrator.py  ← entry point (stdin JSON → stdout JSON)      │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  PASS 1: SOURCE TRUTH  (runs once per session)                      │   │
│  │                                                                     │   │
│  │  MongoDbMcpToolAgent ──→ load chunks from Atlas via MCP tools       │   │
│  │  RagRetrievalAgent ────→ Atlas Vector Search (text-embedding-004)   │   │
│  │                          semantic retrieval: find RELEVANT chunks   │   │
│  │  SelectedPageVisionAgent → Gemini Vision scans page images          │   │
│  │                            detects: table·diagram·formula·code      │   │
│  │                            bbox: {x,y,w,h} per region               │   │
│  │                            saves: visionIndex (per page, per region) │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  PASS 2: DOMAIN + LESSON PLAN  (Gemini 2.5 Pro, 1M context)        │   │
│  │                                                                     │   │
│  │  ConceptExtractionAgent  → key concepts from chunks                 │   │
│  │  KnowledgeGraphAgent     → concept relationships                    │   │
│  │  TeachingStrategyAgent   → detect subject:                          │   │
│  │                            database·code·math·science·              │   │
│  │                            finance·history·law·humanities           │   │
│  │  LessonBookPlannerAgent  → 12-20 sections, 2-hour plan              │   │
│  │    (Gemini 2.5 Pro)        each section: goal·screenTypes·minutes   │   │
│  │                            total: 120+ screens planned              │   │
│  │  + Tavily Web Search     → real-world examples per section          │   │
│  │  + Google Search Ground  → "latest research shows..."               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  PASS 3: SEGMENT LOOP  (Gemini 2.5 Flash per agent)                 │   │
│  │  Runs once per section. Segment N+1 generates while N plays.        │   │
│  │                                                                     │   │
│  │  direct_gemini_pipeline.py ─────────────────────────────────────    │   │
│  │  (primary fast path, always produces output)                        │   │
│  │                                                                     │   │
│  │  DetailedExplanationAgent → 20 teacher sentences, source-grounded   │   │
│  │  AnalogyExampleAgent      → 3 relatable analogies                   │   │
│  │  AssessmentQuizAgent      → MCQ + fill-blank checkpoints            │   │
│  │                                                                     │   │
│  │  ScreenPlannerAgent       → picks from 153 screen types:            │   │
│  │  ┌───────────────────────────────────────────────────────────────┐  │   │
│  │  │  153 SCREEN TYPES                                             │  │   │
│  │  │  A. Foundation:    hook·agenda·vocab·objective·prior_check    │  │   │
│  │  │  B. Explanation:   definition·proof·deep_dive·analogy·flow    │  │   │
│  │  │  C. Source/PDF:    pdf_page_crop·pdf_diagram·table_zoom       │  │   │
│  │  │  D. Worked:        setup·step1..N·final·model·guided·indep    │  │   │
│  │  │  E. SQL/Database:  schema·pk_fk·join_bridge·query·dry_run     │  │   │
│  │  │  F. Code/CS:       code_block·line_dryrun·var_table·loop      │  │   │
│  │  │  G. Math:          formula·derivation·graph·proof·geometry    │  │   │
│  │  │  H. Science/Bio:   figure_label·process·cause_effect·micro    │  │   │
│  │  │  I. Finance:       cashflow·scenario·risk·profit·interest      │  │   │
│  │  │  J. History/Law:   timeline·case_fact·rule·argument           │  │   │
│  │  │  K. Quiz:          mcq·fill_blank·spot_mistake·confidence     │  │   │
│  │  │  L. Repair:        mistake·wrong_vs_right·misconception       │  │   │
│  │  │  M. Summary:       takeaway·recap·concept_map·flipbook_page   │  │   │
│  │  │  N. Decoration:    mascot·subject_icon (max 2-3, tiny)        │  │   │
│  │  └───────────────────────────────────────────────────────────────┘  │   │
│  │                                                                     │   │
│  │  VisualPlannerAgent       → layout per screen type                  │   │
│  │  DiagramCompilerAgent     → Mermaid·SVG·table·flowchart blocks      │   │
│  │  BoardSceneAgent          → boardObjects + blocks per screen        │   │
│  │                                                                     │   │
│  │  BoardCommandAgent        → TEACHER POINTER SYSTEM:                 │   │
│  │  ┌───────────────────────────────────────────────────────────────┐  │   │
│  │  │  Every command:                                               │  │   │
│  │  │  { commandId, screenId, voiceLineId, segmentId               │  │   │
│  │  │    commandType: pointer_to_region | circle_bbox |            │  │   │
│  │  │                 highlight_row | write_text |                 │  │   │
│  │  │                 draw_arrow | underline | zoom_region         │  │   │
│  │  │    targetRegionId: "r1"  ← from visionIndex                 │  │   │
│  │  │    bbox: {x,y,w,h}       ← exact PDF pixel region           │  │   │
│  │  │    startMs: 4200         ← synced to voice line             │  │   │
│  │  │    endMs:   7800                                            │  │   │
│  │  │    sourceRef: "[Page 5] exact PDF quote" }                  │  │   │
│  │  └───────────────────────────────────────────────────────────────┘  │   │
│  │                                                                     │   │
│  │  Gemini Code Execution    → SQL/Python code RUNS live in lesson      │   │
│  │  (for code/database topics) board shows real execution result        │   │
│  │                                                                     │   │
│  │  VoiceScriptAgent         → teacher narration per screen             │   │
│  │                             SSML: pause·stress·whisper effects       │   │
│  │  SubtitleSyncAgent        → word-level subtitle alignment            │   │
│  │                                                                     │   │
│  │  quality_gate.py          → reject if: sourceRefs<1                 │   │
│  │                             commands<5 · no bbox when vision used    │   │
│  │                             fail → repair or fallback screen        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  INTERRUPT / REPAIR  (Phase 6 — Gemini Live API)                    │   │
│  │                                                                     │   │
│  │  Student speaks → Deepgram STT → classify question                  │   │
│  │  → pause at commandId cursor                                        │   │
│  │  → Gemini Live API (gemini-2.0-flash-live-001)                      │   │
│  │     real-time bidirectional voice response                          │   │
│  │  → generate repair mini-segment (2-3 screens)                      │   │
│  │  → play repair → resume at saved commandId                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         EXTERNAL AI / API LAYER                             │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │ Gemini 2.5 Flash │  │ Gemini 2.5 Pro   │  │ Gemini Vision API        │  │
│  │ GEMINI_API_KEY   │  │ GEMINI_PRO_MODEL │  │ (same key)               │  │
│  │                  │  │                  │  │                          │  │
│  │ All 28 agents    │  │ Lesson planning  │  │ Scans PDF page PNGs      │  │
│  │ Board commands   │  │ 1M token context │  │ → bbox per region        │  │
│  │ Voice scripts    │  │ Reads FULL PDF   │  │ → visionIndex saved      │  │
│  │ Quizzes          │  │ Cross-page links │  │ Teacher points to exact  │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────────────┘  │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │ Google TTS       │  │ Gemini Code Exec │  │ Google Search Grounding  │  │
│  │ Chirp3-HD-Aoede  │  │ (same key)       │  │ (same key)               │  │
│  │ GOOGLE_TTS_KEY   │  │                  │  │                          │  │
│  │                  │  │ SQL runs live    │  │ Real web examples in     │  │
│  │ Natural teacher  │  │ Python runs live │  │ every lesson section     │  │
│  │ SSML: pause,     │  │ Board shows real │  │ "Amazon uses this for…"  │  │
│  │ stress, whisper  │  │ execution result │  │ Lessons stay current     │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────────────┘  │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │ Gemini Live API  │  │ Deepgram STT     │  │ Tavily Web Search        │  │
│  │ gemini-2.0-flash │  │ DEEPGRAM_KEY     │  │ TAVILY_API_KEY           │  │
│  │ -live-001        │  │                  │  │                          │  │
│  │                  │  │ Student speaks   │  │ Real-world examples      │  │
│  │ Real-time voice  │  │ → text in 200ms  │  │ enriches lesson content  │  │
│  │ Teacher responds │  │ → interrupt      │  │                          │  │
│  │ in real-time     │  │   triggered      │  │                          │  │
│  │ (Phase 6)        │  │                  │  │                          │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────────────┘  │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │ MinerU API       │  │ Google Doc AI    │  │ YouTube Data API         │  │
│  │ MINERU_API_KEY   │  │ DOC_AI_PROCESSOR │  │ YOUTUBE_API_KEY          │  │
│  │                  │  │ + service acct   │  │                          │  │
│  │ Tables as JSON   │  │                  │  │ Fetch relevant videos    │  │
│  │ Formulas as LaTeX│  │ OCR for scanned  │  │ shown in lesson_book     │  │
│  │ Better parsing   │  │ PDFs             │  │ page screens             │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘


═══════════════════════════════════════════════════════════════════════════════
                           COMPLETE DATA FLOW
═══════════════════════════════════════════════════════════════════════════════

PHASE 0 — ALREADY DONE (Stage 1)
  PDF uploaded
  → MinerU parses: text + tables (JSON) + formulas (LaTeX)
  → Document AI: OCR for scanned pages
  → 124 chunks saved to Atlas
  → text-embedding-004 embeds each chunk → Vector Search index
  → 17 page PNGs saved to /public/live-tutor-page-images/
  → Gemini builds concept tree (23 nodes)

PHASE 1 — SESSION START (non-blocking)
  Student clicks node "Database Denormalization"
  → POST /sessions/start
  → Session created instantly: { sessionId, status:"created" }
  → BullMQ job enqueued
  → Frontend starts polling SSE stream

PHASE 2 — SOURCE TRUTH (background, ~10s)
  Worker picks up job
  → Atlas Vector Search: semantic retrieval for this node (top 10 chunks)
  → Page images loaded from disk for relevant pages
  → sourceRefs assembled (≥5 required)
  → SSE: "source_ready"

PHASE 3 — VISION INDEX (background, ~20s)
  → Gemini Vision reads page-05.png, page-06.png bytes
  → Returns: [{regionId:"r1", type:"table", bbox:{x:0.1,y:0.3,w:0.7,h:0.15},
               label:"Normalization comparison table"}]
  → Sharp pre-crops every region → /crops/r1.png (for board zoom)
  → visionIndex saved to session
  → SSE: "vision_ready"

PHASE 4 — LESSON BOOK PLAN (background, ~30s)
  → Gemini 2.5 Pro reads FULL PDF (all 124 chunks + full text)
  → Google Search Grounding enriches examples
  → Tavily fetches real-world use cases
  → TeachingStrategyAgent detects: subject=database
  → LessonBookPlannerAgent produces 16 sections:
     Section 1:  hook (3 screens, 3 min)
     Section 2:  vocabulary (4 screens, 4 min)
     Section 3:  definition + source_proof (5 screens, 6 min)
     Section 4:  schema_diagram + erd (6 screens, 8 min)
     Section 5:  pdf_page_crop → real page 5 (4 screens, 5 min)
     Section 6:  normalization_compare (7 screens, 9 min)
     Section 7:  sql_query_block + dry_run (8 screens, 10 min)
     Section 8:  join_bridge animation (6 screens, 7 min)
     Section 9:  worked example (8 screens, 10 min)
     Section 10: mcq_quiz checkpoint (3 screens, 4 min)
     Section 11: common_mistake + repair (5 screens, 6 min)
     Section 12: deep_dive advanced (7 screens, 9 min)
     Section 13: code execution (SQL runs live) (5 screens, 7 min)
     Section 14: guided + independent practice (6 screens, 8 min)
     Section 15: key_takeaway + concept_map (4 screens, 5 min)
     Section 16: lesson_book_page + audio_chapter (3 screens, 3 min)
     TOTAL: 89 screens, ~107 minutes
  → SSE: "plan_ready" → frontend shows section outline

PHASE 5 — SEGMENT LOOP (while student watches)
  For each section:
    1. DirectGeminiPipeline + ADK agents generate segment
    2. BoardSceneAgent picks screen types from 153-type catalog
    3. BoardCommandAgent maps EVERY command to visionIndex bbox:
         {type:"pointer_to_region", targetRegionId:"r1",
          bbox:{x:0.1,y:0.3,w:0.7,h:0.15},
          startMs:4200, endMs:7800,
          voiceLineId:"vl_042"}
    4. VoiceScriptAgent: teacher says "Notice this table on page 5…"
       SSML: <emphasis>exact row</emphasis> <break time="500ms"/>
    5. Google TTS Chirp3-HD: synthesize audio per voice line
    6. QualityGate: reject if sourceRefs=0 or commands<5
    7. Segment saved to MongoDB
    8. SSE: segment_1_ready
    9. Frontend PLAYS segment 1 (board animation + Chirp3-HD voice)
   10. Backend already generating segment 2 (BullMQ next job)

PHASE 6 — STUDENT INTERRUPT (real-time)
  Student says: "Why not keep everything normalized?"
  → Deepgram STT → text in 200ms
  → Pause at commandId cursor (saved to session)
  → Gemini Live API streams real-time teacher response
  → Repair mini-segment: 3 screens (wrong_vs_correct + analogy + retry)
  → Plays repair → auto-resumes at saved cursor

PHASE 7 — LESSON BOOK (saved forever)
  Every segment appends lesson book pages:
    { pageId, title, screenIds[], keyTakeaways[],
      sourceRefs[], voiceTranscript, practice[] }
  Student can flip through all 89+ screens after class
  Each page replays with audio
  Export as PDF / audio slideshow


═══════════════════════════════════════════════════════════════════════════════
                              FILE STRUCTURE
═══════════════════════════════════════════════════════════════════════════════

ai-live-tutor-rebuild/
│
├── server/                              NODE.JS BACKEND
│   ├── app.js                           Express app, all routes mounted
│   ├── controllers/
│   │   └── googleLiveTutorStage2.controller.js   ← ADD 5 new handlers
│   ├── routes/
│   │   └── googleLiveTutorStage2.routes.js        ← ADD 5 new routes
│   ├── models/
│   │   └── GoogleLiveTutorStage2Session.js        ← EXISTS, well-designed
│   └── services/googleAgent/
│       ├── stage2/
│       │   ├── stage2SessionPersistence.js        ← BUILD (currently empty)
│       │   ├── stage2BackgroundJob.service.js     ← BUILD (BullMQ jobs)
│       │   ├── stage2LessonOrchestrator.js        ← EXISTS (keep, compat)
│       │   └── stage2PowerToolsConfig.js          ← EXISTS
│       ├── sourceContext/
│       │   └── sourceContextPipeline.js           ← FIX (buildSourceTruthPacket)
│       ├── googleTtsVoice.service.js              ← EXISTS (Chirp3-HD)
│       └── pdfPageImageRenderer.service.js        ← EXISTS + add Sharp crops
│
├── google_agent/                        PYTHON PIPELINE
│   ├── stage2_adk_orchestrator.py       ← EXISTS (entry point)
│   ├── pipeline/
│   │   ├── direct_gemini_pipeline.py    ← BUILD (primary, always works)
│   │   ├── adk_pipeline_runner.py       ← FIX (add logging + fallback)
│   │   ├── lesson_book_planner.py       ← BUILD (2-hour plan)
│   │   ├── segment_pipeline.py          ← EXISTS (fix vision connection)
│   │   ├── screen_planner.py            ← FIX (153 types + subject detect)
│   │   ├── quality_gate.py              ← BUILD (reject below threshold)
│   │   └── timing_engine.py            ← EXISTS
│   ├── source/
│   │   ├── selected_page_vision_agent.py ← FIX (real Gemini Vision bytes)
│   │   ├── rag_retrieval_agent.py        ← FIX (Atlas Vector Search)
│   │   ├── knowledge_graph_agent.py      ← EXISTS
│   │   └── mongodb_mcp_tool_agent.py     ← EXISTS
│   ├── teaching/
│   │   ├── detailed_explanation_agent.py ← EXISTS
│   │   ├── analogy_example_agent.py      ← EXISTS
│   │   └── assessment_quiz_agent.py      ← EXISTS
│   ├── visual/
│   │   ├── visual_planner_agent.py       ← EXISTS
│   │   ├── board_scene_agent.py          ← EXISTS
│   │   ├── board_command_agent.py        ← FIX (add bbox/regionId)
│   │   └── board/
│   │       ├── screen_planner.py         ← FIX (153 types)
│   │       ├── command_contract.py       ← FIX (add pointer types)
│   │       └── premium_block_builder.py  ← EXISTS
│   └── live/
│       ├── voice_script_agent.py         ← EXISTS
│       ├── subtitle_sync_agent.py        ← EXISTS
│       └── validator_safety_agent.py     ← EXISTS
│
├── client/src/features/googleLiveTutor/
│   └── components/
│       ├── Stage2LiveTutorWorkbench.jsx  ← FIX (polling + progress UI)
│       ├── LiveTutorBoardPlayer.jsx      ← FIX (wire BoardMarkingLayer)
│       ├── BoardMarkingLayer.jsx         ← EXISTS (just wire it in)
│       ├── PremiumBoardScreenRenderer.jsx ← EXISTS (wire all 153 types)
│       ├── LiveTutorFlipbook.jsx         ← BUILD (audio book player)
│       └── TeacherPointerOverlay.jsx     ← BUILD (animates bbox pointer)
│
└── docs/
    ├── ARCHITECTURE.md                  ← THIS FILE
    └── current_to_world_best_tutor_conversion_workflow.md


═══════════════════════════════════════════════════════════════════════════════
                          BUILD PHASES
═══════════════════════════════════════════════════════════════════════════════

  PHASE 1  Pipeline produces real output        (fix _run_safe logging,
           direct_gemini_pipeline.py)            direct Gemini fallback)

  PHASE 2  Non-blocking sessions                (stage2SessionPersistence.js,
           POST /sessions/start, SSE stream)     BullMQ job queue)

  PHASE 3  2-hour lesson plan                   (lesson_book_planner.py,
           Gemini 2.5 Pro, Search Grounding)     Atlas Vector Search)

  PHASE 4  Vision-first teacher pointing        (SelectedPageVisionAgent fix,
           real bbox, Sharp pre-crop)            board commands with regionId)

  PHASE 5  Frontend classroom                   (BoardMarkingLayer wired,
           segment streaming, flipbook)          SSE progress UI, dot nav)

  PHASE 6  Real-time voice                      (Gemini Live API,
           interrupt + repair)                   Deepgram STT, WebSocket)

  PHASE 7  Quality hardening                    (eval tests, curl proof,
           153 screen types rendered)            min threshold enforced)


═══════════════════════════════════════════════════════════════════════════════
                     API KEYS MAPPED TO PHASES
═══════════════════════════════════════════════════════════════════════════════

  KEY                       PHASE  POWERS
  GEMINI_API_KEY            1-7    All agents · Vision · Embeddings · Live
  GOOGLE_TTS_API_KEY        1-7    Chirp3-HD voice every segment
  MONGODB_URI               1-7    All persistence + Vector Search
  REDIS_URL                 2-7    BullMQ job queue (start Redis first)
  DEEPGRAM_API_KEY          6      Student speech → interrupt
  TAVILY_API_KEY            3-7    Web search → enrich lesson content
  YOUTUBE_API_KEY           5-7    Video links in lesson book pages
  MINERU_API_KEY            0      Better PDF table/formula parsing
  DOCUMENT_AI_PROCESSOR     0      OCR for scanned PDFs
  GOOGLE_APPLICATION_CRED   0      Google Cloud service account
  OPENAI_API_KEY            1-7    GPT-4o fallback if Gemini fails
```

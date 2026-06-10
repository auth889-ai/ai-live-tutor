# LUMINA AI TUTOR — COMPLETE FILE-TO-FILE WORKFLOW
# Every file, every call, every data flow

═══════════════════════════════════════════════════════════════════════════
STEP 0 — SERVER STARTS
═══════════════════════════════════════════════════════════════════════════

  server/server.js
    └── requires server/app.js
          └── server/config/loadEnv.js          reads .env → process.env
          └── connects MongoDB Atlas             MONGODB_URI
          └── mounts routes:
                /api/.../agent1/        ← server/routes/googleLiveTutorAgent1.routes.js
                /api/.../concept-tree/  ← server/routes/googleLiveTutorConceptTree.routes.js
                /api/.../stage2/        ← server/routes/googleLiveTutorStage2.routes.js


═══════════════════════════════════════════════════════════════════════════
STEP 1 — STUDENT UPLOADS PDF
═══════════════════════════════════════════════════════════════════════════

  BROWSER
  client/src/App.jsx
  └── client/src/features/googleLiveTutor/components/Stage2LiveTutorWorkbench.jsx
        └── POST /api/google-agent/live-tutor/resources/upload

  SERVER
  server/routes/googleLiveTutorAgent1.routes.js
  └── server/controllers/googleLiveTutorAgent1.controller.js
        └── server/services/googleAgent/agent1Resource.service.js
              │
              ├── server/services/googleAgent/pdfPageImageRenderer.service.js
              │     └── renders every PDF page → PNG
              │     └── saves to: /server/public/live-tutor-page-images/{resourceId}/page-01.png
              │                                                                       page-02.png
              │                                                                       ...page-17.png
              │
              └── spawns Python process:
                    /miniconda3/envs/live-tutor-adk/bin/python
                    google_agent/agent1_pdf_text_visual_agent.py
                          │
                          ├── MINERU_API_KEY  → advanced table+formula parsing
                          ├── DOCUMENT_AI_PROCESSOR_NAME → OCR for scanned pages
                          ├── GEMINI_API_KEY → Gemini reads full PDF
                          │
                          └── saves to MongoDB:
                                googlelivetutorresources       (1 resource doc)
                                googlelivetutorresourcechunks  (124 chunk docs)
                                  each chunk: {chunkId, text, page, pageRef,
                                               textPreview, tokenEstimate}

  RESULT SAVED TO:
  server/models/GoogleLiveTutorResource.js  → resourceId stored
  MongoDB Atlas: googlelivetutorresourcechunks


═══════════════════════════════════════════════════════════════════════════
STEP 2 — CONCEPT TREE BUILT (Stage 1)
═══════════════════════════════════════════════════════════════════════════

  BROWSER
  Stage2LiveTutorWorkbench.jsx
  └── POST /api/google-agent/live-tutor/resources/:resourceId/concept-tree

  SERVER
  server/routes/googleLiveTutorConceptTree.routes.js
  └── server/controllers/googleLiveTutorConceptTree.controller.js
        └── server/services/googleAgent/stage1ConceptTree.service.js
              └── server/services/googleAgent/stage1/stage1BuildPipeline.js
                    │
                    ├── stage1/stage1SourcePackBuilder.js
                    │     └── loads all 124 chunks from MongoDB
                    │
                    ├── stage1/stage1ContextBuilder.js
                    │     └── builds fullPdfSummary + outline
                    │
                    ├── stage1/stage1PromptBuilder.js
                    │     └── builds Gemini prompt for concept tree
                    │
                    ├── stage1/stage1GeminiClient.js
                    │     └── GEMINI_API_KEY → calls gemini-2.5-flash
                    │     └── gets back: 23 nodes with relationships
                    │
                    ├── stage1/stage1TreeNormalizer.js
                    │     └── normalizes node structure
                    │
                    ├── stage1/stage1RoadmapQuality.js
                    │     └── validates quality
                    │
                    ├── stage1/stage1McpMirror.js
                    │     └── mirrors to MCP if enabled
                    │
                    └── stage1/stage1TreePersistence.js
                          └── saves to MongoDB: googlelivetutorconcepttrees
                          └── treeId returned

  RESULT:
  MongoDB: googlelivetutorconcepttrees (23-node tree)

  BROWSER
  client/src/features/googleLiveTutor/components/ConceptTreeDagreBoard.jsx
  └── renders tree with React Flow + Dagre layout
  └── student sees 23 nodes as interactive map
  └── student clicks a node → STAGE 2 STARTS


═══════════════════════════════════════════════════════════════════════════
STEP 3 — STUDENT CLICKS NODE → LESSON STARTS (Stage 2)
═══════════════════════════════════════════════════════════════════════════

                    ┌──────────────────────────────────────┐
                    │  CURRENT (BROKEN)  vs  FIXED (NEW)   │
                    └──────────────────────────────────────┘

━━━ CURRENT BROKEN FLOW ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Stage2LiveTutorWorkbench.jsx
  └── POST /api/.../stage2/teach-node   ← BLOCKS for 600 seconds

  routes/googleLiveTutorStage2.routes.js (teachNode)
  └── controllers/googleLiveTutorStage2.controller.js (teachNode)
        ├── sourceContext/sourceContextPipeline.js (buildSourceContext)
        │     ├── sourceContext/resourceLoader.js         load resource
        │     ├── sourceContext/chunkLoader.js            load chunks
        │     ├── sourceContext/selectedNodeContext.js    node chunks
        │     ├── sourceContext/nearbyPageContext.js      nearby chunks
        │     ├── sourceContext/pageImageContext.js       page images
        │     ├── sourceContext/richSourcePackAssembler.js assemble
        │     └── sourceContext/contextAudit.js          audit
        │
        └── stage2/stage2LessonOrchestrator.js (teachNodeWithAdkPipeline)
              └── spawns Python:
                    stage2_adk_orchestrator.py
                    └── pipeline/adk_pipeline_runner.py (run_adk_pipeline)
                          └── 28 agents → ALL wrapped in _run_safe()
                          └── _run_safe() swallows ALL errors silently
                          └── returns: boardCommands=[] voiceScript=[]
                                                        ↑ EMPTY ALWAYS

  RESULT: session status=undefined, boardCommands=0 ← BROKEN

━━━ FIXED FLOW (WHAT WE BUILD) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Stage2LiveTutorWorkbench.jsx
  └── POST /api/.../stage2/sessions/start  ← returns in <100ms
        receives: { sessionId, status:"created", streamUrl }
  └── opens SSE: GET /api/.../stage2/sessions/:id/stream
  └── shows animated progress screen (like OpenMAIC)
  └── starts polling: GET /api/.../stage2/sessions/:id/status

  ┌─────────────────────────────────────────────────────────────────────┐
  │  SERVER — SESSION START                                             │
  │                                                                     │
  │  routes/googleLiveTutorStage2.routes.js (POST /sessions/start)     │
  │  └── controllers/googleLiveTutorStage2.controller.js (startSession)│
  │        ├── stage2/stage2RequestValidator.js   validate input        │
  │        ├── stage2/stage2SessionPersistence.js (createSession)  ←BUILD│
  │        │     └── GoogleLiveTutorStage2Session.js (Mongoose model)  │
  │        │     └── MongoDB: google_live_tutor_stage2_sessions        │
  │        │     └── status: "created"                                 │
  │        │                                                            │
  │        ├── stage2/stage2BackgroundJob.service.js (enqueue)    ←BUILD│
  │        │     └── BullMQ queue: "lesson_generation"                 │
  │        │     └── Redis: REDIS_URL=redis://127.0.0.1:6379           │
  │        │                                                            │
  │        └── returns: { sessionId, status:"created" }  immediately   │
  └─────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────┐
  │  BULLMQ WORKER — BACKGROUND JOB                                     │
  │  (runs in parallel while frontend polls)                            │
  │                                                                     │
  │  stage2BackgroundJob.service.js (worker picks up job)          ←BUILD│
  │  │                                                                  │
  │  ├── PASS 1: BUILD SOURCE TRUTH PACKET                              │
  │  │   sourceContext/sourceContextPipeline.js (buildSourceTruth)     │
  │  │     ├── sourceContext/resourceLoader.js    load resource doc     │
  │  │     ├── sourceContext/chunkLoader.js        load 124 chunks      │
  │  │     ├── sourceContext/selectedNodeContext.js  node-specific      │
  │  │     ├── sourceContext/nearbyPageContext.js  surrounding pages    │
  │  │     ├── sourceContext/pageImageContext.js   load page PNG paths  │
  │  │     └── sourceContext/richSourcePackAssembler.js  final pack     │
  │  │           QUALITY GATE: selectedEvidence ≥ 5 chunks required    │
  │  │                                                                  │
  │  ├── stage2SessionPersistence.js (updateStatus "source_ready")     │
  │  │                                                                  │
  │  ├── PASS 2: SPAWN PYTHON PIPELINE                                  │
  │  │   stage2LessonOrchestrator.js (teachNodeWithAdkPipeline)         │
  │  │   └── spawns Python:                                             │
  │  │         google_agent/stage2_adk_orchestrator.py                 │
  │  │         └── google_agent/pipeline/adk_pipeline_runner.py        │
  │  │               │                                                  │
  │  │               ├── FIXED: _run_safe() now logs to stderr          │
  │  │               ├── PRIMARY PATH:                                  │
  │  │               │   google_agent/pipeline/direct_gemini_pipeline.py ←BUILD│
  │  │               │   └── detects subject (database/code/math...)    │
  │  │               │   └── picks 20-25 screen types from 153 catalog  │
  │  │               │   └── Gemini 2.5 Flash → generates full lesson   │
  │  │               │   └── ALWAYS returns 20+ screens, 120+ commands  │
  │  │               │                                                  │
  │  │               └── ADK PATH (28 agents):                          │
  │  │                   live_tutor_agents/orchestrator_registry.py     │
  │  │                   │  loads all agents from these files:          │
  │  │                   │                                              │
  │  │                   │  source/mongodb_mcp_tool_agent.py            │
  │  │                   │  source/rag_retrieval_agent.py   ←FIX Vector │
  │  │                   │  source/selected_page_vision_agent.py ←FIX   │
  │  │                   │  source/concept_extraction_agent.py          │
  │  │                   │  source/knowledge_graph_agent.py             │
  │  │                   │  planning/teaching_strategy_agent.py         │
  │  │                   │  planning/course_planner_agent.py            │
  │  │                   │  planning/segment_planner_agent.py           │
  │  │                   │  teaching/detailed_explanation_agent.py      │
  │  │                   │  teaching/analogy_example_agent.py           │
  │  │                   │  teaching/assessment_quiz_agent.py           │
  │  │                   │  visual/visual_planner_agent.py              │
  │  │                   │  visual/board_scene_agent.py                 │
  │  │                   │  visual/board_command_agent.py  ←FIX bbox    │
  │  │                   │  visual/layout_agent.py                      │
  │  │                   │  visual/diagram_compiler_agent.py            │
  │  │                   │  visual/handwriting_drawing_agent.py         │
  │  │                   │  live/voice_script_agent.py                  │
  │  │                   │  live/subtitle_sync_agent.py                 │
  │  │                   │  live/validator_safety_agent.py              │
  │  │                   │                                              │
  │  │                   │  Supporting modules:                         │
  │  │                   │  visual/board/screen_planner.py    ←FIX 153  │
  │  │                   │  visual/board/command_contract.py  ←FIX bbox │
  │  │                   │  visual/board/premium_block_builder.py       │
  │  │                   │  visual/board/teacher_marks.py               │
  │  │                   │  source/rag/evidence_selector.py             │
  │  │                   │  source/rag/citation_builder.py              │
  │  │                   │  source/rag/chunk_ranker.py                  │
  │  │                   │  live/voice/teacher_script_builder.py        │
  │  │                   │  live/voice/subtitle_aligner.py              │
  │  │                   │  pipeline/timing_engine.py                   │
  │  │                   │  pipeline/result_builder.py                  │
  │  │                   └──pipeline/pipeline_state.py                  │
  │  │                                                                  │
  │  ├── PYTHON RETURNS per-segment JSON:                               │
  │  │   { boardScreens[], boardCommands[], voiceScript[],              │
  │  │     subtitles[], sourceRefs[], visionIndex{} }                   │
  │  │                                                                  │
  │  ├── PASS 3: ATTACH GOOGLE TTS VOICE                                │
  │  │   services/googleAgent/googleTtsVoice.service.js                │
  │  │   └── GOOGLE_TTS_API_KEY → Chirp3-HD-Aoede                      │
  │  │   └── synthesizes audio per voice line                          │
  │  │   └── saves audio files to /public/live-tutor-audio/            │
  │  │                                                                  │
  │  ├── PASS 4: SAVE SEGMENT                                           │
  │  │   stage2/stage2SessionPersistence.js (saveSegment)          ←BUILD│
  │  │   └── stage2/stage2SegmentSaver.js                              │
  │  │   └── GoogleLiveTutorStage2Session.js (Mongoose)                │
  │  │   └── MongoDB: google_live_tutor_stage2_sessions                │
  │  │         status: "running"                                        │
  │  │         segments[N]: { boardScreens, boardCommands,              │
  │  │                         voiceScript, subtitles }                 │
  │  │                                                                  │
  │  └── PASS 5: SSE NOTIFY FRONTEND                                    │
  │      GET /sessions/:id/stream (SSE endpoint)  ←BUILD               │
  │      └── event: "segment_ready"                                     │
  │      └── data: { segmentId, segmentIndex, screenCount }            │
  └─────────────────────────────────────────────────────────────────────┘

  Worker immediately enqueues NEXT segment job
  (segment 2 generates while segment 1 plays)


═══════════════════════════════════════════════════════════════════════════
STEP 4 — FRONTEND PLAYS THE LESSON
═══════════════════════════════════════════════════════════════════════════

  SSE receives: { event:"segment_ready", segmentId:"seg_001" }

  Stage2LiveTutorWorkbench.jsx
  └── GET /api/.../stage2/sessions/:id/segments/seg_001
  └── receives: { boardScreens[], boardCommands[], voiceScript[], subtitles[] }

  Stage2LiveTutorWorkbench.jsx
  └── renders: Stage2PremiumBoardRenderer.jsx (container)
        └── LiveTutorBoardPlayer.jsx (main player)  ←FIX
              │
              ├── PremiumBoardScreenRenderer.jsx (renders each screen)  ←FIX
              │     maps 153 screen types → React components
              │     database  → schema_diagram, sql_query_block, join_bridge
              │     code      → code_block, line_dryrun, variable_table
              │     math      → formula_card, graph_screen, proof_step
              │     science   → figure_label, process_flow_bio
              │     finance   → cashflow_timeline, scenario_simulation
              │     ...all 153 types rendered
              │
              ├── BoardMarkingLayer.jsx (teacher actions)  ←WIRE IN
              │     reads boardCommands, executes at startMs:
              │     commandType: "writeText"       → writes on board
              │     commandType: "pointer_to_region" → pointer moves to bbox
              │     commandType: "circle_bbox"     → animated circle draws
              │     commandType: "highlight_row"   → yellow highlight
              │     commandType: "draw_arrow"      → arrow appears
              │     commandType: "underline"       → underline draws
              │     commandType: "zoom_region"     → region fills screen
              │     commandType: "show_source_badge" → "[Page 5]" badge
              │
              ├── TeacherPointerOverlay.jsx (bbox pointer)  ←BUILD
              │     reads: visionIndex regionId → bbox {x,y,w,h}
              │     at startMs → animates pointer to exact PDF region
              │     shows: /crops/{regionId}.png (Sharp pre-cropped)
              │
              ├── VoiceSubtitleSyncPlayer.jsx (audio + subtitles)
              │     plays: /public/live-tutor-audio/{lineId}.mp3
              │     syncs: subtitle words at exact millisecond
              │
              └── dot navigation: 120+ screen dots at bottom


═══════════════════════════════════════════════════════════════════════════
STEP 5 — TEACHER POINTS AT REAL PDF REGION
═══════════════════════════════════════════════════════════════════════════

  PYTHON — selected_page_vision_agent.py  ←FIX
  └── loads: /server/public/live-tutor-page-images/{resourceId}/page-05.png
  └── reads PNG bytes into memory
  └── sends to: GEMINI_API_KEY → Gemini Vision API
  └── gets back: detected regions with bbox
  └── saves: visionIndex = {
               page: 5,
               regions: [
                 { regionId:"r1", type:"table",
                   bbox:{x:0.10, y:0.30, w:0.70, h:0.15},
                   label:"Normalization comparison table" },
                 { regionId:"r2", type:"diagram",
                   bbox:{x:0.20, y:0.55, w:0.55, h:0.28},
                   label:"Star schema layout" }
               ]
             }

  NODE.JS — Sharp pre-cropper (in pdfPageImageRenderer.service.js)  ←ADD
  └── reads visionIndex regions
  └── sharp(page-05.png).extract(bbox) → /public/crops/r1.png
  └── sharp(page-05.png).extract(bbox) → /public/crops/r2.png

  PYTHON — board_command_agent.py  ←FIX
  └── reads visionIndex
  └── generates commands that reference REAL regions:
        {
          commandId: "cmd_042",
          screenId: "screen_022",
          voiceLineId: "vl_042",
          commandType: "circle_bbox",
          targetRegionId: "r1",
          bbox: {x:0.10, y:0.30, w:0.70, h:0.15},
          imagePath: "/public/live-tutor-page-images/.../page-05.png",
          cropPath: "/public/crops/r1.png",
          startMs: 4200,   ← teacher says "look at this table" at 4.2s
          endMs: 7800,
          sourceRef: "[Page 5] Normalization comparison"
        }

  FRONTEND — TeacherPointerOverlay.jsx  ←BUILD
  └── at currentMs = 4200:
  └── shows circle animation around bbox on board
  └── zooms to /public/crops/r1.png (that exact table fills screen)
  └── teacher voice says: "Notice this comparison table on page 5..."
  └── subtitle word "comparison" highlights at 4.2s


═══════════════════════════════════════════════════════════════════════════
STEP 6 — CODE RUNS LIVE ON BOARD (SQL / Python topics)
═══════════════════════════════════════════════════════════════════════════

  PYTHON — direct_gemini_pipeline.py  ←BUILD
  └── detects subject: "database" or "code"
  └── for sql_query_block screen:
        calls GEMINI_API_KEY → Gemini Code Execution API
        sends: SQL query from PDF evidence
        gets back: real execution result table
        adds to boardScreen.blocks:
          { type: "code_block", language: "sql", code: "SELECT..." }
          { type: "execution_result", rows: [...real data...] }

  FRONTEND — PremiumBoardScreenRenderer.jsx
  └── renders code_block screen type:
        left side: SQL query with syntax highlight
        right side: execution result table (real rows)
        teacher pointer: highlights each line as it executes


═══════════════════════════════════════════════════════════════════════════
STEP 7 — STUDENT INTERRUPTS
═══════════════════════════════════════════════════════════════════════════

  FRONTEND
  Stage2LiveTutorWorkbench.jsx
  └── student presses mic button or types question
  └── Deepgram STT: DEEPGRAM_API_KEY → speech to text
  └── POST /api/.../stage2/sessions/:id/interrupt
        { commandId:"cmd_042", studentMessage:"Why not keep normalized?" }

  SERVER
  controllers/googleLiveTutorStage2.controller.js (interrupt)
  └── stage2SessionPersistence.js (savePlaybackCursor)  ←BUILD
        saves: { pausedAt: commandId:"cmd_042", screenId:"screen_022" }
  └── stage2BackgroundJob.service.js (enqueueRepair)  ←BUILD
        enqueues: repair job with studentMessage

  WORKER
  └── spawns Python: stage2_adk_orchestrator.py (mode: "repair")
  └── google_agent/teaching/repair_confusion_agent.py
        └── Gemini 2.5 Flash → generates 3-screen repair lesson
        └── wrong_vs_correct + simpler_analogy + retry_checkpoint screens
  └── TTS synthesizes repair audio
  └── SSE: "repair_ready"

  FRONTEND
  └── plays repair mini-lesson (3 screens)
  └── auto-resumes at saved cursor: commandId:"cmd_043"


═══════════════════════════════════════════════════════════════════════════
STEP 8 — LESSON BOOK SAVED
═══════════════════════════════════════════════════════════════════════════

  After every segment:
  stage2SegmentSaver.js + stage2SessionPersistence.js
  └── saves lesson book pages to MongoDB:
        { pageId, sectionTitle, screenIds[],
          keyTakeaways[], sourceRefs[], voiceTranscript }

  FRONTEND — LiveTutorFlipbook.jsx  ←BUILD
  └── GET /api/.../stage2/sessions/:id/book
  └── renders 120+ flipable pages
  └── each page: click → audio replays, board shows that screen
  └── student can review entire 2-hour lesson as book


═══════════════════════════════════════════════════════════════════════════
COMPLETE FILE CALL MAP
═══════════════════════════════════════════════════════════════════════════

  ENTRY POINTS (browser → server):
  ─────────────────────────────────────────────────────────────────────
  App.jsx
  └── Stage2LiveTutorWorkbench.jsx       main classroom container
        ├── ConceptTreeDagreBoard.jsx     Stage 1 tree display
        ├── LiveTutorBoardPlayer.jsx      Stage 2 board player
        │     ├── PremiumBoardScreenRenderer.jsx  153 screen types
        │     ├── BoardMarkingLayer.jsx            teacher actions
        │     ├── TeacherPointerOverlay.jsx         bbox pointer
        │     └── VoiceSubtitleSyncPlayer.jsx       audio+subtitles
        ├── HumanTutorAutoBoard.jsx       (exists, needs wiring)
        ├── Stage2PremiumBoardRenderer.jsx (wrapper)
        └── LiveTutorFlipbook.jsx         ←BUILD audio book

  SERVER FILES (routes → controllers → services):
  ─────────────────────────────────────────────────────────────────────
  app.js → server.js
  │
  ├── routes/googleLiveTutorAgent1.routes.js
  │     └── controllers/googleLiveTutorAgent1.controller.js
  │           └── services/googleAgent/agent1Resource.service.js
  │                 └── services/googleAgent/pdfPageImageRenderer.service.js
  │
  ├── routes/googleLiveTutorConceptTree.routes.js
  │     └── controllers/googleLiveTutorConceptTree.controller.js
  │           └── services/googleAgent/stage1ConceptTree.service.js
  │                 └── services/googleAgent/stage1/stage1BuildPipeline.js
  │                       ├── stage1/stage1SourcePackBuilder.js
  │                       ├── stage1/stage1ContextBuilder.js
  │                       ├── stage1/stage1PromptBuilder.js
  │                       ├── stage1/stage1GeminiClient.js
  │                       ├── stage1/stage1TreeNormalizer.js
  │                       ├── stage1/stage1RoadmapQuality.js
  │                       ├── stage1/stage1McpMirror.js
  │                       └── stage1/stage1TreePersistence.js
  │
  └── routes/googleLiveTutorStage2.routes.js
        └── controllers/googleLiveTutorStage2.controller.js
              ├── services/googleAgent/sourceContext/sourceContextPipeline.js
              │     ├── sourceContext/resourceLoader.js
              │     ├── sourceContext/chunkLoader.js
              │     ├── sourceContext/selectedNodeContext.js
              │     ├── sourceContext/nearbyPageContext.js
              │     ├── sourceContext/pageImageContext.js
              │     ├── sourceContext/richSourcePackAssembler.js
              │     └── sourceContext/contextAudit.js
              │
              ├── services/googleAgent/stage2/stage2SessionPersistence.js ←BUILD
              ├── services/googleAgent/stage2/stage2BackgroundJob.service.js ←BUILD
              ├── services/googleAgent/stage2/stage2LessonOrchestrator.js
              ├── services/googleAgent/stage2/stage2RequestValidator.js
              ├── services/googleAgent/stage2/stage2ResultNormalizer.js
              ├── services/googleAgent/stage2/stage2NodeResolver.js
              ├── services/googleAgent/stage2/stage2ContextAssembler.js
              ├── services/googleAgent/stage2/stage2SegmentSaver.js
              ├── services/googleAgent/stage2/stage2PythonBridgeRunner.js
              ├── services/googleAgent/stage2/stage2McpProof.js
              ├── services/googleAgent/stage2/stage2PowerToolsConfig.js
              ├── services/googleAgent/googleTtsVoice.service.js
              └── services/googleAgent/sourceContextBuilder.service.js

  MODELS (MongoDB schemas):
  ─────────────────────────────────────────────────────────────────────
  models/GoogleLiveTutorResource.js        resources collection
  models/GoogleLiveTutorBoard.js           boards collection
  models/GoogleLiveTutorStage2Session.js   sessions collection
  models/LiveTutorUser.js                  users collection

  PYTHON FILES (agent pipeline):
  ─────────────────────────────────────────────────────────────────────
  stage2_adk_orchestrator.py               entry point
  │
  ├── pipeline/direct_gemini_pipeline.py   ←BUILD primary path
  ├── pipeline/adk_pipeline_runner.py      ←FIX  ADK path
  ├── pipeline/lesson_book_planner.py      ←BUILD 2-hour plan
  ├── pipeline/segment_pipeline.py         fix vision connection
  ├── pipeline/screen_planner.py           ←FIX  153 types
  ├── pipeline/quality_gate.py             ←BUILD reject threshold
  ├── pipeline/timing_engine.py            keep
  ├── pipeline/result_builder.py           keep
  │
  ├── live_tutor_agents/
  │     ├── orchestrator_registry.py       loads all agents
  │     ├── base_agent.py                  base class
  │     ├── contracts.py                   data types
  │     └── stage2_flow_contract.py        packet builders
  │
  ├── source/
  │     ├── mongodb_mcp_tool_agent.py      MCP reads Atlas
  │     ├── rag_retrieval_agent.py         ←FIX Vector Search
  │     ├── selected_page_vision_agent.py  ←FIX real Vision API
  │     ├── concept_extraction_agent.py    keep
  │     ├── knowledge_graph_agent.py       keep
  │     └── rag/
  │           ├── evidence_selector.py     keep
  │           ├── citation_builder.py      keep
  │           └── chunk_ranker.py          keep
  │
  ├── planning/
  │     ├── teaching_strategy_agent.py     keep
  │     ├── course_planner_agent.py        keep
  │     └── segment_planner_agent.py       keep
  │
  ├── teaching/
  │     ├── detailed_explanation_agent.py  keep
  │     ├── analogy_example_agent.py       keep
  │     ├── assessment_quiz_agent.py       keep
  │     └── repair_confusion_agent.py      keep
  │
  ├── visual/
  │     ├── visual_planner_agent.py        keep
  │     ├── board_scene_agent.py           keep
  │     ├── board_command_agent.py         ←FIX bbox + regionId
  │     ├── layout_agent.py                keep
  │     ├── diagram_compiler_agent.py      keep
  │     ├── handwriting_drawing_agent.py   keep
  │     └── board/
  │           ├── screen_planner.py        ←FIX 153 types
  │           ├── command_contract.py      ←FIX pointer types
  │           ├── premium_block_builder.py keep
  │           ├── diagram_plan_builder.py  keep
  │           ├── teacher_marks.py         keep
  │           └── layout_rules.py          keep
  │
  └── live/
        ├── voice_script_agent.py          keep
        ├── subtitle_sync_agent.py         keep
        ├── validator_safety_agent.py      keep
        ├── interaction_agent.py           keep
        ├── interrupt_agent.py             keep
        └── voice/
              ├── teacher_script_builder.py keep
              └── subtitle_aligner.py       keep


═══════════════════════════════════════════════════════════════════════════
WHAT GETS FIXED vs WHAT GETS BUILT NEW
═══════════════════════════════════════════════════════════════════════════

  FIX (replace broken code inside existing file):
    adk_pipeline_runner.py                add logging + direct fallback
    selected_page_vision_agent.py         real Gemini Vision with image bytes
    screen_planner.py                     153 screen types + subject detect
    board_command_agent.py                add bbox/regionId from visionIndex
    rag_retrieval_agent.py                wire Atlas Vector Search
    stage2SessionPersistence.js           FULL rebuild (currently 1 empty line)
    googleLiveTutorStage2.routes.js       add 5 new routes
    googleLiveTutorStage2.controller.js   add 5 new handlers
    sourceContextPipeline.js              enforce ≥5 chunks quality gate

  BUILD NEW (new file added):
    pipeline/direct_gemini_pipeline.py    primary pipeline always works
    pipeline/lesson_book_planner.py       2-hour plan with Gemini Pro
    pipeline/quality_gate.py             reject below threshold
    stage2/stage2BackgroundJob.service.js BullMQ job queue + SSE
    components/TeacherPointerOverlay.jsx  bbox pointer animation
    components/LiveTutorFlipbook.jsx      120+ screen audio book

  KEEP (already working, no changes):
    stage1/ all files                     Stage 1 already works
    planning/ all agents                  keep
    teaching/ all agents                  keep
    live/ all agents                      keep
    models/ all models                    well designed
    googleTtsVoice.service.js             Chirp3-HD works
    pdfPageImageRenderer.service.js       page images work
    ConceptTreeDagreBoard.jsx             tree UI works
    VoiceSubtitleSyncPlayer.jsx           keep
    BoardMarkingLayer.jsx                 just wire it in


═══════════════════════════════════════════════════════════════════════════
RUNNING ORDER WHEN STUDENT STARTS LESSON
═══════════════════════════════════════════════════════════════════════════

  1ms    Frontend: POST /sessions/start
  2ms    Server: session created in MongoDB, BullMQ job enqueued
  3ms    Server: returns {sessionId} to frontend
  5ms    Frontend: opens SSE stream, shows progress animation
  10ms   Worker: starts buildSourceTruth
  15s    Worker: sourceRefs loaded (124 chunks, 5+ for this node)
  25s    Worker: Gemini Vision scans page-05.png → visionIndex saved
  30s    Worker: Sharp pre-crops r1.png, r2.png
  45s    Worker: Gemini Pro builds 16-section 2-hour lesson plan
  50s    SSE: "plan_ready" → frontend shows section outline
  65s    Worker: segment 1 starts generating (direct_gemini_pipeline)
  90s    Worker: segment 1 done (6 screens, 40 commands, voice lines)
  91s    Worker: TTS synthesizes segment 1 audio files
  100s   Worker: segment 1 saved to MongoDB
  101s   SSE: "segment_1_ready"
  102s   Frontend: fetches segment 1, STARTS PLAYING
  102s   Worker: segment 2 ALREADY generating (parallel)
  160s   Worker: segment 2 done → SSE → frontend plays when segment 1 ends
         [continues until all 16 segments done = ~2 hour lesson]

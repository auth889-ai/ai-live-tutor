Phase 0 — Foundations (Week 1, non-negotiable)
Before one line of AI code, nail these three things. Skipping them breaks every phase after.
1. Region layout system — the most important design decision in the whole product.
The Visual Director agent must never output raw x, y coordinates. Instead define named regions per layout type:
pythonLAYOUT_REGIONS = {
  "teacher_notebook": {
    "notebook_title":  {"x": 40,  "y": 60,  "w": 500, "maxLines": 1},
    "notebook_body":   {"x": 40,  "y": 110, "w": 500, "maxLines": 6},
    "notebook_footer": {"x": 40,  "y": 360, "w": 500, "maxLines": 2},
    "pointer_zone":    {"x": 40,  "y": 60,  "w": 500, "h": 380}
  },
  "teacher_code_dryrun": {
    "code_panel":      {"x": 40,  "y": 60,  "w": 320, "maxLines": 20},
    "variable_table":  {"x": 380, "y": 60,  "w": 260, "maxLines": 10},
    "output_panel":    {"x": 380, "y": 280, "w": 260, "maxLines": 8},
    "pointer_zone":    {"x": 40,  "y": 60,  "w": 600, "h": 380}
  },
  "teacher_diagram_source": {
    "diagram_area":    {"x": 40,  "y": 60,  "w": 380, "h": 320},
    "source_sidebar":  {"x": 440, "y": 60,  "w": 220, "maxLines": 12},
    "notebook_footer": {"x": 40,  "y": 400, "w": 600, "maxLines": 2}
  }
}
The AI picks a region name — "region": "notebook_body" — and a line number within it. The renderer computes actual pixel position from the region spec. This is what prevents overlap, overflow, and clutter. It is non-negotiable.
2. The TeachingScreen manifest Pydantic schema — every field, strictly typed.
pythonclass TimelineAction(BaseModel):
    id: str
    type: Literal["write_text","draw_arrow","circle","underline",
                  "highlight_code_line","show_output_line",
                  "update_variable_table","move_pointer",
                  "source_focus","show_quiz","save_notebook_snapshot"]
    targetObjectId: str
    region: str          # must match a key in LAYOUT_REGIONS[layout]
    lineNumber: int      # within the region, 0-indexed
    startMs: int         # set to 0 initially, reconciled after TTS
    endMs: int
    pointerOffsetMs: int = -300  # pointer arrives BEFORE voice mentions it

class VoiceLine(BaseModel):
    id: str
    text: str
    startMs: int   # 0 initially, reconciled after TTS
    endMs: int
    wordTimestamps: list[WordTimestamp] = []  # filled by TTS runner

class TeachingScreenManifest(BaseModel):
    sceneId: str
    layout: str          # must be a key in LAYOUT_REGIONS
    durationMs: int
    voiceLines: list[VoiceLine]
    visualObjects: list[VisualObject]
    timelineActions: list[TimelineAction]
    subtitles: list[SubtitleWord]
    sourceEvidence: list[SourceEvidence]
    notebookPage: NotebookPage
Every agent output is validated against these models. If it fails, the Repair agent gets the validation errors, not a human. This is how you get reliable quality at scale.
3. The audio master clock — write this once and never change it.
typescript// audioEngine.ts — the single source of truth for all timing
class AudioEngine {
  private ctx = new AudioContext()
  private sceneStartTime = 0

  get currentMs(): number {
    return (this.ctx.currentTime - this.sceneStartTime) * 1000
  }

  onFrame(actions: TimelineAction[], objects: VisualObject[]) {
    const t = this.currentMs
    for (const action of actions) {
      if (t >= action.startMs && t <= action.endMs) {
        this.dispatchAction(action, t, objects)
      }
    }
    requestAnimationFrame(() => this.onFrame(actions, objects))
  }
}
This runs on every animation frame. Every visual — writing, pointer, highlight, subtitle — is driven by this single currentMs value. No setTimeout anywhere in the codebase. If any developer puts a setTimeout for visual timing, reject the PR.

Phase 1 — Static Player Shell (Week 1–2)
Build the complete frontend with hardcoded demo content. The point is to prove the UI feels right before any AI is connected.
What to build:

Full layout: sidebar + lecture stage + playback controls + subtitle bar
Whiteboard canvas that does stroke-reveal of hardcoded text, using a handwriting font (Kalam or Caveat from Google Fonts) word-by-word
Pointer that moves smoothly between hardcoded coordinates using cubic-bezier easing
Code panel with Monaco Editor that highlights lines on cue
Subtitle bar highlighting the current word

The pointer easing is critical. Use this exactly:
typescriptfunction movePointer(fromX: number, fromY: number, 
                     toX: number, toY: number, 
                     durationMs: number, elapsedMs: number) {
  // cubic-bezier ease-out — arrives fast, settles gently
  const t = Math.min(elapsedMs / durationMs, 1)
  const ease = 1 - Math.pow(1 - t, 3)
  return {
    x: fromX + (toX - fromX) * ease,
    y: fromY + (toY - fromY) * ease
  }
}
And the pointer always targets its destination 300ms before the voice line that mentions it — hardcode this offset in Phase 1 so you feel it in action before the AI is generating it.
Done when: a 3-minute hardcoded lesson plays and genuinely feels like watching a real teacher. If it doesn't feel like that with hardcoded content, the AI pipeline won't save it.

Phase 2 — TTS Integration + Timestamp Reconciler (Week 2)
This phase is short but critical. You cannot build the AI pipeline correctly until you understand exactly how timestamps work.
Use ElevenLabs streaming API with alignment mode enabled — it returns characters, character_start_times_seconds, and character_end_times_seconds per audio chunk. Aggregate these into word-level timestamps:
pythonasync def synthesize_with_timestamps(text: str) -> TTSResult:
    # ElevenLabs /v1/text-to-speech/{voice_id}/stream/with-timestamps
    words = []
    async for chunk in elevenlabs.stream_with_alignment(text):
        words.extend(parse_word_timestamps(chunk.alignment))
    return TTSResult(audio_bytes=..., word_timestamps=words)
Then the reconciler takes the manifest timestamps (which the AI estimated) and replaces them with real ones:
pythondef reconcile_timestamps(manifest: TeachingScreenManifest, 
                         tts_result: TTSResult) -> TeachingScreenManifest:
    # For each voiceLine, find its words in tts_result
    # Update voiceLine.startMs, endMs from real audio
    # For each timelineAction tied to a voiceLine:
    #   set startMs = voiceLine.startMs + action's relative offset
    #   set endMs proportionally
    # For pointer actions: startMs -= pointerOffsetMs (arrive early)
    ...
Done when: A single voiceLine plays in the browser and every word highlights in the subtitle bar at the exact moment it's spoken. Test with at least 10 different sentences.

Phase 3 — Single Scene Generator (Week 3)
Now connect the AI. The staged pipeline for one scene:
Stage 1: PedagogyPlan     → what teaching intent, what affordances needed
Stage 2: ScriptBeats      → 3-7 beats, each one idea
Stage 3: VoiceLines       → narration text per beat, spoken natural language
Stage 4: VisualPlan       → which region, what type (text/arrow/circle/code)
Stage 5: TimelineActions  → action sequence with estimated startMs/endMs
Stage 6: SourceEvidence   → evidence chunks from pgvector for each claim
Stage 7: NotebookPage     → keyNotes the student takes away
Each stage is a separate LangGraph node. The output of each is validated by Pydantic before the next stage runs. If validation fails, it retries with the validation error injected into the prompt — max 3 retries before the Repair agent handles it.
The most important prompt is the Visual Director (Stage 4). It must be told explicitly:
You are the Visual Director. You place content on a teaching whiteboard.
You MUST pick from these regions only: {json(LAYOUT_REGIONS[layout])}
You MUST NOT place more than {maxLines} items in any region.
You MUST pick the region name exactly as given. Do not invent region names.
Output strict JSON matching the VisualPlan schema.
Done when: One scene is generated end-to-end, passes all validators, audio plays, and the board content is synchronized to the voice. The content must be accurate and grounded.

Phase 4 — Full Episode Pipeline (Week 4)
Scale from one scene to a full episode. New things needed:
Continuity agent — before each scene's ScriptBeats are generated, it receives a summary of all previous scenes in the episode and injects connective language: "Now that we understand X, let's look at Y..." — this is what makes it feel like a course, not isolated lessons.
Parallel scene generation — scenes within an episode are independent once the course plan is fixed. Run them concurrently with asyncio.gather, up to 4 at once. This brings a 10-scene episode from ~8 minutes generation time to ~2 minutes.
Job progress — the frontend polls GET /api/jobs/:jobId and shows real progress per scene: "Scene 3 of 8 — generating narration..." Students waiting for their course to build need to see something alive.
Scene approval flow — after the course outline is generated, show it to the user. Let them edit scene titles, remove scenes, or regenerate a single scene before full generation starts. This is a feature Udemy course creators would love.
Done when: A full 5–10 minute episode with 4–6 scenes generates, each scene transitions smoothly, and a student can watch it start to finish feeling genuine educational flow.

Phase 5 — Source Grounding (Week 5)
This is what separates Forever from hallucinating AI tutors. Every factual claim must be traceable.
Ingestion pipeline:
pythonasync def ingest_pdf(file: bytes, course_id: str) -> SourcePack:
    # 1. Extract text + tables + figures with PyMuPDF
    # 2. Chunk by paragraph/section with 150 token overlap
    # 3. Embed each chunk with text-embedding-3-small
    # 4. Store in source_chunks table with pgvector embedding column
    # 5. Return SourcePack with chunk references
During scene generation, the SourceEvidence stage does a semantic search:
pythonasync def retrieve_evidence(claim: str, course_id: str, k=3) -> list[SourceChunk]:
    claim_embedding = await embed(claim)
    return await db.query("""
        SELECT * FROM source_chunks 
        WHERE course_id = $1
        ORDER BY embedding <=> $2
        LIMIT $3
    """, course_id, claim_embedding, k)
The GroundingReviewer checks: does the retrieved chunk actually support the claim? If not, it flags the claim and the Repair agent either finds better evidence or softens the claim language.
The Source Proof sidebar in the frontend shows the exact chunk, page number, and a relevance score when the student clicks "Show source" on any part of the board.
Done when: Every scene shows source citations. Clicking a notebook note highlights the source chunk it came from.

Phase 6 — Multi-Episode Course Series (Week 5–6)
Scale from one episode to a full course series from a PDF.
The Course Planner agent reads the entire SourcePack and produces a course outline: N episodes in a specific dependency order where Episode 3 builds on Episode 2. For a 50-page PDF this might be 8–12 episodes.
New components:

Course sidebar showing all episodes with completion status
Inter-episode continuity: each episode's intro references what was taught before
Course-level notebook: aggregate notebook from all episodes, exportable as PDF
Resume: the student can close the browser and return to exactly where they left off (save sceneId + currentMs to the database every 5 seconds)

Done when: A 40-page PDF generates a 6-episode course. A student can start Episode 1, come back the next day, and resume from exactly where they left.

Phase 7 — Polish + Production (Week 6–7)
These details are the difference between a demo and a real product:
The avatar/teacher panel: Use a Lottie animation of a simple illustrated teacher figure. It should have 4 states: talking (looped lip movement), thinking (pause), pointing (arm raised), and idle. Switch between states based on current timelineAction.type. This alone adds enormous "human feel." Lottie is lightweight and the animation files are small.
Quiz implementation: When a quiz timelineAction fires, the audio pauses. The quiz card appears. The student must answer before the lesson continues. The answer is saved to their notebook. After answering, audio resumes from exactly where it paused.
PDF notebook export: After any episode, the student can export their saved notebook as a PDF. Use pdfplumber or reportlab on the backend. Each notebook page shows key notes, the source reference, and a timestamp of when in the lesson that note was generated.
MediaRecorder export: Optionally let the student record their session as a video file. The browser's MediaRecorder API captures the canvas + audio stream. This requires zero server-side video rendering — the browser does it.
Rate limiting + caching: Cache TTS audio by content hash so the same sentence never gets synthesized twice. Cache scene manifests so re-watching an episode doesn't regenerate anything.

The three things that will kill the product if ignored
1. The timestamp reconciler must run. If you skip it and use estimated timestamps from the AI, the board content will visibly lag behind or run ahead of the voice. Students will notice immediately. This single bug destroys the "feels like a video" experience completely.
2. The region system must be enforced. If the Visual Director is allowed to produce raw coordinates, you will spend weeks debugging overlapping text and content that goes off-screen for specific inputs. The region system is the contract between AI and renderer — enforce it strictly in the Pydantic model.
3. No setTimeout for visual timing. This will drift. On a slow device or a long scene, a setTimeout set at page load will be 200–400ms out of sync by the time the scene ends. Everything goes through audioContext.currentTime. This is the rule.
Follow these seven phases, enforce these three rules, and Forever will feel like a real human instructor course — not a demo.
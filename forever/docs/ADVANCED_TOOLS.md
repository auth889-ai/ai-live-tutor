# Forever — Advanced Tools & Multimodal Ingestion (the missing power layer)

You're right: Forever is text-only and blind to images. Giant production course/RAG systems
are multimodal — they parse PDFs WITH their images/tables, SEE the figures, fetch real
images for topics, and ingest web/YouTube. This doc names every advanced tool, chosen from
research (MinerU/Docling/LlamaParse comparisons, multimodal-RAG, Qwen native tools, image
APIs), and the design that ties them together. Decisions first — then built one slice at a time.

## What "advanced tools" giant projects actually use (researched)

### 1. PDF → structured text + IMAGES + tables
- **MinerU** (OpenDataLab / Shanghai AI Lab) — most-starred, production-grade, extracts text,
  tables, AND figures; Markdown+JSON; built for agentic workflows; aligns with the Qwen/Alibaba
  ecosystem. **We already have a MinerU key** (from the old project). → PRIMARY PDF parser.
- **pdftocairo/pdftoppm** page-image rendering (from the old server) → one full-page PNG per
  page so the vision model can SEE the whole page. → Runs alongside MinerU.
- (Alternatives noted: Docling for table-heavy, LlamaParse for embedded images — fallbacks.)

### 2. SEE and explain images inside the source (the key one you named)
- **qwen3.7-plus multimodal vision** (already available, 1M context) reads page images + each
  extracted figure → produces: transcription, what the diagram MEANS, every arrow/box/relation,
  a teachingNote, bbox. So when a PDF has a diagram, the tutor teaches FROM the real image
  (shown on the board via the FULL-PAGE overlay rule), not from guessed text.
- This is the old server's proven Vision pass (VisionAgent) — port it to qwen3.7-plus.

### 3. Website / URL
- **Qwen built-in `web_extractor`** (Responses API — native, no extra key) → clean article text.
  Jina Reader as fallback.

### 4. YouTube
- Transcript fetch (timedtext) → chunks with timestamp source refs. Optional: sample keyframes
  → vision for on-screen diagrams/code.

### 5. Bare topic (no source)
- **Qwen built-in `web_search` + `web_extractor`** (native) → Researcher builds a CITED
  multimodal SourcePack so grounding still holds.

### 6. Fetch REAL images for a topic (you asked for this)
- **Qwen native `t2i_search` / `i2i_search`** (built-in tools, in-ecosystem) → find real images
  for a concept. **Unsplash API** (free 50/hr) as fallback for photos.
- Research nuance: for teaching, generated DIAGRAMS usually beat stock photos (knowledge
  visualization > generic images). So: diagrams for concepts, real images only when a real
  photo genuinely helps ("this is an actual chloroplast"). Board can show either.

### 7. Other advanced tools already in hand
- **Qwen `code_interpreter`** (native) for quick numeric checks; Docker/Judge0 for real runs.
- **Explicit prompt cache** — cache the SourcePack prefix across a lesson's scene agents (5-10× cost cut).

## The design: one multimodal ingestion layer

```
Input (pdf | url | youtube | code | topic | text)
  -> adapter (MinerU+page-images | web_extractor | transcript | web_search)
  -> MULTIMODAL SourcePack:
       chunks[]  (text, sourceRef)
       assets[]  (imageId, pngPath, page, bbox, kind: figure|page|table|web)
       + vision pass (qwen3.7-plus) enriches each asset: meaning, relations, teachingNote
  -> Archivist embeds text + image captions (pgvector)
  -> Teacher/Board Director can now place an IMAGE board object (real figure) and teach from it
```

Key upgrades this unlocks:
- **Image board objects** — a new renderHint `image` (already in RENDER_HINTS) that shows a real
  figure from the PDF/web, with the tutor pointing at parts of it (bbox overlay).
- **Multimodal grounding** — a claim can cite an image asset, not just text.
- **Vision-first** — diagram-only PDF pages become real teachable evidence.

## Advanced tools — gap list (add to GAP_ANALYSIS)
T1 MinerU PDF parse (have key)  ·  T2 page-image render (pdftocairo)  ·  T3 qwen3.7-plus vision
pass  ·  T4 web_extractor URL  ·  T5 YouTube transcript(+keyframes)  ·  T6 web_search topic
Researcher  ·  T7 t2i_search/Unsplash topic images  ·  T8 image board object + multimodal
grounding  ·  T9 code_interpreter  ·  T10 explicit prompt cache.

## Where this fits the build order
This is **Wave 2 expanded** (the "giant course" wave) — but the MULTIMODAL part (PDF images +
vision + image board objects) is what makes it feel like a real course built from real material,
not text. Recommended sequence within the ingestion wave:
1. PDF text+images via MinerU + page-image render.  2. qwen3.7-plus vision pass (SEE figures).
3. Image board object + FULL-PAGE overlay (show the real figure, tutor points).  4. URL + YouTube
+ topic (web_search/web_extractor).  5. Topic image fetch (t2i_search/Unsplash).

All-Qwen/Alibaba where possible (web_search, web_extractor, t2i_search, vision, code_interpreter,
cache are native), MinerU + ElevenLabs + Unsplash as supporting services from the Alibaba backend.

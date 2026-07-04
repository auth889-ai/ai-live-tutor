# Forever

Forever is a source-grounded human tutor course player.

The product goal is to turn user learning material into a Udemy/Coursera-style interactive lesson: tutor narration, notebook/whiteboard actions, code dry-runs, source proof, quizzes, and saved notes.

Current build rule:

```text
No fake generation. No hardcoded final demo. Build one real slice at a time.
```

## Current Slice

Phase 0 starts with real source ingestion for plain text.

```text
User text -> SourcePack -> chunks -> source refs
```

PDF, image OCR, website URL, YouTube transcript, code sandbox, Qwen scene generation, and playback are later slices. Until implemented, those inputs must fail clearly instead of producing fake output.

## Run Tests

```bash
cd forever
python3 -m unittest discover -s apps/api/tests
```


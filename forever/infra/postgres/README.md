# PostgreSQL + pgvector

Forever uses PostgreSQL for relational course/session state and pgvector for semantic search over source chunks.

Core tables planned:

```text
courses
course_sources
source_chunks
source_embeddings
learning_units
episodes
scenes
timeline_manifests
voice_lines
board_actions
source_evidence
generation_jobs
progress_events
learner_memory
```

`source_embeddings.embedding` should use `vector(1536)` or the selected Qwen embedding dimension.


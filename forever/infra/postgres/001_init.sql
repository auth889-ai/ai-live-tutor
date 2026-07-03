CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS courses (
  course_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_chunks (
  chunk_id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(course_id),
  source_id TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  text TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS source_embeddings (
  chunk_id TEXT PRIMARY KEY REFERENCES source_chunks(chunk_id),
  embedding vector(1536)
);

CREATE TABLE IF NOT EXISTS timeline_manifests (
  scene_id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(course_id),
  manifest JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS progress_events (
  event_id BIGSERIAL PRIMARY KEY,
  course_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


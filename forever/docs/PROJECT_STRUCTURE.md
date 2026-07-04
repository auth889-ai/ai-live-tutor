# Project Structure

```text
forever/
  apps/
    api/
      src/forever_api/
        agents/             multi-agent specs and registry
        generation/         deterministic and Qwen generation pipelines
        messaging/          event contracts and publishers
        modules/            focused generation stages
        orchestration/      LangGraph state and graph boundary
        queues/             Celery/Redis worker boundary
        qwen/               Qwen Cloud client
        schemas/            API and manifest contracts
        semantic_search/    pgvector retrieval boundary
        storage/            persistence boundary
      tests/
        unit/
        integration/
        fixtures/
    realtime/
      src/                  BullMQ websocket gateway boundary
    web/
      src/
        components/
          course/           course-platform shell, sidebar, header, builder surface
          player/           audio-clock lesson player, board, media, subtitles, proof
        data/               local demo manifest
        domain/             timeline helpers
        lib/                API and clock utilities
      tests/
  e2e/
    pages/
    tests/
    fixtures/
  infra/
    alibaba-cloud/
    postgres/
    redis/
  packages/
    contracts/
  docs/
```

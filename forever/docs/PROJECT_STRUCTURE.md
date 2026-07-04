# Project Structure

```text
forever/
  apps/
    api/                 backend app
      requirements.txt   backend runtime dependencies
      src/forever_api/
        main.py          FastAPI app entrypoint
        contracts/       layout, manifest, and timing rules
        ingestion/       SourcePack creation from user material
        routers/         dependency-free route behavior
        services/        service wrappers around backend flows
      tests/             backend tests
    web/                 frontend app, intentionally empty until first UI slice
      src/
  docs/
    ARCHITECTURE.md
    BUILD_PHASES.md
    PROJECT_STRUCTURE.md
  e2e/                   future browser tests
```

Rule:

```text
Do not add duplicate folders for the same purpose.
Do not add fake static product code.
Each file must own one clear responsibility.
```

Current reality:

```text
backend slice exists: SourcePack ingestion for text
frontend slice is reserved
```

# Project Structure

```text
forever/
  apps/
    api/                 backend app
      src/forever_api/
        ingestion/       SourcePack creation from user material
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

# Forever Realtime Gateway

Node/TypeScript boundary for BullMQ and websocket fanout.

This service is optional for the first playable slice, but it is part of the production architecture:

```text
FastAPI/Celery publishes progress events
  -> Redis
  -> BullMQ Realtime Gateway
  -> WebSocket clients
  -> Tutor player appends scene-ready events
```

Celery remains the Python generation worker. BullMQ exists to make UI event delivery and frontend-facing job state clean.

## Planned Responsibilities

- subscribe to Redis/BullMQ generation events
- expose `WS /ws/sessions/:sessionId`
- buffer latest course progress per session
- fan out `SCENE_READY`, `COURSE_PROGRESS`, and `REVIEW_FAILED`
- keep frontend independent from Python worker internals


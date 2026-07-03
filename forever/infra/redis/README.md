# Redis

Redis is used by two layers:

- Celery broker/result backend for Python generation jobs.
- BullMQ event stream for the realtime gateway.

Local default:

```env
REDIS_URL=redis://localhost:6379/0
```


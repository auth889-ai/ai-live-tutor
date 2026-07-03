from __future__ import annotations

import os

try:
    from celery import Celery
except Exception:  # pragma: no cover
    Celery = None  # type: ignore


REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


def create_celery_app():
    if Celery is None:
        return None
    return Celery(
        "forever",
        broker=REDIS_URL,
        backend=REDIS_URL,
        include=["forever_api.queues.tasks"],
    )


celery_app = create_celery_app()


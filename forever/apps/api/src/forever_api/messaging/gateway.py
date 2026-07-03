from __future__ import annotations

from forever_api.messaging.events import ForeverEvent


class EventPublisher:
    async def publish(self, event: ForeverEvent) -> None:
        raise NotImplementedError


class InMemoryEventPublisher(EventPublisher):
    def __init__(self) -> None:
        self.events: list[ForeverEvent] = []

    async def publish(self, event: ForeverEvent) -> None:
        self.events.append(event)


event_publisher = InMemoryEventPublisher()


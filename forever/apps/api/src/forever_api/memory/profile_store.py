from __future__ import annotations


class LearnerMemoryStore:
    """
    Track 1-compatible extension point.

    Stores durable learner preferences, misconceptions, pace, and prior quiz
    results. The Agent Society track can still use this for personalization.
    """

    async def remember(self, user_id: str, key: str, value: dict) -> None:
        raise NotImplementedError("Phase 4: persist learner memory")

    async def recall(self, user_id: str, query: str) -> list[dict]:
        raise NotImplementedError("Phase 4: retrieve learner memory")


from __future__ import annotations


class MemoryStore:
    def __init__(self) -> None:
        self.courses: dict[str, dict] = {}
        self.scenes: dict[str, dict] = {}

    def save_course(self, course: dict, manifest: dict) -> None:
        self.courses[course["courseId"]] = course
        self.scenes[manifest["sceneId"]] = manifest

    def get_scene(self, scene_id: str) -> dict | None:
        return self.scenes.get(scene_id)


store = MemoryStore()


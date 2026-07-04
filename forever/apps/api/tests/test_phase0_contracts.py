import unittest

from forever_api.contracts import (
    LAYOUT_REGIONS,
    NotebookPage,
    SourceEvidence,
    SubtitleWord,
    TeachingScreenManifest,
    TimelineAction,
    VisualObject,
    VoiceLine,
    WordTimestamp,
    elapsed_ms,
    validate_teaching_screen_manifest,
)


class Phase0ContractTests(unittest.TestCase):
    def test_layout_regions_use_named_regions(self):
        self.assertIn("teacher_notebook", LAYOUT_REGIONS)
        self.assertIn("notebook_body", LAYOUT_REGIONS["teacher_notebook"])
        self.assertIn("pointer_zone", LAYOUT_REGIONS["teacher_code_dryrun"])

    def test_teaching_screen_manifest_validates_named_regions(self):
        manifest = TeachingScreenManifest(
            sceneId="scene_001",
            layout="teacher_notebook",
            durationMs=12000,
            voiceLines=[
                VoiceLine(
                    id="voice_001",
                    text="The outer loop counts rows.",
                    startMs=0,
                    endMs=2000,
                    wordTimestamps=[WordTimestamp(word="The", startMs=0, endMs=100)],
                )
            ],
            visualObjects=[
                VisualObject(id="note_001", region="notebook_body", kind="text", text="Outer loop -> rows"),
            ],
            timelineActions=[
                TimelineAction(
                    id="action_001",
                    type="write_text",
                    targetObjectId="note_001",
                    region="notebook_body",
                    lineNumber=0,
                    startMs=100,
                    endMs=900,
                )
            ],
            subtitles=[SubtitleWord(word="outer", startMs=100, endMs=300, beatId="beat_001")],
            sourceEvidence=[SourceEvidence(sourceId="src_001", sourceRef="User text", quote="Outer loop counts rows.")],
            notebookPage=NotebookPage(title="Rows and columns", keyNotes=["Outer loop counts rows"], sourceRefs=["User text"]),
        )

        validate_teaching_screen_manifest(manifest)

    def test_audio_clock_elapsed_ms(self):
        self.assertEqual(elapsed_ms(3.5, 1.0), 2500)


if __name__ == "__main__":
    unittest.main()


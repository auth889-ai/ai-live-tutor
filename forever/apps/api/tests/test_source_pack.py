import unittest

from forever_api.ingestion.source_pack import SourcePackError, build_source_pack


class SourcePackTests(unittest.TestCase):
    def test_text_input_builds_source_pack_with_chunks(self):
        source_pack = build_source_pack(
            input_type="text",
            text=(
                "Nested loops are useful for pattern printing. "
                "The outer loop controls rows. "
                "The inner loop controls columns and decides what appears in each row."
            ),
        )

        data = source_pack.to_dict()

        self.assertEqual(data["inputType"], "text")
        self.assertTrue(data["sourcePackId"].startswith("sp_"))
        self.assertEqual(data["sources"][0]["sourceRef"], "User text")
        self.assertGreaterEqual(len(data["chunks"]), 1)
        self.assertIn("Nested", data["concepts"])

    def test_unimplemented_input_type_fails_honestly(self):
        with self.assertRaises(SourcePackError):
            build_source_pack(input_type="pdf", text="/tmp/lesson.pdf")

    def test_short_text_is_rejected(self):
        with self.assertRaises(SourcePackError):
            build_source_pack(input_type="text", text="too short")


if __name__ == "__main__":
    unittest.main()


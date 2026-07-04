import unittest

from forever_api.services.source_pack_service import (
    create_source_pack_response,
    create_source_pack_response_or_error,
)


class SourcePackServiceTests(unittest.TestCase):
    def test_service_wraps_source_pack_in_response(self):
        response = create_source_pack_response(
            input_type="text",
            text=(
                "Nested loops teach how rows and columns work together. "
                "The outer loop counts rows. "
                "The inner loop prints the columns inside each row."
            ),
        )

        self.assertEqual(response["status"], "ready")
        self.assertEqual(response["sourcePack"]["inputType"], "text")
        self.assertTrue(response["sourcePack"]["chunks"])
        self.assertEqual(response["sourcePack"]["sources"][0]["sourceRef"], "User text")

    def test_service_returns_clear_error_for_unsupported_input(self):
        response = create_source_pack_response_or_error(input_type="pdf", text="/tmp/lesson.pdf")

        self.assertEqual(response["status"], "error")
        self.assertIn("not implemented yet", response["error"])


if __name__ == "__main__":
    unittest.main()

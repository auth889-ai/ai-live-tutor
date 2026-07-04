import unittest

from forever_api.routers.source_packs import create_source_pack_endpoint


class SourcePackApiTests(unittest.TestCase):
    def test_create_source_pack_endpoint_returns_ready_response(self):
        status_code, body = create_source_pack_endpoint(
            {
                "inputType": "text",
                "text": (
                    "Nested loops use one loop for rows and another loop for columns. "
                    "This creates a structured pattern where each row can print a different number of items."
                ),
            }
        )

        self.assertEqual(status_code, 200)
        self.assertEqual(body["status"], "ready")
        self.assertEqual(body["sourcePack"]["inputType"], "text")
        self.assertTrue(body["sourcePack"]["chunks"])

    def test_create_source_pack_endpoint_rejects_missing_input_type(self):
        status_code, body = create_source_pack_endpoint({"text": "This is a valid length text but no input type."})

        self.assertEqual(status_code, 422)
        self.assertEqual(body["status"], "error")
        self.assertIn("inputType", body["error"])

    def test_create_source_pack_endpoint_rejects_unimplemented_adapter(self):
        status_code, body = create_source_pack_endpoint({"inputType": "pdf", "text": "/tmp/lesson.pdf"})

        self.assertEqual(status_code, 422)
        self.assertEqual(body["status"], "error")
        self.assertIn("not implemented yet", body["error"])


if __name__ == "__main__":
    unittest.main()

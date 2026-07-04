import unittest


try:
    from fastapi.testclient import TestClient

    from forever_api.main import app
except ModuleNotFoundError:
    TestClient = None
    app = None


@unittest.skipIf(TestClient is None, "FastAPI is not installed")
class MainHttpTests(unittest.TestCase):
    def test_health(self):
        response = TestClient(app).get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["ok"], True)

    def test_create_source_pack_http_route(self):
        response = TestClient(app).post(
            "/api/source-packs",
            json={
                "inputType": "text",
                "text": (
                    "Nested loops use one loop for rows and another loop for columns. "
                    "The outer loop chooses the row and the inner loop prints values."
                ),
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ready")


if __name__ == "__main__":
    unittest.main()


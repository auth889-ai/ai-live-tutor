from __future__ import annotations

import httpx

from forever_api.settings import settings


class QwenClientError(RuntimeError):
    pass


class QwenClient:
    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
    ) -> None:
        self.api_key = api_key if api_key is not None else settings.qwen_api_key
        self.base_url = (base_url or settings.qwen_base_url).rstrip("/")
        self.model = model or settings.qwen_model

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.base_url and self.model)

    async def chat_json(self, system: str, user: str) -> str:
        if not self.configured:
            raise QwenClientError("DASHSCOPE_API_KEY is not configured")

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
        }
        headers = {"Authorization": f"Bearer {self.api_key}"}

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload,
            )

        if response.status_code >= 400:
            raise QwenClientError(response.text[:500])

        data = response.json()
        return data["choices"][0]["message"]["content"]

    async def health(self) -> dict:
        if not self.configured:
            return {"ok": False, "configured": False, "reason": "missing DASHSCOPE_API_KEY"}

        try:
            content = await self.chat_json(
                "Return compact JSON only.",
                '{"ping":"forever"} -> return {"ok":true,"provider":"qwen-cloud"}',
            )
            return {
                "ok": True,
                "configured": True,
                "model": self.model,
                "baseUrl": self.base_url,
                "sample": content[:180],
            }
        except Exception as exc:
            return {
                "ok": False,
                "configured": True,
                "model": self.model,
                "baseUrl": self.base_url,
                "reason": str(exc)[:300],
            }


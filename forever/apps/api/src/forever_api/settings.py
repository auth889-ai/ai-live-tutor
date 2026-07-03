from __future__ import annotations

import os
from dataclasses import dataclass

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    pass


@dataclass(frozen=True)
class Settings:
    qwen_api_key: str = os.getenv("DASHSCOPE_API_KEY", "")
    qwen_base_url: str = os.getenv(
        "QWEN_BASE_URL",
        "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
    ).rstrip("/")
    qwen_model: str = os.getenv("QWEN_MODEL", "qwen-plus")


settings = Settings()


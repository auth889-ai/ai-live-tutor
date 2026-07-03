"""
Devpost Alibaba Cloud proof helper.

Run this from the deployed backend environment to prove the project can call
Qwen through Alibaba Cloud Model Studio's OpenAI-compatible API.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request


def main() -> None:
    api_key = os.getenv("DASHSCOPE_API_KEY", "")
    base_url = os.getenv("QWEN_BASE_URL", "https://dashscope-us.aliyuncs.com/compatible-mode/v1").rstrip("/")
    model = os.getenv("QWEN_MODEL", "qwen-plus")

    if not api_key:
        raise SystemExit("DASHSCOPE_API_KEY is missing")

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "Return compact JSON only."},
            {"role": "user", "content": 'Return {"ok":true,"service":"forever","cloud":"alibaba-qwen"}'},
        ],
        "temperature": 0.2,
    }
    request = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            print(response.read().decode("utf-8")[:1000])
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Qwen healthcheck failed: {exc.code} {body[:500]}") from exc


if __name__ == "__main__":
    main()


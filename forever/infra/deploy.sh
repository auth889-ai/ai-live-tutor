#!/usr/bin/env bash
# One-command deploy for Forever on an Alibaba Cloud ECS box.
# Builds the image and (re)starts web + worker + redis + mongo. Run from forever/.
set -euo pipefail

cd "$(dirname "$0")/.."   # -> forever/

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Run: cp .env.example .env  and fill DASHSCOPE_API_KEY + SESSION_SECRET" >&2
  exit 1
fi

echo "==> Building and starting containers…"
docker compose up -d --build

echo "==> Waiting for the web health check…"
for i in $(seq 1 30); do
  if curl -fsS http://localhost:3000/api/health >/dev/null 2>&1; then
    echo "==> Forever is up: http://localhost:3000  (open port 3000 in your ECS security group)"
    docker compose ps
    exit 0
  fi
  sleep 3
done

echo "WARN: health check did not pass in time — check logs: docker compose logs -f web worker" >&2
docker compose ps

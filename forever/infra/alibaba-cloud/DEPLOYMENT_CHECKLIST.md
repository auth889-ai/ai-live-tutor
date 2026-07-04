# Alibaba Cloud Deployment Checklist

Alibaba Cloud deployment is mandatory for the Qwen hackathon.

## Required Environment

```env
DASHSCOPE_API_KEY=...
QWEN_BASE_URL=...
QWEN_MODEL=qwen-plus
REDIS_URL=...
DATABASE_URL=...
```

## Required Endpoints

```text
GET /health
GET /api/qwen/health
GET /api/architecture/graph
GET /api/architecture/agent-contracts
POST /api/courses/start
```

## Proof Recording Must Show

```text
1. Alibaba Cloud console or deployment terminal.
2. Backend service running on Alibaba Cloud.
3. Deployed /health response.
4. Deployed /api/qwen/health response.
5. Code file proving Qwen/Alibaba usage:
   infra/alibaba-cloud/qwen_cloud_healthcheck.py
```

## Submission Gate

Do not submit until:

```text
Alibaba backend URL is live.
Qwen health works from deployed backend.
Proof recording is uploaded.
Devpost text includes deployment proof link.
```


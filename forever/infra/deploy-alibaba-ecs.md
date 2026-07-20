# Deploy Forever on Alibaba Cloud ECS

This is the exact runbook to get Forever running on **Alibaba Cloud** — the Next.js web app +
the BullMQ agent-society worker, with all model calls going to **Qwen Cloud (DashScope / Model
Studio)**. Total time ≈ 20–30 minutes.

> **Deployment proof (submission requirement).** Every model call is made to an Alibaba Cloud
> service — Model Studio / DashScope — through one client:
> [`lib/qwen/client.js`](../lib/qwen/client.js) (endpoint
> `dashscope-intl.aliyuncs.com/compatible-mode/v1`) and the vision client
> [`lib/qwen/vision.js`](../lib/qwen/vision.js). Media/persistence use the Alibaba seams in
> [`lib/storage/`](../lib/storage/). This file + the running ECS instance are the deployment proof.

---

## 1. Create the ECS instance

Alibaba Cloud console → **ECS → Instances → Create Instance**:

- **Image:** Ubuntu 22.04 LTS (x86_64)
- **Type:** `ecs.g7.large` (2 vCPU / 8 GiB) or larger — the worker + Docker builds want headroom
- **System disk:** 40 GiB ESSD
- **Public IP:** assign one (or bind an EIP)
- **Security group — open inbound:** `22` (SSH), `3000` (the app). Keep Redis/Mongo closed.

SSH in:

```bash
ssh root@<your-ecs-public-ip>
```

## 2. Install Docker + Compose

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker compose version   # should print v2.x
```

## 3. Get the code and configure secrets

```bash
git clone https://github.com/auth889-ai/ai-live-tutor.git
cd ai-live-tutor/forever
cp .env.example .env
nano .env    # fill the values below
```

Minimum `.env` for a live deploy:

```ini
DASHSCOPE_API_KEY=sk-...            # your Qwen Cloud / Model Studio key
SESSION_SECRET=<long-random-string>
# REDIS_URL and MONGODB_URI are injected by docker-compose for the bundled services.
# To use Alibaba managed services instead, set them here and remove the redis/mongo
# service blocks from docker-compose.yml:
#   REDIS_URL=redis://<tair-endpoint>:6379
#   MONGODB_URI=mongodb://<user>:<pass>@<apsaradb-endpoint>:3717/forever
```

## 4. Launch (one command)

```bash
./infra/deploy.sh
```

That builds the image and starts **web + worker + redis + mongo**. Verify:

```bash
docker compose ps
curl -s http://localhost:3000/api/health
```

Open `http://<your-ecs-public-ip>:3000` — create an account, go to **Studio**, paste material,
and watch the agent society build a course. The worker logs show the faculty running:

```bash
docker compose logs -f worker
```

## 5. (Recommended) Managed Alibaba services for production

- **ApsaraDB for MongoDB** → set `MONGODB_URI`, drop the `mongo` service.
- **Tair (Redis)** → set `REDIS_URL`, drop the `redis` service.
- **OSS** → store audio/page-images; wire behind [`lib/storage/`](../lib/storage/).
- **SLB + HTTPS** → put an Application Load Balancer / CDN in front of `:3000`.

## 6. Update to a new version

```bash
cd ~/ai-live-tutor && git pull && cd forever && ./infra/deploy.sh
```

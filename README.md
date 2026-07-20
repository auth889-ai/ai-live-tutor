# Forever — an agent society that teaches like the best teacher you ever had

**Global AI Hackathon with Qwen Cloud · Track 3: Agent Society**
**License: AGPL-3.0 · All models on Qwen Cloud (DashScope / Alibaba Cloud Model Studio)**

> 👉 **The submission project lives in [`forever/`](forever/).** Start there — it has the full
> architecture diagram, the Track‑3 measurable‑gain benchmarks, run instructions, and the
> complete source. This root page is a map.

---

## What it is

Bring any material — a PDF with figures, a web article, notes, an image — and a **society of
Qwen agents** builds a real, taught course from it: a Dean outlines it, a Teacher/Coding
Instructor writes every explanation, a Board Director stages the screen, and independent
**critics negotiate** (a Grounding Auditor and a Pedagogy Critic object with evidence; an
Arbiter rules) so nothing unsupported ever ships. Algorithm animation is driven by an
**Execution Tracer that runs the real code** — never LLM‑imagined frames.

## Track 3: Agent Society — how it maps

- **Task division** — every agent has one job, one file under
  [`forever/lib/orchestration/agents/`](forever/lib/orchestration/agents/) (router, dean,
  instructor, board director, execution tracer, code runner, voice writer, grounding auditor,
  pedagogy critic, arbiter).
- **Dialogue & negotiation** — the Board Director proposes; the Auditor and Critic object with
  cited evidence; the board revises; a **bounded debate** ends in an Arbiter verdict —
  grounded‑or‑dropped.
- **Conflict resolution** — structural: hand‑authored animation is stripped so the real trace
  owns motion; a dry‑run scene without a real trace refuses to ship.
- **Measurable gain vs single‑agent baseline** — [`forever/eval/`](forever/eval/): on N=4
  matched coding materials a single agent passes **0/4** the quality gate; the society passes
  **4/4** with 0 contract failures and 3–5× depth. Reproduce with
  `node --env-file=.env eval/society-vs-single.eval.mjs`.

## Qwen Cloud / Alibaba Cloud (deployment proof)

- **Every model call goes to Qwen Cloud (DashScope / Model Studio)** through one client:
  [`forever/lib/qwen/client.js`](forever/lib/qwen/client.js) — endpoint
  `dashscope-intl.aliyuncs.com/compatible-mode/v1` (qwen3.7‑max planners/judge, qwen3.7‑plus
  board/vision, qwen3.6‑flash routing/audit, qwen3‑coder‑plus tracer programs), plus the Qwen
  TTS adapter [`forever/lib/tts/providers/synthesize.js`](forever/lib/tts/providers/synthesize.js).
- Backend on **Alibaba Cloud ECS**; MongoDB (ApsaraDB‑compatible), Redis/BullMQ (Tair‑compatible),
  media to OSS behind the storage seams in [`forever/lib/storage/`](forever/lib/storage/).

## Run it

```bash
cd forever && npm install
cp .env.example .env        # set DASHSCOPE_API_KEY, MONGODB_URI, REDIS_URL, SESSION_SECRET
docker pull python:3.12-slim node:22-slim
npm run dev:all             # web (3000) + worker
npm test                    # 660+ tests, no tokens spent
```

Full documentation, architecture diagram, and repository map: **[`forever/README.md`](forever/README.md)**.

---

*This monorepo also contains earlier experiments and research; the hackathon submission is the
`forever/` project only.*

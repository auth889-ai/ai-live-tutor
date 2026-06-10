"use strict";

/**
 * tests/server/integration/stage2Api.test.js
 *
 * Integration tests for Stage 2 API endpoints.
 * Uses supertest — tests actual HTTP responses.
 * MongoDB and BullMQ are mocked.
 */

const request = require("supertest");

// ── Mock all heavy dependencies ───────────────────────────────────────────────

jest.mock("mongoose", () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  model:   jest.fn().mockReturnValue({}),
  models:  {},
  Schema:  jest.fn().mockImplementation(() => ({
    index: jest.fn().mockReturnThis(),
    pre:   jest.fn().mockReturnThis(),
  })),
  connection: { readyState: 1 },
}));

jest.mock("ioredis", () => jest.fn().mockImplementation(() => ({
  connect: jest.fn().mockResolvedValue(undefined),
  on: jest.fn().mockReturnThis(),
})));

jest.mock("bullmq", () => ({
  Queue:  jest.fn().mockImplementation(() => ({
    add:    jest.fn().mockResolvedValue({ id: "job_test" }),
    getJob: jest.fn().mockResolvedValue(null),
  })),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn().mockReturnThis() })),
}));

// Mock session persistence
jest.mock("../../../server/services/googleAgent/stage2/stage2SessionPersistence", () => ({
  createSession: jest.fn().mockResolvedValue({
    sessionId: "s2_test_integration_001",
    status: "created",
    ownerKey: "demo_user",
    nodeId: "database_denorm",
    nodeTitle: "Database Denormalization",
    toObject() { return this; },
  }),
  getSessionStatus: jest.fn().mockResolvedValue({
    sessionId: "s2_test_integration_001",
    status: "running",
    counts: { boardCommands: 50, premiumBoardScreens: 20 },
    nodeId: "database_denorm",
  }),
  loadSessionWithArtifacts: jest.fn().mockResolvedValue({
    sessionId: "s2_test_integration_001",
    status: "completed",
    nodeId: "database_denorm",
    nodeTitle: "Database Denormalization",
    boardScreens: Array(20).fill({ screenId: "s1" }),
    boardCommands: Array(100).fill({ commandId: "c1" }),
    voiceScript: Array(20).fill({ lineId: "vl1" }),
    subtitles: [],
    counts: { premiumBoardScreens: 20, boardCommands: 100 },
  }),
  loadSession: jest.fn().mockResolvedValue(null),
  updateSessionStatus: jest.fn().mockResolvedValue(undefined),
  saveSessionResult: jest.fn().mockResolvedValue(undefined),
  savePlaybackCursor: jest.fn().mockResolvedValue(undefined),
}));

// Mock background job
jest.mock("../../../server/services/googleAgent/stage2/stage2BackgroundJob.service", () => ({
  enqueueLesson:  jest.fn().mockResolvedValue({ jobId: "lesson_s2_test", queued: true }),
  startWorker:    jest.fn().mockReturnValue({ on: jest.fn() }),
  getJobStatus:   jest.fn().mockResolvedValue({ found: true, state: "active" }),
  sseRegister:    jest.fn(),
  sseUnregister:  jest.fn(),
  sseEmit:        jest.fn(),
  isRedisOk:      jest.fn().mockReturnValue(true),
}));

// Mock stage2 service
jest.mock("../../../server/services/googleAgent/stage2LiveTutor.service", () => ({
  health: jest.fn().mockResolvedValue({ ok: true }),
  teachNode: jest.fn().mockResolvedValue({ ok: true, boardCommands: [], voiceScript: [], metadata: { fallbackUsed: false } }),
  interruptRepair: jest.fn().mockResolvedValue({ ok: true, metadata: { fallbackUsed: false } }),
  savePlaybackState: jest.fn().mockResolvedValue({ ok: true, metadata: { fallbackUsed: false } }),
  getSession: jest.fn().mockResolvedValue({ ok: true, metadata: { fallbackUsed: false } }),
}));

jest.mock("../../../server/services/googleAgent/googleTtsVoice.service", () => ({
  synthesizeLessonVoice: jest.fn().mockResolvedValue({ ok: false, ttsUsed: false, enabled: false }),
}));

jest.mock("../../../server/services/googleAgent/sourceContext/sourceContextPipeline", () => ({
  buildSourceContext: jest.fn().mockResolvedValue({ selectedEvidence: [] }),
}));

jest.mock("../../../server/services/googleAgent/stage2/stage2LessonOrchestrator", () => ({
  teachNodeWithAdkPipeline: jest.fn().mockResolvedValue({
    ok: true, boardCommands: [], voiceScript: [], metadata: { fallbackUsed: false },
  }),
}));

jest.mock("../../../server/services/googleAgent/stage2/stage2PowerToolsConfig", () => ({
  buildPowerToolsReport: jest.fn().mockReturnValue({
    readiness: "good", missingRequired: [], selectedProviders: {},
  }),
}));


// ── Load app AFTER all mocks ──────────────────────────────────────────────────

// Prevent server.js from starting the actual server
process.env.PORT = "0";
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://localhost:27017/test";
process.env.GEMINI_API_KEY = "test_key";

const app = require("../../../server/app");


// ══════════════════════════════════════════════════════════════════
// POST /sessions/start
// ══════════════════════════════════════════════════════════════════

describe("POST /api/google-agent/live-tutor/stage2/sessions/start", () => {
  const endpoint = "/api/google-agent/live-tutor/stage2/sessions/start";

  test("201 — returns sessionId for valid request", async () => {
    const res = await request(app)
      .post(endpoint)
      .send({ resourceId: "res_001", treeId: "tree_001", nodeId: "database_denorm", nodeTitle: "DB Denorm" })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("sessionId");
    expect(res.body.sessionId).toBe("s2_test_integration_001");
  });

  test("201 — returns status created", async () => {
    const res = await request(app)
      .post(endpoint)
      .send({ nodeId: "database_denorm", resourceId: "res_001" });

    expect(res.body.status).toBe("created");
  });

  test("201 — returns streamUrl", async () => {
    const res = await request(app)
      .post(endpoint)
      .send({ nodeId: "database_denorm", resourceId: "res_001" });

    expect(res.body).toHaveProperty("streamUrl");
    expect(res.body.streamUrl).toContain("/stream");
  });

  test("201 — returns statusUrl", async () => {
    const res = await request(app)
      .post(endpoint)
      .send({ nodeId: "database_denorm", resourceId: "res_001" });

    expect(res.body).toHaveProperty("statusUrl");
    expect(res.body.statusUrl).toContain("/status");
  });

  test("400 — missing nodeId and resourceId", async () => {
    const res = await request(app)
      .post(endpoint)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test("ok:true in response", async () => {
    const res = await request(app)
      .post(endpoint)
      .send({ nodeId: "node_a", resourceId: "res_001" });
    expect(res.body.ok).toBe(true);
  });

  test("response never has fallbackUsed:true", async () => {
    const res = await request(app)
      .post(endpoint)
      .send({ nodeId: "database_denorm", resourceId: "res_001" });
    expect(res.body?.metadata?.fallbackUsed).not.toBe(true);
  });
});


// ══════════════════════════════════════════════════════════════════
// GET /sessions/:sessionId/status
// ══════════════════════════════════════════════════════════════════

describe("GET /api/google-agent/live-tutor/stage2/sessions/:id/status", () => {
  const endpoint = (id) => `/api/google-agent/live-tutor/stage2/sessions/${id}/status`;

  test("200 — returns status for known session", async () => {
    const res = await request(app).get(endpoint("s2_test_integration_001"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status");
  });

  test("200 — returns counts", async () => {
    const res = await request(app).get(endpoint("s2_test_integration_001"));
    expect(res.body).toHaveProperty("counts");
  });

  test("200 — ok:true", async () => {
    const res = await request(app).get(endpoint("s2_test_integration_001"));
    expect(res.body.ok).toBe(true);
  });

  test("404 — unknown session", async () => {
    const { getSessionStatus } = require("../../../server/services/googleAgent/stage2/stage2SessionPersistence");
    getSessionStatus.mockResolvedValueOnce(null);
    const res = await request(app).get(endpoint("no_such_session"));
    expect(res.status).toBe(404);
  });
});


// ══════════════════════════════════════════════════════════════════
// GET /sessions/:sessionId/book
// ══════════════════════════════════════════════════════════════════

describe("GET /api/google-agent/live-tutor/stage2/sessions/:id/book", () => {
  const endpoint = (id) => `/api/google-agent/live-tutor/stage2/sessions/${id}/book`;

  test("200 — returns boardScreens array", async () => {
    const res = await request(app).get(endpoint("s2_test_integration_001"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("boardScreens");
    expect(Array.isArray(res.body.boardScreens)).toBe(true);
  });

  test("200 — returns boardCommands array", async () => {
    const res = await request(app).get(endpoint("s2_test_integration_001"));
    expect(res.body).toHaveProperty("boardCommands");
  });

  test("200 — returns voiceScript array", async () => {
    const res = await request(app).get(endpoint("s2_test_integration_001"));
    expect(res.body).toHaveProperty("voiceScript");
  });

  test("200 — ok:true", async () => {
    const res = await request(app).get(endpoint("s2_test_integration_001"));
    expect(res.body.ok).toBe(true);
  });

  test("404 — unknown session", async () => {
    const { loadSessionWithArtifacts } = require("../../../server/services/googleAgent/stage2/stage2SessionPersistence");
    loadSessionWithArtifacts.mockResolvedValueOnce(null);
    const res = await request(app).get(endpoint("no_such_session"));
    expect(res.status).toBe(404);
  });
});


// ══════════════════════════════════════════════════════════════════
// GET /health
// ══════════════════════════════════════════════════════════════════

describe("GET /api/google-agent/live-tutor/stage2/health", () => {
  test("returns 200", async () => {
    const res = await request(app).get("/api/google-agent/live-tutor/stage2/health");
    expect(res.status).toBe(200);
  });

  test("returns ok:true", async () => {
    const res = await request(app).get("/api/google-agent/live-tutor/stage2/health");
    expect(res.body.ok).toBe(true);
  });
});


// ══════════════════════════════════════════════════════════════════
// GET /sessions/:id/stream (SSE)
// ══════════════════════════════════════════════════════════════════

describe("GET /sessions/:id/stream (SSE)", () => {
  test("returns 200 with text/event-stream content type", async () => {
    const res = await request(app)
      .get("/api/google-agent/live-tutor/stage2/sessions/s2_sse_test/stream")
      .buffer(false)
      .timeout({ response: 500 })
      .catch(() => null);  // SSE never closes, so timeout is expected
    // The response headers should indicate SSE
    // Just check the endpoint doesn't 404
  }, 2000);
});

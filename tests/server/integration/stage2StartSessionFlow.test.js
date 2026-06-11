"use strict";

const fs = require("fs");
const path = require("path");
const request = require("supertest");

const mockEnqueueLesson = jest.fn().mockResolvedValue({
  jobId: "lesson_s2_step1_001",
  jobName: "teach_node",
  bullJobId: "lesson_s2_step1_001",
  queued: true,
  queueName: "lumina_lesson_generation_stage2_v2",
  workerContractVersion: "stage2_source_truth_worker_v2",
});
const mockTeachNode = jest.fn().mockResolvedValue({ ok: true });
const mockTeachNodeWithAdkPipeline = jest.fn().mockResolvedValue({ ok: true });
const mockUpdateSessionStatus = jest.fn().mockResolvedValue(undefined);

jest.mock("mongoose", () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  model: jest.fn().mockReturnValue({}),
  models: {},
  Schema: jest.fn().mockImplementation(() => ({
    index: jest.fn().mockReturnThis(),
    pre: jest.fn().mockReturnThis(),
  })),
  connection: { readyState: 1 },
}));

jest.mock("ioredis", () => jest.fn().mockImplementation(() => ({
  connect: jest.fn().mockResolvedValue(undefined),
  on: jest.fn().mockReturnThis(),
})));

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: "job_test" }),
    getJob: jest.fn().mockResolvedValue(null),
  })),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn().mockReturnThis() })),
}));

jest.mock("../../../server/services/googleAgent/stage2/stage2SessionPersistence", () => ({
  createSession: jest.fn().mockResolvedValue({
    sessionId: "s2_step1_001",
    status: "created",
    ownerKey: "demo_user",
    nodeId: "node_click_start",
    nodeTitle: "Clicked Concept",
    toObject() { return this; },
  }),
  updateSessionStatus: mockUpdateSessionStatus,
  getSessionStatus: jest.fn().mockResolvedValue({
    sessionId: "s2_step1_001",
    status: "running",
    counts: {},
    nodeId: "node_click_start",
  }),
  loadSessionWithArtifacts: jest.fn().mockResolvedValue({
    sessionId: "s2_step1_001",
    status: "running",
    boardScreens: [],
    boardCommands: [],
    voiceScript: [],
    subtitles: [],
    counts: {},
  }),
  loadSessionSegment: jest.fn().mockResolvedValue(null),
  loadSession: jest.fn().mockResolvedValue(null),
  saveSessionResult: jest.fn().mockResolvedValue(undefined),
  savePlaybackCursor: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../../server/services/googleAgent/stage2/stage2BackgroundJob.service", () => ({
  enqueueLesson: mockEnqueueLesson,
  startWorker: jest.fn().mockReturnValue({ on: jest.fn() }),
  getJobStatus: jest.fn().mockResolvedValue({
    found: true,
    jobId: "lesson_s2_step1_001",
    state: "waiting",
    queueName: "lumina_lesson_generation_stage2_v2",
    workerContractVersion: "stage2_source_truth_worker_v2",
  }),
  sseRegister: jest.fn(),
  sseUnregister: jest.fn(),
  sseEmit: jest.fn(),
  isRedisOk: jest.fn().mockReturnValue(true),
}));

jest.mock("../../../server/services/googleAgent/stage2LiveTutor.service", () => ({
  health: jest.fn().mockResolvedValue({ ok: true }),
  teachNode: mockTeachNode,
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
  teachNodeWithAdkPipeline: mockTeachNodeWithAdkPipeline,
}));

jest.mock("../../../server/services/googleAgent/stage2/stage2PowerToolsConfig", () => ({
  buildPowerToolsReport: jest.fn().mockReturnValue({
    readiness: { minimumReady: true },
    missingRequired: [],
    selectedProviders: {},
  }),
}));

process.env.PORT = "0";
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = "mongodb://localhost:27017/test";
process.env.GEMINI_API_KEY = "test_key";

const app = require("../../../server/app");

describe("Step 1 node click starts a non-blocking tutor session", () => {
  const endpoint = "/api/google-agent/live-tutor/stage2/sessions/start";

  beforeEach(() => {
    mockEnqueueLesson.mockClear();
    mockTeachNode.mockClear();
    mockTeachNodeWithAdkPipeline.mockClear();
    mockUpdateSessionStatus.mockClear();
  });

  test("returns sessionId and BullMQ job proof immediately", async () => {
    const res = await request(app)
      .post(endpoint)
      .send({
        resourceId: "res_step1",
        treeId: "tree_step1",
        nodeId: "node_click_start",
        selectedNode: {
          nodeId: "node_click_start",
          title: "Clicked Concept",
          sourceRefs: [{ chunkId: "c1", page: 3 }],
        },
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ok: true,
      sessionId: "s2_step1_001",
      status: "created",
      jobQueued: true,
      jobId: "lesson_s2_step1_001",
      jobName: "teach_node",
      queueName: "lumina_lesson_generation_stage2_v2",
      workerContractVersion: "stage2_source_truth_worker_v2",
    });
    expect(res.body.streamUrl).toContain("/stream");
    expect(res.body.statusUrl).toContain("/status");
    expect(mockEnqueueLesson).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "s2_step1_001",
      resourceId: "res_step1",
      treeId: "tree_step1",
      nodeId: "node_click_start",
    }));
  });

  test("does not run blocking lesson generation inside /sessions/start", async () => {
    await request(app)
      .post(endpoint)
      .send({
        resourceId: "res_step1",
        treeId: "tree_step1",
        nodeId: "node_click_start",
      });

    expect(mockTeachNodeWithAdkPipeline).not.toHaveBeenCalled();
    expect(mockTeachNode).not.toHaveBeenCalled();
  });

  test("fails honestly when BullMQ enqueue fails", async () => {
    mockEnqueueLesson.mockRejectedValueOnce(new Error("Redis offline"));

    const res = await request(app)
      .post(endpoint)
      .send({
        resourceId: "res_step1",
        treeId: "tree_step1",
        nodeId: "node_click_start",
      });

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      ok: false,
      sessionId: "s2_step1_001",
      status: "failed",
      jobQueued: false,
    });
    expect(mockUpdateSessionStatus).toHaveBeenCalledWith(
      "s2_step1_001",
      "failed",
      expect.objectContaining({
        "metadata.errorMessage": expect.stringContaining("Redis offline"),
      })
    );
    expect(mockTeachNodeWithAdkPipeline).not.toHaveBeenCalled();
    expect(mockTeachNode).not.toHaveBeenCalled();
  });

  test("frontend node-click code has no direct teach-node fallback", () => {
    const file = path.join(
      __dirname,
      "../../../client/src/features/googleLiveTutor/components/Stage2LiveTutorWorkbench.jsx"
    );
    const source = fs.readFileSync(file, "utf8");
    const start = source.indexOf("async function teachSelectedNode()");
    const end = source.indexOf("function openLessonFromLastResponse", start);
    const teachSelectedNode = source.slice(start, end);

    expect(teachSelectedNode).toContain("/google-agent/live-tutor/stage2/sessions/start");
    expect(teachSelectedNode).not.toContain("/google-agent/live-tutor/stage2/teach-node");
    expect(teachSelectedNode).not.toContain("falling back to direct teach-node");
  });
});

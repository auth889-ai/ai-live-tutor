"use strict";

/**
 * tests/server/unit/stage2BackgroundJob.test.js
 *
 * Tests for stage2BackgroundJob.service.js
 * Redis and BullMQ are mocked — no real Redis needed.
 */

// ── Mock ioredis ──────────────────────────────────────────────────────────────
const mockConnect  = jest.fn().mockResolvedValue(undefined);
const mockOn       = jest.fn().mockReturnThis();
jest.mock("ioredis", () => {
  return jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    on: mockOn,
    ping: jest.fn().mockResolvedValue("PONG"),
  }));
});

// ── Mock BullMQ ───────────────────────────────────────────────────────────────
// Note: jest.mock is hoisted, so mock fns must be defined inside the factory
jest.mock("bullmq", () => {
  const addFn    = jest.fn().mockResolvedValue({ id: "job_s2_test_abc" });
  const getJobFn = jest.fn().mockResolvedValue(null);
  return {
    Queue: jest.fn().mockImplementation(() => ({ add: addFn, getJob: getJobFn })),
    Worker: jest.fn().mockImplementation(() => ({ on: jest.fn().mockReturnThis() })),
    // expose for assertions
    _addFn: addFn,
    _getJobFn: getJobFn,
  };
});

// ── Mock dependencies of background job ──────────────────────────────────────
jest.mock("../../../server/services/googleAgent/stage2/stage2SessionPersistence", () => ({
  updateSessionStatus: jest.fn().mockResolvedValue(undefined),
  saveSessionResult:   jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../../server/services/googleAgent/sourceContext/sourceContextPipeline", () => ({
  buildSourceContext: jest.fn().mockResolvedValue({ selectedEvidence: [] }),
}));

jest.mock("../../../server/services/googleAgent/stage2/stage2LessonOrchestrator", () => ({
  teachNodeWithAdkPipeline: jest.fn().mockResolvedValue({
    boardScreens:  Array(20).fill({ screenId: "s1", screenType: "title_concept_card" }),
    boardCommands: Array(100).fill({ commandId: "c1" }),
    voiceScript:   Array(20).fill({ lineId: "vl1", text: "teacher speaks" }),
    subtitles:     [],
    sourceRefs:    [{ chunkId: "c1", page: 5 }],
    metadata:      { fallbackUsed: false },
  }),
}));

jest.mock("../../../server/services/googleAgent/googleTtsVoice.service", () => ({
  synthesizeLessonVoice: jest.fn().mockResolvedValue({
    ok: true, ttsUsed: true, enabled: true, synthesizedCount: 20,
  }),
}));

const bgJob = require("../../../server/services/googleAgent/stage2/stage2BackgroundJob.service");


// ══════════════════════════════════════════════════════════════════
// enqueueLesson
// ══════════════════════════════════════════════════════════════════

describe("enqueueLesson", () => {
  test("adds job to queue and returns jobId", async () => {
    const result = await bgJob.enqueueLesson({
      sessionId:  "s2_test_abc",
      ownerKey:   "user1",
      resourceId: "res_001",
      treeId:     "tree_001",
      nodeId:     "database_denorm",
      nodeTitle:  "Database Denormalization",
    });
    expect(result).toHaveProperty("jobId");
    expect(result.queued).toBe(true);
  });

  test("job id contains sessionId", async () => {
    const result = await bgJob.enqueueLesson({ sessionId: "s2_xyz_123", ownerKey: "u1" });
    expect(result.jobId).toContain("s2_xyz_123");
  });

  test("returns correct jobId format", async () => {
    const result = await bgJob.enqueueLesson({ sessionId: "s2_abc", ownerKey: "u1" });
    expect(result.jobId).toBe("lesson_s2_abc");
  });

  test("returns queued:true on success", async () => {
    const result = await bgJob.enqueueLesson({ sessionId: "s2_abc", ownerKey: "u1" });
    expect(result.queued).toBe(true);
  });

  test("different sessions produce different jobIds", async () => {
    const r1 = await bgJob.enqueueLesson({ sessionId: "s2_aaa", ownerKey: "u1" });
    const r2 = await bgJob.enqueueLesson({ sessionId: "s2_bbb", ownerKey: "u1" });
    expect(r1.jobId).not.toBe(r2.jobId);
  });
});


// ══════════════════════════════════════════════════════════════════
// SSE registration / emit
// ══════════════════════════════════════════════════════════════════

describe("SSE sseRegister / sseUnregister / sseEmit", () => {
  function makeMockRes() {
    return { write: jest.fn(), end: jest.fn() };
  }

  test("sseRegister adds client for sessionId", () => {
    const res = makeMockRes();
    bgJob.sseRegister("session_sse_1", res);
    // emit should reach it
    bgJob.sseEmit("session_sse_1", "test_event", { data: "hello" });
    expect(res.write).toHaveBeenCalled();
  });

  test("sseEmit sends correct event format", () => {
    const res = makeMockRes();
    bgJob.sseRegister("session_sse_2", res);
    bgJob.sseEmit("session_sse_2", "lesson_ready", { sessionId: "session_sse_2", screens: 25 });
    const written = res.write.mock.calls[0][0];
    expect(written).toContain("event: lesson_ready");
    expect(written).toContain('"screens":25');
  });

  test("sseEmit sends to all registered clients", () => {
    const res1 = makeMockRes();
    const res2 = makeMockRes();
    bgJob.sseRegister("session_sse_3", res1);
    bgJob.sseRegister("session_sse_3", res2);
    bgJob.sseEmit("session_sse_3", "status", { status: "running" });
    expect(res1.write).toHaveBeenCalled();
    expect(res2.write).toHaveBeenCalled();
  });

  test("sseUnregister stops receiving events", () => {
    const res = makeMockRes();
    bgJob.sseRegister("session_sse_4", res);
    bgJob.sseUnregister("session_sse_4", res);
    bgJob.sseEmit("session_sse_4", "test_event", {});
    expect(res.write).not.toHaveBeenCalled();
  });

  test("sseEmit to unknown session does not crash", () => {
    expect(() => {
      bgJob.sseEmit("no_such_session", "event", {});
    }).not.toThrow();
  });

  test("sseEmit handles client write error gracefully", () => {
    const res = { write: jest.fn().mockImplementation(() => { throw new Error("broken pipe"); }) };
    bgJob.sseRegister("session_sse_5", res);
    expect(() => {
      bgJob.sseEmit("session_sse_5", "event", {});
    }).not.toThrow();
  });

  test("multiple sessions are independent", () => {
    const res1 = makeMockRes();
    const res2 = makeMockRes();
    bgJob.sseRegister("session_A", res1);
    bgJob.sseRegister("session_B", res2);
    bgJob.sseEmit("session_A", "event", { msg: "only for A" });
    expect(res1.write).toHaveBeenCalled();
    expect(res2.write).not.toHaveBeenCalled();
  });
});


// ══════════════════════════════════════════════════════════════════
// startWorker
// ══════════════════════════════════════════════════════════════════

describe("startWorker", () => {
  test("returns worker object", () => {
    const worker = bgJob.startWorker();
    expect(worker).toBeDefined();
  });

  test("second call returns same worker (singleton)", () => {
    const w1 = bgJob.startWorker();
    const w2 = bgJob.startWorker();
    expect(w1).toBe(w2);
  });
});


// ══════════════════════════════════════════════════════════════════
// getJobStatus
// ══════════════════════════════════════════════════════════════════

describe("getJobStatus", () => {
  test("returns found:false when job does not exist", async () => {
    const { Queue } = require("bullmq");
    // reset the mock so getJob returns null
    const queueInstance = Queue.mock.results[0]?.value;
    if (queueInstance) queueInstance.getJob.mockResolvedValueOnce(null);
    const result = await bgJob.getJobStatus("s2_unknown_xyz");
    expect(result).toHaveProperty("found");
    expect(result).toHaveProperty("jobId");
  });

  test("jobId format is lesson_ + sessionId", async () => {
    const { Queue } = require("bullmq");
    const queueInstance = Queue.mock.results[0]?.value;
    if (queueInstance) queueInstance.getJob.mockResolvedValueOnce(null);
    const result = await bgJob.getJobStatus("s2_test_999");
    expect(result.jobId).toBe("lesson_s2_test_999");
  });
});

"use strict";

const mockProgress = jest.fn().mockResolvedValue(undefined);
const mockUpdateSessionStatus = jest.fn().mockResolvedValue(undefined);
const mockSaveSessionSegment = jest.fn().mockResolvedValue(undefined);
const mockSaveSessionResult = jest.fn().mockResolvedValue(undefined);
const mockLoadSessionWithArtifacts = jest.fn().mockResolvedValue({
  sessionId: "s2_worker_contract",
  status: "completed",
  boardScreens: [{ screenId: "s0" }],
  boardCommands: [{ commandId: "cmd0" }],
  voiceScript: [{ lineId: "vl0", text: "teacher speaks" }],
  subtitles: [{ lineId: "vl0", startMs: 0, endMs: 1000 }],
});

const mockBuildSourceContext = jest.fn().mockResolvedValue({
  selectedEvidence: [{ chunkId: "c1", page: 2, text: "source text" }],
  sourceRefs: [{ chunkId: "c1", page: 2 }],
  pageImages: [{ page: 2, imagePath: "/tmp/page-02.png" }],
});

const segment0 = {
  boardScreens: [{ screenId: "s0", title: "Segment 0" }],
  boardCommands: [{ commandId: "cmd0", screenId: "s0" }],
  voiceScript: [{ lineId: "vl0", text: "teacher speaks" }],
  subtitles: [{ lineId: "vl0", startMs: 0, endMs: 1000 }],
};

const mockTeachNodeWithAdkPipeline = jest.fn(async (_payload, options = {}) => {
  if (typeof options.onSegmentReady === "function") {
    await options.onSegmentReady(0, segment0);
  }

  return {
    ok: true,
    boardScreens: [{ screenId: "s0" }, { screenId: "s1" }],
    boardCommands: [{ commandId: "cmd0" }, { commandId: "cmd1" }],
    voiceScript: [{ lineId: "vl0", text: "teacher speaks" }],
    subtitles: [{ lineId: "vl0", startMs: 0, endMs: 1000 }],
    sourceRefs: [{ chunkId: "c1", page: 2 }],
    metadata: { fallbackUsed: false },
  };
});

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
  updateSessionStatus: mockUpdateSessionStatus,
  saveSessionSegment: mockSaveSessionSegment,
  saveSessionResult: mockSaveSessionResult,
  loadSessionWithArtifacts: mockLoadSessionWithArtifacts,
}));

jest.mock("../../../server/services/googleAgent/sourceContext/sourceContextPipeline", () => ({
  buildSourceContext: mockBuildSourceContext,
}));

jest.mock("../../../server/services/googleAgent/stage2/stage2LessonOrchestrator", () => ({
  teachNodeWithAdkPipeline: mockTeachNodeWithAdkPipeline,
}));

jest.mock("../../../server/services/googleAgent/googleTtsVoice.service", () => ({
  synthesizeLessonVoice: jest.fn().mockResolvedValue({
    ok: true,
    ttsUsed: true,
    enabled: true,
    audioClips: [{ lineId: "vl0", audioUrl: "data:audio/mp3;base64,AAA" }],
  }),
}));

const bgJob = require("../../../server/services/googleAgent/stage2/stage2BackgroundJob.service");

function makeJob() {
  return {
    id: "lesson_s2_worker_contract",
    data: {
      sessionId: "s2_worker_contract",
      ownerKey: "user1",
      resourceId: "res1",
      treeId: "tree1",
      nodeId: "node1",
      nodeTitle: "Node 1",
      selectedNode: { nodeId: "node1", title: "Node 1" },
      body: { studentLevel: "beginner" },
      workerContractVersion: bgJob.WORKER_CONTRACT_VERSION,
    },
    updateProgress: mockProgress,
  };
}

function eventNamesFrom(res) {
  return res.write.mock.calls
    .map((call) => String(call[0] || ""))
    .filter((text) => text.startsWith("event: "))
    .map((text) => text.match(/^event: ([^\n]+)/)?.[1])
    .filter(Boolean);
}

describe("Stage 2 worker contract", () => {
  beforeEach(() => {
    mockProgress.mockClear();
    mockUpdateSessionStatus.mockClear();
    mockSaveSessionSegment.mockClear();
    mockSaveSessionResult.mockClear();
    mockLoadSessionWithArtifacts.mockClear();
    mockBuildSourceContext.mockClear();
    mockTeachNodeWithAdkPipeline.mockClear();
    mockLoadSessionWithArtifacts.mockResolvedValue({
      sessionId: "s2_worker_contract",
      status: "completed",
      boardScreens: [{ screenId: "s0" }],
      boardCommands: [{ commandId: "cmd0" }],
      voiceScript: [{ lineId: "vl0", text: "teacher speaks" }],
      subtitles: [{ lineId: "vl0", startMs: 0, endMs: 1000 }],
    });
  });

  test("runs source, pipeline, segment stream, save, reload verification, and lesson_ready", async () => {
    const res = { write: jest.fn() };
    bgJob.sseRegister("s2_worker_contract", res);

    await bgJob.__test.processLessonJob(makeJob());

    expect(mockUpdateSessionStatus).toHaveBeenCalledWith(
      "s2_worker_contract",
      "running",
      expect.objectContaining({ "metadata.workerStartedAt": expect.any(String) })
    );
    expect(mockBuildSourceContext).toHaveBeenCalledWith({
      ownerKey: "user1",
      resourceId: "res1",
      treeId: "tree1",
      nodeId: "node1",
    });
    expect(mockTeachNodeWithAdkPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ _sourceContextInjected: true }),
      expect.objectContaining({ onSegmentReady: expect.any(Function) })
    );
    expect(mockSaveSessionSegment).toHaveBeenCalledWith(
      "s2_worker_contract",
      "user1",
      0,
      expect.objectContaining({
        boardScreens: expect.any(Array),
        boardCommands: expect.any(Array),
        voiceScript: expect.arrayContaining([
          expect.objectContaining({ audioUrl: "data:audio/mp3;base64,AAA" }),
        ]),
      })
    );
    expect(mockSaveSessionResult).toHaveBeenCalled();
    expect(mockLoadSessionWithArtifacts).toHaveBeenCalledWith("s2_worker_contract", "user1");

    const events = eventNamesFrom(res);
    expect(events).toContain("status");
    expect(events).toContain("segment_ready");
    expect(events).toContain("lesson_ready");

    expect(mockProgress).toHaveBeenCalledWith(expect.objectContaining({ status: "running" }));
    expect(mockProgress).toHaveBeenCalledWith(expect.objectContaining({ status: "source_ready" }));
    expect(mockProgress).toHaveBeenCalledWith(expect.objectContaining({ status: "generating" }));
    expect(mockProgress).toHaveBeenCalledWith(expect.objectContaining({ status: "segment_ready", segmentIndex: 0 }));
    expect(mockProgress).toHaveBeenCalledWith(expect.objectContaining({ status: "pipeline_done" }));
    expect(mockProgress).toHaveBeenCalledWith(expect.objectContaining({ status: "completed", percent: 100 }));

    bgJob.sseUnregister("s2_worker_contract", res);
  });

  test("throws and marks failed when persisted lesson reload is empty", async () => {
    const res = { write: jest.fn() };
    bgJob.sseRegister("s2_worker_contract", res);
    mockLoadSessionWithArtifacts.mockResolvedValueOnce({
      sessionId: "s2_worker_contract",
      status: "completed",
      boardScreens: [],
      boardCommands: [],
      voiceScript: [],
    });

    await expect(bgJob.__test.processLessonJob(makeJob())).rejects.toThrow(
      /Saved lesson verification failed/
    );

    expect(mockUpdateSessionStatus).toHaveBeenCalledWith(
      "s2_worker_contract",
      "failed",
      expect.objectContaining({
        "metadata.errorMessage": expect.stringContaining("Saved lesson verification failed"),
      })
    );

    const events = eventNamesFrom(res);
    expect(events).toContain("failed");
    expect(events).not.toContain("lesson_ready");

    bgJob.sseUnregister("s2_worker_contract", res);
  });

  test("rejects jobs from an older worker contract", async () => {
    const oldJob = makeJob();
    oldJob.data.workerContractVersion = "old_stage2_worker";

    await expect(bgJob.__test.processLessonJob(oldJob)).rejects.toThrow(
      /Worker contract mismatch/
    );

    expect(mockBuildSourceContext).not.toHaveBeenCalled();
    expect(mockTeachNodeWithAdkPipeline).not.toHaveBeenCalled();
  });
});

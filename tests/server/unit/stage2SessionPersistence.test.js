"use strict";

/**
 * tests/server/unit/stage2SessionPersistence.test.js
 *
 * Tests for stage2SessionPersistence.js
 * MongoDB is mocked — no real DB connection needed.
 */

// ── Mock mongoose models ──────────────────────────────────────────────────────
const mockSave    = jest.fn();
const mockFindOne = jest.fn();
const mockUpdateOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockFind    = jest.fn();
const mockCreate  = jest.fn();

jest.mock("../../../server/models/GoogleLiveTutorStage2Session", () => ({
  GoogleLiveTutorStage2Session: {
    create: mockCreate,
    findOne: mockFindOne,
    updateOne: mockUpdateOne,
    find: mockFind,
  },
  GoogleLiveTutorStage2Artifact: {
    findOneAndUpdate: mockFindOneAndUpdate,
    find: mockFind,
  },
}));

const persistence = require("../../../server/services/googleAgent/stage2/stage2SessionPersistence");


// ── Helpers ───────────────────────────────────────────────────────────────────

function mockSession(overrides = {}) {
  return {
    sessionId:    "s2_1234567890_abc",
    ownerKey:     "demo_user",
    offlineUserId: "demo_user",
    deviceId:     "demo_device",
    resourceId:   "glt_resource_001",
    treeId:       "tree_001",
    nodeId:       "database_denormalization",
    nodeTitle:    "Database Denormalization",
    status:       "created",
    counts:       { premiumBoardScreens: 0, boardCommands: 0, voiceScript: 0 },
    metadata:     { fallbackUsed: false },
    toObject() { return { ...this }; },
    ...overrides,
  };
}


// ══════════════════════════════════════════════════════════════════
// createSession
// ══════════════════════════════════════════════════════════════════

describe("createSession", () => {
  beforeEach(() => {
    mockCreate.mockResolvedValue(mockSession());
  });

  test("returns object with sessionId", async () => {
    const result = await persistence.createSession({ ownerKey: "user1", nodeId: "node_a" });
    expect(result).toHaveProperty("sessionId");
    expect(typeof result.sessionId).toBe("string");
    expect(result.sessionId).toMatch(/^s2_/);
  });

  test("calls create with correct ownerKey", async () => {
    await persistence.createSession({ ownerKey: "user_test", nodeId: "node_b" });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ ownerKey: "user_test" })
    );
  });

  test("creates session with status created", async () => {
    await persistence.createSession({ ownerKey: "user1" });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "created" })
    );
  });

  test("uses demo_user as fallback ownerKey", async () => {
    await persistence.createSession({});
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ ownerKey: "demo_user" })
    );
  });

  test("sets fallbackUsed to false in metadata", async () => {
    await persistence.createSession({ ownerKey: "u1" });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ fallbackUsed: false }),
      })
    );
  });

  test("sets nodeTitle in session", async () => {
    await persistence.createSession({
      ownerKey: "u1",
      nodeId: "database_denorm",
      nodeTitle: "Database Denormalization",
    });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ nodeTitle: "Database Denormalization" })
    );
  });

  test("generates unique sessionIds each call", async () => {
    const ids = new Set();
    for (let i = 0; i < 10; i++) {
      mockCreate.mockResolvedValueOnce(mockSession({ sessionId: `s2_${Date.now() + i}_${i}` }));
      const result = await persistence.createSession({ ownerKey: "u1" });
      ids.add(result.sessionId);
    }
    expect(ids.size).toBe(10);
  });
});


// ══════════════════════════════════════════════════════════════════
// updateSessionStatus
// ══════════════════════════════════════════════════════════════════

describe("updateSessionStatus", () => {
  beforeEach(() => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  test("calls updateOne with sessionId and status", async () => {
    await persistence.updateSessionStatus("s2_abc", "running");
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { sessionId: "s2_abc" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "running" }) })
    );
  });

  test("updates to all valid statuses", async () => {
    const statuses = ["created", "running", "ready", "paused", "completed", "failed"];
    for (const s of statuses) {
      await persistence.updateSessionStatus("s2_abc", s);
      expect(mockUpdateOne).toHaveBeenCalledWith(
        { sessionId: "s2_abc" },
        expect.objectContaining({ $set: expect.objectContaining({ status: s }) })
      );
    }
  });

  test("passes extra fields to $set", async () => {
    await persistence.updateSessionStatus("s2_abc", "running", {
      "metadata.workerStartedAt": "2026-06-11T00:00:00Z",
    });
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { sessionId: "s2_abc" },
      expect.objectContaining({
        $set: expect.objectContaining({
          "metadata.workerStartedAt": "2026-06-11T00:00:00Z",
        }),
      })
    );
  });
});


// ══════════════════════════════════════════════════════════════════
// saveSessionResult
// ══════════════════════════════════════════════════════════════════

describe("saveSessionResult", () => {
  beforeEach(() => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    mockFindOneAndUpdate.mockResolvedValue({});
  });

  const goodResult = {
    boardScreens: Array(25).fill({ screenId: "s1", screenType: "title_concept_card" }),
    boardCommands: Array(125).fill({ commandId: "c1" }),
    voiceScript: Array(25).fill({ lineId: "vl1", text: "teacher speaks" }),
    subtitles: Array(25).fill({ lineId: "vl1", text: "teacher speaks" }),
    sourceRefs: [{ chunkId: "c1", page: 5 }],
    metadata: { fallbackUsed: false },
  };

  test("updates status to completed", async () => {
    await persistence.saveSessionResult("s2_abc", "user1", goodResult);
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { sessionId: "s2_abc" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "completed" }) })
    );
  });

  test("saves correct screen count in counts", async () => {
    await persistence.saveSessionResult("s2_abc", "user1", goodResult);
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { sessionId: "s2_abc" },
      expect.objectContaining({
        $set: expect.objectContaining({
          counts: expect.objectContaining({ premiumBoardScreens: 25 }),
        }),
      })
    );
  });

  test("saves correct command count", async () => {
    await persistence.saveSessionResult("s2_abc", "user1", goodResult);
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { sessionId: "s2_abc" },
      expect.objectContaining({
        $set: expect.objectContaining({
          counts: expect.objectContaining({ boardCommands: 125 }),
        }),
      })
    );
  });

  test("creates boardScreens artifact", async () => {
    await persistence.saveSessionResult("s2_abc", "user1", goodResult);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ type: "boardScreens" }),
      expect.anything(),
      { upsert: true }
    );
  });

  test("creates boardCommands artifact", async () => {
    await persistence.saveSessionResult("s2_abc", "user1", goodResult);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ type: "boardCommands" }),
      expect.anything(),
      { upsert: true }
    );
  });

  test("forces fallbackUsed false even if result has true", async () => {
    const badResult = { ...goodResult, metadata: { fallbackUsed: true } };
    await persistence.saveSessionResult("s2_abc", "user1", badResult);
    // updateOne should NOT propagate fallbackUsed:true
    const call = mockUpdateOne.mock.calls[0];
    const setData = call[1].$set;
    expect(setData.metadata.fallbackUsed).toBe(false);
  });
});


// ══════════════════════════════════════════════════════════════════
// saveSessionSegment
// ══════════════════════════════════════════════════════════════════

describe("saveSessionSegment", () => {
  beforeEach(() => {
    mockFindOneAndUpdate.mockResolvedValue({});
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  const segment = {
    boardScreens: Array(6).fill({ screenId: "s1" }),
    boardCommands: Array(30).fill({ commandId: "c1" }),
    voiceScript: Array(6).fill({ lineId: "vl1", text: "speaking" }),
  };

  test("saves artifact with correct type", async () => {
    await persistence.saveSessionSegment("s2_abc", "user1", 0, segment);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ type: "segment_0" }),
      expect.anything(),
      { upsert: true }
    );
  });

  test("increments counts in session", async () => {
    await persistence.saveSessionSegment("s2_abc", "user1", 1, segment);
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { sessionId: "s2_abc" },
      expect.objectContaining({
        $inc: expect.objectContaining({
          "counts.premiumBoardScreens": 6,
          "counts.boardCommands": 30,
        }),
      })
    );
  });

  test("sets status to running", async () => {
    await persistence.saveSessionSegment("s2_abc", "user1", 0, segment);
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { sessionId: "s2_abc" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "running" }),
      })
    );
  });
});


// ══════════════════════════════════════════════════════════════════
// loadSession
// ══════════════════════════════════════════════════════════════════

describe("loadSession", () => {
  test("loads by sessionId when ownerKey provided", async () => {
    mockFindOne.mockReturnValue({ lean: () => Promise.resolve(mockSession()) });
    await persistence.loadSession("s2_abc", "user1");
    expect(mockFindOne).toHaveBeenCalledWith({ sessionId: "s2_abc", ownerKey: "user1" });
  });

  test("loads by sessionId only when no ownerKey", async () => {
    mockFindOne.mockReturnValue({ lean: () => Promise.resolve(mockSession()) });
    await persistence.loadSession("s2_abc", null);
    expect(mockFindOne).toHaveBeenCalledWith({ sessionId: "s2_abc" });
  });

  test("returns null when session not found", async () => {
    mockFindOne.mockReturnValue({ lean: () => Promise.resolve(null) });
    const result = await persistence.loadSession("nonexistent", "user1");
    expect(result).toBeNull();
  });
});


// ══════════════════════════════════════════════════════════════════
// getSessionStatus
// ══════════════════════════════════════════════════════════════════

describe("getSessionStatus", () => {
  test("returns minimal status fields", async () => {
    const mockDoc = {
      sessionId: "s2_abc",
      status: "running",
      counts: { boardCommands: 50 },
      nodeId: "database_denorm",
      nodeTitle: "Database Denormalization",
      resourceId: "res_001",
    };
    mockFindOne.mockReturnValue({ lean: () => Promise.resolve(mockDoc) });
    const result = await persistence.getSessionStatus("s2_abc");
    expect(result).toBeDefined();
  });

  test("returns null for unknown session", async () => {
    mockFindOne.mockReturnValue({ lean: () => Promise.resolve(null) });
    const result = await persistence.getSessionStatus("unknown");
    expect(result).toBeNull();
  });
});


// ══════════════════════════════════════════════════════════════════
// savePlaybackCursor
// ══════════════════════════════════════════════════════════════════

describe("savePlaybackCursor", () => {
  beforeEach(() => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  test("saves pause point to session", async () => {
    await persistence.savePlaybackCursor("s2_abc", {
      commandIndex: 42,
      screenId: "screen_010",
      paused: true,
      reason: "interrupt",
    });
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { sessionId: "s2_abc" },
      expect.objectContaining({
        $set: expect.objectContaining({
          "playbackState.currentCommandIndex": 42,
          "playbackState.currentScreenId": "screen_010",
          "playbackState.paused": true,
        }),
      })
    );
  });

  test("handles empty cursor gracefully", async () => {
    await persistence.savePlaybackCursor("s2_abc", {});
    expect(mockUpdateOne).toHaveBeenCalled();
  });
});

"use strict";

function makeChunks(resourceId = "res_source_truth") {
  return [
    { chunkId: "p1_c1", resourceId, page: 1, chunkIndex: 0, text: "Previous page bridge context.", sourceRef: `${resourceId}:p1:c1` },
    { chunkId: "p2_c1", resourceId, page: 2, chunkIndex: 0, text: "Selected page two explains the first half of the concept.", sourceRef: `${resourceId}:p2:c1` },
    { chunkId: "p2_c2", resourceId, page: 2, chunkIndex: 1, text: "Selected page two has an example and definition.", sourceRef: `${resourceId}:p2:c2` },
    { chunkId: "p3_c1", resourceId, page: 3, chunkIndex: 0, text: "Selected page three continues with a diagram and table.", sourceRef: `${resourceId}:p3:c1` },
    { chunkId: "p3_c2", resourceId, page: 3, chunkIndex: 1, text: "Selected page three gives the worked procedure.", sourceRef: `${resourceId}:p3:c2` },
    { chunkId: "p4_c1", resourceId, page: 4, chunkIndex: 0, text: "Next page applies the concept in practice.", sourceRef: `${resourceId}:p4:c1` },
  ];
}

function makeResource(resourceId = "res_source_truth") {
  return {
    resourceId,
    ownerKey: "user_source_truth",
    title: "Source Truth PDF",
    metadata: {
      fullPdfSummary: {
        overview: "Complete document summary used by the tutor.",
      },
      fullPdfOutline: {
        sections: [
          { title: "Source truth section", pages: [2, 3] },
        ],
      },
      roadmapModules: [{ title: "Module A" }],
    },
  };
}

function makeTree(resourceId = "res_source_truth") {
  return {
    treeId: "tree_source_truth",
    ownerKey: "user_source_truth",
    nodes: [
      {
        nodeId: "node_source_truth",
        id: "node_source_truth",
        title: "Dynamic Source Truth",
        shortDefinition: "A selected node whose truth spans multiple pages.",
        pageRefs: [2, 3],
        sourceRefs: [
          { chunkId: "p2_c1", page: 2, sourceRef: `${resourceId}:p2:c1` },
          { chunkId: "p3_c1", page: 3, sourceRef: `${resourceId}:p3:c1` },
        ],
        metadata: {
          richSourcePack: {
            selectedEvidence: [
              { chunkId: "tree_ev_p2", page: 2, text: "Tree evidence from page two.", sourceRef: `${resourceId}:tree:p2` },
              { chunkId: "tree_ev_p3", page: 3, text: "Tree evidence from page three.", sourceRef: `${resourceId}:tree:p3` },
            ],
          },
        },
      },
    ],
  };
}

function mockSourcePipelineDependencies({
  images = [
    { page: 2, imagePath: "/tmp/page-02.png", imageUrl: "/page-02.png", base64: "p2base64", exists: true },
    { page: 3, imagePath: "/tmp/page-03.png", imageUrl: "/page-03.png", base64: "p3base64", exists: true },
  ],
  hybridChunks = [
    { chunkId: "semantic_p9", page: 9, text: "Semantic related chunk from another PDF page.", sourceRef: "res_source_truth:p9:c1" },
  ],
} = {}) {
  const resource = makeResource();
  const tree = makeTree();
  const chunks = makeChunks();

  jest.doMock("../../../server/services/googleAgent/sourceContext/resourceLoader", () => ({
    loadResource: jest.fn().mockResolvedValue(resource),
  }));

  jest.doMock("../../../server/services/googleAgent/stage1/stage1TreePersistence", () => ({
    getConceptTree: jest.fn().mockResolvedValue(tree),
  }));

  jest.doMock("../../../server/services/googleAgent/sourceContext/chunkLoader", () => {
    const actual = jest.requireActual("../../../server/services/googleAgent/sourceContext/chunkLoader");
    return {
      ...actual,
      loadChunksByResource: jest.fn().mockResolvedValue(chunks),
      loadChunksByPages: jest.fn().mockResolvedValue(chunks),
    };
  });

  jest.doMock("../../../server/services/googleAgent/sourceContext/pageImageContext", () => ({
    getPageImages: jest.fn().mockResolvedValue(images),
    getAllPageImages: jest.fn().mockReturnValue(images),
  }));

  jest.doMock("../../../server/services/googleAgent/hybridSearch.service", () => ({
    hybridSearchChunks: jest.fn().mockResolvedValue({
      ok: hybridChunks.length > 0,
      chunks: hybridChunks,
      vectorCount: hybridChunks.length,
      textCount: 0,
    }),
  }));

  return { resource, tree, chunks, images, hybridChunks };
}

describe("Stage 2 SourceTruthPacket", () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock("../../../server/services/googleAgent/sourceContext/resourceLoader");
    jest.dontMock("../../../server/services/googleAgent/stage1/stage1TreePersistence");
    jest.dontMock("../../../server/services/googleAgent/sourceContext/chunkLoader");
    jest.dontMock("../../../server/services/googleAgent/sourceContext/pageImageContext");
    jest.dontMock("../../../server/services/googleAgent/hybridSearch.service");
  });

  test("buildSourceContext returns dynamic complete page/text/image/source coverage", async () => {
    const { tree, chunks, images, hybridChunks } = mockSourcePipelineDependencies();
    const { buildSourceContext } = require("../../../server/services/googleAgent/sourceContext/sourceContextPipeline");

    const pack = await buildSourceContext({
      ownerKey: "user_source_truth",
      resourceId: "res_source_truth",
      treeId: "tree_source_truth",
      nodeId: "node_source_truth",
    });

    const node = tree.nodes[0];
    const selectedPages = node.pageRefs;
    const selectedChunkIds = chunks
      .filter((chunk) => selectedPages.includes(Number(chunk.page)))
      .map((chunk) => chunk.chunkId);

    const evidencePages = new Set(pack.selectedEvidence.map((item) => Number(item.page)));
    const sourceRefChunkIds = new Set(pack.sourceRefs.map((ref) => ref.chunkId));
    const imagePages = new Set(pack.pageImages.map((image) => Number(image.page)));

    for (const page of selectedPages) {
      expect(evidencePages.has(page)).toBe(true);
      expect(imagePages.has(page)).toBe(true);
      expect(pack.selectedPageFullText).toContain(`[Page ${page}]`);
    }

    for (const chunkId of selectedChunkIds) {
      expect(sourceRefChunkIds.has(chunkId)).toBe(true);
    }

    expect(pack.pageImages).toHaveLength(images.length);
    expect(pack.semanticChunks.map((chunk) => chunk.chunkId)).toEqual(
      expect.arrayContaining(hybridChunks.map((chunk) => chunk.chunkId))
    );
    expect(pack.previousPageChunks.some((chunk) => Number(chunk.page) === 1)).toBe(true);
    expect(pack.nextPageChunks.some((chunk) => Number(chunk.page) === 4)).toBe(true);
    expect(pack.selectedPageFullText.length).toBeGreaterThan(0);
    expect(pack.fullPdfSummary).toEqual(expect.objectContaining({ overview: expect.any(String) }));
    expect(pack.fullPdfOutline).toEqual(expect.objectContaining({ sections: expect.any(Array) }));
    expect(pack.proof).toEqual(expect.objectContaining({
      hasText: true,
      hasImages: true,
      hasSummary: true,
      hasOutline: true,
      hasEvidence: true,
    }));
    expect(pack.metadata.pipelineSource).toBe("sourceContextPipeline");
  });

  test("buildSourceContext fails honestly when any selected node page image is missing", async () => {
    mockSourcePipelineDependencies({
      images: [
        { page: 2, imagePath: "/tmp/page-02.png", imageUrl: "/page-02.png", base64: "p2base64", exists: true },
      ],
    });
    const { buildSourceContext } = require("../../../server/services/googleAgent/sourceContext/sourceContextPipeline");

    await expect(buildSourceContext({
      ownerKey: "user_source_truth",
      resourceId: "res_source_truth",
      treeId: "tree_source_truth",
      nodeId: "node_source_truth",
    })).rejects.toThrow(/Missing page image\(s\): 3/);
  });
});

describe("Worker receives complete SourceTruthPacket before Python", () => {
  const mockProgress = jest.fn().mockResolvedValue(undefined);
  const mockUpdateSessionStatus = jest.fn().mockResolvedValue(undefined);
  const mockSaveSessionSegment = jest.fn().mockResolvedValue(undefined);
  const mockSaveSessionResult = jest.fn().mockResolvedValue(undefined);
  const mockLoadSessionWithArtifacts = jest.fn().mockResolvedValue({
    sessionId: "s2_source_truth",
    status: "completed",
    boardScreens: [{ screenId: "s0" }],
    boardCommands: [{ commandId: "cmd0" }],
    voiceScript: [{ lineId: "vl0", text: "teacher speaks" }],
    subtitles: [{ lineId: "vl0", startMs: 0, endMs: 1000 }],
  });
  const completeSourcePacket = {
    selectedEvidence: [
      { chunkId: "p2_c1", page: 2, text: "Selected page two explains the concept." },
      { chunkId: "p3_c1", page: 3, text: "Selected page three continues the concept." },
    ],
    sourceRefs: [
      { chunkId: "p2_c1", page: 2 },
      { chunkId: "p3_c1", page: 3 },
    ],
    pageImages: [
      { page: 2, imagePath: "/tmp/page-02.png", base64: "p2base64" },
      { page: 3, imagePath: "/tmp/page-03.png", base64: "p3base64" },
    ],
    selectedPageFullText: "[Page 2]\nSource text\n\n---\n\n[Page 3]\nMore source text",
    fullPdfSummary: { overview: "Summary" },
    fullPdfOutline: { sections: [{ title: "Outline" }] },
  };
  const mockBuildSourceContext = jest.fn().mockResolvedValue(completeSourcePacket);
  const mockTeachNodeWithAdkPipeline = jest.fn(async () => ({
    ok: true,
    boardScreens: [{ screenId: "s0" }],
    boardCommands: [{ commandId: "cmd0" }],
    voiceScript: [{ lineId: "vl0", text: "teacher speaks" }],
    subtitles: [{ lineId: "vl0", startMs: 0, endMs: 1000 }],
  }));

  function makeJob(bgJob) {
    return {
      id: "lesson_s2_source_truth",
      data: {
        sessionId: "s2_source_truth",
        ownerKey: "user_source_truth",
        resourceId: "res_source_truth",
        treeId: "tree_source_truth",
        nodeId: "node_source_truth",
        selectedNode: { nodeId: "node_source_truth" },
        body: { studentLevel: "beginner" },
        workerContractVersion: bgJob.WORKER_CONTRACT_VERSION,
      },
      updateProgress: mockProgress,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    mockProgress.mockClear();
    mockUpdateSessionStatus.mockClear();
    mockSaveSessionSegment.mockClear();
    mockSaveSessionResult.mockClear();
    mockLoadSessionWithArtifacts.mockClear();
    mockBuildSourceContext.mockClear();
    mockTeachNodeWithAdkPipeline.mockClear();

    jest.doMock("ioredis", () => jest.fn().mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      on: jest.fn().mockReturnThis(),
    })));
    jest.doMock("bullmq", () => ({
      Queue: jest.fn().mockImplementation(() => ({
        add: jest.fn().mockResolvedValue({ id: "job_test" }),
        getJob: jest.fn().mockResolvedValue(null),
      })),
      Worker: jest.fn().mockImplementation(() => ({ on: jest.fn().mockReturnThis() })),
    }));
    jest.doMock("../../../server/services/googleAgent/stage2/stage2SessionPersistence", () => ({
      updateSessionStatus: mockUpdateSessionStatus,
      saveSessionSegment: mockSaveSessionSegment,
      saveSessionResult: mockSaveSessionResult,
      loadSessionWithArtifacts: mockLoadSessionWithArtifacts,
    }));
    jest.doMock("../../../server/services/googleAgent/sourceContext/sourceContextPipeline", () => ({
      buildSourceContext: mockBuildSourceContext,
    }));
    jest.doMock("../../../server/services/googleAgent/stage2/stage2LessonOrchestrator", () => ({
      teachNodeWithAdkPipeline: mockTeachNodeWithAdkPipeline,
    }));
    jest.doMock("../../../server/services/googleAgent/googleTtsVoice.service", () => ({
      synthesizeLessonVoice: jest.fn().mockResolvedValue({
        ok: true,
        ttsUsed: true,
        enabled: true,
        audioClips: [{ lineId: "vl0", audioUrl: "data:audio/mp3;base64,AAA" }],
      }),
    }));
  });

  test("worker calls buildSourceContext and passes complete enrichedBody to Python", async () => {
    const bgJob = require("../../../server/services/googleAgent/stage2/stage2BackgroundJob.service");

    await bgJob.__test.processLessonJob(makeJob(bgJob));

    expect(mockBuildSourceContext).toHaveBeenCalledWith({
      ownerKey: "user_source_truth",
      resourceId: "res_source_truth",
      treeId: "tree_source_truth",
      nodeId: "node_source_truth",
    });

    expect(mockTeachNodeWithAdkPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        _sourceContextInjected: true,
        selectedEvidence: completeSourcePacket.selectedEvidence,
        sourceRefs: completeSourcePacket.sourceRefs,
        pageImages: completeSourcePacket.pageImages,
        selectedPageFullText: completeSourcePacket.selectedPageFullText,
        fullPdfSummary: completeSourcePacket.fullPdfSummary,
        fullPdfOutline: completeSourcePacket.fullPdfOutline,
      }),
      expect.objectContaining({ onSegmentReady: expect.any(Function) })
    );
  });

  test("worker does not call Python when source truth fails", async () => {
    const bgJob = require("../../../server/services/googleAgent/stage2/stage2BackgroundJob.service");
    const sourceError = new Error("Stage 2 requires real PDF page images for every selected node page. Missing page image(s): 3");
    mockBuildSourceContext.mockRejectedValueOnce(sourceError);

    await expect(bgJob.__test.processLessonJob(makeJob(bgJob))).rejects.toThrow(/Missing page image\(s\): 3/);

    expect(mockTeachNodeWithAdkPipeline).not.toHaveBeenCalled();
    expect(mockUpdateSessionStatus).toHaveBeenCalledWith(
      "s2_source_truth",
      "failed",
      expect.objectContaining({
        "metadata.errorMessage": expect.stringContaining("Missing page image(s): 3"),
      })
    );
  });
});

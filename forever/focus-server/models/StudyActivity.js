import mongoose from "mongoose";

/**
 * StudyActivity
 * -------------
 * Stores every analyzed browser activity for Feature 1.
 *
 * Keeps old features:
 * - page metadata
 * - behavior signals
 * - AI classification
 * - visual/screenshot analysis summary
 * - conflict signals
 * - explainability
 * - intervention tracking
 * - feedback
 * - voice conversation
 *
 * New fixes:
 * - sessionId links each activity to StudySession
 * - voice statuses include thinking/speaking/error
 * - popup fields support voice/chat/history-based guardian output
 * - focus_update enum included
 */

const StudyActivitySchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      default: "",
      index: true,
    },

    deviceId: {
      type: String,
      required: true,
      index: true,
    },

    goal: {
      type: String,
      default: "",
    },

    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StudySession",
      index: true,
    },

    page: {
      url: { type: String, default: "" },
      domain: { type: String, default: "" },
      title: { type: String, default: "" },
      topic: { type: String, default: "" },

      isBlank: { type: Boolean, default: false },
      isPdf: { type: Boolean, default: false },
      isRestricted: { type: Boolean, default: false },
      isSpa: { type: Boolean, default: false },
      hasIframes: { type: Boolean, default: false },

      textLength: { type: Number, default: 0 },
    },

    behavior: {
      dwellMs: { type: Number, default: 0 },
      durationMs: { type: Number, default: 0 },
      scrollDepth: { type: Number, default: 0 },
      scrollSpeed: { type: Number, default: 0 },
      tabSwitches: { type: Number, default: 0 },
      idleMs: { type: Number, default: 0 },
      typingCount: { type: Number, default: 0 },
      mouseMoves: { type: Number, default: 0 },
      routeChanges: { type: Number, default: 0 },
      iframeCount: { type: Number, default: 0 },
      isHidden: { type: Boolean, default: false },
    },

    signals: {
      relevanceScore: { type: Number, default: 0 },
      behaviorScore: { type: Number, default: 0 },
      memoryScore: { type: Number, default: 0 },
      triggerReason: { type: String, default: "" },
      hasScreenshot: { type: Boolean, default: false },
      contentQuality: { type: String, default: "unknown" },
      edgeCase: { type: String, default: "" },
    },

    ai: {
      type: {
        type: String,
        enum: ["study", "partial", "non-study", "unknown"],
        default: "unknown",
      },

      confidence: { type: Number, default: 0 },
      reason: { type: String, default: "" },
      motivation: { type: String, default: "" },
      voiceText: { type: String, default: "" },
      needsUserCheck: { type: Boolean, default: false },
      reflection: { type: String, default: "" },

      visualAnalysis: {
        summary: { type: String, default: "" },
        uiType: { type: String, default: "unknown" },
        visibleElements: { type: [String], default: [] },
        userActivity: { type: String, default: "unknown" },
        distractionSignals: { type: [String], default: [] },
        studySignals: { type: [String], default: [] },
        visualConfidence: { type: Number, default: 0 },
      },

      textAnalysis: {
        summary: { type: String, default: "" },
        topic: { type: String, default: "" },
        goalMatch: { type: String, default: "" },
        importantTerms: { type: [String], default: [] },
        confidence: { type: Number, default: 0 },
      },

      conflict: {
        exists: { type: Boolean, default: false },
        kind: { type: String, default: "" },
        explanation: { type: String, default: "" },
      },

      conflictingSignals: { type: [String], default: [] },

      screenshotInfluence: {
        type: String,
        enum: ["none", "weak", "medium", "strong"],
        default: "none",
      },
    },

    decision: {
      action: {
        type: String,
        enum: ["continue", "ask", "intervene", "refocus", "watch"],
        default: "continue",
      },

      reason: { type: String, default: "" },

      severity: {
        type: String,
        enum: ["low", "medium", "high"],
        default: "medium",
      },

      adaptiveLevel: { type: Number, default: 0 },
      pattern: { type: String, default: "" },
      recentNonStudyCount: { type: Number, default: 0 },
      recentPopupCount: { type: Number, default: 0 },
      recentRecoveredCount: { type: Number, default: 0 },
    },

    explainability: {
      bullets: { type: [String], default: [] },
      evidence: { type: [String], default: [] },
      userVisibleReason: { type: String, default: "" },
    },

    intervention: {
      shownCount: { type: Number, default: 0 },
      ignoredCount: { type: Number, default: 0 },
      lastShownAt: Date,
      lastIgnoredAt: Date,
      strictMode: { type: Boolean, default: false },
    },

    timelineEvent: {
      type: String,
      enum: [
        "study",
        "partial",
        "non_study",
        "ask_user",
        "needs_confirmation",
        "refocus_triggered",
        "self_recovered",
        "frequent_switching",
        "distraction_loop",
        "study_to_distraction",
        "non_study_loop",
        "non_study_to_non_study",
        "recovered_to_study",
        "focus_update",
        "feedback_saved",
        "voice_conversation",
        "unknown",
      ],
      default: "unknown",
    },

    refocus: {
      status: {
        type: String,
        enum: [
          "none",
          "not-needed",
          "triggered",
          "self_recovered",
          "stale_ignored",
          "cancelled",
        ],
        default: "none",
      },
      triggeredAt: Date,
      recoveredAt: Date,
      message: { type: String, default: "" },
      voiceText: { type: String, default: "" },
      reason: { type: String, default: "" },
    },

    popup: {
      shouldShow: { type: Boolean, default: false },
      type: { type: String, default: "none" },
      title: { type: String, default: "" },
      message: { type: String, default: "" },
      voiceText: { type: String, default: "" },
      chatMessage: { type: String, default: "" },
      suggestedAction: { type: String, default: "" },
      historyInsight: { type: String, default: "" },
      priority: {
        type: String,
        enum: ["low", "medium", "high"],
        default: "low",
      },
      pattern: { type: String, default: "" },
      reason: { type: String, default: "" },
      recentNonStudyCount: { type: Number, default: 0 },
      recentPopupCount: { type: Number, default: 0 },
      recentRecoveredCount: { type: Number, default: 0 },
      createdAt: Date,
    },

    voiceSession: {
      stage: { type: Number, default: 0 },

      status: {
        type: String,
        enum: [
          "not-started",
          "asking",
          "listening",
          "thinking",
          "speaking",
          "deciding",
          "completed",
          "error",
        ],
        default: "not-started",
      },

      turns: [
        {
          role: {
            type: String,
            enum: ["user", "assistant"],
          },

          text: {
            type: String,
            default: "",
          },

          stage: {
            type: Number,
            default: 0,
          },

          at: {
            type: Date,
            default: Date.now,
          },
        },
      ],

      finalDecisionMade: { type: Boolean, default: false },
      shouldContinueConversation: { type: Boolean, default: false },
      stopReason: { type: String, default: "" },
    },

    feedback: {
      userAnswer: { type: String, default: "" },
      voiceAnswer: { type: String, default: "" },
      correctedType: { type: String, default: "" },
      reason: { type: String, default: "" },
      at: Date,
    },
  },
  { timestamps: true }
);

StudyActivitySchema.index({ deviceId: 1, createdAt: -1 });
StudyActivitySchema.index({ userId: 1, createdAt: -1 });
StudyActivitySchema.index({ sessionId: 1, createdAt: -1 });
StudyActivitySchema.index({ deviceId: 1, sessionId: 1, createdAt: -1 });
StudyActivitySchema.index({ deviceId: 1, "ai.type": 1, createdAt: -1 });
StudyActivitySchema.index({ deviceId: 1, "page.domain": 1, createdAt: -1 });

export default mongoose.models.StudyActivity ||
  mongoose.model("StudyActivity", StudyActivitySchema);
import mongoose from "mongoose";

const { Schema } = mongoose;

const checklistItemSchema = new Schema(
  {
    id: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    required: {
      type: Boolean,
      default: false,
    },
    done: {
      type: Boolean,
      default: false,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const feedbackSchema = new Schema(
  {
    type: {
      type: String,
      enum: [
        "wrong_result",
        "too_hard",
        "too_easy",
        "not_for_my_country",
        "deadline_passed",
        "already_done",
        "saved_for_later",
        "useful",
        "not_useful",
        "other",
      ],
      default: "other",
    },
    note: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1500,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const proofSchema = new Schema(
  {
    proofType: {
      type: String,
      enum: ["none", "text", "url", "file"],
      default: "none",
    },
    proofText: {
      type: String,
      default: "",
      trim: true,
      maxlength: 6000,
    },
    proofUrl: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1200,
    },
    fileName: {
      type: String,
      default: "",
      trim: true,
      maxlength: 300,
    },
    fileUrl: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1200,
    },
    fileSize: {
      type: Number,
      default: 0,
      min: 0,
    },
    submittedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const selectedOpportunitySchema = new Schema(
  {
    opportunityId: {
      type: String,
      default: "",
      trim: true,
      maxlength: 160,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 600,
    },
    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: 5000,
    },
    url: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1500,
    },
    domain: {
      type: String,
      default: "",
      trim: true,
      maxlength: 200,
    },
    platform: {
      type: String,
      default: "",
      trim: true,
      maxlength: 200,
    },
    source: {
      type: String,
      default: "",
      trim: true,
      maxlength: 200,
    },
    sourceMode: {
      type: String,
      default: "",
      trim: true,
      maxlength: 200,
    },
    sourceTrust: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    verifiedDomain: {
      type: Boolean,
      default: false,
    },
    real: {
      type: Boolean,
      default: true,
    },
    type: {
      type: String,
      default: "opportunity",
      trim: true,
      maxlength: 120,
    },
    level: {
      type: String,
      enum: ["beginner", "intermediate", "advanced", "unknown"],
      default: "unknown",
    },
    matchScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    matchLabel: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },
    startAt: {
      type: Date,
      default: null,
    },
    deadlineAt: {
      type: Date,
      default: null,
    },
    tags: {
      type: [String],
      default: [],
    },
    matchReasons: {
      type: [String],
      default: [],
    },
    verificationProblems: {
      type: [String],
      default: [],
    },
  },
  { _id: false }
);

const missionSchema = new Schema(
  {
    missionTitle: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    exactAction: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    proofOfWin: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },
    nextStep: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },
    recoveryMessage: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },
    todayMinutes: {
      type: Number,
      default: 30,
      min: 1,
      max: 600,
    },
    proofRequired: {
      type: Boolean,
      default: true,
    },
    checklist: {
      type: [checklistItemSchema],
      default: [],
    },
  },
  { _id: false }
);

const smallWinMissionSchema = new Schema(
  {
    /**
     * CRITICAL PRIVACY FIELD:
     * Every saved mission/proof/history belongs to exactly one authenticated user.
     * Never query this collection without userId.
     */
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    deviceId: {
      type: String,
      default: "",
      trim: true,
      maxlength: 200,
      index: true,
    },

    field: {
      type: String,
      required: true,
      trim: true,
      index: true,
      enum: [
        "programming",
        "hackathon",
        "scholarship",
        "ielts_english",
        "research",
        "math_science",
        "design_creative",
        "writing",
        "business_startup",
        "internship",
        "workshop_course",
        "general",
      ],
    },

    level: {
      type: String,
      enum: ["beginner", "intermediate", "advanced"],
      default: "beginner",
    },

    goal: {
      type: String,
      default: "",
      trim: true,
      maxlength: 3000,
    },

    feeling: {
      type: String,
      default: "confused",
      trim: true,
      maxlength: 80,
    },

    country: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },

    dailyTimeMinutes: {
      type: Number,
      default: 30,
      min: 1,
      max: 600,
    },

    status: {
      type: String,
      enum: ["saved", "started", "proof_submitted", "completed", "archived"],
      default: "saved",
      index: true,
    },

    selectedOpportunity: {
      type: selectedOpportunitySchema,
      required: true,
    },

    mission: {
      type: missionSchema,
      required: true,
    },

    proof: {
      type: proofSchema,
      default: () => ({}),
    },

    feedback: {
      type: [feedbackSchema],
      default: [],
    },

    completedAt: {
      type: Date,
      default: null,
    },

    archivedAt: {
      type: Date,
      default: null,
    },

    lastActionAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

smallWinMissionSchema.index({ userId: 1, status: 1, updatedAt: -1 });
smallWinMissionSchema.index({ userId: 1, field: 1, createdAt: -1 });
smallWinMissionSchema.index({ userId: 1, "selectedOpportunity.opportunityId": 1 });
smallWinMissionSchema.index({ userId: 1, "selectedOpportunity.url": 1 });

export default mongoose.model("SmallWinMission", smallWinMissionSchema);
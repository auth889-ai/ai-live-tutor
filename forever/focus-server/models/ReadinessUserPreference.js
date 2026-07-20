import mongoose from "mongoose";

const planningSchema = new mongoose.Schema(
  {
    timeSlots: {
      type: [String],
      default: ["09:00", "12:00", "15:00", "18:00", "20:00"],
    },

    maxDailyStudyMinutes: {
      type: Number,
      default: 150,
      min: 15,
      max: 720,
    },

    softDailyWorkloadMinutes: {
      type: Number,
      default: 120,
      min: 15,
      max: 720,
    },

    planningWindowDays: {
      type: Number,
      default: 30,
      min: 7,
      max: 90,
    },

    recentOverdueDays: {
      type: Number,
      default: 7,
      min: 1,
      max: 30,
    },
  },
  { _id: false }
);

const readinessUserPreferenceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    timezone: {
      type: String,
      default: "Asia/Dhaka",
      trim: true,
    },

    country: {
      type: String,
      default: "BD",
      trim: true,
    },

    locale: {
      type: String,
      default: "en-BD",
      trim: true,
    },

    planning: {
      type: planningSchema,
      default: () => ({}),
    },

    smsEnabled: {
      type: Boolean,
      default: false,
    },

    phone: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    voiceEnabled: {
      type: Boolean,
      default: true,
    },

    googleCalendarSyncEnabled: {
      type: Boolean,
      default: false,
    },

    googleCalendarId: {
      type: String,
      default: "primary",
      trim: true,
    },

    dailyCheckin: {
      enabled: {
        type: Boolean,
        default: true,
      },
      time: {
        type: String,
        default: "19:00",
      },
      reminderWindowMinutes: {
        type: Number,
        default: 120,
      },
    },

    heavyWeek: {
      enabled: {
        type: Boolean,
        default: true,
      },
      lookaheadDays: {
        type: Number,
        default: 10,
      },
      thresholdCount: {
        type: Number,
        default: 3,
      },
      thresholdWorkHours: {
        type: Number,
        default: 8,
      },
    },

    coaching: {
      tone: {
        type: String,
        enum: ["gentle", "balanced", "strict", "supportive"],
        default: "balanced",
      },
      language: {
        type: String,
        enum: ["bangla", "english", "mixed"],
        default: "mixed",
      },
      maxDailyStudyMinutes: {
        type: Number,
        default: 150,
      },
      preferredStudyStart: {
        type: String,
        default: "19:00",
      },
      preferredStudyEnd: {
        type: String,
        default: "23:00",
      },
    },

    notificationIntelligence: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    reminderTone: {
      type: String,
      enum: ["supportive", "strict", "friendly", "minimal"],
      default: "supportive",
    },

    aiEnabled: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

readinessUserPreferenceSchema.pre("save", function normalize(next) {
  if (!this.timezone) this.timezone = "Asia/Dhaka";
  if (!this.country) this.country = "BD";
  if (!this.locale) this.locale = "en-BD";

  if (!this.planning) {
    this.planning = {};
  }

  if (!Array.isArray(this.planning.timeSlots) || !this.planning.timeSlots.length) {
    this.planning.timeSlots = ["09:00", "12:00", "15:00", "18:00", "20:00"];
  }

  this.planning.timeSlots = [...new Set(this.planning.timeSlots)]
    .map((slot) => String(slot || "").trim())
    .filter((slot) => /^([01]\d|2[0-3]):[0-5]\d$/.test(slot))
    .sort();

  if (!this.planning.timeSlots.length) {
    this.planning.timeSlots = ["09:00", "12:00", "15:00", "18:00", "20:00"];
  }

  next();
});

/**
 * Do NOT add this again:
 * readinessUserPreferenceSchema.index({ userId: 1 }, { unique: true });
 *
 * userId already has unique: true.
 * Adding schema.index again causes duplicate schema index warning.
 */

export default mongoose.models.ReadinessUserPreference ||
  mongoose.model("ReadinessUserPreference", readinessUserPreferenceSchema);
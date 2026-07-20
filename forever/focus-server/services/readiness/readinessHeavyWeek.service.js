import ReadinessDeadline from "../../models/ReadinessDeadline.js";
import ReadinessTask from "../../models/ReadinessTask.js";
import ReadinessUserPreference from "../../models/ReadinessUserPreference.js";

import {
  addDays,
  clamp,
  dateOnly,
  daysBetween,
  endOfDay,
  requireUserId,
  ymd,
} from "./readinessDate.util.js";

function deadlineLoad(deadline) {
  const difficulty = clamp(deadline.difficulty || 3, 1, 5);
  const estimatedHours = clamp(deadline.estimatedHours || 1, 0.25, 200);
  const weight = clamp(deadline.weightPercent || 0, 0, 100);

  return difficulty + estimatedHours / 2 + weight / 20;
}

function preferredStart(preference) {
  return preference?.coaching?.preferredStudyStart || "19:00";
}

function dailyCapacity(preference) {
  return clamp(preference?.coaching?.maxDailyStudyMinutes || 150, 45, 360);
}

function riskBoost(deadline) {
  if (deadline.riskLevel === "Critical") return 35;
  if (deadline.riskLevel === "High") return 25;
  if (deadline.riskLevel === "Medium") return 12;
  return 5;
}

function isExamLike(deadline) {
  return ["exam", "quiz"].includes(deadline.type);
}

export async function getHeavyWeeks(query = {}) {
  const userId = requireUserId(query);

  const preference = await ReadinessUserPreference.findOne({ userId });

  const start = dateOnly(query.from || new Date());
  const end = query.to ? endOfDay(query.to) : addDays(start, 35);

  const deadlines = await ReadinessDeadline.find({
    userId,
    status: "active",
    dueDate: { $gte: start, $lte: end },
  }).sort({ dueDate: 1 });

  const buckets = new Map();

  for (const deadline of deadlines) {
    const diff = Math.max(0, daysBetween(start, deadline.dueDate));
    const weekIndex = Math.floor(diff / 7);
    const key = `week_${weekIndex + 1}`;

    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        from: addDays(start, weekIndex * 7),
        to: addDays(start, weekIndex * 7 + 6),
        count: 0,
        load: 0,
        examCount: 0,
        criticalCount: 0,
        deadlines: [],
      });
    }

    const bucket = buckets.get(key);

    bucket.count += 1;
    bucket.load += deadlineLoad(deadline);
    bucket.examCount += isExamLike(deadline) ? 1 : 0;
    bucket.criticalCount += ["High", "Critical"].includes(deadline.riskLevel) ? 1 : 0;

    bucket.deadlines.push({
      _id: deadline._id,
      title: deadline.title,
      courseCode: deadline.courseCode,
      courseTitle: deadline.courseTitle,
      type: deadline.type,
      dueDate: deadline.dueDate,
      difficulty: deadline.difficulty,
      estimatedHours: deadline.estimatedHours,
      weightPercent: deadline.weightPercent,
      readinessScore: deadline.readinessScore,
      riskLevel: deadline.riskLevel,
    });
  }

  const thresholdCount = preference?.heavyWeek?.thresholdCount || 3;
  const thresholdWorkHours = preference?.heavyWeek?.thresholdWorkHours || 8;

  const weeks = [...buckets.values()].map((week) => {
    const isHeavy =
      week.count >= thresholdCount ||
      week.load >= thresholdWorkHours ||
      week.examCount >= 2 ||
      week.criticalCount >= 2;

    return {
      ...week,
      isHeavy,
      message: isHeavy
        ? `Heavy week detected: ${week.count} deadline(s), ${week.examCount} exam/quiz item(s). Start earlier with small blocks.`
        : "Workload looks manageable.",
    };
  });

  return { weeks };
}

async function buildDayLoadMap({ userId, from, to }) {
  const tasks = await ReadinessTask.find({
    userId,
    status: "planned",
    scheduledDate: { $gte: from, $lte: to },
  });

  const map = new Map();

  for (const task of tasks) {
    const key = ymd(task.scheduledDate);
    map.set(key, (map.get(key) || 0) + Number(task.durationMinutes || 25));
  }

  return map;
}

function findEarlierDateWithCapacity({
  originalDate,
  today,
  dayLoad,
  capacity,
  duration,
  maxBackDays = 7,
}) {
  for (let back = 1; back <= maxBackDays; back += 1) {
    const candidate = addDays(originalDate, -back);

    if (!candidate || candidate < today) continue;

    const key = ymd(candidate);
    const load = dayLoad.get(key) || 0;

    if (load + duration <= capacity) {
      return candidate;
    }
  }

  return originalDate;
}

export async function smoothHeavyWeeks(userId) {
  const preference = await ReadinessUserPreference.findOne({ userId });

  const capacity = dailyCapacity(preference);
  const startTime = preferredStart(preference);

  const { weeks } = await getHeavyWeeks({ userId });
  const heavyWeeks = weeks.filter((week) => week.isHeavy);

  const today = dateOnly(new Date());
  const horizonEnd = addDays(today, 42);
  const dayLoad = await buildDayLoadMap({ userId, from: today, to: horizonEnd });

  let changed = 0;
  const changes = [];

  for (const week of heavyWeeks) {
    const deadlineIds = week.deadlines.map((deadline) => deadline._id);

    const deadlines = await ReadinessDeadline.find({
      userId,
      _id: { $in: deadlineIds },
      status: "active",
    });

    const deadlineById = new Map(deadlines.map((d) => [String(d._id), d]));

    const tasks = await ReadinessTask.find({
      userId,
      deadlineId: { $in: deadlineIds },
      status: "planned",
      scheduledDate: { $gte: dateOnly(week.from), $lte: endOfDay(week.to) },
    }).sort({ priority: -1, scheduledDate: 1 });

    for (const task of tasks) {
      const deadline = deadlineById.get(String(task.deadlineId));

      if (!deadline) continue;

      const originalDate = task.scheduledDate;
      const originalKey = ymd(originalDate);
      const originalDuration = Number(task.durationMinutes || 25);

      const newDuration =
        deadline.riskLevel === "Critical"
          ? clamp(Math.ceil(originalDuration * 0.75), 15, 45)
          : clamp(Math.ceil(originalDuration * 0.9), 15, 60);

      const candidateDate = findEarlierDateWithCapacity({
        originalDate,
        today,
        dayLoad,
        capacity,
        duration: newDuration,
        maxBackDays: isExamLike(deadline) ? 10 : 6,
      });

      task.durationMinutes = newDuration;
      task.startTime = task.startTime || startTime;
      task.mode = deadline.riskLevel === "Critical" ? "minimum" : task.mode;
      task.priority = clamp((task.priority || 60) + riskBoost(deadline), 1, 100);
      task.autoReplanned = true;

      if (ymd(candidateDate) !== originalKey) {
        task.scheduledDate = candidateDate;

        dayLoad.set(
          originalKey,
          Math.max(0, (dayLoad.get(originalKey) || 0) - originalDuration)
        );

        dayLoad.set(
          ymd(candidateDate),
          (dayLoad.get(ymd(candidateDate)) || 0) + newDuration
        );
      }

      task.reason = `${task.reason || ""} Smoothed by workload optimizer: heavy week, risk=${deadline.riskLevel}, daily capacity=${capacity}min.`.trim();

      await task.save();

      changed += 1;

      changes.push({
        taskId: task._id,
        title: task.title,
        deadlineTitle: deadline.title,
        from: originalDate,
        to: task.scheduledDate,
        durationMinutes: task.durationMinutes,
        priority: task.priority,
      });
    }
  }

  return {
    changed,
    changes,
    capacity,
    message:
      changed > 0
        ? `Smoothed heavy-week workload by optimizing ${changed} task(s).`
        : "No heavy-week tasks needed moving.",
  };
}
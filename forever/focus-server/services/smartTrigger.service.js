import { studyRuntimeConfig } from "../config/studyRuntime.config.js";

/**
 * File: server/services/smartTrigger.service.js
 *
 * Purpose:
 * Decide when backend should call AI.
 *
 * Supports both call styles:
 * 1. shouldCallAi(signal)
 * 2. shouldCallAi(deviceId, meta)
 *
 * Always returns both:
 * {
 *   call: boolean,
 *   callAi: boolean,
 *   reason: string
 * }
 *
 * Fixes:
 * - trigger.call undefined bug
 * - previousState null crash
 * - study.service.js / smartTrigger.service.js mismatch
 */

const lastStateByDevice = new Map();

export function getPreviousState(deviceId) {
  return lastStateByDevice.get(deviceId) || null;
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeInput(inputOrDeviceId, maybeMeta = {}) {
  if (typeof inputOrDeviceId === "string") {
    return {
      deviceId: inputOrDeviceId,
      page: {
        url: maybeMeta.url || "",
        domain: maybeMeta.domain || "",
        title: maybeMeta.title || "",
        textLength: toNumber(maybeMeta.textLength, 0),
        screenshotBase64: maybeMeta.hasScreenshot ? "present" : "",
      },
      behavior: {
        tabSwitches: toNumber(maybeMeta.tabSwitches, 0),
        idleMs: toNumber(maybeMeta.idleMs, 0),
        scrollSpeed: toNumber(maybeMeta.scrollSpeed, 0),
        routeChanges: toNumber(maybeMeta.routeChanges, 0),
      },
    };
  }

  const signal = inputOrDeviceId || {};

  return {
    deviceId: signal.deviceId || "",
    page: {
      url: signal.page?.url || "",
      domain: signal.page?.domain || "",
      title: signal.page?.title || "",
      textLength: toNumber(signal.page?.textLength, 0),
      screenshotBase64: signal.page?.screenshotBase64 || "",
    },
    behavior: {
      tabSwitches: toNumber(signal.behavior?.tabSwitches, 0),
      idleMs: toNumber(signal.behavior?.idleMs, 0),
      scrollSpeed: toNumber(signal.behavior?.scrollSpeed, 0),
      routeChanges: toNumber(signal.behavior?.routeChanges, 0),
    },
  };
}

function triggerResult(call, reason) {
  return {
    call,
    callAi: call,
    reason,
  };
}

export function shouldCallAi(inputOrDeviceId, maybeMeta = {}) {
  const signal = normalizeInput(inputOrDeviceId, maybeMeta);
  const previous = getPreviousState(signal.deviceId);
  const currentTime = Date.now();

  if (!signal.deviceId) {
    return triggerResult(true, "missing_device_force_ai");
  }

  if (!previous) {
    return triggerResult(true, "first_signal");
  }

  const urlChanged = previous.url !== signal.page.url;
  const domainChanged = previous.domain !== signal.page.domain;
  const titleChanged = previous.title !== signal.page.title;

  const routeChanged =
    toNumber(signal.behavior.routeChanges, 0) >
    toNumber(previous.routeChanges, 0);

  const lastWasPartial = previous.type === "partial";
  const lastWasUnknown = previous.type === "unknown";

  const cooldownPassed =
    currentTime - toNumber(previous.lastAiAt, 0) >=
    toNumber(studyRuntimeConfig.aiMinIntervalMs, 20000);

  const behaviorSpike =
    toNumber(signal.behavior.tabSwitches, 0) >
      toNumber(previous.tabSwitches, 0) + 2 ||
    toNumber(signal.behavior.idleMs, 0) >
      toNumber(previous.idleMs, 0) + 30000 ||
    toNumber(signal.behavior.scrollSpeed, 0) >
      toNumber(previous.scrollSpeed, 0) * 2 + 1;

  const textChangedMeaningfully =
    Math.abs(
      toNumber(signal.page.textLength, 0) - toNumber(previous.textLength, 0)
    ) > 250;

  const screenshotAppeared =
    Boolean(signal.page.screenshotBase64) && !previous.hasScreenshot;

  const call =
    urlChanged ||
    domainChanged ||
    titleChanged ||
    routeChanged ||
    lastWasPartial ||
    lastWasUnknown ||
    cooldownPassed ||
    behaviorSpike ||
    textChangedMeaningfully ||
    screenshotAppeared;

  return triggerResult(
    call,
    call ? "smart_trigger_matched" : "cooldown_reuse_previous_state"
  );
}

export function updateRuntimeState(deviceId, patch = {}) {
  if (!deviceId) return;

  const previous = lastStateByDevice.get(deviceId) || {};

  lastStateByDevice.set(deviceId, {
    ...previous,
    ...patch,
    textLength:
      patch.textLength ??
      patch.page?.textLength ??
      previous.textLength ??
      0,
    hasScreenshot:
      patch.hasScreenshot ??
      Boolean(patch.page?.screenshotBase64) ??
      previous.hasScreenshot ??
      false,
    lastUpdatedAt: Date.now(),
  });
}
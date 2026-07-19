/**
 * extension/core/offlineQueue.js
 * ------------------------------------------------------------
 * Persistent offline queue using chrome.storage.local.
 *
 * Purpose:
 * - Keep signals/voice/feedback if backend/ngrok is offline.
 * - Retry later.
 * - Prevent data loss.
 *
 * Safe/OCP:
 * - Does not replace background queue.
 * - Extends it with persistent fallback.
 */

(function initSfaiOfflineQueue(global) {
  const STORAGE_KEY = "sfaiOfflineQueue";
  const MAX_ITEMS = 150;

  function makeId() {
    return `offline_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  async function list() {
    const data = await chrome.storage.local.get([STORAGE_KEY]);
    return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  }

  async function save(items = []) {
    await chrome.storage.local.set({
      [STORAGE_KEY]: items.slice(-MAX_ITEMS),
    });
  }

  async function enqueue(kind, payload = {}, meta = {}) {
    const items = await list();

    const item = {
      id: makeId(),
      kind,
      payload,
      meta,
      attempts: 0,
      createdAt: new Date().toISOString(),
      lastAttemptAt: null,
      lastError: "",
    };

    items.push(item);
    await save(items);

    return item;
  }

  async function remove(id) {
    const items = await list();
    await save(items.filter((item) => item.id !== id));
  }

  async function clear() {
    await save([]);
  }

  async function count() {
    const items = await list();
    return items.length;
  }

  async function drain(processor) {
    const items = await list();
    const remaining = [];
    const results = [];

    for (const item of items) {
      try {
        const result = await processor(item);
        results.push({ id: item.id, ok: true, result });
      } catch (error) {
        remaining.push({
          ...item,
          attempts: Number(item.attempts || 0) + 1,
          lastAttemptAt: new Date().toISOString(),
          lastError: error.message || String(error),
        });

        results.push({
          id: item.id,
          ok: false,
          message: error.message || String(error),
        });
      }
    }

    await save(remaining);
    return results;
  }

  global.SFAI_OFFLINE_QUEUE = {
    enqueue,
    list,
    save,
    remove,
    clear,
    count,
    drain,
  };
})(globalThis);
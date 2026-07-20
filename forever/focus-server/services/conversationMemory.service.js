const store = new Map();

export function getConversationMemory(deviceId) {
  if (!deviceId) return [];
  return store.get(deviceId) || [];
}

export function pushConversationMemory(deviceId, message) {
  if (!deviceId) return [];

  const oldMessages = store.get(deviceId) || [];

  const nextMessages = [
    ...oldMessages,
    {
      role: message.role,
      text: message.text,
      activityId: message.activityId || "",
      at: new Date().toISOString(),
    },
  ].slice(-10);

  store.set(deviceId, nextMessages);
  return nextMessages;
}

export function clearConversationMemory(deviceId) {
  if (!deviceId) return;
  store.delete(deviceId);
}
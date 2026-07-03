const DEFAULT_API_BASE = "http://127.0.0.1:8000";

export async function startCourse({ text, inputType, learnerLevel, targetMinutes, useQwen }) {
  const apiBase = localStorage.getItem("FOREVER_API_BASE") || DEFAULT_API_BASE;
  const response = await fetch(`${apiBase}/api/courses/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      inputType,
      learnerLevel,
      targetMinutes,
      useQwen
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body.slice(0, 300) || `API failed with ${response.status}`);
  }

  return response.json();
}


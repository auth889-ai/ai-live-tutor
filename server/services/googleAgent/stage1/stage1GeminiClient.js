"use strict";

function getApiKey() {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_API_KEY || "").trim();
}

function getModel() {
  return (process.env.GEMINI_MODEL || process.env.GOOGLE_GEMINI_MODEL || "gemini-2.5-flash").trim();
}

function extractJson(text) {
  const clean = text.replace(/```json\n?/gi, "").replace(/```\n?/gi, "").trim();
  const fi = clean.indexOf("{"), li = clean.lastIndexOf("}");
  const fa = clean.indexOf("["), la = clean.lastIndexOf("]");
  try {
    if (fi !== -1 && li > fi) return JSON.parse(clean.slice(fi, li + 1));
    if (fa !== -1 && la > fa) return JSON.parse(clean.slice(fa, la + 1));
    return JSON.parse(clean);
  } catch {
    throw new Error(`Gemini JSON parse failed. Preview: ${clean.slice(0, 300)}`);
  }
}

async function callGeminiJson(prompt, { maxTokens = 32000, temperature = 0.12 } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) throw Object.assign(new Error("Gemini API key missing. Set GEMINI_API_KEY."), { statusCode: 500 });
  if (typeof fetch !== "function") throw new Error("fetch unavailable — use Node 18+.");

  const model = getModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature, topP: 0.8, maxOutputTokens: maxTokens, responseMimeType: "application/json" },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(
      new Error(data?.error?.message || `Gemini HTTP ${res.status}`),
      { statusCode: 502 }
    );
  }

  const raw = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("\n").trim();
  return extractJson(raw);
}

async function callGeminiWithRepair(prompt, validate, opts = {}) {
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await callGeminiJson(attempt === 0 ? prompt : `${prompt}\n\nFix: ${lastErr}`, opts);
      lastErr = validate(result);
      if (!lastErr) return result;
    } catch (e) {
      lastErr = e.message;
      if (attempt === 2) throw e;
    }
  }
  throw new Error(`Gemini output invalid after 3 attempts: ${lastErr}`);
}

module.exports = { callGeminiJson, callGeminiWithRepair, extractJson, getModel, getApiKey };

// server/services/connectLearning/webSearch.service.js

function clean(value = "") {
  return String(value || "").trim();
}

function trunc(value = "", max = 1000) {
  const text = String(value || "");
  return text.length > max ? text.slice(0, max) : text;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeUrl(url = "") {
  return clean(url).replace(/\/+$/, "");
}

function isHttpUrl(url = "") {
  return /^https?:\/\//i.test(clean(url));
}

function safeJsonParse(text = "") {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function keywordFallbackResources(query = "") {
  const q = encodeURIComponent(query);

  return [
    {
      title: `Search web for: ${query}`,
      url: `https://www.google.com/search?q=${q}`,
      summary:
        "Fallback web search link. Configure TAVILY_API_KEY or another search provider for automatic web resource discovery.",
      provider: "fallback",
      relevance: 0.45,
    },
  ];
}

async function tavilySearch(query, { maxResults = 8 } = {}) {
  const apiKey = clean(process.env.TAVILY_API_KEY);
  if (!apiKey) {
    return { resources: keywordFallbackResources(query), provider: "fallback" };
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      search_depth: "advanced",
      include_answer: false,
      include_raw_content: false,
      max_results: Number(maxResults || 8),
    }),
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`Tavily search failed: ${response.status} ${raw.slice(0, 300)}`);
  }

  const json = safeJsonParse(raw) || {};
  const results = list(json.results);

  const resources = results
    .map((item) => ({
      title: clean(item.title || item.url || "Web Resource"),
      url: normalizeUrl(item.url),
      summary: trunc(clean(item.content || item.snippet || item.description || ""), 900),
      description: trunc(clean(item.content || item.snippet || item.description || ""), 1200),
      provider: "tavily",
      relevance: Number(item.score || 0.65),
      raw: item,
    }))
    .filter((item) => item.title && isHttpUrl(item.url))
    .slice(0, maxResults);

  return { resources, provider: "tavily" };
}

async function serpApiSearch(query, { maxResults = 8 } = {}) {
  const apiKey = clean(process.env.SERPAPI_API_KEY);
  if (!apiKey) {
    return { resources: keywordFallbackResources(query), provider: "fallback" };
  }

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("num", String(maxResults || 8));

  const response = await fetch(url);
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`SerpAPI search failed: ${response.status} ${raw.slice(0, 300)}`);
  }

  const json = safeJsonParse(raw) || {};
  const results = list(json.organic_results);

  const resources = results
    .map((item) => ({
      title: clean(item.title || item.link || "Web Resource"),
      url: normalizeUrl(item.link),
      summary: trunc(clean(item.snippet || ""), 900),
      description: trunc(clean(item.snippet || ""), 1200),
      provider: "serpapi",
      relevance: 0.65,
      raw: item,
    }))
    .filter((item) => item.title && isHttpUrl(item.url))
    .slice(0, maxResults);

  return { resources, provider: "serpapi" };
}

export async function searchWebResourcesForNode(query = "", { maxResults = 8 } = {}) {
  const finalQuery = clean(query);
  if (!finalQuery) {
    return { resources: [], provider: "none" };
  }

  const provider = clean(process.env.WEB_SEARCH_PROVIDER || "tavily").toLowerCase();

  try {
    if (provider === "serpapi" || provider === "google") {
      return await serpApiSearch(finalQuery, { maxResults });
    }

    if (provider === "none" || provider === "disabled") {
      return { resources: [], provider: "disabled" };
    }

    return await tavilySearch(finalQuery, { maxResults });
  } catch (error) {
    console.warn("[connect-learning:webSearch] failed:", error.message);

    return {
      resources: keywordFallbackResources(finalQuery),
      provider: "fallback",
      error: error.message || String(error),
    };
  }
}

export default {
  searchWebResourcesForNode,
};
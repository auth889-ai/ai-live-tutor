// Topic cover image — REAL stock-photo APIs (Pexels primary, Pixabay fallback), queried by
// the course/lesson topic so every course card gets a cover that matches its subject.
// Free-license providers only (no scraping). Honest null when neither key is set or no
// match exists — the UI falls back to bundled study photos, never a broken image.

export async function findTopicImage(topic, { env = process.env, fetchImpl = fetch } = {}) {
  // A course title like "Longest Common Substring: From Brute Force to DP" over-specifies a
  // stock search; try the title's leading words first, then a broadened technology query.
  const lead = String(topic).split(/[:—–-]/)[0].replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  const queries = [lead, `${lead.split(' ').slice(0, 2).join(' ')} programming technology`, 'programming code computer'];

  for (const query of queries) {
    if (!query.trim()) continue;
    const hit = (await fromPexels(query, env, fetchImpl)) ?? (await fromPixabay(query, env, fetchImpl));
    if (hit) return hit;
  }
  return null;
}

async function fromPexels(query, env, fetchImpl) {
  const key = env.PEXELS_API_KEY?.trim();
  if (!key) return null;
  try {
    const res = await fetchImpl(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`,
      { headers: { Authorization: key } },
    );
    if (!res.ok) return null;
    const photo = (await res.json()).photos?.[0];
    if (!photo) return null;
    return { url: photo.src?.landscape ?? photo.src?.large, credit: `Photo: ${photo.photographer} / Pexels`, provider: 'pexels' };
  } catch {
    return null; // cover art is enrichment — a provider hiccup must never fail a lesson
  }
}

async function fromPixabay(query, env, fetchImpl) {
  const key = env.PIXABAY_API_KEY?.trim();
  if (!key) return null;
  try {
    const res = await fetchImpl(
      `https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(query)}&image_type=photo&orientation=horizontal&per_page=3&safesearch=true`,
    );
    if (!res.ok) return null;
    const hit = (await res.json()).hits?.[0];
    if (!hit) return null;
    return { url: hit.webformatURL, credit: 'Image: Pixabay', provider: 'pixabay' };
  } catch {
    return null;
  }
}

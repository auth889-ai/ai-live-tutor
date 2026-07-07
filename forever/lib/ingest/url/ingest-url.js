// URL -> SourcePack. Fetches a real web page, extracts its readable text (scripts, styles,
// nav chrome stripped), and builds the same multimodal SourcePack contract every other
// input produces — so a pasted article flows through the identical society pipeline.
// Honest failure: a page that won't fetch or has too little text raises, never a stub.

import { buildMultimodalSourcePack } from '../../source-pack/build/multimodal-source-pack.js';

export async function ingestUrl(url, { timeoutMs = 20_000, fetchImpl = fetch } = {}) {
  const parsed = new URL(url); // throws on garbage
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('Only http(s) URLs are supported');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let html;
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'ForeverTutor/1.0 (+course-generation)' },
    });
    if (!response.ok) throw new Error(`Could not fetch the page: HTTP ${response.status}`);
    html = await response.text();
  } finally {
    clearTimeout(timer);
  }

  const { title, text } = extractReadableText(html);
  if (text.length < 200) throw new Error('That page has too little readable text to teach from');
  return buildMultimodalSourcePack({ title: title || parsed.hostname, text, images: [], documentType: 'url' });
}

// Pure + unit-tested. Deliberately dependency-free: good-enough article extraction, not a
// browser engine. Block-level tags become line breaks so paragraphs survive.
export function extractReadableText(html) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? '';
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<(nav|footer|header|aside)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre)>/gi, '\n')
      .replace(/<(br|hr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return { title: decodeEntities(title), text };
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

export function normalizeText(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const output = [];
  let blankSeen = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      output.push(trimmed);
      blankSeen = false;
    } else if (!blankSeen) {
      output.push('');
      blankSeen = true;
    }
  }

  return output.join('\n').trim();
}

export function chunkText(text, { maxChars = 900, overlapChars = 120 } = {}) {
  const normalized = normalizeText(text);
  const paragraphs = normalized.split('\n\n').map((item) => item.trim()).filter(Boolean);
  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    current = paragraph;

    while (current.length > maxChars) {
      const cutAt = bestCutIndex(current, maxChars);
      chunks.push(current.slice(0, cutAt).trim());
      current = current.slice(Math.max(0, cutAt - overlapChars)).trim();
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export function estimateTokens(text) {
  return Math.max(1, text.split(/\s+/).filter(Boolean).length + Math.floor(text.length / 8));
}

function bestCutIndex(text, maxChars) {
  const search = text.slice(0, maxChars);
  for (const separator of ['\n', '. ', '। ', ' ']) {
    const index = search.lastIndexOf(separator);
    if (index >= Math.floor(maxChars / 2)) return index + separator.length;
  }
  return maxChars;
}


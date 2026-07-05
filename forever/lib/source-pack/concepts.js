const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'into',
  'will',
  'are',
  'you',
  'your',
  'এই',
  'আর',
  'করে',
  'দিয়ে',
  'কাজ',
]);

export function extractConceptCandidates(text, { limit = 12 } = {}) {
  const headings = [];
  for (const line of text.split('\n')) {
    const clean = line.trim().replace(/^#+\s*/, '').replace(/[:：-]+$/, '');
    if (clean.length >= 3 && clean.length <= 80 && (line.includes(':') || line.startsWith('#'))) {
      headings.push(clean.split(/[:：]/)[0].trim());
    }
  }

  const matches = text.match(/[A-Za-z][A-Za-z0-9_+\-]{2,}|[\u0980-\u09FF]{3,}/g) ?? [];
  const counts = new Map();
  for (const raw of matches) {
    const term = raw.replace(/^[-:,।()[\]{}]+|[-:,।()[\]{}]+$/g, '').toLowerCase();
    if (!term || STOP_WORDS.has(term) || /^\d+$/.test(term)) continue;
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([term]) => displayTerm(term));
  const concepts = [];
  for (const term of [...headings, ...ranked]) {
    if (!concepts.includes(term)) concepts.push(term);
    if (concepts.length >= limit) break;
  }
  return concepts;
}

function displayTerm(term) {
  if (/^[a-z0-9_+\-]+$/.test(term)) {
    return term.slice(0, 1).toUpperCase() + term.slice(1);
  }
  return term;
}


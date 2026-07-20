export function cleanText(text) {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}
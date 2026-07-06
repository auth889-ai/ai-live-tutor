// Clean MinerU markdown into teachable prose: drop image tags, tables-as-noise, page
// markers, and excessive symbols, keeping headings and paragraphs. Pure -> unit-tested.

export function cleanMarkdown(markdown) {
  return String(markdown)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // image tags
    .replace(/<[^>]+>/g, '') // stray html
    .replace(/^\s*\|.*\|\s*$/gm, '') // table rows (noise for prose; MinerU keeps figures separately)
    .replace(/^#{1,6}\s*/gm, '') // heading markers -> keep the heading text
    .replace(/[*_`]{1,3}/g, '') // md emphasis
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

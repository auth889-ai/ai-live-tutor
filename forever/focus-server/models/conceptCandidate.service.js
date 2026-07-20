const DEFAULT_NODE_TYPES = [
  "root",
  "core_concept",
  "practice",
  "process",
  "example",
  "tool",
  "warning",
  "evidence",
];

const DEFAULT_RELATION_TYPES = [
  "contains",
  "prerequisite",
  "depends_on",
  "example_of",
  "contrasts_with",
  "leads_to",
  "applied_to",
  "requires",
  "solves_problem",
];

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "into",
  "your",
  "you",
  "are",
  "was",
  "were",
  "will",
  "shall",
  "can",
  "could",
  "should",
  "would",
  "have",
  "has",
  "had",
  "not",
  "but",
  "about",
  "what",
  "when",
  "where",
  "which",
  "using",
  "used",
  "each",
  "page",
  "slide",
  "section",
  "chapter",
]);

function clean(value = "") {
  return String(value || "").trim();
}

function cleanSpace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function trunc(value = "", max = 1200) {
  const text = String(value || "");
  return text.length > max ? text.slice(0, max) : text;
}

function norm(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9+# ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function uniq(values = []) {
  return [...new Set(list(values).map(clean).filter(Boolean))];
}

function tokenize(text = "") {
  return norm(text)
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3 && !STOPWORDS.has(x));
}

function normalizeChunk(chunk = {}, index = 0) {
  const pageNumber =
    Number(chunk.pageNumber || chunk.page || chunk.pageStart || chunk.pageIndex || 0) || 0;

  return {
    ...chunk,
    chunkId: clean(chunk.chunkId || chunk.id || `p${pageNumber || 0}_c${index + 1}`),
    index: Number(chunk.index ?? index),
    pageNumber,
    pageStart: Number(chunk.pageStart || pageNumber || 0),
    pageEnd: Number(chunk.pageEnd || pageNumber || 0),
    type: clean(chunk.type || chunk.source || "text"),
    source: clean(chunk.source || chunk.type || "pdf"),
    text: String(chunk.text || chunk.content || chunk.ocrText || chunk.summary || "").trim(),
  };
}

function normalizeVisual(visual = {}, index = 0) {
  const pageNumber =
    Number(visual.pageNumber || visual.page || visual.pageIndex || index + 1) || index + 1;

  const vision = visual.vision || visual.visualAnalysis || visual.analysis || {};

  return {
    pageNumber,
    visualType: clean(
      visual.visualType || visual.visualTypeGuess || vision.visualType || visual.type || ""
    ),
    title: clean(visual.title || vision.title || ""),
    summary: clean(visual.summary || vision.summary || visual.reason || ""),
    ocrText: clean(visual.ocrText || visual.text || ""),
    imageUrl: clean(visual.imageUrl || ""),
    imagePath: clean(visual.imagePath || visual.filePath || ""),
    isMeaningful:
      visual.isMeaningful === true ||
      visual.hasVisualCandidate === true ||
      visual.hasMeaningfulVisual === true ||
      /diagram|workflow|chart|table|code|screenshot|flowchart|architecture/i.test(
        `${visual.visualType || ""} ${visual.title || ""} ${visual.summary || ""} ${vision.summary || ""}`
      ),
  };
}

function looksLikePageNoise(line = "") {
  const value = cleanSpace(line);

  return (
    !value ||
    /^-{2,}\s*page\s+\d+\s*-{2,}$/i.test(value) ||
    /^\[PDF PAGE\s+\d+/i.test(value) ||
    /^page\s+\d+$/i.test(value) ||
    /^\d+$/.test(value) ||
    /^references?$/i.test(value) ||
    /^bibliography$/i.test(value) ||
    /^table of contents$/i.test(value) ||
    /^https?:\/\//i.test(value) ||
    /^www\./i.test(value) ||
    /^©/.test(value)
  );
}

function looksLikeSentenceFragment(line = "") {
  const value = cleanSpace(line);
  const words = value.split(/\s+/).filter(Boolean);

  if (words.length > 12) return true;
  if (/^(the|a|an|and|or|but|with|to|from|of|in|on|for|by)\b/i.test(value)) return true;
  if (/^(here|there|because|therefore|however|previously|now|then)\b/i.test(value)) return true;
  if (/[.?!]$/.test(value) && words.length > 6) return true;

  return false;
}

function isStrongConceptTitle(line = "") {
  const value = cleanSpace(line)
    .replace(/^[-•●*]+\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .trim();

  if (!value || value.length < 4 || value.length > 100) return false;
  if (looksLikePageNoise(value)) return false;
  if (looksLikeSentenceFragment(value)) return false;

  const words = value.split(/\s+/).filter(Boolean);
  if (words.length > 11) return false;

  const hasConceptNoun =
    /\b(concept|theory|method|process|workflow|approach|model|system|architecture|practice|principle|rule|type|types|category|change|changes|migration|script|refactoring|schema|data|tool|framework|design|pattern|algorithm|protocol|security|energy|network|database|testing|deployment|integration|version|control)\b/i.test(
      value
    );

  const titleCase = /^[A-Z][A-Za-z0-9()/:+\- ]+$/.test(value);
  const hasColon = /^[A-Za-z0-9()/:+\- ]+:\s*\S+/.test(value);

  return hasConceptNoun || titleCase || hasColon;
}

function classifyNodeType(title = "", evidence = "") {
  const text = `${title}\n${evidence}`.toLowerCase();

  if (
    /example|case study|user story|scenario|previously|now|sample|for instance|e\.g\.|sql|alter table|create table|drop column|insert into|update .* set/i.test(
      text
    )
  ) {
    return "example";
  }

  if (/workflow|process|step|phase|approach|pipeline|procedure|lifecycle|flow/i.test(text)) {
    return "process";
  }

  if (
    /tool|framework|library|platform|liquibase|active record|flyway|docker|kubernetes|react|django|spring|postgres|mysql|mongodb/i.test(
      text
    )
  ) {
    return "tool";
  }

  if (/warning|risk|pitfall|mistake|anti-pattern|avoid|problem|danger|conflict|break/i.test(text)) {
    return "warning";
  }

  if (/practice|practices|should|must|recommended|best practice|guideline/i.test(text)) {
    return "practice";
  }

  return "core_concept";
}

function evidenceAfterLine(lines = [], index = 0, maxLines = 8) {
  const selected = [];

  for (let i = index + 1; i < Math.min(lines.length, index + maxLines + 1); i += 1) {
    const line = cleanSpace(lines[i]);
    if (!line) continue;
    if (looksLikePageNoise(line)) continue;

    selected.push(line);

    if (selected.join(" ").length > 900) break;
  }

  return selected.join(" ");
}

function evidenceAroundTitle(title = "", chunk = {}) {
  const text = String(chunk.text || "");
  if (!text.trim()) return "";

  const lowerText = text.toLowerCase();
  const lowerTitle = clean(title).toLowerCase();

  const idx = lowerTitle ? lowerText.indexOf(lowerTitle) : -1;

  if (idx >= 0) {
    return cleanSpace(text.slice(idx, idx + 1200));
  }

  return cleanSpace(text.slice(0, 900));
}

function scoreCandidate(candidate = {}) {
  let score = 0;

  if (candidate.title) score += 1;
  if (candidate.title.length >= 5 && candidate.title.length <= 80) score += 1;
  if (candidate.isHeading) score += 3;
  if (candidate.isRepeated) score += 2;
  if (candidate.hasEvidence) score += 3;
  if (candidate.nodeTypeGuess && candidate.nodeTypeGuess !== "core_concept") score += 1;
  if (candidate.visualPageNumbers?.length) score += 1;
  if (candidate.source === "definition") score += 2;
  if (candidate.source === "process") score += 2;
  if (candidate.source === "example") score += 2;

  if (looksLikeSentenceFragment(candidate.title)) score -= 3;
  if (looksLikePageNoise(candidate.title)) score -= 5;
  if (candidate.title.split(/\s+/).length > 11) score -= 2;
  if (!candidate.evidenceQuotes?.length) score -= 2;

  return Math.max(0, score);
}

function visualPagesForTitle(title = "", visualPages = [], pageNumber = 0) {
  const terms = tokenize(title).filter((t) => t.length > 4);

  return visualPages
    .filter((visual) => {
      if (!visual.isMeaningful) return false;
      if (Number(visual.pageNumber) === Number(pageNumber)) return true;

      const hay = norm(`${visual.title} ${visual.summary} ${visual.ocrText} ${visual.visualType}`);
      return terms.some((term) => hay.includes(term));
    })
    .slice(0, 4)
    .map((visual) => visual.pageNumber);
}

function makeCandidate({
  title,
  chunk,
  nodeTypeGuess = "",
  source = "heading",
  evidence = "",
  reason = "",
  visualPages = [],
  isHeading = false,
  isRepeated = false,
}) {
  const cleanTitle = cleanSpace(title)
    .replace(/^[-•●*]+\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!isStrongConceptTitle(cleanTitle)) return null;

  const pageNumber = Number(chunk?.pageNumber || chunk?.pageStart || 0);
  const chunkId = clean(chunk?.chunkId || `p${pageNumber || 0}_c1`);
  const quote = cleanSpace(evidence || evidenceAroundTitle(cleanTitle, chunk));

  const type = nodeTypeGuess || classifyNodeType(cleanTitle, quote);
  const visualPageNumbers = visualPagesForTitle(cleanTitle, visualPages, pageNumber);

  const candidate = {
    id: "",
    title: cleanTitle,
    normalizedTitle: norm(cleanTitle),
    nodeTypeGuess: type,
    source,
    summary: trunc(quote, 320),
    pdfEvidence: trunc(quote, 1000),
    pageNumber,
    chunkId,
    pageRefs: [
      {
        pageNumber,
        chunkId,
        source: chunk?.source || "pdf",
        confidence: 0.75,
      },
    ],
    evidenceQuotes: quote
      ? [
          {
            pageNumber,
            chunkId,
            quote: trunc(quote, 650),
            reason: reason || `Detected as ${source} candidate from PDF evidence.`,
          },
        ]
      : [],
    relatedChunkIds: [chunkId],
    visualPageNumbers,
    concepts: uniq([cleanTitle, ...tokenize(cleanTitle).slice(0, 5)]),
    tags: uniq(["pdf", type, source, ...tokenize(cleanTitle).slice(0, 4)]),
    isHeading,
    isRepeated,
    hasEvidence: Boolean(quote),
    confidence: 0.7,
  };

  candidate.score = scoreCandidate(candidate);
  candidate.confidence = Math.min(0.95, Math.max(0.45, candidate.score / 10));

  return candidate;
}

function detectHeadingCandidates(chunks = [], visualPages = []) {
  const raw = [];
  const titleCounts = new Map();

  for (const chunk of chunks) {
    const lines = String(chunk.text || "")
      .split(/\n+/)
      .map((line) => cleanSpace(line))
      .filter(Boolean);

    for (const line of lines) {
      const key = norm(line);
      if (!key) continue;
      titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
    }
  }

  for (const chunk of chunks) {
    const lines = String(chunk.text || "")
      .split(/\n+/)
      .map((line) => cleanSpace(line))
      .filter(Boolean);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const next = lines[i + 1] || "";
      const previous = lines[i - 1] || "";

      if (!isStrongConceptTitle(line)) continue;

      const words = line.split(/\s+/).filter(Boolean);
      const headingLike =
        words.length <= 8 ||
        /^\d+[.)]\s+/.test(line) ||
        /^#{1,6}\s+/.test(line) ||
        /^[A-Z][A-Za-z0-9()/:+\- ]+$/.test(line) ||
        /^\d+$/.test(next) ||
        /^chapter|section|part|unit|module/i.test(previous);

      if (!headingLike) continue;

      const candidate = makeCandidate({
        title: line,
        chunk,
        visualPages,
        source: "heading",
        evidence: evidenceAfterLine(lines, i),
        reason: "Detected as heading/title with nearby PDF evidence.",
        isHeading: true,
        isRepeated: (titleCounts.get(norm(line)) || 0) > 1,
      });

      if (candidate) raw.push(candidate);

      // Split headings common in slides: "Types of Database" + "Changes"
      if (next && isStrongConceptTitle(`${line} ${next}`) && next.split(/\s+/).length <= 3) {
        const joined = `${line} ${next}`;
        const joinedCandidate = makeCandidate({
          title: joined,
          chunk,
          visualPages,
          source: "split_heading",
          evidence: evidenceAfterLine(lines, i + 1),
          reason: "Detected as split heading across adjacent PDF/OCR lines.",
          isHeading: true,
        });

        if (joinedCandidate) raw.push(joinedCandidate);
      }
    }
  }

  return raw;
}

function detectDefinitionCandidates(chunks = [], visualPages = []) {
  const raw = [];

  const patterns = [
    /(?:^|\n)\s*([A-Z][A-Za-z0-9()/:+\- ]{3,80})\s+(?:is|are|means|refers to|consists of|involves|includes)\s+([^.\n]{20,240})/g,
    /(?:^|\n)\s*([A-Z][A-Za-z0-9()/:+\- ]{3,80})\s*[:\-]\s+([^.\n]{20,260})/g,
  ];

  for (const chunk of chunks) {
    const text = String(chunk.text || "");

    for (const pattern of patterns) {
      let match = null;

      while ((match = pattern.exec(text)) !== null) {
        const title = cleanSpace(match[1]);
        const evidence = cleanSpace(`${match[1]} ${match[0]}`.slice(0, 1000));

        const candidate = makeCandidate({
          title,
          chunk,
          visualPages,
          source: "definition",
          evidence,
          reason: "Detected from definition-style phrase in PDF text.",
        });

        if (candidate) raw.push(candidate);
      }
    }
  }

  return raw;
}

function detectProcessCandidates(chunks = [], visualPages = []) {
  const raw = [];

  for (const chunk of chunks) {
    const text = String(chunk.text || "");
    const lines = text.split(/\n+/).map(cleanSpace).filter(Boolean);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];

      if (
        /\b(step|phase|workflow|process|pipeline|approach|procedure|migration script|sequence)\b/i.test(
          line
        ) &&
        isStrongConceptTitle(line)
      ) {
        const candidate = makeCandidate({
          title: line,
          chunk,
          visualPages,
          source: "process",
          nodeTypeGuess: "process",
          evidence: evidenceAfterLine(lines, i, 10),
          reason: "Detected as process/workflow/phase concept.",
        });

        if (candidate) raw.push(candidate);
      }

      const phaseMatch = line.match(/\b(three[-\s]?phase|two[-\s]?phase|multi[-\s]?phase)\s+([A-Za-z ]{3,60})/i);
      if (phaseMatch) {
        const title = cleanSpace(`${phaseMatch[1]} ${phaseMatch[2]}`);
        const candidate = makeCandidate({
          title,
          chunk,
          visualPages,
          source: "process",
          nodeTypeGuess: "process",
          evidence: evidenceAfterLine(lines, i, 10),
          reason: "Detected as named phase/process approach.",
        });

        if (candidate) raw.push(candidate);
      }
    }
  }

  return raw;
}

function detectExampleCandidates(chunks = [], visualPages = []) {
  const raw = [];

  for (const chunk of chunks) {
    const text = String(chunk.text || "");
    const lines = text.split(/\n+/).map(cleanSpace).filter(Boolean);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];

      const isExampleArea =
        /\b(example|user story|scenario|case study|previously|now|alter table|create table|drop column|create index|update .* set|insert into)\b/i.test(
          line
        );

      if (!isExampleArea) continue;

      let title = "";

      if (/user story/i.test(line)) {
        title = line.replace(/^user story[:\-]?\s*/i, "").slice(0, 90);
      } else if (/alter table|create table|drop column|create index|update .* set/i.test(line)) {
        title = "Database migration SQL example";
      } else if (/example/i.test(line) && isStrongConceptTitle(line)) {
        title = line;
      } else {
        title = lines[i - 1] && isStrongConceptTitle(lines[i - 1]) ? lines[i - 1] : "PDF example";
      }

      const evidence = lines.slice(i, Math.min(lines.length, i + 12)).join(" ");

      const candidate = makeCandidate({
        title,
        chunk,
        visualPages,
        source: "example",
        nodeTypeGuess: "example",
        evidence,
        reason: "Detected as example/user story/code example from PDF.",
      });

      if (candidate) raw.push(candidate);
    }
  }

  return raw;
}

function detectToolCandidates(chunks = [], visualPages = []) {
  const raw = [];

  const toolPattern =
    /\b(Liquibase|Active Record Migrations|Flyway|Prisma|Alembic|Django Migrations|Rails Migrations|Docker|Kubernetes|React|Node\.js|MongoDB|PostgreSQL|MySQL|Git|GitHub|Jenkins|CI\/CD)\b/g;

  for (const chunk of chunks) {
    const text = String(chunk.text || "");
    let match = null;

    while ((match = toolPattern.exec(text)) !== null) {
      const title = cleanSpace(match[1]);
      const evidence = cleanSpace(text.slice(Math.max(0, match.index - 250), match.index + 650));

      const candidate = makeCandidate({
        title,
        chunk,
        visualPages,
        source: "tool",
        nodeTypeGuess: "tool",
        evidence,
        reason: "Detected as named tool/framework in PDF evidence.",
      });

      if (candidate) raw.push(candidate);
    }
  }

  return raw;
}

function detectWarningCandidates(chunks = [], visualPages = []) {
  const raw = [];

  for (const chunk of chunks) {
    const text = String(chunk.text || "");
    const lines = text.split(/\n+/).map(cleanSpace).filter(Boolean);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];

      if (!/\b(problem|risk|warning|mistake|pitfall|conflict|break|out-of-sync|error-prone|avoid)\b/i.test(line)) {
        continue;
      }

      const title = line.length <= 90 ? line : "Common mistake / risk";
      const candidate = makeCandidate({
        title,
        chunk,
        visualPages,
        source: "warning",
        nodeTypeGuess: "warning",
        evidence: evidenceAfterLine(lines, i, 6) || line,
        reason: "Detected as warning/risk/mistake from PDF text.",
      });

      if (candidate) raw.push(candidate);
    }
  }

  return raw;
}

function detectVisualCandidates(chunks = [], visualPages = []) {
  const raw = [];

  for (const visual of visualPages) {
    if (!visual.isMeaningful) continue;

    const matchingChunk =
      chunks.find((chunk) => Number(chunk.pageNumber) === Number(visual.pageNumber)) ||
      chunks[Math.max(0, Math.min(chunks.length - 1, visual.pageNumber - 1))] ||
      chunks[0];

    const title =
      visual.title ||
      (visual.visualType ? `${visual.visualType} on page ${visual.pageNumber}` : `Visual example page ${visual.pageNumber}`);

    const visualText = cleanSpace(
      [
        visual.title,
        visual.summary,
        visual.ocrText,
        matchingChunk?.text ? trunc(matchingChunk.text, 600) : "",
      ].filter(Boolean).join(" ")
    );

    const nodeTypeGuess = /table|code|screenshot|example|sql/i.test(
      `${visual.visualType} ${visualText}`
    )
      ? "example"
      : /workflow|diagram|flowchart|process/i.test(`${visual.visualType} ${visualText}`)
        ? "process"
        : "evidence";

    const candidate = makeCandidate({
      title,
      chunk: matchingChunk,
      visualPages,
      source: "visual",
      nodeTypeGuess,
      evidence: visualText,
      reason: "Detected from meaningful visual/table/diagram/code candidate.",
    });

    if (candidate) {
      candidate.visualPageNumbers = [visual.pageNumber];
      candidate.visualRefs = [
        {
          pageNumber: visual.pageNumber,
          visualType: visual.visualType,
          title: visual.title,
          summary: visual.summary,
          imagePath: visual.imagePath,
          imageUrl: visual.imageUrl,
        },
      ];
      raw.push(candidate);
    }
  }

  return raw;
}

function mergeCandidates(candidates = []) {
  const map = new Map();

  for (const candidate of candidates) {
    if (!candidate?.title) continue;
    if (candidate.score < Number(process.env.CONNECT_LEARNING_MIN_CANDIDATE_SCORE || 5)) continue;

    const key = candidate.normalizedTitle || norm(candidate.title);

    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, {
        ...candidate,
        aliases: [candidate.title],
        mergedCount: 1,
      });
      continue;
    }

    const existing = map.get(key);

    existing.mergedCount += 1;
    existing.aliases = uniq([...existing.aliases, candidate.title]);
    existing.score = Math.max(existing.score, candidate.score) + 0.5;
    existing.confidence = Math.max(existing.confidence, candidate.confidence);
    existing.summary =
      (existing.summary || "").length >= (candidate.summary || "").length
        ? existing.summary
        : candidate.summary;

    existing.pdfEvidence = uniq([existing.pdfEvidence, candidate.pdfEvidence]).join(" ");
    existing.relatedChunkIds = uniq([
      ...list(existing.relatedChunkIds),
      ...list(candidate.relatedChunkIds),
    ]).slice(0, 10);

    existing.pageRefs = [...list(existing.pageRefs), ...list(candidate.pageRefs)]
      .filter((ref, index, arr) => {
        const k = `${ref.pageNumber}:${ref.chunkId}`;
        return arr.findIndex((x) => `${x.pageNumber}:${x.chunkId}` === k) === index;
      })
      .slice(0, 10);

    existing.evidenceQuotes = [...list(existing.evidenceQuotes), ...list(candidate.evidenceQuotes)]
      .filter((e, index, arr) => {
        const k = `${e.pageNumber}:${e.chunkId}:${norm(e.quote).slice(0, 60)}`;
        return arr.findIndex((x) => `${x.pageNumber}:${x.chunkId}:${norm(x.quote).slice(0, 60)}` === k) === index;
      })
      .slice(0, 8);

    existing.visualPageNumbers = uniq([
      ...list(existing.visualPageNumbers).map(String),
      ...list(candidate.visualPageNumbers).map(String),
    ])
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 6);

    existing.visualRefs = [...list(existing.visualRefs), ...list(candidate.visualRefs)].slice(0, 6);

    existing.concepts = uniq([...list(existing.concepts), ...list(candidate.concepts)]).slice(0, 12);
    existing.tags = uniq([...list(existing.tags), ...list(candidate.tags)]).slice(0, 16);
  }

  const merged = [...map.values()];

  merged.sort((a, b) => {
    const aScore =
      Number(a.score || 0) +
      list(a.evidenceQuotes).length * 1.2 +
      list(a.visualPageNumbers).length * 0.8 +
      Number(a.mergedCount || 1) * 0.5;

    const bScore =
      Number(b.score || 0) +
      list(b.evidenceQuotes).length * 1.2 +
      list(b.visualPageNumbers).length * 0.8 +
      Number(b.mergedCount || 1) * 0.5;

    return bScore - aScore;
  });

  return merged.map((candidate, index) => ({
    ...candidate,
    id: candidate.id || `c${index + 1}`,
    confidence: Math.min(0.97, Math.max(0.45, candidate.confidence || candidate.score / 10)),
    needsReview: candidate.confidence < 0.65 || candidate.score < 6,
  }));
}

function discoverLearningSchema(candidates = []) {
  const nodeTypes = new Set(["root", "core_concept"]);
  const relationTypes = new Set(["contains", "related"]);

  for (const candidate of candidates) {
    if (candidate.nodeTypeGuess) nodeTypes.add(candidate.nodeTypeGuess);
  }

  if (nodeTypes.has("example")) relationTypes.add("example_of");
  if (nodeTypes.has("process")) relationTypes.add("requires");
  if (nodeTypes.has("tool")) relationTypes.add("uses_tool");
  if (nodeTypes.has("warning")) relationTypes.add("solves_problem");

  DEFAULT_NODE_TYPES.forEach((x) => nodeTypes.add(x));
  DEFAULT_RELATION_TYPES.forEach((x) => relationTypes.add(x));

  return {
    nodeTypes: [...nodeTypes],
    relationTypes: [...relationTypes],
    notes:
      "Education-focused schema discovered from PDF candidates. Gemma 4 should use these as a closed set unless strong evidence requires a fallback related edge.",
  };
}

export function extractLearningGraphCandidatesFromPdf({
  extraction = {},
  fileName = "",
  studyGoal = "",
  maxCandidates = Number(process.env.CONNECT_LEARNING_FAST_TREE_MAX_CANDIDATES || 24),
} = {}) {
  const chunks = list(extraction.chunks)
    .map(normalizeChunk)
    .filter((chunk) => clean(chunk.text));

  const visualPages = list(extraction.visualPages || extraction.visualCandidates)
    .map(normalizeVisual)
    .filter((visual) => visual.pageNumber);

  const candidates = [
    ...detectHeadingCandidates(chunks, visualPages),
    ...detectDefinitionCandidates(chunks, visualPages),
    ...detectProcessCandidates(chunks, visualPages),
    ...detectExampleCandidates(chunks, visualPages),
    ...detectToolCandidates(chunks, visualPages),
    ...detectWarningCandidates(chunks, visualPages),
    ...detectVisualCandidates(chunks, visualPages),
  ];

  const merged = mergeCandidates(candidates).slice(0, maxCandidates);

  const schema = discoverLearningSchema(merged);

  return {
    fileName,
    studyGoal,
    schema,
    candidates: merged,
    stats: {
      rawCandidateCount: candidates.length,
      mergedCandidateCount: merged.length,
      chunkCount: chunks.length,
      visualCandidateCount: visualPages.length,
    },
  };
}

export default {
  extractLearningGraphCandidatesFromPdf,
};
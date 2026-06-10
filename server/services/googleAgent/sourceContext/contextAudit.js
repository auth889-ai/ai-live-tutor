"use strict";

const WEIGHTS = {
  hasSelectedNode:   20,
  hasEvidence:       25,
  hasPageText:       20,
  hasPageImages:     10,
  hasSummary:        10,
  hasOutline:         5,
  hasSourceRefs:     25,
  hasSamePageChunks: 10,
};

function auditSourcePack(pack) {
  if (!pack || typeof pack !== "object") {
    return { ok: false, score: 0, flags: {}, warnings: ["Source context pack is null/empty."] };
  }

  const flags = {
    hasSelectedNode:   !!(pack.selectedNode?.nodeId || pack.selectedNode?.title),
    hasEvidence:       Array.isArray(pack.selectedEvidence)  && pack.selectedEvidence.length  > 0,
    hasPageText:       typeof pack.selectedPageFullText === "string" && pack.selectedPageFullText.length > 40,
    hasPageImages:     Array.isArray(pack.pageImages)        && pack.pageImages.length        > 0,
    hasSummary:        !!(pack.fullPdfSummary && typeof pack.fullPdfSummary === "object" && Object.keys(pack.fullPdfSummary).length),
    hasOutline:        !!(pack.fullPdfOutline && typeof pack.fullPdfOutline === "object"),
    hasSourceRefs:     Array.isArray(pack.sourceRefs)        && pack.sourceRefs.length        > 0,
    hasSamePageChunks: Array.isArray(pack.samePageChunks)    && pack.samePageChunks.length    > 0,
  };

  const score = Object.entries(WEIGHTS).reduce((s, [k, w]) => s + (flags[k] ? w : 0), 0);

  const warnings = [];
  if (!flags.hasSelectedNode)   warnings.push("selectedNode missing.");
  if (!flags.hasEvidence)       warnings.push("selectedEvidence empty — no source evidence.");
  if (!flags.hasPageText)       warnings.push("selectedPageFullText empty — page text unavailable.");
  if (!flags.hasSourceRefs)     warnings.push("sourceRefs empty — cannot ground teaching in source.");

  const ok = flags.hasSelectedNode && (flags.hasEvidence || flags.hasPageText) && flags.hasSourceRefs;
  return { ok, score: Math.min(100, score), flags, warnings };
}

function assertQuality(pack, minScore = 40) {
  const audit = auditSourcePack(pack);
  if (!audit.ok || audit.score < minScore) {
    const err = new Error(
      `Source context too weak (score: ${audit.score}/100). Issues: ${audit.warnings.join(" | ")}`
    );
    err.statusCode = 422;
    err.audit = audit;
    throw err;
  }
  return audit;
}

module.exports = { auditSourcePack, assertQuality };

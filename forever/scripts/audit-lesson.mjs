// THE CORRECTNESS KERNEL (Phase 0, user directive 2026-07-26): audit a SAVED lesson with
// every deterministic gate the pipeline owns — so quality failures are found by MACHINE
// on existing artifacts, not discovered one regeneration at a time. No model calls; pure
// checks only. Every production failure a human catches should become a check here.
//
//   node scripts/audit-lesson.mjs <lessonId | path/to/lesson.json>
//
// Exit code 0 = clean; 1 = violations found (counts + per-scene reasons printed).

import { readFile } from 'node:fs/promises';

import { structureViolation } from '../lib/board/structures/structure-rules.js';
import { scrubSpokenInternalIds } from '../lib/generation/voice/voice-lines.js';
import { validateTimeline } from '../lib/generation/timeline/timeline-actions.js';

const KNOWN_PROVENANCE = new Set(['consensus', 'consensus+crop', 'anchor', 'human']);

const arg = process.argv[2];
if (!arg) { console.error('usage: node scripts/audit-lesson.mjs <lessonId | lesson.json path>'); process.exit(2); }
const path = arg.endsWith('.json') ? arg : `.data/lessons/${arg}.json`;
const lesson = JSON.parse(await readFile(path, 'utf8'));

const findings = []; // {sceneId, severity: 'FAIL'|'WARN', rule, detail}
const add = (sceneId, severity, rule, detail) => findings.push({ sceneId, severity, rule, detail });

for (const scene of lesson.scenes ?? []) {
  const objects = scene.objects ?? [];
  const voiceLines = scene.voiceLines ?? [];

  // 1. MARK PROVENANCE — every teaching mark must carry a verified origin. Marks from the
  //    pre-provenance era (or stripped tags) are exactly the wrong-place class the user
  //    caught on screen: unverifiable => untrusted.
  for (const object of objects.filter((o) => o.renderHint === 'image')) {
    for (const a of object.content?.annotations ?? []) {
      if (!KNOWN_PROVENANCE.has(a.groundedBy ?? '')) {
        add(scene.sceneId, 'FAIL', 'mark-provenance', `${object.id}: mark "${(a.text ?? a.verb).slice(0, 40)}" has no verified origin (groundedBy=${a.groundedBy ?? 'none'}) — regenerate or hand-verify in the mark editor`);
      }
    }
    if (object.content?.bbox && !object.content?.bboxTarget) {
      add(scene.sceneId, 'FAIL', 'unnamed-highlight', `${object.id}: highlight bbox with no named target (blind-guess era)`);
    }
  }

  // 2. SLIDE-ALONE — a figure without the tutor's own notes beside it (structure gate).
  const violation = structureViolation(objects, { title: scene.title, directive: scene.title });
  if (violation) add(scene.sceneId, 'FAIL', 'structure', violation.slice(0, 160));

  // 3. SPOKEN INTERNAL IDS — narration saying "fig_004"/"chunk_0010" out loud.
  const scrubbed = scrubSpokenInternalIds(voiceLines);
  voiceLines.forEach((line, i) => {
    if (scrubbed[i] !== line) add(scene.sceneId, 'FAIL', 'spoken-id', `${line.id}: "${line.text.slice(0, 70)}…"`);
  });

  // 4. ABSENT-FIGURE NARRATION — the voice claims something is on the board that is not.
  const hasImage = objects.some((o) => o.renderHint === 'image');
  const hasDiagram = objects.some((o) => ['diagram', 'chart', 'algorithm', 'table'].includes(o.renderHint));
  for (const line of voiceLines) {
    if (/on the board you see|look at (this|the) (figure|diagram|image)|in the figure/i.test(line.text) && !hasImage && !hasDiagram) {
      add(scene.sceneId, 'FAIL', 'absent-figure', `${line.id}: narration points at a figure this board does not have`);
    }
  }

  // 5. CHANNEL SEPARATION — a board text object that transcribes a narration sentence.
  for (const object of objects.filter((o) => typeof o.content === 'string' && o.content.length >= 60)) {
    for (const line of voiceLines) {
      if (line.text.length >= 60 && (object.content.includes(line.text.slice(0, 60)) || line.text.includes(object.content.slice(0, 60)))) {
        add(scene.sceneId, 'WARN', 'channel-separation', `${object.id} duplicates narration ${line.id} — board should carry the skeleton, not the transcript`);
        break;
      }
    }
  }

  // 6. TIMELINE INVARIANTS — visibility and binding: every object either has a write action
  //    or is decorative; every action targets a real object (validateTimeline is strict).
  if (scene.timeline?.actions) {
    try {
      validateTimeline(scene.timeline, { objects, voiceLines });
    } catch (error) {
      add(scene.sceneId, 'FAIL', 'timeline', String(error.message).slice(0, 140));
    }
    const written = new Set(scene.timeline.actions.filter((a) => a.kind === 'write' || a.kind === 'reveal_code').map((a) => a.targetObjectId));
    for (const object of objects) {
      if (!written.has(object.id) && !object.decorative) {
        add(scene.sceneId, 'WARN', 'invisible-object', `${object.id} (${object.renderHint}) never gets a write action — it will not appear`);
      }
    }
  }

  // 6b. EXPLAINED-NOT-MENTIONED (QAG-proxy, WARN tier per research): each scene's top
  // source keyterms should appear in a line that also carries a definitional or causal
  // marker — a keyterm that is only name-dropped was cited, not taught.
  const MARKER = /\b(is a|is an|is the|refers to|means|defined as|because|so that|therefore|which means|that's why)\b/i;
  const termCounts = new Map();
  for (const line of voiceLines) {
    for (const w of String(line.text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')) {
      if (w.length >= 6) termCounts.set(w, (termCounts.get(w) ?? 0) + 1);
    }
  }
  const topTerms = [...termCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
  for (const term of topTerms) {
    const taught = voiceLines.some((l) => new RegExp(`\\b${term}\\b`, 'i').test(l.text ?? '') && MARKER.test(l.text ?? ''));
    if (!taught && voiceLines.length >= 6) {
      add(scene.sceneId, 'WARN', 'mentioned-not-explained', `"${term}" is spoken ${termCounts.get(term)}x but never in a defining/causal sentence`);
    }
  }

  // 7. DEPTH FLOOR — a "taught" scene with fewer than 6 narration lines is a summary.
  if (voiceLines.length > 0 && voiceLines.length < 6 && !['recap', 'checkpoint', 'practice'].some((r) => scene.pedagogicalRole?.includes(r) || /recap|checkpoint|practice/i.test(scene.title))) {
    add(scene.sceneId, 'WARN', 'thin-narration', `${voiceLines.length} lines — the depth rules demand a real explanation`);
  }
}

const fails = findings.filter((f) => f.severity === 'FAIL');
const warns = findings.filter((f) => f.severity === 'WARN');
console.log(`AUDIT ${path} — "${lesson.lessonTitle}" (${(lesson.scenes ?? []).length} scenes)`);
for (const f of findings) console.log(`  ${f.severity} [${f.rule}] ${f.sceneId}: ${f.detail}`);
console.log(`════ ${fails.length} FAIL · ${warns.length} WARN ════`);
process.exit(fails.length ? 1 : 0);

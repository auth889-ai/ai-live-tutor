// The Dean — the COURSE architect. ONE job: turn a SourcePack into a validated
// CourseOutline (episodes -> lessons with focus chunks), calibrated on real Udemy course
// structure (episodes 30-90 min of one topic; lessons 3-20 min of one goal). It does NOT
// plan scenes (the per-lesson Instructor's job), write boards, or narrate. Same honest
// repair pattern as every planner: contract violations go back once with the exact
// problem; a second failure raises.

import { runAgentChain } from '../../../qwen/client.js';
import { validateCourseOutline, LESSON_TYPES } from '../../../course-series/outline/course-outline.js';

export async function designCourseOutline({ sourcePack, deps = {} } = {}) {
  const call = deps.runAgentChain ?? deps.callQwenJson ?? runAgentChain;
  const chunkIds = new Set(sourcePack.chunks.map((chunk) => chunk.id));

  const system = `You are the Dean of an AI tutor faculty — the COURSE architect. You turn source material into
a real course STRUCTURE the way Udemy's best courses are built. You do not write lessons; specialist
instructors will build each lesson later from your plan.

Output ONLY JSON:
{"title": string,
 "episodes": [{"id": "ep_01", "title": string, "estimatedMinutes": 30-90, "quizQuestionCount": 3-8,
   "lessons": [{"id": "ep_01_l_01", "title": string,
                "lessonType": one of ${JSON.stringify(LESSON_TYPES)},
                "estimatedMinutes": 3-20,
                "objective": "ONE sentence: what the student can DO after this lesson",
                "focusChunkIds": [chunkId, ...]}]}]}

STRUCTURE RULES (from real course calibration — violations are rejected):
- An episode covers ONE coherent topic, 30-90 minutes total; its lessons' minutes must fit inside it.
- Every episode OPENS with a 'concept' lesson; mix in 'build'/'see_it' (hands-on), 'pitfalls', 'practice',
  and end bigger episodes with 'recap'. A lesson over 12 minutes needs a "longFormJustification" field.
- Lesson titles are student-facing and specific ("Dry Run: Watching BFS Explore Level by Level"), never generic.
- Every focusChunkId MUST be one of the provided chunk ids; each lesson gets the chunks it teaches FROM.
- Scale to the material: a short article -> 1 episode with 2-4 lessons; a chapter -> 2-3 episodes; never pad
  beyond what the source actually supports, and never drop material the source covers well.
- Order lessons so each builds on the previous (concept before practice; brute force before optimal).`;

  const user = JSON.stringify({
    task: 'Architect the course outline for this source material.',
    chunks: sourcePack.chunks.map((chunk) => ({ chunkId: chunk.id, text: chunk.text })),
  });

  let problem = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let json;
    let usage;
    try {
      ({ json, usage } = await call({
      agent: 'dean',
      system: problem ? `${system}\n\nYOUR PREVIOUS OUTLINE WAS REJECTED: ${problem}\nOutput the corrected full JSON.` : system,
      user,
      model: process.env.MODEL_PLANNER || 'qwen3.7-max',
      temperature: 0.4,
      maxTokens: 7000,
    }));
    } catch (error) {
      // Truncated output is a REPAIRABLE planning failure (the model wrote too much), not
      // a dead job: tell it to be concise and try once more.
      if (/invalid JSON/i.test(String(error?.message))) {
        problem = 'your output was cut off mid-JSON — write SHORTER directives (2 sentences max) and output the complete valid JSON.';
        continue;
      }
      throw error;
    }

    const outline = {
      title: String(json.title || sourcePack.title).trim(),
      sourcePackId: sourcePack.id,
      episodes: (Array.isArray(json.episodes) ? json.episodes : []).map((episode) => ({
        ...episode,
        lessons: (episode.lessons ?? []).map((lesson) => ({
          ...lesson,
          focusChunkIds: (lesson.focusChunkIds ?? []).filter((id) => chunkIds.has(id)),
        })),
      })),
    };
    repairCourseCoverage(outline, sourcePack);

    try {
      validateCourseOutline(outline);
      return { outline, usage };
    } catch (error) {
      problem = error.message;
    }
  }
  throw new Error(`Dean could not produce a valid course outline: ${problem}`);
}

// COURSE-LEVEL COVERAGE GUARANTEE (user requirement 2026-07-26: "never skip a single word
// of the PDF"): the lesson-level guarantee (teacher.js repairCoverage) only covers chunks
// the Dean handed that lesson — anything the Dean never assigned was legally skipped.
// Deterministic repair: every chunk of the SourcePack is owned by >=1 lesson. Unassigned
// chunks join the lesson whose title/description shares their vocabulary; chunks with no
// textual home become "Deep Dive: the material nobody covered" lessons (capped per episode
// append; nothing is ever silently dropped).
export function repairCourseCoverage(outline, sourcePack) {
  const lessons = (outline.episodes ?? []).flatMap((e) => e.lessons ?? []);
  if (!lessons.length) return outline;
  const covered = new Set(lessons.flatMap((l) => l.focusChunkIds ?? []));
  const tokensOf = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t.length >= 4));
  const orphans = [];
  for (const chunk of sourcePack.chunks ?? []) {
    if (covered.has(chunk.id)) continue;
    const chunkTokens = tokensOf(chunk.text.slice(0, 400));
    let best = null;
    let bestOverlap = 0;
    for (const lesson of lessons) {
      const overlap = [...tokensOf(`${lesson.title} ${lesson.description ?? ''} ${lesson.goal ?? ''}`)].filter((t) => chunkTokens.has(t)).length;
      if (overlap > bestOverlap) { best = lesson; bestOverlap = overlap; }
    }
    if (best && bestOverlap >= 2) best.focusChunkIds.push(chunk.id);
    else orphans.push(chunk.id);
  }
  if (orphans.length) {
    const lastEpisode = outline.episodes.at(-1);
    // ~6 chunks per deep-dive lesson keeps each within a real lesson's teaching span.
    for (let i = 0; i < orphans.length; i += 6) {
      lastEpisode.lessons.push({
        id: `ep_${String(outline.episodes.length).padStart(2, '0')}_dd_${Math.floor(i / 6) + 1}`,
        title: `Deep Dive: What the Chapters Also Say (part ${Math.floor(i / 6) + 1})`,
        minutes: 8,
        goal: 'Teach the source material no other lesson covered — fully, not as a footnote.',
        focusChunkIds: orphans.slice(i, i + 6),
      });
    }
    console.error(`[dean] course coverage repair: ${orphans.length} unassigned chunk(s) -> ${Math.ceil(orphans.length / 6)} deep-dive lesson(s); nothing skipped`);
  }
  return outline;
}

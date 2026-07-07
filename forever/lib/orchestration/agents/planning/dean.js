// The Dean — the COURSE architect. ONE job: turn a SourcePack into a validated
// CourseOutline (episodes -> lessons with focus chunks), calibrated on real Udemy course
// structure (episodes 30-90 min of one topic; lessons 3-20 min of one goal). It does NOT
// plan scenes (the per-lesson Instructor's job), write boards, or narrate. Same honest
// repair pattern as every planner: contract violations go back once with the exact
// problem; a second failure raises.

import { callQwenJson } from '../../../qwen/client.js';
import { validateCourseOutline, LESSON_TYPES } from '../../../course-series/outline/course-outline.js';

export async function designCourseOutline({ sourcePack, deps = {} } = {}) {
  const call = deps.callQwenJson ?? callQwenJson;
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
    const { json, usage } = await call({
      agent: 'dean',
      system: problem ? `${system}\n\nYOUR PREVIOUS OUTLINE WAS REJECTED: ${problem}\nOutput the corrected full JSON.` : system,
      user,
      model: process.env.MODEL_PLANNER || 'qwen3.7-max',
      temperature: 0.4,
      maxTokens: 3500,
    });

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

    try {
      validateCourseOutline(outline);
      return { outline, usage };
    } catch (error) {
      problem = error.message;
    }
  }
  throw new Error(`Dean could not produce a valid course outline: ${problem}`);
}

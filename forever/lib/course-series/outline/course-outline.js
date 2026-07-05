// Three-tier outline per docs/COURSE_STRUCTURE.md, calibrated on real Udemy courses:
// Course -> Episode (30-90 min, one topic) -> Lesson (3-20 min, one goal) -> Scene (1-5 min).
export const LESSON_TYPES = Object.freeze(['concept', 'build', 'see_it', 'pitfalls', 'practice', 'recap']);

export function validateCourseOutline(outline) {
  if (!outline.title?.trim()) throw new Error('Course title is required');
  if (!outline.sourcePackId?.trim()) throw new Error('sourcePackId is required');
  if (!outline.episodes?.length) throw new Error('At least one episode is required');

  const episodeIds = new Set();
  for (const episode of outline.episodes) {
    if (episodeIds.has(episode.id)) throw new Error(`Duplicate episode id: ${episode.id}`);
    episodeIds.add(episode.id);
    validateEpisode(episode);
  }
}

function validateEpisode(episode) {
  if (!episode.title?.trim()) throw new Error(`Episode ${episode.id} requires a title`);
  if (episode.estimatedMinutes < 30 || episode.estimatedMinutes > 90) {
    throw new Error(`Episode ${episode.id} must be 30-90 minutes (COURSE_STRUCTURE.md)`);
  }
  if (!Number.isInteger(episode.quizQuestionCount) || episode.quizQuestionCount < 3 || episode.quizQuestionCount > 8) {
    throw new Error(`Episode ${episode.id} must close with a quiz of 3-8 questions`);
  }
  if (!episode.lessons?.length) throw new Error(`Episode ${episode.id} requires lessons`);
  if (episode.lessons[0].lessonType !== 'concept') {
    throw new Error(`Episode ${episode.id} must open with a concept lesson before any practice`);
  }

  const lessonIds = new Set();
  let totalLessonMinutes = 0;
  for (const lesson of episode.lessons) {
    if (lessonIds.has(lesson.id)) throw new Error(`Duplicate lesson id: ${lesson.id}`);
    lessonIds.add(lesson.id);
    validateLesson(lesson, episode);
    totalLessonMinutes += lesson.estimatedMinutes;
  }
  if (totalLessonMinutes > episode.estimatedMinutes + 10) {
    throw new Error(`Episode ${episode.id} lesson durations exceed the episode budget`);
  }
}

function validateLesson(lesson, episode) {
  if (!lesson.title?.trim()) throw new Error(`Lesson ${lesson.id} requires a title`);
  if (!LESSON_TYPES.includes(lesson.lessonType)) {
    throw new Error(`Lesson ${lesson.id} has unknown lessonType: ${lesson.lessonType}`);
  }
  if (lesson.estimatedMinutes < 3 || lesson.estimatedMinutes > 20) {
    throw new Error(`Lesson ${lesson.id} must be 3-20 minutes`);
  }
  if (lesson.estimatedMinutes > 12 && !lesson.longFormJustification?.trim()) {
    throw new Error(`Lesson ${lesson.id} exceeds 12 minutes — the Dean must state a longFormJustification`);
  }
  if (!lesson.scenes?.length) throw new Error(`Lesson ${lesson.id} requires scenes`);

  const sceneIds = new Set();
  let totalSeconds = 0;
  for (const scene of lesson.scenes) {
    if (sceneIds.has(scene.id)) throw new Error(`Duplicate scene id: ${scene.id}`);
    sceneIds.add(scene.id);
    if (!scene.sourceChunkIds?.length) throw new Error(`Scene ${scene.id} must reference source chunks`);
    if (scene.estimatedSeconds < 60 || scene.estimatedSeconds > 300) {
      throw new Error(`Scene ${scene.id} must be 60-300 seconds`);
    }
    totalSeconds += scene.estimatedSeconds;
  }
  if (totalSeconds > lesson.estimatedMinutes * 60 + 60) {
    throw new Error(`Lesson ${lesson.id} scene durations exceed the lesson budget (episode ${episode.id})`);
  }
}

// Progressive-lesson writer (one job: persist a lesson WHILE it builds). The processor
// hands generate-lesson's onPlan/onScene events here; this module keeps the building
// state, serializes partial saves (scenes finish in parallel — a slow write must never
// clobber a newer one), and answers "how many scenes are watchable in order?".
// The player opens the stored shell immediately; each save extends the ready prefix.

export function createProgressiveLessonWriter({ lessonId, sourcePackId, ownerId, save, outlineLesson = null, episode = null, courseId = null }) {
  const state = { lessonTitle: outlineLesson?.title ?? null, briefs: [], ready: new Map() };
  let saveChain = Promise.resolve();

  const savePartial = () => {
    saveChain = saveChain
      .then(() => {
        const orderedScenes = [...state.ready.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([index, scene]) => ({ ...scene, sceneIndex: index }));
        return save(lessonId, {
          status: 'building',
          lessonTitle: state.lessonTitle ?? 'Lesson in progress',
          sourcePackId,
          plannedScenes: state.briefs.map((brief) => ({
            title: brief.title,
            pedagogicalRole: brief.pedagogicalRole,
            // The Teacher's own brief — the waiting screen shows it as a scene teaser
            // (AI-written, material-specific; never canned filler).
            directive: brief.directive ?? null,
          })),
          scenes: orderedScenes,
          voiced: orderedScenes.some((s) => Boolean(s.audioUrl)),
          ...(outlineLesson ? { courseRef: { courseId, episodeId: episode?.id ?? null, outlineLessonId: outlineLesson.id, episodeTitle: episode?.title ?? null } } : {}),
        }, { ownerId });
      })
      .catch((error) => console.error(`[lesson] partial save failed (playback catches up on the next scene): ${error?.message}`));
    return saveChain;
  };

  return {
    async recordPlan({ lessonTitle, briefs }) {
      state.lessonTitle = outlineLesson?.title ?? lessonTitle; // the Dean's student-facing title wins in a course
      state.briefs = briefs;
      await savePartial(); // the shell exists -> /course/:id already opens
    },
    // Returns { before, after }: the playable prefix around this scene landing, so the
    // caller can fire first-scene side effects (early course link) exactly once.
    async recordScene(index, scene) {
      const before = playablePrefix(state.ready);
      state.ready.set(index, scene);
      await savePartial();
      return { before, after: playablePrefix(state.ready) };
    },
    plannedCount: () => state.briefs.length,
    readyCount: () => state.ready.size,
    playableCount: () => playablePrefix(state.ready),
    // The final canonical save happens AFTER any in-flight partial write.
    flush: () => saveChain,
  };
}

// The longest contiguous prefix sc_01..sc_k that has finished. Playback is sequential, so
// an out-of-order finish (sc_03 before sc_01) is not yet playable.
function playablePrefix(ready) {
  let n = 0;
  while (ready.has(n)) n += 1;
  return n;
}

export function validateCourseOutline(outline) {
  if (!outline.title?.trim()) throw new Error('Course title is required');
  if (!outline.sourcePackId?.trim()) throw new Error('sourcePackId is required');
  if (!outline.episodes?.length) throw new Error('At least one episode is required');

  const episodeIds = new Set();
  for (const episode of outline.episodes) {
    if (episodeIds.has(episode.id)) throw new Error(`Duplicate episode id: ${episode.id}`);
    episodeIds.add(episode.id);
    if (episode.estimatedMinutes < 5 || episode.estimatedMinutes > 30) {
      throw new Error(`Episode ${episode.id} must be 5-30 minutes`);
    }
    if (!episode.scenes?.length) throw new Error(`Episode ${episode.id} requires scenes`);
    validateScenes(episode);
  }
}

function validateScenes(episode) {
  const sceneIds = new Set();
  let totalSeconds = 0;
  for (const scene of episode.scenes) {
    if (sceneIds.has(scene.id)) throw new Error(`Duplicate scene id: ${scene.id}`);
    sceneIds.add(scene.id);
    if (!scene.sourceChunkIds?.length) throw new Error(`Scene ${scene.id} must reference source chunks`);
    if (scene.estimatedSeconds < 30 || scene.estimatedSeconds > 240) {
      throw new Error(`Scene ${scene.id} must be 30-240 seconds`);
    }
    totalSeconds += scene.estimatedSeconds;
  }
  if (totalSeconds > episode.estimatedMinutes * 60 + 120) {
    throw new Error(`Episode ${episode.id} scene duration exceeds estimate`);
  }
}


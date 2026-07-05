import test from 'node:test';

import { nestedLoopsScene, nestedLoopsTimeline } from '../../fixtures/scenes/nested-loops-fixture.js';
import { validateBoardObjects } from '../../lib/board/objects/board-objects.js';
import { validateVoiceLines } from '../../lib/generation/voice/voice-lines.js';
import { validateTimeline } from '../../lib/generation/timeline/timeline-actions.js';

// The fixture must pass the SAME gates generated scenes pass — a fixture that drifts
// from the contracts would prove nothing about the real player.
test('the fixture scene is contract-valid end to end', () => {
  validateBoardObjects(nestedLoopsScene.objects, nestedLoopsScene.layout);
  validateVoiceLines(nestedLoopsScene.voiceLines, nestedLoopsScene.objects);
  validateTimeline(nestedLoopsTimeline, {
    objects: nestedLoopsScene.objects,
    voiceLines: nestedLoopsScene.voiceLines,
  });
});

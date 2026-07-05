import assert from 'node:assert/strict';
import test from 'node:test';

import { createManualClock } from '../../../lib/playback/clock/manual-clock.js';

function fakeNow() {
  let wall = 0;
  const now = () => wall;
  now.advance = (ms) => {
    wall += ms;
  };
  return now;
}

test('a paused clock does not move', () => {
  const now = fakeNow();
  const clock = createManualClock({ now });
  now.advance(5000);
  assert.equal(clock.currentTimeMs(), 0);
});

test('a playing clock tracks wall time', () => {
  const now = fakeNow();
  const clock = createManualClock({ now });
  clock.play();
  now.advance(1200);
  assert.equal(clock.currentTimeMs(), 1200);
});

test('pause freezes the position and play resumes from it', () => {
  const now = fakeNow();
  const clock = createManualClock({ now });
  clock.play();
  now.advance(1000);
  clock.pause();
  now.advance(9999);
  assert.equal(clock.currentTimeMs(), 1000);
  clock.play();
  now.advance(500);
  assert.equal(clock.currentTimeMs(), 1500);
});

test('seek jumps anywhere, playing or paused', () => {
  const now = fakeNow();
  const clock = createManualClock({ now });
  clock.seek(8000);
  assert.equal(clock.currentTimeMs(), 8000);
  clock.play();
  now.advance(100);
  clock.seek(2000);
  now.advance(100);
  assert.equal(clock.currentTimeMs(), 2100);
});

test('rate change speeds the clock without jumping position', () => {
  const now = fakeNow();
  const clock = createManualClock({ now });
  clock.play();
  now.advance(1000);
  clock.setRate(2);
  assert.equal(clock.currentTimeMs(), 1000); // no jump at the switch
  now.advance(500);
  assert.equal(clock.currentTimeMs(), 2000); // 500ms wall at 2x
});

test('invalid seek and rate are rejected', () => {
  const clock = createManualClock({ now: fakeNow() });
  assert.throws(() => clock.seek(-1), /non-negative/);
  assert.throws(() => clock.setRate(0), /positive/);
});

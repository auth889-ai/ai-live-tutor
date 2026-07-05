// The one playback clock, Phase 1 form. Same interface the Phase 2 audio clock will
// expose (currentTimeMs/play/pause/seek/setRate), so the player component never changes
// when real TTS audio replaces it — only the clock source does. `now` is injectable
// for deterministic tests.

export function createManualClock({ now = () => globalThis.performance.now() } = {}) {
  let playing = false;
  let rate = 1;
  let baseMediaMs = 0; // media position when we last (re)anchored
  let baseWallMs = 0; // wall time at that anchor

  function currentTimeMs() {
    if (!playing) return baseMediaMs;
    return baseMediaMs + (now() - baseWallMs) * rate;
  }

  function anchor() {
    baseMediaMs = currentTimeMs();
    baseWallMs = now();
  }

  return {
    currentTimeMs,
    isPlaying: () => playing,
    rate: () => rate,
    play() {
      if (playing) return;
      baseWallMs = now();
      playing = true;
    },
    pause() {
      if (!playing) return;
      anchor();
      playing = false;
    },
    seek(ms) {
      if (!Number.isFinite(ms) || ms < 0) throw new Error(`seek requires a non-negative time, got ${ms}`);
      baseMediaMs = ms;
      baseWallMs = now();
    },
    setRate(nextRate) {
      if (!Number.isFinite(nextRate) || nextRate <= 0) throw new Error(`rate must be positive, got ${nextRate}`);
      anchor();
      rate = nextRate;
    },
  };
}

// Audio-backed clock: the real playback clock for voiced scenes. Same interface as the
// manual clock (currentTimeMs/play/pause/seek/setRate/isPlaying), so the player component
// swaps clocks without changing. The <audio> element IS the clock — its currentTime drives
// every visual action, so sight and sound can never drift.

export function createAudioClock(audioElement) {
  return {
    currentTimeMs: () => audioElement.currentTime * 1000,
    isPlaying: () => !audioElement.paused && !audioElement.ended,
    rate: () => audioElement.playbackRate,
    play() {
      audioElement.play();
    },
    pause() {
      audioElement.pause();
    },
    seek(ms) {
      if (!Number.isFinite(ms) || ms < 0) throw new Error(`seek requires a non-negative time, got ${ms}`);
      audioElement.currentTime = ms / 1000;
    },
    setRate(rate) {
      if (!Number.isFinite(rate) || rate <= 0) throw new Error(`rate must be positive, got ${rate}`);
      audioElement.playbackRate = rate;
    },
  };
}

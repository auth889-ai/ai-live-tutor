export class AudioClock {
  constructor() {
    this.context = null;
    this.sceneStartTime = 0;
    this.pausedMs = 0;
    this.playing = false;
    this.listeners = new Set();
    this.frame = null;
  }

  async play() {
    if (!this.context) {
      this.context = new AudioContext();
    }
    await this.context.resume();
    this.sceneStartTime = this.context.currentTime - this.pausedMs / 1000;
    this.playing = true;
    this.tick();
  }

  pause() {
    if (!this.context) return;
    this.pausedMs = this.currentMs();
    this.playing = false;
    if (this.frame) cancelAnimationFrame(this.frame);
  }

  seek(ms) {
    this.pausedMs = Math.max(0, ms);
    if (this.context && this.playing) {
      this.sceneStartTime = this.context.currentTime - this.pausedMs / 1000;
    }
    this.emit(this.pausedMs);
  }

  currentMs() {
    if (!this.context || !this.playing) return this.pausedMs;
    return Math.max(0, (this.context.currentTime - this.sceneStartTime) * 1000);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.currentMs());
    return () => this.listeners.delete(listener);
  }

  tick() {
    if (!this.playing) return;
    this.emit(this.currentMs());
    this.frame = requestAnimationFrame(() => this.tick());
  }

  emit(ms) {
    for (const listener of this.listeners) listener(ms);
  }
}


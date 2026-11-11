// Frame spacing catches GPU/scheduling stalls as well as synchronous render work.
export class RenderWatchdog {
  constructor() { this.reset(); }

  reset() {
    this.stopped = false;
    this.resetTiming();
  }

  resetTiming() {
    this.previousStart = undefined;
    this.slowFrames = 0;
  }

  sample(start, end) {
    if (this.stopped) return true;
    const elapsed = Math.max(end - start, this.previousStart === undefined ? 0 : start - this.previousStart);
    this.previousStart = start;
    this.slowFrames = elapsed >= 500 ? this.slowFrames + 1 : 0;
    this.stopped = elapsed >= 3000 || this.slowFrames >= 3;
    return this.stopped;
  }
}

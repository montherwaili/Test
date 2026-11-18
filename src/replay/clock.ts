/** Play, pause, speed and seeking over a recording's time span. Pure. */
export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

export class ReplayClock {
  time: number;
  playing = false;
  speed = 1;

  constructor(
    readonly start: number,
    readonly end: number,
  ) {
    this.time = start;
  }

  seek(t: number): void {
    this.time = Math.min(this.end, Math.max(this.start, t));
  }

  /** Jump `seconds` forwards (negative = back). */
  skip(seconds: number): void {
    this.seek(this.time + seconds);
  }

  toggle(): void {
    // Pressing play at the end starts again from the beginning.
    if (!this.playing && this.time >= this.end) this.time = this.start;
    this.playing = !this.playing;
  }

  /** Next speed in the list, wrapping round. */
  cycleSpeed(): void {
    const i = SPEEDS.indexOf(this.speed as (typeof SPEEDS)[number]);
    this.speed = SPEEDS[(i + 1) % SPEEDS.length]!;
  }

  /** Advance by real elapsed seconds. */
  tick(elapsed: number): void {
    if (!this.playing) return;
    this.time += elapsed * this.speed;
    if (this.time >= this.end) {
      this.time = this.end;
      this.playing = false;
    }
  }

  /** 0..1 along the recording. */
  get progress(): number {
    return this.end > this.start ? (this.time - this.start) / (this.end - this.start) : 0;
  }
}

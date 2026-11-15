/**
 * Fixed-timestep accumulator: the simulation always advances in equal steps
 * (120 Hz by default) no matter how fast or unevenly frames are drawn.
 * This is what makes drives reproducible and replays exact.
 */
export class FixedStepper {
  readonly dt: number;
  private accumulator = 0;

  constructor(
    stepHz: number,
    /** Steps allowed per `advance`; beyond this, time is dropped (slow device or a background tab). */
    private readonly maxSubSteps = 8,
  ) {
    if (!(stepHz > 0)) throw new Error('stepHz must be positive');
    this.dt = 1 / stepHz;
  }

  /**
   * Feed real elapsed seconds; `step` is called once per fixed step due.
   * Returns how many steps ran.
   */
  advance(elapsedSeconds: number, step: (dt: number) => void): number {
    if (!(elapsedSeconds > 0)) return 0;
    this.accumulator += elapsedSeconds;
    // Small tolerance so 1/60 s of frame time yields exactly two 1/120 s steps
    // despite float rounding.
    const eps = this.dt * 1e-6;
    let steps = 0;
    while (this.accumulator + eps >= this.dt && steps < this.maxSubSteps) {
      step(this.dt);
      this.accumulator -= this.dt;
      steps++;
    }
    if (this.accumulator >= this.dt) {
      // Could not keep up: drop the backlog rather than spiral.
      this.accumulator = 0;
    } else if (this.accumulator < 0) {
      this.accumulator = 0;
    }
    return steps;
  }

  /** Fraction of a step left over, 0..1, for render interpolation. */
  get alpha(): number {
    return this.accumulator / this.dt;
  }

  reset(): void {
    this.accumulator = 0;
  }
}

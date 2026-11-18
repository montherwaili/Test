/**
 * Holds the frame rate by drawing fewer pixels when the device is struggling
 * and more when it has time to spare. Pure logic: it is told how long each
 * frame took and answers with a resolution scale.
 */
export interface GovernorOptions {
  /** Frames per second to hold. */
  targetFps: number;
  minScale: number;
  maxScale: number;
  /** Change the scale by this factor at a time. */
  step: number;
}

export class ResolutionGovernor {
  scale: number;
  private sum = 0;
  private count = 0;
  private window = 0;
  /** Seconds of comfortable frames in a row (raising is cautious). */
  private comfortable = 0;
  /** After a change, frames are not judged for a moment (the change itself costs a frame or two). */
  private settle = 1;

  constructor(readonly options: GovernorOptions) {
    this.scale = options.maxScale;
  }

  /**
   * @param frameSeconds time since the last frame
   * @returns true when the scale changed
   */
  frame(frameSeconds: number): boolean {
    // A frame of a second or more is a hiccup (tab switched, page paused), not the device's speed.
    if (frameSeconds <= 0 || frameSeconds > 0.5) return false;
    if (this.settle > 0) {
      this.settle -= frameSeconds;
      return false;
    }
    this.sum += frameSeconds;
    this.count++;
    this.window += frameSeconds;
    if (this.window < 1) return false;
    const avg = this.sum / this.count;
    const window = this.window;
    this.sum = 0;
    this.count = 0;
    this.window = 0;
    const budget = 1 / this.options.targetFps;
    const { minScale, maxScale, step } = this.options;
    if (avg > budget * 1.12 && this.scale > minScale) {
      this.comfortable = 0;
      // Further below the target: a bigger cut.
      const factor = avg > budget * 1.5 ? step * step : step;
      return this.set(Math.max(minScale, this.scale * factor));
    }
    if (avg < budget * 0.8) {
      this.comfortable += window;
      if (this.comfortable >= 4 && this.scale < maxScale) {
        this.comfortable = 0;
        return this.set(Math.min(maxScale, this.scale / step));
      }
    } else {
      this.comfortable = 0;
    }
    return false;
  }

  private set(scale: number): boolean {
    if (Math.abs(scale - this.scale) < 1e-3) return false;
    this.scale = scale;
    this.settle = 0.5;
    return true;
  }
}

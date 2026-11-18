import { describe, expect, it } from 'vitest';
import { ResolutionGovernor } from '../resolutionGovernor';

const make = () => new ResolutionGovernor({ targetFps: 30, minScale: 0.5, maxScale: 1, step: 0.85 });

function run(g: ResolutionGovernor, seconds: number, frameTime: (scale: number) => number): void {
  for (let t = 0; t < seconds; ) {
    const dt = frameTime(g.scale);
    g.frame(dt);
    t += dt;
  }
}

describe('resolution governor', () => {
  it('keeps full resolution when frames are on time', () => {
    const g = make();
    run(g, 20, () => 1 / 40);
    expect(g.scale).toBe(1);
  });

  it('lowers the resolution until the target is held', () => {
    const g = make();
    // A phone that needs 50 ms a frame at full resolution, cost falling with the pixel count.
    const cost = (s: number) => 0.008 + 0.042 * s * s;
    run(g, 30, cost);
    expect(g.scale).toBeLessThan(0.85);
    expect(g.scale).toBeGreaterThanOrEqual(0.5);
    expect(cost(g.scale)).toBeLessThan((1 / 30) * 1.12);
  });

  it('never goes below the minimum', () => {
    const g = make();
    run(g, 30, () => 0.1);
    expect(g.scale).toBe(0.5);
  });

  it('raises it again once the device has time to spare, but not straight away', () => {
    const g = make();
    run(g, 10, () => 0.1);
    expect(g.scale).toBe(0.5);
    run(g, 2, () => 1 / 60);
    expect(g.scale).toBe(0.5);
    run(g, 40, () => 1 / 60);
    expect(g.scale).toBe(1);
  });

  it('ignores a single long pause', () => {
    const g = make();
    run(g, 3, () => 1 / 40);
    g.frame(2);
    run(g, 3, () => 1 / 40);
    expect(g.scale).toBe(1);
  });
});

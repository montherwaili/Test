import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../fixedStep';

describe('FixedStepper', () => {
  it('runs two 120 Hz steps per 60 Hz frame', () => {
    const s = new FixedStepper(120);
    let n = 0;
    for (let frame = 0; frame < 600; frame++) n += s.advance(1 / 60, () => {});
    expect(n).toBe(1200);
  });

  it('passes the fixed dt to the step function', () => {
    const s = new FixedStepper(120);
    const seen: number[] = [];
    s.advance(0.05, (dt) => seen.push(dt));
    expect(seen).toEqual(new Array(6).fill(1 / 120));
  });

  it('carries the remainder between frames', () => {
    const s = new FixedStepper(100);
    expect(s.advance(0.015, () => {})).toBe(1);
    expect(s.alpha).toBeCloseTo(0.5);
    expect(s.advance(0.005, () => {})).toBe(1);
    expect(s.alpha).toBeCloseTo(0, 5);
  });

  it('runs the same number of steps however the time is sliced', () => {
    const total = 10;
    const even = new FixedStepper(120, 1000);
    let a = 0;
    for (let i = 0; i < 300; i++) a += even.advance(total / 300, () => {});

    const uneven = new FixedStepper(120, 1000);
    let b = 0;
    const slices = [0.004, 0.031, 0.016, 0.009, 0.04];
    let t = 0;
    for (let i = 0; t < total - 1e-9; i++) {
      const dt = Math.min(slices[i % slices.length]!, total - t);
      b += uneven.advance(dt, () => {});
      t += dt;
    }
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
    expect(a).toBe(1200);
  });

  it('caps the catch-up after a long pause instead of spiralling', () => {
    const s = new FixedStepper(120, 8);
    expect(s.advance(5, () => {})).toBe(8);
    expect(s.alpha).toBe(0);
    expect(s.advance(1 / 120, () => {})).toBe(1);
  });

  it('ignores zero, negative and NaN elapsed time', () => {
    const s = new FixedStepper(120);
    expect(s.advance(0, () => {})).toBe(0);
    expect(s.advance(-1, () => {})).toBe(0);
    expect(s.advance(NaN, () => {})).toBe(0);
    expect(s.alpha).toBe(0);
  });

  it('rejects a non-positive rate', () => {
    expect(() => new FixedStepper(0)).toThrow();
  });
});

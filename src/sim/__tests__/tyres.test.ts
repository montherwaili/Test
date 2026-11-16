import { describe, expect, it } from 'vitest';
import { lateralGripFactor, longitudinalGripFactor } from '../vehicle';

describe('tyre grip curves', () => {
  const peak = (7 * Math.PI) / 180;

  it('cornering grip builds linearly to the peak slip angle', () => {
    expect(lateralGripFactor(0, peak, 0.85)).toBe(0);
    expect(lateralGripFactor(peak / 2, peak, 0.85)).toBeCloseTo(0.5);
    expect(lateralGripFactor(peak, peak, 0.85)).toBeCloseTo(1);
  });

  it('cornering grip eases down to the sliding value past the peak', () => {
    expect(lateralGripFactor(peak * 2.5, peak, 0.85)).toBeLessThan(1);
    expect(lateralGripFactor(peak * 2.5, peak, 0.85)).toBeGreaterThan(0.85);
    expect(lateralGripFactor(Math.PI / 2, peak, 0.85)).toBeCloseTo(0.85);
    expect(lateralGripFactor(-Math.PI / 2, peak, 0.85)).toBeCloseTo(0.85);
  });

  it('drive grip is full up to the peak slip ratio then falls to the sliding value', () => {
    expect(longitudinalGripFactor(0, 0.12, 0.85)).toBe(1);
    expect(longitudinalGripFactor(0.12, 0.12, 0.85)).toBe(1);
    expect(longitudinalGripFactor(0.5, 0.12, 0.85)).toBeLessThan(1);
    expect(longitudinalGripFactor(1, 0.12, 0.85)).toBeCloseTo(0.85);
    expect(longitudinalGripFactor(-3, 0.12, 0.85)).toBeCloseTo(0.85);
  });
});

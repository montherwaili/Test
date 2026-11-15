import { describe, expect, it } from 'vitest';
import { clamp, sampleCurve, type CurvePoint } from '../curve';

describe('sampleCurve', () => {
  const pts: CurvePoint[] = [
    [0, 0],
    [10, 100],
    [20, 50],
  ];

  it('returns the points themselves', () => {
    expect(sampleCurve(pts, 0)).toBe(0);
    expect(sampleCurve(pts, 10)).toBe(100);
    expect(sampleCurve(pts, 20)).toBe(50);
  });

  it('interpolates linearly between points', () => {
    expect(sampleCurve(pts, 5)).toBeCloseTo(50);
    expect(sampleCurve(pts, 15)).toBeCloseTo(75);
  });

  it('holds the end values outside the range', () => {
    expect(sampleCurve(pts, -5)).toBe(0);
    expect(sampleCurve(pts, 99)).toBe(50);
  });

  it('handles an empty curve', () => {
    expect(sampleCurve([], 3)).toBe(0);
  });
});

describe('clamp', () => {
  it('limits to the range', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(0.4, 0, 1)).toBe(0.4);
  });
});

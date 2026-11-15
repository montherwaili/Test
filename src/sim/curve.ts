/** A point on a piecewise-linear curve: [x, y]. */
export type CurvePoint = [number, number];

/**
 * Sample a piecewise-linear curve. `points` must be sorted by x ascending.
 * Outside the range the first / last y value is held.
 */
export function sampleCurve(points: readonly CurvePoint[], x: number): number {
  const n = points.length;
  if (n === 0) return 0;
  const first = points[0]!;
  if (x <= first[0]) return first[1];
  const last = points[n - 1]!;
  if (x >= last[0]) return last[1];
  for (let i = 1; i < n; i++) {
    const b = points[i]!;
    if (x <= b[0]) {
      const a = points[i - 1]!;
      const t = (x - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * t;
    }
  }
  return last[1];
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export const RPM_PER_RAD_S = 60 / (2 * Math.PI);
export const RAD_S_PER_RPM = (2 * Math.PI) / 60;

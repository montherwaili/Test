/** 2D geometry on the ground plane: x east, z south (north is -z). Pure maths. */

export interface P2 {
  x: number;
  z: number;
}

export const DEG = Math.PI / 180;

/** Unit vector for a compass heading in degrees (0 = north, 90 = east). */
export function headingVector(headingDeg: number): P2 {
  const a = headingDeg * DEG;
  return { x: Math.sin(a), z: -Math.cos(a) };
}

/** The direction 90° to the right of `d`. */
export function rightOf(d: P2): P2 {
  return { x: -d.z, z: d.x };
}

/** Compass heading in degrees (0..360) of a direction vector. */
export function headingOf(d: P2): number {
  const h = Math.atan2(d.x, -d.z) / DEG;
  return h < 0 ? h + 360 : h;
}

/** Smallest signed difference a - b between two headings, in -180..180. */
export function headingDiff(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  else if (d < -180) d += 360;
  return d;
}

export function dist(a: P2, b: P2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * A smooth curve from point `a` heading `da` to point `b` heading `db`
 * (cubic Bézier), sampled into `segments` straight pieces. Collinear poses
 * give a straight line; a 90° turn gives a close approximation of an arc.
 */
export function connectPoses(a: P2, da: P2, b: P2, db: P2, segments = 12): P2[] {
  // 0.39 x chord is the handle length that turns a right-angle into a quarter circle.
  const h = dist(a, b) * 0.39;
  const c1 = { x: a.x + da.x * h, z: a.z + da.z * h };
  const c2 = { x: b.x - db.x * h, z: b.z - db.z * h };
  const out: P2[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    out.push({
      x: w0 * a.x + w1 * c1.x + w2 * c2.x + w3 * b.x,
      z: w0 * a.z + w1 * c1.z + w2 * c2.z + w3 * b.z,
    });
  }
  return out;
}

/**
 * Points along a circle. Angles in degrees, measured from east towards north
 * (anticlockwise on a north-up map); `to` may exceed 360 to wrap.
 */
export function arcPoints(centre: P2, radius: number, fromDeg: number, toDeg: number, stepDeg = 6): P2[] {
  const n = Math.max(1, Math.ceil(Math.abs(toDeg - fromDeg) / stepDeg));
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (fromDeg + ((toDeg - fromDeg) * i) / n) * DEG;
    out.push({ x: centre.x + radius * Math.cos(a), z: centre.z - radius * Math.sin(a) });
  }
  return out;
}

/** A polyline with cumulative lengths, for walking along it. */
export class Path {
  readonly points: P2[];
  /** Distance from the start to each point. */
  readonly offsets: number[];
  readonly length: number;

  constructor(points: P2[]) {
    if (points.length < 2) throw new Error('a path needs at least two points');
    this.points = points;
    this.offsets = [0];
    for (let i = 1; i < points.length; i++) {
      this.offsets.push(this.offsets[i - 1]! + dist(points[i - 1]!, points[i]!));
    }
    this.length = this.offsets[points.length - 1]!;
  }

  private segmentAt(s: number): number {
    const o = this.offsets;
    if (s <= 0) return 0;
    if (s >= this.length) return o.length - 2;
    let lo = 0;
    let hi = o.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (o[mid]! <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Point at distance `s` from the start (clamped to the ends). */
  pointAt(s: number): P2 {
    const i = this.segmentAt(s);
    const a = this.points[i]!;
    const b = this.points[i + 1]!;
    const len = this.offsets[i + 1]! - this.offsets[i]!;
    const t = len > 0 ? Math.min(1, Math.max(0, (s - this.offsets[i]!) / len)) : 0;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }

  /** Unit direction of travel at distance `s`. */
  directionAt(s: number): P2 {
    const i = this.segmentAt(s);
    const a = this.points[i]!;
    const b = this.points[i + 1]!;
    const len = dist(a, b) || 1;
    return { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
  }

  /**
   * Closest point on the path to `p`: distance along the path, the gap to it,
   * and which side `p` is on (`lateral` > 0 = to the right of travel).
   */
  project(p: P2): { s: number; distance: number; lateral: number } {
    let best = Infinity;
    let bestS = 0;
    let bestLat = 0;
    for (let i = 0; i < this.points.length - 1; i++) {
      const a = this.points[i]!;
      const b = this.points[i + 1]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz;
      if (len2 === 0) continue;
      const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
      const qx = a.x + dx * t;
      const qz = a.z + dz * t;
      const d = Math.hypot(p.x - qx, p.z - qz);
      if (d < best) {
        best = d;
        const len = Math.sqrt(len2);
        bestS = this.offsets[i]! + len * t;
        // Right of travel is (-dz, dx).
        bestLat = ((p.x - qx) * -dz + (p.z - qz) * dx) / len;
      }
    }
    return { s: bestS, distance: best, lateral: bestLat };
  }
}

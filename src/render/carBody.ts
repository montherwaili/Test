/**
 * A saloon car's body, built as smooth lofts: cross-sections set out along
 * its length and joined. Used for the player's car and, merged, for traffic.
 *
 * Car frame: facing -Z, Y up, origin at the centre of mass.
 */
import { BufferAttribute, BufferGeometry, CylinderGeometry, LatheGeometry, BoxGeometry, Vector2 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface BodySize {
  /** Nose and tail, z. */
  front: number;
  rear: number;
  width: number;
  /** Underside, the window line and the roof, y. */
  bottom: number;
  belt: number;
  roof: number;
  /** Axles, z; wheel centre height, y; wheel radius. */
  axles: [number, number];
  wheelY: number;
  wheelRadius: number;
}

interface Section {
  z: number;
  y0: number;
  y1: number;
  /** Half width at the bottom and at the top. */
  hw0: number;
  hw1: number;
}

/** A rounded-rectangle ring ("squircle", exponent n) per section, joined into a closed surface. */
function loft(sections: Section[], points = 28, n = 4): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const e = 2 / n;
  for (const s of sections) {
    const cy = (s.y0 + s.y1) / 2;
    const hh = (s.y1 - s.y0) / 2;
    for (let k = 0; k < points; k++) {
      const a = (k / points) * Math.PI * 2;
      const c = Math.cos(a);
      const si = Math.sin(a);
      const yy = cy + hh * Math.sign(si) * Math.abs(si) ** e;
      // Narrower towards the top (tumblehome).
      const f = hh > 1e-6 ? (yy - s.y0) / (s.y1 - s.y0) : 0;
      const hw = s.hw0 + (s.hw1 - s.hw0) * f;
      pos.push(hw * Math.sign(c) * Math.abs(c) ** e, yy, s.z);
    }
  }
  for (let i = 0; i < sections.length - 1; i++) {
    for (let k = 0; k < points; k++) {
      const a = i * points + k;
      const b = i * points + ((k + 1) % points);
      const c = a + points;
      const d = b + points;
      // Sections run front (-z) to rear: wind so the outside faces out.
      idx.push(a, b, d, a, d, c);
    }
  }
  // Close both ends with a fan.
  for (const [i, flip] of [
    [0, true],
    [sections.length - 1, false],
  ] as const) {
    const s = sections[i]!;
    const centre = pos.length / 3;
    pos.push(0, (s.y0 + s.y1) / 2, s.z);
    for (let k = 0; k < points; k++) {
      const a = i * points + k;
      const b = i * points + ((k + 1) % points);
      if (flip) idx.push(centre, b, a);
      else idx.push(centre, a, b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Piecewise-linear lookup in [u, value] pairs, smoothed. */
function keyed(keys: [number, number][], u: number): number {
  if (u <= keys[0]![0]) return keys[0]![1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [u0, v0] = keys[i]!;
    const [u1, v1] = keys[i + 1]!;
    if (u <= u1) {
      const t = (u - u0) / (u1 - u0);
      const s = t * t * (3 - 2 * t);
      return v0 + (v1 - v0) * s;
    }
  }
  return keys[keys.length - 1]![1];
}

export interface BodyParts {
  /** Painted: the lower body (with wheel arches) and the roof. */
  paint: BufferGeometry;
  glass: BufferGeometry;
  /** Black trim: the grille and the sills. */
  trim: BufferGeometry;
}

/** `detail`: 1 for the player's car, lower for the many traffic cars (fewer sections round and along). */
export function sedanBody(b: BodySize, detail = 1): BodyParts {
  const L = b.rear - b.front;
  const hw = b.width / 2;
  const z = (u: number) => b.front + u * L;
  const lift = b.belt - b.bottom;

  // --- lower body ---
  const lower: Section[] = [];
  const N = Math.max(16, Math.round(72 * detail));
  const ring = Math.max(12, Math.round(28 * detail));
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const zz = z(u);
    const top = keyed(
      [
        [0, b.bottom + lift * 0.62],
        [0.05, b.belt - lift * 0.16],
        [0.3, b.belt - lift * 0.05],
        [0.36, b.belt],
        [0.8, b.belt],
        [0.86, b.belt - lift * 0.02],
        [0.97, b.belt - lift * 0.08],
        [1, b.bottom + lift * 0.66],
      ],
      u,
    );
    // The underside rises at the bumpers and over each wheel (the arches).
    let under = b.bottom + 0.1 * Math.max(0, 1 - Math.min(u, 1 - u) / 0.1);
    for (const az of b.axles) {
      const dz = (zz - az) / (b.wheelRadius * 1.18);
      if (Math.abs(dz) < 1) under = Math.max(under, b.wheelY + b.wheelRadius * 1.08 * Math.sqrt(1 - dz * dz));
    }
    // Rounded corners in plan.
    const plan = (1 - Math.abs(2 * u - 1) ** 6) ** (1 / 6);
    const w = hw * (0.8 + 0.2 * plan);
    lower.push({ z: zz, y0: Math.min(under, top - 0.04), y1: top, hw0: w * 0.97, hw1: w * 0.93 });
  }

  // --- glasshouse: windscreen, side windows, rear screen ---
  const roofAt = (u: number) =>
    b.belt + (b.roof - b.belt) * Math.max(0.03, keyed([[0.31, 0], [0.47, 1], [0.66, 1], [0.8, 0]], u));
  const glass: Section[] = [];
  const G = Math.max(8, Math.round(40 * detail));
  for (let i = 0; i <= G; i++) {
    const u = 0.31 + (0.49 * i) / G;
    glass.push({ z: z(u), y0: b.belt - 0.03, y1: roofAt(u), hw0: hw * 0.92, hw1: hw * 0.78 });
  }

  // --- roof: a thin painted shell over the top of the glass ---
  const roof: Section[] = [];
  const R = Math.max(5, Math.round(20 * detail));
  for (let i = 0; i <= R; i++) {
    const u = 0.455 + (0.215 * i) / R;
    const top = roofAt(u) + 0.008;
    roof.push({ z: z(u), y0: top - 0.07, y1: top, hw0: hw * 0.8, hw1: hw * 0.78 });
  }

  // --- trim: the grille and a dark sill line ---
  const trimParts: BufferGeometry[] = [];
  const grille = new BoxGeometry(hw * 0.95, lift * 0.18, 0.04);
  grille.translate(0, b.bottom + lift * 0.5, z(0.012));
  trimParts.push(grille);
  for (const side of [-1, 1]) {
    const sill = new BoxGeometry(0.02, 0.06, L * 0.42);
    sill.translate(side * hw * 0.97, b.bottom + 0.05, z(0.5));
    trimParts.push(sill);
  }

  return {
    paint: mergeGeometries([loft(lower, ring), loft(roof, ring, 7)], false),
    glass: loft(glass, ring, 6),
    trim: mergeGeometries(trimParts.map((g) => g.toNonIndexed()), false),
  };
}

/** A tyre with a rounded shoulder, rolling about X. */
export function tyreGeometry(radius: number, width: number, segments = 28): BufferGeometry {
  const r = radius;
  const h = width / 2;
  const pts = [
    new Vector2(r * 0.66, -h),
    new Vector2(r * 0.92, -h),
    new Vector2(r * 0.985, -h * 0.82),
    new Vector2(r, -h * 0.45),
    new Vector2(r, h * 0.45),
    new Vector2(r * 0.985, h * 0.82),
    new Vector2(r * 0.92, h),
    new Vector2(r * 0.66, h),
  ];
  const g = new LatheGeometry(pts, segments);
  g.rotateZ(Math.PI / 2);
  return g;
}

/** A five-spoke alloy wheel, facing out along +X (mirror for the left side). */
export function rimGeometry(radius: number, width: number): BufferGeometry {
  const r = radius * 0.66;
  const parts: BufferGeometry[] = [];
  const barrel = new CylinderGeometry(r, r, width * 0.9, 24, 1, true);
  barrel.rotateZ(Math.PI / 2);
  parts.push(barrel);
  const hub = new CylinderGeometry(r * 0.24, r * 0.28, 0.05, 12);
  hub.rotateZ(Math.PI / 2);
  hub.translate(width * 0.42, 0, 0);
  parts.push(hub);
  for (let k = 0; k < 5; k++) {
    const spoke = new BoxGeometry(0.03, r * 0.82, r * 0.2);
    spoke.translate(width * 0.4, r * 0.5, 0);
    spoke.rotateX((k / 5) * Math.PI * 2);
    parts.push(spoke);
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
}

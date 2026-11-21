/**
 * A saloon car's body, built as smooth lofts: cross-sections set out along
 * its length and joined. Used for the player's car and, merged, for traffic.
 *
 * Car frame: facing -Z, Y up, origin at the centre of mass.
 */
import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, ExtrudeGeometry, LatheGeometry, Shape, Vector2 } from 'three';
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

export interface BodyParts {
  /** Painted: the body (with wheel arches) and the cabin. */
  paint: BufferGeometry;
  glass: BufferGeometry;
  /** Black trim: grille, lower bumpers, sills, window surrounds. */
  trim: BufferGeometry;
}

/**
 * Extrude a side profile (points in car z, y) across the car to `width`,
 * with rounded edges. Comes out centred on x = 0.
 */
function extrudeProfile(profile: Shape, width: number, round: number, smooth: number): BufferGeometry {
  const depth = Math.max(0.01, width - 2 * round);
  const g = new ExtrudeGeometry(profile, {
    depth,
    bevelEnabled: round > 0,
    bevelThickness: round,
    bevelSize: round * 0.8,
    bevelSegments: smooth,
    curveSegments: smooth * 4,
  });
  g.translate(0, 0, -depth / 2);
  // Profile x is the car's z; the extrusion runs along the car's x.
  g.rotateY(-Math.PI / 2);
  g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
}

/** Move every vertex's x by a function of its position (for curving extruded shapes). */
function shape(g: BufferGeometry, fx: (x: number, y: number, z: number) => number): void {
  const p = g.attributes['position']!;
  for (let i = 0; i < p.count; i++) p.setX(i, fx(p.getX(i), p.getY(i), p.getZ(i)));
  g.computeVertexNormals();
}

/** A flat panel through the given points (car x, y, z), as two triangles per quad. */
function panel(points: [number, number, number][]): BufferGeometry {
  const pos: number[] = [];
  for (let i = 1; i < points.length - 1; i++) pos.push(...points[0]!, ...points[i]!, ...points[i + 1]!);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}

function plain(g: BufferGeometry): BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('uv');
  return n;
}

/**
 * A saloon car: the body is its side profile (bumpers, bonnet, boot, wheel
 * arches) extruded across the car with rounded edges; the cabin a narrower
 * profile on top; the glass set into it. `detail` lowers the rounding for
 * the many traffic cars.
 */
export function sedanBody(b: BodySize, detail = 1): BodyParts {
  const L = b.rear - b.front;
  const z = (u: number) => b.front + u * L;
  const lift = b.belt - b.bottom;
  const smooth = detail >= 1 ? 3 : 1;
  const R = b.wheelRadius;
  const archR = R * 1.12;

  // --- body: side profile, front (low z) to rear ---
  const body = new Shape();
  body.moveTo(z(0.012), b.bottom + lift * 0.18);
  body.lineTo(z(0.0), b.bottom + lift * 0.42);
  body.lineTo(z(0.004), b.bottom + lift * 0.66);
  body.lineTo(z(0.03), b.belt - lift * 0.12);
  body.lineTo(z(0.12), b.belt - lift * 0.05);
  body.lineTo(z(0.3), b.belt + 0.005);
  body.lineTo(z(0.8), b.belt + 0.01);
  body.lineTo(z(0.95), b.belt - lift * 0.02);
  body.lineTo(z(0.995), b.belt - lift * 0.1);
  body.lineTo(z(1.0), b.bottom + lift * 0.42);
  body.lineTo(z(0.985), b.bottom + lift * 0.14);
  // Underside, rear to front, arching over each wheel.
  const [frontAxle, rearAxle] = b.axles;
  const under = b.bottom + 0.06;
  body.lineTo(rearAxle + archR, under);
  body.lineTo(rearAxle + archR, b.wheelY);
  body.absarc(rearAxle, b.wheelY, archR, 0, Math.PI, false);
  body.lineTo(rearAxle - archR, under);
  body.lineTo(frontAxle + archR, under);
  body.lineTo(frontAxle + archR, b.wheelY);
  body.absarc(frontAxle, b.wheelY, archR, 0, Math.PI, false);
  body.lineTo(frontAxle - archR, under);
  body.lineTo(z(0.012), b.bottom + lift * 0.18);
  const bodyGeo = extrudeProfile(body, b.width, 0.07 * Math.min(1, detail + 0.4), smooth);
  // Seen from above, nose and tail round off at the corners; the sides bow out a little at the middle.
  shape(bodyGeo, (x, y, zz) => {
    const e = Math.abs((zz - (b.front + b.rear) / 2) / (L / 2));
    const plan = 1 - 0.16 * Math.max(0, (e - 0.62) / 0.38) ** 2.2;
    // The body tucks in towards the bottom, as a real car's sides curve under.
    const tuck = 1 - 0.05 * Math.max(0, (b.bottom + lift * 0.35 - y) / (lift * 0.35));
    return x * plan * tuck;
  });

  // --- cabin: windscreen, roof, rear screen ---
  const cabinW = b.width * 0.86;
  const w0 = z(0.29); // foot of the windscreen
  const w1 = z(0.48); // top of the windscreen (well raked)
  const r1 = z(0.71); // top of the rear screen
  const r0 = z(0.86); // foot of the rear screen
  const top = b.roof;
  const cabin = new Shape();
  cabin.moveTo(w0, b.belt - 0.02);
  cabin.lineTo(w1, top - 0.02);
  cabin.quadraticCurveTo((w1 + r1) / 2, top + 0.03, r1, top - 0.03);
  cabin.lineTo(r0, b.belt - 0.02);
  cabin.lineTo(w0, b.belt - 0.02);
  const cabinGeo = extrudeProfile(cabin, cabinW, 0.06 * Math.min(1, detail + 0.4), smooth);
  // The cabin's sides lean in towards the roof (tumblehome).
  const tumble = (x: number, y: number) => x * (1 - 0.14 * Math.max(0, (y - b.belt) / (top - b.belt)));
  shape(cabinGeo, (x, y) => tumble(x, y));

  // --- glass ---
  const hx = cabinW / 2 + 0.004;
  const inset = 0.05;
  const along = (a: [number, number], c: [number, number], t: number): [number, number] => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
  // Side windows: inside the cabin's outline, split by the B pillar.
  const foot = b.belt + 0.035;
  const wsA: [number, number] = [w0 + 0.1, foot];
  const wsB: [number, number] = along([w0, b.belt], [w1, top], 0.93);
  const rsB: [number, number] = along([r0, b.belt], [r1, top], 0.92);
  const rsA: [number, number] = [r0 - 0.12, foot];
  const pillar = z(0.575);
  const glassParts: BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const roofLine = top - inset - 0.03;
    const at = (y: number, zz: number): [number, number, number] => [side * (tumble(hx, y) + 0.003), y, zz];
    glassParts.push(
      panel([at(wsA[1], wsA[0]), at(wsB[1] - inset * 0.5, wsB[0] + 0.03), at(roofLine, pillar - 0.05), at(foot, pillar - 0.05)]),
      panel([at(foot, pillar + 0.05), at(roofLine, pillar + 0.05), at(rsB[1] - inset * 0.5, rsB[0] - 0.03), at(rsA[1], rsA[0])]),
    );
  }
  // Windscreen and rear screen, lying just proud of the cabin's slopes.
  const screen = (a: [number, number], c: [number, number]) => {
    const hw = cabinW / 2 - 0.08;
    // The slope's normal, turned to face up and out of the cabin.
    let nz = -(c[1] - a[1]);
    let ny = c[0] - a[0];
    if (ny < 0) {
      nz = -nz;
      ny = -ny;
    }
    const n = Math.hypot(nz, ny);
    // Clear of the rounded edge the extrusion adds round the outline.
    const o = 0.07 / n;
    const p0: [number, number] = [a[0] + nz * o, a[1] + ny * o];
    const p1: [number, number] = [c[0] + nz * o, c[1] + ny * o];
    return panel([
      [-hw, p0[1], p0[0]],
      [hw, p0[1], p0[0]],
      [hw * 0.92, p1[1], p1[0]],
      [-hw * 0.92, p1[1], p1[0]],
    ]);
  };
  const wsFoot: [number, number] = [w0, b.belt - 0.02];
  const wsTop: [number, number] = [w1, top - 0.02];
  const rsFoot: [number, number] = [r0, b.belt - 0.02];
  const rsTop: [number, number] = [r1, top - 0.03];
  glassParts.push(screen(along(wsFoot, wsTop, 0.06), along(wsFoot, wsTop, 0.94)));
  glassParts.push(screen(along(rsFoot, rsTop, 0.06), along(rsFoot, rsTop, 0.93)));

  // --- trim: grille, lower bumpers, sills ---
  const trimParts: BufferGeometry[] = [];
  const grille = new BoxGeometry(b.width * 0.42, lift * 0.16, 0.04);
  grille.translate(0, b.bottom + lift * 0.55, z(0.004));
  trimParts.push(plain(grille));
  for (const zz of [z(0.01), z(0.99)]) {
    const bumper = new BoxGeometry(b.width * 0.9, lift * 0.1, 0.06);
    bumper.translate(0, b.bottom + lift * 0.22, zz);
    trimParts.push(plain(bumper));
  }
  for (const side of [-1, 1]) {
    const sill = new BoxGeometry(0.03, 0.07, (rearAxle - frontAxle) - 2 * archR - 0.1);
    sill.translate(side * (b.width / 2 - 0.005), under + 0.06, (frontAxle + rearAxle) / 2);
    trimParts.push(plain(sill));
  }

  return {
    paint: mergeGeometries([bodyGeo, cabinGeo], false),
    glass: mergeGeometries(glassParts, false),
    trim: mergeGeometries(trimParts, false),
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

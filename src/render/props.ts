/**
 * Shapes for the things along the streets: date palms, street lamps and
 * people. Low in triangles (there are hundreds of them), but shaped like the
 * real thing rather than stacked primitives.
 */
import { BufferAttribute, BufferGeometry, CylinderGeometry, LatheGeometry, SphereGeometry, Vector2 } from 'three';

/** One coloured piece of a prop. */
export interface Part {
  geometry: BufferGeometry;
  color: number;
}

/**
 * A palm frond: a curved spine arching out and drooping, with leaflets on
 * both sides angled down from it (a shallow V), wide in the middle and
 * pointed at the tip. Built along +X from the origin.
 */
function frond(length: number, droop: number, width: number, segments: number): BufferGeometry {
  const pos: number[] = [];
  const spine = (t: number) => ({ x: length * t, y: length * (0.35 * t - droop * t * t) });
  const half = (t: number) => width * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - 0.3 * t);
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    const a = spine(t0);
    const b = spine(t1);
    const w0 = half(t0);
    const w1 = half(t1);
    // The leaflets hang below the spine: the edges are lower than the middle.
    const sag0 = w0 * 0.45;
    const sag1 = w1 * 0.45;
    for (const s of [-1, 1]) {
      const quad = [
        [a.x, a.y, 0],
        [b.x, b.y, 0],
        [b.x, b.y - sag1, s * w1],
        [a.x, a.y - sag0, s * w0],
      ];
      const order = s > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      for (const k of order) pos.push(...(quad[k] as [number, number, number]));
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}

/** A date palm: a ringed, slightly leaning trunk, a crown of arching fronds and a skirt of old dry ones. */
export function datePalm(height: number, radius: number, seed: number, lite = false): Part[] {
  const rnd = (() => {
    let s = (seed * 2654435761) >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
  })();
  const parts: Part[] = [];
  // Trunk: tapered, ringed by the bases of old fronds.
  const trunk = new CylinderGeometry(radius * 0.75, radius, height, lite ? 5 : 6, lite ? 3 : 6, true);
  const p = trunk.attributes['position']!;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) + height / 2;
    const ring = 1 + 0.16 * Math.abs(Math.sin((y / 0.45) * Math.PI));
    p.setX(i, p.getX(i) * ring);
    p.setZ(i, p.getZ(i) * ring);
  }
  trunk.computeVertexNormals();
  trunk.translate(0, height / 2, 0);
  parts.push({ geometry: trunk, color: 0x7d6347 });
  // Crown.
  const n = lite ? 6 : 8;
  const greens = [0x4f7a3a, 0x5b8441, 0x46703a];
  for (let k = 0; k < n; k++) {
    const g = frond(2.6 + rnd() * 0.8, 0.85 + rnd() * 0.5, 0.38, lite ? 2 : 3);
    g.rotateZ(0.25 + rnd() * 0.35);
    g.rotateY((k / n) * Math.PI * 2 + rnd() * 0.3);
    g.translate(0, height + 0.15, 0);
    parts.push({ geometry: g, color: greens[k % greens.length]! });
  }
  if (lite) return parts;
  // Young fronds pointing up in the middle.
  for (let k = 0; k < 2; k++) {
    const g = frond(1.8, 0.1, 0.25, 2);
    g.rotateZ(1.1);
    g.rotateY((k / 2) * Math.PI * 2 + 0.5);
    g.translate(0, height + 0.2, 0);
    parts.push({ geometry: g, color: 0x6a9448 });
  }
  // Dry fronds hanging down under the crown.
  for (let k = 0; k < 3; k++) {
    const g = frond(1.6, 0.2, 0.22, 2);
    g.rotateZ(-1.2);
    g.rotateY((k / 3) * Math.PI * 2 + 0.8);
    g.translate(0, height - 0.1, 0);
    parts.push({ geometry: g, color: 0x9c8559 });
  }
  return parts;
}

/** A street lamp: a tapered pole, an arm reaching over the road along +X, and the lamp under its end. */
export function streetLamp(height: number, reach: number): { body: BufferGeometry; lamp: BufferGeometry } {
  const pole = new CylinderGeometry(0.06, 0.1, height, 6);
  pole.translate(0, height / 2, 0);
  const arm = new CylinderGeometry(0.04, 0.04, reach, 5);
  arm.rotateZ(Math.PI / 2 - 0.12);
  arm.translate(reach / 2, height + 0.1, 0);
  const lamp = new CylinderGeometry(0.22, 0.28, 0.12, 8);
  lamp.translate(reach, height + 0.12, 0);
  const strip = (g: BufferGeometry) => {
    g.deleteAttribute('uv');
    return g.index ? g.toNonIndexed() : g;
  };
  const body = new BufferGeometry();
  const a = strip(pole);
  const b = strip(arm);
  const merged = new Float32Array([...(a.attributes['position']!.array as Float32Array), ...(b.attributes['position']!.array as Float32Array)]);
  body.setAttribute('position', new BufferAttribute(merged, 3));
  body.computeVertexNormals();
  return { body, lamp: strip(lamp) };
}

/**
 * A person facing -Z, feet at y = 0, in a long robe: a dishdasha or an
 * abaya (the instance colour), with arms at the sides.
 */
export function robeGeometry(): BufferGeometry {
  const profile = [
    [0.0, 0.0],
    [0.27, 0.02],
    [0.25, 0.35],
    [0.21, 0.8],
    [0.2, 1.05],
    [0.22, 1.3],
    [0.2, 1.42],
    [0.08, 1.47],
    [0.0, 1.48],
  ].map(([r, y]) => new Vector2(r!, y!));
  const body = new LatheGeometry(profile, 10);
  // Shoulders wider than deep.
  body.scale(1, 1, 0.72);
  const parts: BufferGeometry[] = [body];
  for (const side of [-1, 1]) {
    const arm = new CylinderGeometry(0.055, 0.07, 0.62, 6);
    arm.rotateZ(side * 0.08);
    arm.translate(side * 0.255, 1.08, 0.02);
    parts.push(arm);
  }
  return joinPlain(parts);
}

/** Face and hands: bare skin. */
export function skinGeometry(): BufferGeometry {
  const head = new SphereGeometry(0.11, 10, 8);
  head.scale(0.9, 1.05, 0.95);
  head.translate(0, 1.6, 0);
  const parts: BufferGeometry[] = [head];
  for (const side of [-1, 1]) {
    const hand = new SphereGeometry(0.045, 6, 4);
    hand.translate(side * 0.265, 0.74, 0.02);
    parts.push(hand);
  }
  return joinPlain(parts);
}

/** What is worn on the head: a cap-and-scarf shape that also covers the neck (coloured per person). */
export function headwearGeometry(): BufferGeometry {
  // Over the crown and down the back to the shoulders, open at the face.
  const scarf = new SphereGeometry(0.125, 10, 8, Math.PI * 0.62, Math.PI * 1.76, 0, Math.PI * 0.62);
  scarf.scale(0.95, 1.1, 1);
  scarf.translate(0, 1.61, 0.005);
  const back = new CylinderGeometry(0.12, 0.17, 0.2, 10, 1, true, Math.PI * 0.5, Math.PI);
  back.translate(0, 1.47, 0.02);
  return joinPlain([scarf, back]);
}

/** Merge geometries keeping only positions and normals (their attributes differ otherwise). */
function joinPlain(parts: BufferGeometry[]): BufferGeometry {
  const arrays: number[] = [];
  for (const p of parts) {
    const g = p.index ? p.toNonIndexed() : p;
    arrays.push(...(g.attributes['position']!.array as Float32Array));
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(new Float32Array(arrays), 3));
  out.computeVertexNormals();
  return out;
}

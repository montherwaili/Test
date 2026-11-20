/**
 * Builds the visible version of a map from the same data the colliders use.
 * Nearly everything static is merged into a handful of meshes (one for paving,
 * one for all solid objects, one per paint colour), so a whole town costs
 * about a dozen draw calls.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  CONE_HEIGHT,
  CONE_RADIUS,
  MOSQUE,
  surfaceHeight,
  type BuiltMap,
  type MarkingColor,
  type SolidDef,
} from '../world/map';
import { datePalm, streetLamp } from './props';
import { asphaltDetail, facadeDetail, sandDetail } from './surfaceDetail';
import type { SignalState } from '../world/roads/signals';
import { signTexture, signTextureKey } from './signs';

const COLORS = {
  sand: 0xd9c49a,
  asphalt: 0x4a4c50,
  wall: 0xb8b2a6,
  kerb: 0xcfcbc2,
  pole: 0xe8531f,
  bump: 0xe0b020,
  island: 0xcfcbc2,
  planter: 0x7f9a55,
  trunk: 0x7a5a3a,
  leaf: 0x3f7d3a,
  metal: 0x6f7378,
  housing: 0x1d1f22,
  door: 0x6b4a2f,
  dome: 0xd9b45a,
  rock: 0xa98c66,
};

/** Wall colours for buildings: whites and warm sand tones. */
const BUILDING_STYLES = [0xf3efe6, 0xe9dcc3, 0xe2cfae, 0xf0e4d4];

const MARKING_COLORS: Record<MarkingColor, number> = { white: 0xf4f4f0, yellow: 0xf2c230 };

/** Height above the surface at which paint is drawn, to avoid z-fighting. */
const PAINT_LIFT = 0.015;

const SIGN_HEIGHT = 2.2;
const SIGN_SIZE = 0.8;
const SIGNAL_HEIGHT = 3.3;

const LAMP_COLORS: Record<SignalState, number> = { red: 0xff2a1f, amber: 0xffb000, green: 0x22e06a };
const LAMP_ORDER: SignalState[] = ['red', 'amber', 'green'];

export interface MapMeshes {
  root: Group;
  /** One mesh per loose cone, in the same order as `map.cones`. */
  cones: Mesh[];
  /** Light the lamps: called with the state of each signal group. */
  setSignals(stateOf: (junction: string, group: string) => SignalState): void;
  /** Dim the road paint at night (it is unlit, so it would otherwise glow). */
  setNight(night: boolean): void;
  /** Counts for the performance report. */
  stats: { meshes: number };
}

const NO_DETAIL = [0, 0, 0, 0] as const;

/** Anything geometry can be added to (a Batch, or a ChunkedBatch of them). */
interface Adder {
  add(g: BufferGeometry, color: number, x: number, y: number, z: number, yaw?: number, detail?: readonly [number, number, number, number]): void;
}

/** Collects geometries, coloured per piece, to be merged into one mesh. */
class Batch {
  private parts: BufferGeometry[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);

  /**
   * Add a geometry at a position, turned `yaw` radians about the vertical. The geometry is consumed.
   * `detail` marks surfaces for the shader (see surfaceDetail.ts): (1, wall start, wall length, height) for a building wall.
   */
  add(g: BufferGeometry, color: number, x: number, y: number, z: number, yaw = 0, detail: readonly [number, number, number, number] = NO_DETAIL): void {
    const geo = g.index ? g.toNonIndexed() : g;
    this.q.setFromAxisAngle(this.up, yaw);
    this.m.compose(new Vector3(x, y, z), this.q, new Vector3(1, 1, 1));
    geo.applyMatrix4(this.m);
    const c = new Color(color);
    const n = geo.attributes['position']!.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    const details = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) details.set(detail, i * 4);
    geo.setAttribute('detail', new BufferAttribute(details, 4));
    geo.deleteAttribute('uv');
    this.parts.push(geo);
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  build(): BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    merged.computeVertexNormals();
    return merged;
  }
}

/** Collects flat strips of paint into one geometry per colour. */
/** Size of the squares the map is cut into, m: what is behind the camera is then skipped, not drawn. */
const CHUNK = 200;
const chunkKey = (x: number, z: number) => `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;

/** A Batch per square of the map: each becomes its own mesh. */
class ChunkedBatch {
  private readonly chunks = new Map<string, Batch>();

  add(g: BufferGeometry, color: number, x: number, y: number, z: number, yaw = 0, detail: readonly [number, number, number, number] = NO_DETAIL): void {
    const key = chunkKey(x, z);
    let b = this.chunks.get(key);
    if (!b) this.chunks.set(key, (b = new Batch()));
    b.add(g, color, x, y, z, yaw, detail);
  }

  get empty(): boolean {
    return this.chunks.size === 0;
  }

  build(): BufferGeometry[] {
    return [...this.chunks.values()].map((b) => b.build());
  }
}

class PaintBatch {
  private readonly chunks = new Map<string, number[]>();

  constructor(private readonly map: BuiltMap) {}

  /** A strip from a to b (x, z on the ground), `width` wide, lying on the surface. */
  strip(ax: number, az: number, bx: number, bz: number, width: number): void {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return;
    const nx = (-dz / len) * (width / 2);
    const nz = (dx / len) * (width / 2);
    const corners: [number, number][] = [
      [ax + nx, az + nz],
      [ax - nx, az - nz],
      [bx - nx, bz - nz],
      [bx + nx, bz + nz],
    ];
    const p = corners.map(([x, z]) => [x, surfaceHeight(this.map, x, z) + PAINT_LIFT, z] as const);
    const key = chunkKey((ax + bx) / 2, (az + bz) / 2);
    let positions = this.chunks.get(key);
    if (!positions) this.chunks.set(key, (positions = []));
    for (const i of [0, 1, 2, 0, 2, 3]) positions.push(p[i]![0], p[i]![1], p[i]![2]);
  }

  /** A line through several points, solid or dashed ([painted, gap] metres). */
  polyline(points: readonly (readonly [number, number])[], width: number, dash?: readonly [number, number]): void {
    // Walk the line in short steps so it follows curves and slopes; `phase` tracks the dash pattern.
    const period = dash ? dash[0] + dash[1] : Infinity;
    let phase = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, az] = points[i]!;
      const [bx, bz] = points[i + 1]!;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) continue;
      let s = 0;
      while (s < len - 1e-9) {
        const inPeriod = dash ? phase % period : 0;
        const painting = !dash || inPeriod < dash[0];
        const untilChange = dash ? (painting ? dash[0] - inPeriod : period - inPeriod) : Infinity;
        // Never less than a millimetre: a dash boundary landing a rounding error away must not stall the walk.
        const step = Math.max(1e-3, Math.min(len - s, untilChange, 10));
        if (painting) {
          const t0 = s / len;
          const t1 = (s + step) / len;
          this.strip(ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1, width);
        }
        s += step;
        phase += step;
      }
    }
  }

  build(color: number): { meshes: Mesh[]; material: MeshBasicMaterial } {
    const material = new MeshBasicMaterial({ color, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const meshes = [...this.chunks.values()].map((positions) => {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
      const mesh = new Mesh(g, material);
      mesh.renderOrder = 2;
      return mesh;
    });
    return { meshes, material };
  }
}

function hillGeometry(width: number, ramp: number, plateau: number, rise: number): BufferGeometry {
  // Side profile in (z, y), climbing north (-Z) from the foot at z = 0.
  const profile: [number, number][] = [
    [0, 0],
    [-ramp, rise],
    [-ramp - plateau, rise],
    [-2 * ramp - plateau, 0],
  ];
  const h = width / 2;
  const v: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => v.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < 3; i++) {
    const [z0, y0] = profile[i]!;
    const [z1, y1] = profile[i + 1]!;
    quad([-h, y0, z0], [h, y0, z0], [h, y1, z1], [-h, y1, z1]); // road surface
    quad([h, 0, z0], [h, 0, z1], [h, y1, z1], [h, y0, z0]); // right flank
    quad([-h, 0, z1], [-h, 0, z0], [-h, y0, z0], [-h, y1, z1]); // left flank
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
  g.computeVertexNormals();
  return g;
}

/** A thin wall seen from both sides and above: its two faces and its top (the ends hardly show). Feet at y = 0. */
function wallGeometry(sx: number, h: number, sz: number): BufferGeometry {
  const alongX = sx >= sz;
  const len = alongX ? sx : sz;
  const t = alongX ? sz : sx;
  const parts: BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const face = new PlaneGeometry(len, h);
    face.rotateY(side < 0 ? Math.PI : 0);
    face.translate(0, h / 2, (side * t) / 2);
    parts.push(face);
  }
  const top = new PlaneGeometry(len, t);
  top.rotateX(-Math.PI / 2);
  top.translate(0, h, 0);
  parts.push(top);
  const g = mergeGeometries(parts, false);
  if (!alongX) g.rotateY(Math.PI / 2);
  return g;
}

function addBuilding(batch: Adder, s: Extract<SolidDef, { shape: 'box' }>, rnd: () => number): void {
  const [w, h, d] = s.size;
  const [x, , z] = s.center;
  const wall = BUILDING_STYLES[(s.style ?? 0) % BUILDING_STYLES.length]!;
  // Four walls, each marked for the shader to draw its windows (no window geometry: no triangles).
  // A plane faces +Z; turned by yaw it faces (sin yaw, cos yaw).
  const walls: [number, number, number, number, number, number][] = [
    // [centre x, centre z, width, yaw, start along, length]
    [x, z + d / 2, w, 0, x - w / 2, w],
    [x + w / 2, z, d, Math.PI / 2, z - d / 2, d],
    [x, z - d / 2, w, Math.PI, x - w / 2, w],
    [x - w / 2, z, d, -Math.PI / 2, z - d / 2, d],
  ];
  for (const [cx, cz, width, yaw, start, len] of walls) {
    batch.add(new PlaneGeometry(width, h), wall, cx, h / 2, cz, yaw, [1, start, len, h]);
  }
  const roof = new PlaneGeometry(w, d);
  roof.rotateX(-Math.PI / 2);
  batch.add(roof, new Color(wall).multiplyScalar(0.92).getHex(), x, h, z);
  // A parapet round the flat roof.
  for (const [px, pz, pw, pd] of [
    [0, d / 2 - 0.15, w, 0.3],
    [0, -d / 2 + 0.15, w, 0.3],
    [w / 2 - 0.15, 0, 0.3, d],
    [-w / 2 + 0.15, 0, 0.3, d],
  ] as const) {
    batch.add(wallGeometry(pw, 0.6, pd), wall, x + px, h, z + pz);
  }
  // A door, and on some roofs a water tank and an air-conditioning unit, as on many Omani houses.
  const side = Math.floor(rnd() * 4);
  const [cx, cz, , yaw] = walls[side]!;
  const out = 0.05;
  batch.add(new BoxGeometry(1.2, 2.3, 0.1), COLORS.door, cx + Math.sin(yaw) * out, 1.15, cz + Math.cos(yaw) * out, yaw);
  if (rnd() < 0.6) {
    const tx = x + (rnd() - 0.5) * (w - 3);
    const tz = z + (rnd() - 0.5) * (d - 3);
    batch.add(new CylinderGeometry(0.6, 0.6, 1.3, 7), 0xe9e6dc, tx, h + 0.65, tz);
  }
  if (rnd() < 0.7) {
    batch.add(new BoxGeometry(1.0, 0.7, 0.8), 0xc9ccce, x + (rnd() - 0.5) * (w - 2.5), h + 0.35, z + (rnd() - 0.5) * (d - 2.5));
  }
}

function addPalm(batch: Adder, x: number, z: number, height: number, radius: number, lite = false): void {
  const seed = Math.round(x * 13.7 + z * 7.3);
  for (const part of datePalm(height, radius, seed, lite)) batch.add(part.geometry, part.color, x, 0, z, (seed % 628) / 100);
}

/** `lite`: simpler palms and fewer lamps, for phones. */
export function buildMapMeshes(map: BuiltMap, lite = false): MapMeshes {
  const root = new Group();
  const def = map.def;
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  // --- ground and paving -----------------------------------------------------
  const sand = new MeshStandardMaterial({ color: COLORS.sand, roughness: 1 });
  sandDetail(sand);
  // In 100 m squares, for the same reason as the roads below.
  const cells = Math.max(1, Math.round(def.groundSize / 100));
  const ground = new Mesh(new PlaneGeometry(def.groundSize, def.groundSize, cells, cells), sand);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  // Roads are drawn a hair above the ground; the depth offset stops them
  // flickering against it in the distance.
  // Long roads are cut into short pieces: a kilometre-long triangle running
  // past the camera loses depth precision and the sand shows through it.
  const paving = new ChunkedBatch();
  for (const r of def.roads) {
    const dx = r.to[0] - r.from[0];
    const dz = r.to[1] - r.from[1];
    const len = Math.hypot(dx, dz);
    const pieces = Math.max(1, Math.ceil(len / 40));
    for (let k = 0; k < pieces; k++) {
      const t = (k + 0.5) / pieces;
      const g = new PlaneGeometry(r.width, len / pieces);
      g.rotateX(-Math.PI / 2);
      paving.add(g, COLORS.asphalt, r.from[0] + dx * t, 0.006, r.from[1] + dz * t, Math.atan2(dx, dz));
    }
  }
  for (const d of def.discs ?? []) {
    const g = new CircleGeometry(d.radius, 48);
    g.rotateX(-Math.PI / 2);
    paving.add(g, COLORS.asphalt, d.center[0], 0.006, d.center[1]);
  }
  if (!paving.empty) {
    const asphalt = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    asphaltDetail(asphalt);
    for (const geometry of paving.build()) {
      const mesh = new Mesh(geometry, asphalt);
      mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      root.add(mesh);
    }
  }

  // --- everything solid --------------------------------------------------------
  const solid = new ChunkedBatch();

  for (const h of map.hills) {
    const d = h.def;
    solid.add(hillGeometry(d.width, d.rampLength, d.plateauLength, h.rise), COLORS.asphalt, d.x, 0, d.z, (-(d.headingDeg ?? 0) * Math.PI) / 180);
  }

  for (const s of def.solids) {
    if (s.shape === 'box') {
      if (s.kind === 'building') addBuilding(solid, s, rnd);
      else if (s.kind === 'wall' && s.style !== undefined) {
        // A house's boundary wall: rendered like the house, in plaster.
        const wall = BUILDING_STYLES[s.style % BUILDING_STYLES.length]!;
        solid.add(wallGeometry(s.size[0], s.size[1], s.size[2]), wall, s.center[0], 0, s.center[2], 0, [3, 0, 0, 0]);
      } else {
        const color = s.kind === 'wall' ? COLORS.wall : COLORS.kerb;
        // Wide kerb boxes are pavements: paving slabs on top.
        const paved = s.kind !== 'wall' && Math.min(s.size[0], s.size[2]) >= 1.5;
        solid.add(
          new BoxGeometry(s.size[0], s.size[1], s.size[2]),
          color,
          s.center[0],
          s.center[1],
          s.center[2],
          ((s.yawDeg ?? 0) * Math.PI) / 180,
          paved ? [2, 0, 0, 0] : undefined,
        );
      }
    } else if (s.shape === 'cylinder') {
      if (s.kind === 'palm') addPalm(solid, s.center[0], s.center[2], s.height, s.radius, lite);
      else if (s.kind === 'island') {
        // The low outer ring is kerb stone; the taller middle is planted.
        const planted = s.height > 0.4;
        solid.add(new CylinderGeometry(s.radius, s.radius, s.height, 40), planted ? COLORS.planter : COLORS.island, s.center[0], s.center[1], s.center[2]);
        if (planted) {
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 + 0.5;
            addPalm(solid, s.center[0] + Math.cos(a) * s.radius * 0.45, s.center[2] + Math.sin(a) * s.radius * 0.45, 6 + i * 0.8, 0.24, lite);
          }
        }
      } else {
        solid.add(new CylinderGeometry(s.radius, s.radius, s.height, 8), COLORS.pole, s.center[0], s.center[1], s.center[2]);
      }
    } else {
      const g = new CylinderGeometry(s.radius, s.radius, s.width, 28, 1, false);
      g.rotateZ(Math.PI / 2);
      solid.add(g, COLORS.bump, s.center[0], s.height - s.radius, s.center[1], (-(s.headingDeg ?? 0) * Math.PI) / 180);
    }
  }

  // Street lamps along the pavements, every 40 m, the arm reaching over the road.
  const lampHeads: BufferGeometry[] = [];
  const lampPools: BufferGeometry[] = [];
  const onRoad = (x: number, z: number) =>
    def.roads.some((r) => {
      const dx = r.to[0] - r.from[0];
      const dz = r.to[1] - r.from[1];
      const len = Math.hypot(dx, dz);
      const along = ((x - r.from[0]) * dx + (z - r.from[1]) * dz) / len;
      const across = Math.abs(((x - r.from[0]) * -dz + (z - r.from[1]) * dx) / len);
      return along >= 0 && along <= len && across <= r.width / 2;
    });
  const lamp = streetLamp(7.5, 1.8);
  for (const sd of def.solids) {
    if (sd.shape !== 'box' || sd.kind !== 'kerb') continue;
    const [sx, , sz] = sd.size;
    const long = Math.max(sx, sz);
    if (Math.min(sx, sz) < 1.5 || long < 30) continue;
    const alongX = sx > sz;
    const count = Math.floor(long / (lite ? 70 : 40));
    for (let k = 0; k < count; k++) {
      const t = (k + 0.5) / count - 0.5;
      const x = sd.center[0] + (alongX ? t * long : 0);
      const z = sd.center[2] + (alongX ? 0 : t * long);
      // Which side is the road: the arm reaches that way.
      const nx = alongX ? 0 : 1;
      const nz = alongX ? 1 : 0;
      const towards = onRoad(x + nx * 4, z + nz * 4) ? 1 : onRoad(x - nx * 4, z - nz * 4) ? -1 : 0;
      if (towards === 0) continue;
      const yaw = Math.atan2(-nz * towards, nx * towards);
      solid.add(lamp.body.clone(), COLORS.metal, x, 0, z, yaw);
      const head = lamp.lamp.clone();
      head.applyMatrix4(new Matrix4().makeRotationY(yaw).setPosition(x, 0, z));
      lampHeads.push(head);
      // Where its light falls: a soft pool on the road, shown at night.
      const pool = new CircleGeometry(7, 16);
      pool.deleteAttribute('uv');
      pool.rotateX(-Math.PI / 2);
      pool.translate(x + Math.cos(yaw) * 1.8, 0.03, z - Math.sin(yaw) * 1.8);
      lampPools.push(pool);
    }
  }

  for (const m of def.mosques ?? []) {
    const white = 0xf6f3ea;
    solid.add(new BoxGeometry(MOSQUE.hall, MOSQUE.hallHeight, MOSQUE.hall), white, m.x, MOSQUE.hallHeight / 2, m.z);
    solid.add(new SphereGeometry(MOSQUE.hall * 0.3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), COLORS.dome, m.x, MOSQUE.hallHeight, m.z);
    const mx = m.x + MOSQUE.minaretOffset;
    const mz = m.z + MOSQUE.minaretOffset;
    solid.add(new CylinderGeometry(MOSQUE.minaretRadius * 0.8, MOSQUE.minaretRadius, MOSQUE.minaretHeight, 10), white, mx, MOSQUE.minaretHeight / 2, mz);
    solid.add(new CylinderGeometry(MOSQUE.minaretRadius * 1.3, MOSQUE.minaretRadius * 1.3, 0.5, 10), white, mx, MOSQUE.minaretHeight * 0.72, mz);
    solid.add(new ConeGeometry(MOSQUE.minaretRadius, 3, 10), COLORS.dome, mx, MOSQUE.minaretHeight + 1.5, mz);
    // An arched doorway facing the street.
    const a = (m.headingDeg * Math.PI) / 180;
    solid.add(new BoxGeometry(2.4, 3.6, 0.2), COLORS.door, m.x + Math.sin(a) * (MOSQUE.hall / 2), 1.8, m.z - Math.cos(a) * (MOSQUE.hall / 2), -a);
  }

  // Distant hills, so there is a horizon to steer by.
  const far = def.groundSize * 0.47;
  // Each is a broad, craggy peak with a lower shoulder beside it, so the skyline is a range, not a row of pyramids.
  const peaks = Math.round(46 * Math.max(1, def.groundSize / 760) ** 0.5);
  for (let i = 0; i < peaks; i++) {
    const angle = (i / peaks) * Math.PI * 2 + rnd() * 0.1;
    const scale = Math.max(1, def.groundSize / 1500);
    const radius = (40 + rnd() * 60) * scale;
    const height = (20 + rnd() * 55) * scale;
    const dist = far + rnd() * 30;
    const shade = new Color(COLORS.rock).offsetHSL(0, 0, (rnd() - 0.5) * 0.1).getHex();
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    solid.add(new ConeGeometry(radius, height, 9, 2), shade, x, height / 2 - 2, z, rnd() * Math.PI);
    const side = rnd() < 0.5 ? -1 : 1;
    solid.add(new ConeGeometry(radius * 0.8, height * 0.55, 8, 1), shade, x - Math.sin(angle) * radius * 0.7 * side, height * 0.275 - 2, z + Math.cos(angle) * radius * 0.7 * side, rnd() * Math.PI);
  }

  // --- signs: a pole and a back plate in the solid batch, the faces by texture ----
  const faces = new Map<string, BufferGeometry[]>();
  for (const s of def.signs ?? []) {
    const a = Math.PI - (s.facingDeg * Math.PI) / 180; // turn a +Z-facing plate to the compass heading
    const nx = Math.sin((s.facingDeg * Math.PI) / 180);
    const nz = -Math.cos((s.facingDeg * Math.PI) / 180);
    solid.add(new CylinderGeometry(0.04, 0.04, SIGN_HEIGHT + SIGN_SIZE / 2, 6), COLORS.metal, s.x, (SIGN_HEIGHT + SIGN_SIZE / 2) / 2, s.z);
    const face = new PlaneGeometry(SIGN_SIZE, SIGN_SIZE);
    face.applyMatrix4(new Matrix4().makeRotationY(a).setPosition(s.x + nx * 0.05, SIGN_HEIGHT, s.z + nz * 0.05));
    const key = signTextureKey(s);
    let list = faces.get(key);
    if (!list) faces.set(key, (list = []));
    list.push(face);
  }
  for (const [key, list] of faces) {
    const mesh = new Mesh(
      mergeGeometries(list, false),
      new MeshLambertMaterial({ map: signTexture(key), alphaTest: 0.5, side: DoubleSide }),
    );
    root.add(mesh);
  }

  // --- traffic signals --------------------------------------------------------------
  const lampMaterials = new Map<string, Record<SignalState, MeshStandardMaterial>>();
  const lampGeo = new CircleGeometry(0.12, 12);
  const lampGroups = new Map<string, Record<SignalState, BufferGeometry[]>>();
  for (const h of def.signalHeads ?? []) {
    const rad = (h.facingDeg * Math.PI) / 180;
    const a = Math.PI - rad;
    const nx = Math.sin(rad);
    const nz = -Math.cos(rad);
    solid.add(new CylinderGeometry(0.07, 0.09, SIGNAL_HEIGHT, 8), COLORS.metal, h.x, SIGNAL_HEIGHT / 2, h.z);
    solid.add(new BoxGeometry(0.42, 1.15, 0.3), COLORS.housing, h.x, SIGNAL_HEIGHT + 0.1, h.z, a);
    const key = `${h.junction}|${h.group}`;
    let geos = lampGroups.get(key);
    if (!geos) lampGroups.set(key, (geos = { red: [], amber: [], green: [] }));
    LAMP_ORDER.forEach((state, i) => {
      const g = lampGeo.clone();
      g.applyMatrix4(new Matrix4().makeRotationY(a).setPosition(h.x + nx * 0.16, SIGNAL_HEIGHT + 0.46 - i * 0.36, h.z + nz * 0.16));
      geos![state].push(g);
    });
  }
  for (const [key, geos] of lampGroups) {
    const mats = {} as Record<SignalState, MeshStandardMaterial>;
    for (const state of LAMP_ORDER) {
      const mat = new MeshStandardMaterial({ color: 0x111111, emissive: LAMP_COLORS[state], emissiveIntensity: 0.05, side: DoubleSide });
      mats[state] = mat;
      root.add(new Mesh(mergeGeometries(geos[state], false), mat));
    }
    lampMaterials.set(key, mats);
  }
  const setSignals: MapMeshes['setSignals'] = (stateOf) => {
    for (const [key, mats] of lampMaterials) {
      const [junction, group] = key.split('|') as [string, string];
      const now = stateOf(junction, group);
      for (const state of LAMP_ORDER) mats[state].emissiveIntensity = state === now ? 3 : 0.05;
    }
  };

  if (!solid.empty) {
    const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
    facadeDetail(material);
    for (const geometry of solid.build()) {
      const mesh = new Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
  }

  let poolMesh: Mesh | null = null;
  const lampGlass = new MeshStandardMaterial({ color: 0xdddddd, emissive: 0xffd9a0, emissiveIntensity: 0.05, roughness: 0.4 });
  if (lampHeads.length > 0) root.add(new Mesh(mergeGeometries(lampHeads, false), lampGlass));
  // Pools of lamplight: added on top of the ground, brightest under the lamp, fading out.
  const poolMaterial = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -6,
    uniforms: { uStrength: { value: 0 } },
    vertexShader: 'varying vec2 vLocal; attribute vec2 centre; void main(){ vLocal = position.xz - centre; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader:
      'uniform float uStrength; varying vec2 vLocal; void main(){ float d = length(vLocal) / 7.0; float a = uStrength * (1.0 - smoothstep(0.0, 1.0, d)); gl_FragColor = vec4(vec3(1.0, 0.78, 0.5) * a, 1.0); }',
  });
  if (lampPools.length > 0) {
    // Each pool knows its own centre, for the fade.
    for (const g of lampPools) {
      const p = g.attributes['position']!;
      const centre = new Float32Array(p.count * 2);
      const cx = p.getX(0);
      const cz = p.getZ(0);
      for (let i = 0; i < p.count; i++) {
        centre[i * 2] = cx;
        centre[i * 2 + 1] = cz;
      }
      g.setAttribute('centre', new BufferAttribute(centre, 2));
    }
    const pools = new Mesh(mergeGeometries(lampPools, false), poolMaterial);
    pools.renderOrder = 3;
    pools.visible = false;
    poolMesh = pools;
    root.add(pools);
  }

  // --- paint ------------------------------------------------------------------------
  const batches = new Map<MarkingColor, PaintBatch>();
  const batch = (c: MarkingColor) => {
    let b = batches.get(c);
    if (!b) batches.set(c, (b = new PaintBatch(map)));
    return b;
  };
  for (const m of def.markings) {
    if (m.type === 'line') batch(m.color).polyline([m.from, m.to], m.width, m.dash);
    else if (m.type === 'polyline') batch(m.color).polyline(m.points, m.width, m.dash);
    else if (m.type === 'rect') {
      const [cx, cz] = m.center;
      const hx = m.size[0] / 2;
      const hz = m.size[1] / 2;
      batch(m.color).polyline(
        [
          [cx - hx, cz - hz],
          [cx + hx, cz - hz],
          [cx + hx, cz + hz],
          [cx - hx, cz + hz],
          [cx - hx, cz - hz],
        ],
        m.width,
      );
    } else {
      const ring = new Mesh(
        new RingGeometry(m.radius - m.width / 2, m.radius + m.width / 2, 72),
        new MeshBasicMaterial({ color: MARKING_COLORS[m.color], side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(m.center[0], PAINT_LIFT, m.center[1]);
      ring.renderOrder = 2;
      root.add(ring);
    }
  }
  const paintMaterials: { material: MeshBasicMaterial; day: number }[] = [];
  for (const [color, b] of batches) {
    const { meshes, material } = b.build(MARKING_COLORS[color]);
    if (meshes.length === 0) continue;
    root.add(...meshes);
    paintMaterials.push({ material, day: MARKING_COLORS[color] });
  }
  const setNight: MapMeshes['setNight'] = (night) => {
    for (const p of paintMaterials) p.material.color.set(p.day).multiplyScalar(night ? 0.35 : 1);
    lampGlass.emissiveIntensity = night ? 3 : 0.05;
    poolMaterial.uniforms.uStrength!.value = night ? 0.32 : 0;
    if (poolMesh) poolMesh.visible = night;
  };

  // --- loose cones ----------------------------------------------------------------
  const coneGeo = new ConeGeometry(CONE_RADIUS, CONE_HEIGHT, 10);
  const coneMat = new MeshStandardMaterial({ color: 0xf26a1b, roughness: 0.7, flatShading: true });
  const cones = map.cones.map(() => {
    const cone = new Mesh(coneGeo, coneMat);
    cone.castShadow = true;
    root.add(cone);
    return cone;
  });

  let meshes = 0;
  root.traverse((o) => {
    if ((o as Mesh).isMesh) meshes++;
  });
  return { root, cones, setSignals, setNight, stats: { meshes } };
}

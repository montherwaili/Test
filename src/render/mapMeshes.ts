/**
 * Builds the visible version of a map from the same data the colliders use.
 * Nearly everything static is merged into a handful of meshes (one for paving,
 * one for all solid objects, one per paint colour), so a whole town costs
 * about a dozen draw calls.
 */
import {
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
  window: 0x2c3944,
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

/** Collects geometries, coloured per piece, to be merged into one mesh. */
class Batch {
  private parts: BufferGeometry[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);

  /** Add a geometry at a position, turned `yaw` radians about the vertical. The geometry is consumed. */
  add(g: BufferGeometry, color: number, x: number, y: number, z: number, yaw = 0): void {
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
class PaintBatch {
  private positions: number[] = [];

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
    for (const i of [0, 1, 2, 0, 2, 3]) this.positions.push(p[i]![0], p[i]![1], p[i]![2]);
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
        const step = Math.max(1e-3, Math.min(len - s, untilChange, 4));
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

  build(color: number): Mesh<BufferGeometry, MeshBasicMaterial> | null {
    if (this.positions.length === 0) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    const mesh = new Mesh(
      g,
      new MeshBasicMaterial({ color, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    mesh.renderOrder = 2;
    return mesh;
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

function addBuilding(batch: Batch, s: Extract<SolidDef, { shape: 'box' }>, rnd: () => number): void {
  const [w, h, d] = s.size;
  const [x, , z] = s.center;
  const wall = BUILDING_STYLES[(s.style ?? 0) % BUILDING_STYLES.length]!;
  batch.add(new BoxGeometry(w, h, d), wall, x, h / 2, z);
  // A parapet round the flat roof.
  for (const [px, pz, pw, pd] of [
    [0, d / 2 - 0.15, w, 0.3],
    [0, -d / 2 + 0.15, w, 0.3],
    [w / 2 - 0.15, 0, 0.3, d],
    [-w / 2 + 0.15, 0, 0.3, d],
  ] as const) {
    batch.add(new BoxGeometry(pw, 0.6, pd), wall, x + px, h + 0.3, z + pz);
  }
  // Windows on every floor, on all four sides; a door on one.
  const floors = Math.max(1, Math.round(h / 3.2));
  const doorSide = Math.floor(rnd() * 4);
  for (let side = 0; side < 4; side++) {
    const along = side % 2 === 0 ? w : d;
    const out = (side % 2 === 0 ? d : w) / 2 + 0.03;
    const count = Math.max(1, Math.floor(along / 3.4));
    for (let f = 0; f < floors; f++) {
      for (let i = 0; i < count; i++) {
        const a = -along / 2 + ((i + 0.5) * along) / count;
        const isDoor = f === 0 && side === doorSide && i === Math.floor(count / 2);
        const g = isDoor ? new BoxGeometry(1.1, 2.2, 0.08) : new BoxGeometry(1.0, 1.3, 0.08);
        const y = isDoor ? 1.1 : f * 3.2 + 1.9;
        const sign = side < 2 ? 1 : -1;
        if (side % 2 === 0) batch.add(g, isDoor ? COLORS.door : COLORS.window, x + a, y, z + sign * out);
        else batch.add(g, isDoor ? COLORS.door : COLORS.window, x + sign * out, y, z + a, Math.PI / 2);
      }
    }
  }
}

function addPalm(batch: Batch, x: number, z: number, height: number, radius: number): void {
  batch.add(new CylinderGeometry(radius * 0.7, radius, height, 6), COLORS.trunk, x, height / 2, z);
  // A crown of drooping fronds: two flattened cones.
  const upper = new ConeGeometry(2.4, 1.1, 7);
  batch.add(upper, COLORS.leaf, x, height + 0.3, z);
  const lower = new ConeGeometry(3.0, 0.7, 7);
  lower.rotateX(Math.PI);
  batch.add(lower, COLORS.leaf, x, height - 0.1, z, 0.4);
}

export function buildMapMeshes(map: BuiltMap): MapMeshes {
  const root = new Group();
  const def = map.def;
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  // --- ground and paving -----------------------------------------------------
  const ground = new Mesh(
    new PlaneGeometry(def.groundSize, def.groundSize),
    new MeshStandardMaterial({ color: COLORS.sand, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  // Roads are drawn a hair above the ground; the depth offset stops them
  // flickering against it in the distance.
  const paving = new Batch();
  for (const r of def.roads) {
    const dx = r.to[0] - r.from[0];
    const dz = r.to[1] - r.from[1];
    const g = new PlaneGeometry(r.width, Math.hypot(dx, dz));
    g.rotateX(-Math.PI / 2);
    paving.add(g, COLORS.asphalt, (r.from[0] + r.to[0]) / 2, 0.006, (r.from[1] + r.to[1]) / 2, Math.atan2(dx, dz));
  }
  for (const d of def.discs ?? []) {
    const g = new CircleGeometry(d.radius, 48);
    g.rotateX(-Math.PI / 2);
    paving.add(g, COLORS.asphalt, d.center[0], 0.006, d.center[1]);
  }
  if (!paving.empty) {
    const mesh = new Mesh(
      paving.build(),
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    );
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    root.add(mesh);
  }

  // --- everything solid --------------------------------------------------------
  const solid = new Batch();

  for (const h of map.hills) {
    const d = h.def;
    solid.add(hillGeometry(d.width, d.rampLength, d.plateauLength, h.rise), COLORS.asphalt, d.x, 0, d.z, (-(d.headingDeg ?? 0) * Math.PI) / 180);
  }

  for (const s of def.solids) {
    if (s.shape === 'box') {
      if (s.kind === 'building') addBuilding(solid, s, rnd);
      else {
        const color = s.kind === 'wall' ? COLORS.wall : COLORS.kerb;
        solid.add(new BoxGeometry(s.size[0], s.size[1], s.size[2]), color, s.center[0], s.center[1], s.center[2], ((s.yawDeg ?? 0) * Math.PI) / 180);
      }
    } else if (s.shape === 'cylinder') {
      if (s.kind === 'palm') addPalm(solid, s.center[0], s.center[2], s.height, s.radius);
      else if (s.kind === 'island') {
        // The low outer ring is kerb stone; the taller middle is planted.
        const planted = s.height > 0.4;
        solid.add(new CylinderGeometry(s.radius, s.radius, s.height, 40), planted ? COLORS.planter : COLORS.island, s.center[0], s.center[1], s.center[2]);
        if (planted) {
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 + 0.5;
            addPalm(solid, s.center[0] + Math.cos(a) * s.radius * 0.45, s.center[2] + Math.sin(a) * s.radius * 0.45, 6 + i * 0.8, 0.24);
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
  for (let i = 0; i < 46; i++) {
    const angle = (i / 46) * Math.PI * 2 + rnd() * 0.1;
    const radius = 28 + rnd() * 50;
    const height = 18 + rnd() * 60;
    const dist = far + rnd() * 30;
    const shade = new Color(COLORS.rock).offsetHSL(0, 0, (rnd() - 0.5) * 0.08).getHex();
    solid.add(new ConeGeometry(radius, height, 5 + Math.floor(rnd() * 3)), shade, Math.cos(angle) * dist, height / 2 - 2, Math.sin(angle) * dist, rnd() * Math.PI);
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
    const mesh = new Mesh(solid.build(), new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
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
    const mesh = b.build(MARKING_COLORS[color]);
    if (!mesh) continue;
    root.add(mesh);
    paintMaterials.push({ material: mesh.material, day: MARKING_COLORS[color] });
  }
  const setNight: MapMeshes['setNight'] = (night) => {
    for (const p of paintMaterials) p.material.color.set(p.day).multiplyScalar(night ? 0.35 : 1);
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

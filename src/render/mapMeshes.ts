/** Builds the visible version of a map from the same data the colliders use. */
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  BoxGeometry,
  PlaneGeometry,
  RingGeometry,
} from 'three';
import {
  CONE_HEIGHT,
  CONE_RADIUS,
  surfaceHeight,
  type BuiltMap,
  type MarkingColor,
  type SolidKind,
} from '../world/map';

const SOLID_COLORS: Record<SolidKind, number> = {
  wall: 0xb8b2a6,
  kerb: 0xd8d4cc,
  pole: 0xe8531f,
  bump: 0xe0b020,
};

const MARKING_COLORS: Record<MarkingColor, number> = { white: 0xf4f4f0, yellow: 0xf2c230 };

/** Height above the surface at which paint is drawn, to avoid z-fighting. */
const PAINT_LIFT = 0.015;

export interface MapMeshes {
  root: Group;
  /** One mesh per loose cone, in the same order as `map.cones`. */
  cones: Mesh[];
}

/** Collects flat quads into one geometry per colour. */
class QuadBatch {
  private positions: number[] = [];

  /** A strip from a to b (x, z on the ground), `width` wide. */
  strip(map: BuiltMap, ax: number, az: number, bx: number, bz: number, width: number): void {
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
    // Paint follows the surface (so lines on the hill sit on the hill).
    const p = corners.map(([x, z]) => [x, surfaceHeight(map, x, z) + PAINT_LIFT, z] as const);
    for (const i of [0, 1, 2, 0, 2, 3]) this.positions.push(p[i]![0], p[i]![1], p[i]![2]);
  }

  build(color: number): Mesh {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    g.computeVertexNormals();
    const mesh = new Mesh(
      g,
      new MeshBasicMaterial({ color, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    mesh.renderOrder = 2;
    return mesh;
  }
}

function hillGeometry(width: number, ramp: number, plateau: number, rise: number): BufferGeometry {
  // Side profile in (z, y), heading north (-Z) from the foot at z = 0.
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

export function buildMapMeshes(map: BuiltMap): MapMeshes {
  const root = new Group();
  const def = map.def;

  const sand = new MeshStandardMaterial({ color: 0xd9c49a, roughness: 1 });
  // Roads and paint are drawn a hair above the ground; the depth offset stops
  // them flickering against it in the distance.
  const asphalt = new MeshStandardMaterial({
    color: 0x4a4c50,
    roughness: 0.95,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const ground = new Mesh(new PlaneGeometry(def.groundSize, def.groundSize), sand);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  for (const r of def.roads) {
    const dx = r.to[0] - r.from[0];
    const dz = r.to[1] - r.from[1];
    const len = Math.hypot(dx, dz);
    const road = new Mesh(new PlaneGeometry(r.width, len), asphalt);
    road.rotation.x = -Math.PI / 2;
    road.rotation.z = Math.atan2(dx, dz) + Math.PI;
    road.position.set((r.from[0] + r.to[0]) / 2, 0.006, (r.from[1] + r.to[1]) / 2);
    road.receiveShadow = true;
    road.renderOrder = 1;
    root.add(road);
  }

  for (const h of map.hills) {
    const d = h.def;
    const hill = new Mesh(hillGeometry(d.width, d.rampLength, d.plateauLength, h.rise), asphalt);
    hill.position.set(d.x, 0, d.z);
    hill.receiveShadow = true;
    hill.castShadow = true;
    root.add(hill);
  }

  const solidMat = new Map<SolidKind, MeshStandardMaterial>();
  const matFor = (kind: SolidKind) => {
    let m = solidMat.get(kind);
    if (!m) {
      m = new MeshStandardMaterial({ color: SOLID_COLORS[kind], roughness: 0.85, flatShading: true });
      solidMat.set(kind, m);
    }
    return m;
  };
  for (const s of def.solids) {
    let mesh: Mesh;
    if (s.shape === 'box') {
      mesh = new Mesh(new BoxGeometry(s.size[0], s.size[1], s.size[2]), matFor(s.kind));
      mesh.position.set(s.center[0], s.center[1], s.center[2]);
      if (s.yawDeg) mesh.rotation.y = (s.yawDeg * Math.PI) / 180;
    } else if (s.shape === 'cylinder') {
      mesh = new Mesh(new CylinderGeometry(s.radius, s.radius, s.height, 8), matFor(s.kind));
      mesh.position.set(s.center[0], s.center[1], s.center[2]);
    } else {
      const g = new CylinderGeometry(s.radius, s.radius, s.width, 28, 1, false);
      g.rotateZ(Math.PI / 2);
      mesh = new Mesh(g, matFor('bump'));
      mesh.position.set(s.center[0], s.height - s.radius, s.center[1]);
    }
    mesh.castShadow = s.shape !== 'bump';
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  // Painted markings, batched per colour.
  const batches = new Map<MarkingColor, QuadBatch>();
  const batch = (c: MarkingColor) => {
    let b = batches.get(c);
    if (!b) batches.set(c, (b = new QuadBatch()));
    return b;
  };
  for (const m of def.markings) {
    if (m.type === 'line') {
      const b = batch(m.color);
      const dx = m.to[0] - m.from[0];
      const dz = m.to[1] - m.from[1];
      const len = Math.hypot(dx, dz);
      if (!m.dash) {
        // Split long lines so they can follow a change of slope.
        const pieces = Math.max(1, Math.ceil(len / 10));
        for (let i = 0; i < pieces; i++) {
          const a = i / pieces;
          const z = (i + 1) / pieces;
          b.strip(map, m.from[0] + dx * a, m.from[1] + dz * a, m.from[0] + dx * z, m.from[1] + dz * z, m.width);
        }
      } else {
        const [on, off] = m.dash;
        for (let s = 0; s < len; s += on + off) {
          const e = Math.min(len, s + on);
          b.strip(
            map,
            m.from[0] + (dx * s) / len,
            m.from[1] + (dz * s) / len,
            m.from[0] + (dx * e) / len,
            m.from[1] + (dz * e) / len,
            m.width,
          );
        }
      }
    } else if (m.type === 'rect') {
      const b = batch(m.color);
      const [cx, cz] = m.center;
      const hx = m.size[0] / 2;
      const hz = m.size[1] / 2;
      b.strip(map, cx - hx, cz - hz, cx + hx, cz - hz, m.width);
      b.strip(map, cx + hx, cz - hz, cx + hx, cz + hz, m.width);
      b.strip(map, cx + hx, cz + hz, cx - hx, cz + hz, m.width);
      b.strip(map, cx - hx, cz + hz, cx - hx, cz - hz, m.width);
    } else {
      const ring = new Mesh(
        new RingGeometry(m.radius - m.width / 2, m.radius + m.width / 2, 72),
        new MeshBasicMaterial({
          color: MARKING_COLORS[m.color],
          side: DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(m.center[0], PAINT_LIFT, m.center[1]);
      ring.renderOrder = 2;
      root.add(ring);
    }
  }
  for (const [color, b] of batches) root.add(b.build(MARKING_COLORS[color]));

  // Loose cones.
  const coneGeo = new ConeGeometry(CONE_RADIUS, CONE_HEIGHT, 10);
  const coneMat = new MeshStandardMaterial({ color: 0xf26a1b, roughness: 0.7, flatShading: true });
  const cones = map.cones.map(() => {
    const cone = new Mesh(coneGeo, coneMat);
    cone.castShadow = true;
    root.add(cone);
    return cone;
  });

  // Distant hills, so there is a horizon to steer by.
  const rock = new MeshStandardMaterial({ color: 0xa98c66, roughness: 1, flatShading: true });
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const far = def.groundSize * 0.47;
  for (let i = 0; i < 46; i++) {
    const angle = (i / 46) * Math.PI * 2 + rnd() * 0.1;
    const radius = 28 + rnd() * 50;
    const height = 18 + rnd() * 60;
    const peak = new Mesh(new ConeGeometry(radius, height, 5 + Math.floor(rnd() * 3)), rock.clone());
    const dist = far + rnd() * 30;
    peak.position.set(Math.cos(angle) * dist, height / 2 - 2, Math.sin(angle) * dist);
    peak.rotation.y = rnd() * Math.PI;
    (peak.material as MeshStandardMaterial).color = new Color(0xa98c66).offsetHSL(0, 0, (rnd() - 0.5) * 0.08);
    root.add(peak);
  }

  // A disc marking the spawn point.
  const spawn = new Mesh(
    new CircleGeometry(0.25, 16),
    new MeshBasicMaterial({ color: 0xf4f4f0, side: DoubleSide }),
  );
  spawn.rotation.x = -Math.PI / 2;
  spawn.position.set(def.spawn.x + 2.6, PAINT_LIFT, def.spawn.z);
  root.add(spawn);

  return { root, cones };
}

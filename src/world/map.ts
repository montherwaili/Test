/**
 * Map data: the description of a place (ground, roads, hills, solid objects,
 * loose cones, painted markings) as plain data, and the code that builds its
 * physics colliders. Rendering reads the same description, so what you see is
 * what you hit.
 */
import type { Quat, Vec3 } from '../sim/vehicle';
import { quatFromEulerDeg, type LooseBody, type PhysicsWorld } from './physics';
import type { MosqueDef, SignDef, SignalHeadDef, TownLayout } from './roads/generate';
import type { RoadNetwork } from './roads/network';

export type SolidKind = 'wall' | 'kerb' | 'pole' | 'bump' | 'building' | 'palm' | 'island';

export interface BoxSolid {
  kind: SolidKind;
  shape: 'box';
  /** Centre [x, y, z], m. */
  center: [number, number, number];
  /** Full size [x, y, z], m. */
  size: [number, number, number];
  yawDeg?: number;
  /** Buildings: which of the colour schemes to use. */
  style?: number;
}

export interface CylinderSolid {
  kind: SolidKind;
  shape: 'cylinder';
  center: [number, number, number];
  height: number;
  radius: number;
}

/** A rounded speed bump across a lane: the visible top of a buried cylinder. */
export interface BumpSolid {
  kind: 'bump';
  shape: 'bump';
  /** Centre on the ground [x, z]. */
  center: [number, number];
  /** Across the lane, m. */
  width: number;
  height: number;
  /** Radius of the rounded profile, m. */
  radius: number;
  /** Direction of the road it lies across, compass degrees (default 0 = north). */
  headingDeg?: number;
}

export type SolidDef = BoxSolid | CylinderSolid | BumpSolid;

/** A hill on a straight road: up-ramp, flat top, down-ramp. */
export interface HillDef {
  /** Foot of the climb, on the road centre line. */
  x: number;
  z: number;
  /** Direction of the climb, compass degrees (default 0 = north, -Z). */
  headingDeg?: number;
  width: number;
  gradePercent: number;
  /** Horizontal length of each ramp, m. */
  rampLength: number;
  plateauLength: number;
}

export interface RoadDef {
  from: [number, number];
  to: [number, number];
  width: number;
}

export type MarkingColor = 'white' | 'yellow';

export type MarkingDef =
  | { type: 'line'; from: [number, number]; to: [number, number]; width: number; color: MarkingColor; dash?: [number, number] }
  | { type: 'polyline'; points: [number, number][]; width: number; color: MarkingColor; dash?: [number, number] }
  | { type: 'rect'; center: [number, number]; size: [number, number]; width: number; color: MarkingColor }
  | { type: 'circle'; center: [number, number]; radius: number; width: number; color: MarkingColor };

export interface MapDef {
  id: string;
  /** Side of the square ground, m. */
  groundSize: number;
  spawn: { x: number; z: number; headingDeg: number };
  roads: RoadDef[];
  /** Round paved areas (roundabouts, turning circles). */
  discs?: { center: [number, number]; radius: number }[];
  hills: HillDef[];
  solids: SolidDef[];
  /** Loose cones, [x, z]. */
  cones: [number, number][];
  markings: MarkingDef[];
  signs?: SignDef[];
  signalHeads?: SignalHeadDef[];
  mosques?: MosqueDef[];
}

export const CONE_HEIGHT = 0.5;
export const CONE_RADIUS = 0.14;
const CONE_MASS = 2;
/** Thickness of the slab that forms a hill's ramps, m. */
const RAMP_THICKNESS = 0.4;

export interface HillShape {
  def: HillDef;
  /** Height of the flat top, m. */
  rise: number;
  /** Slope angle, rad. */
  angle: number;
}

export interface BuiltMap {
  def: MapDef;
  hills: HillShape[];
  cones: LooseBody[];
  /** Collider handles by what they are, for the examiner (kerb / pole touches). */
  surfaces: Map<number, SolidKind | 'ground' | 'hill'>;
  spawn: { position: Vec3; heading: number };
  /** Lane-level road network, for maps that have one. */
  network: RoadNetwork | null;
}

export function hillShape(def: HillDef): HillShape {
  const angle = Math.atan(def.gradePercent / 100);
  return { def, angle, rise: def.rampLength * Math.tan(angle) };
}

/** Unit vectors along and to the right of a hill's climb. */
function hillAxes(d: HillDef): { fx: number; fz: number; rx: number; rz: number } {
  const a = ((d.headingDeg ?? 0) * Math.PI) / 180;
  const fx = Math.sin(a);
  const fz = -Math.cos(a);
  return { fx, fz, rx: -fz, rz: fx };
}

/** Height of the driving surface at a point, ignoring bumps and kerbs. */
export function surfaceHeight(map: Pick<BuiltMap, 'hills'>, x: number, z: number): number {
  for (const h of map.hills) {
    const d = h.def;
    const { fx, fz, rx, rz } = hillAxes(d);
    const dx = x - d.x;
    const dz = z - d.z;
    if (Math.abs(dx * rx + dz * rz) > d.width / 2) continue;
    const along = dx * fx + dz * fz; // distance travelled from the foot of the climb
    if (along < 0) continue;
    if (along <= d.rampLength) return (along / d.rampLength) * h.rise;
    if (along <= d.rampLength + d.plateauLength) return h.rise;
    const down = along - d.rampLength - d.plateauLength;
    if (down <= d.rampLength) return h.rise * (1 - down / d.rampLength);
  }
  return 0;
}

/** A town layout as a map description (paving, paint, solid objects, signs). */
export function townMapDef(town: TownLayout): MapDef {
  const roads: RoadDef[] = [];
  const discs: NonNullable<MapDef['discs']> = [];
  for (const s of town.surfaces) {
    if (s.type === 'rect') roads.push({ from: [s.from.x, s.from.z], to: [s.to.x, s.to.z], width: s.width });
    else discs.push({ center: [s.center.x, s.center.z], radius: s.radius });
  }
  const solids: SolidDef[] = [];
  for (const r of town.raised) {
    if (r.type === 'box') {
      const box: BoxSolid = {
        kind: r.kind,
        shape: 'box',
        center: [r.center.x, r.size[1] / 2, r.center.z],
        size: r.size,
      };
      if (r.style !== undefined) box.style = r.style;
      solids.push(box);
    } else {
      solids.push({
        kind: r.kind === 'palm' ? 'palm' : 'island',
        shape: 'cylinder',
        center: [r.center.x, r.height / 2, r.center.z],
        height: r.height,
        radius: r.radius,
      });
    }
  }
  for (const b of town.bumps) {
    solids.push({ kind: 'bump', shape: 'bump', center: [b.x, b.z], width: b.width, height: 0.07, radius: 1.2, headingDeg: b.headingDeg });
  }
  return {
    id: town.def.id,
    groundSize: town.def.groundSize,
    spawn: town.spawn,
    roads,
    discs,
    hills: town.hills,
    solids,
    cones: [],
    markings: town.paint.map((p) => {
      const m: MarkingDef = { type: 'polyline', points: p.points.map((q) => [q.x, q.z]), width: p.width, color: p.color };
      if (p.dash) m.dash = p.dash;
      return m;
    }),
    signs: town.signs,
    signalHeads: town.signalHeads,
    mosques: town.mosques,
  };
}

/** Size of a mosque's prayer hall and minaret, shared by its collider and its mesh. */
export const MOSQUE = { hall: 18, hallHeight: 7, minaretRadius: 1.3, minaretHeight: 22, minaretOffset: 11 };

/** Create the colliders for a map. */
export function buildMap(def: MapDef, physics: PhysicsWorld, network: RoadNetwork | null = null): BuiltMap {
  const surfaces: BuiltMap['surfaces'] = new Map();

  // Ground: a slab whose top face is y = 0.
  surfaces.set(
    physics.addFixedBox({ x: 0, y: -0.5, z: 0 }, { x: def.groundSize, y: 1, z: def.groundSize }),
    'ground',
  );

  const hills = def.hills.map(hillShape);
  for (const h of hills) {
    const d = h.def;
    const { fx, fz } = hillAxes(d);
    const yaw = -(d.headingDeg ?? 0);
    const pitch = (h.angle * 180) / Math.PI;
    const slopeLength = d.rampLength / Math.cos(h.angle);
    const sin = Math.sin(h.angle);
    const cos = Math.cos(h.angle);
    const size = { x: d.width, y: RAMP_THICKNESS, z: slopeLength };
    /** A point `along` metres up the road from the foot, at height `y`. */
    const at = (along: number, y: number): Vec3 => ({ x: d.x + fx * along, y, z: d.z + fz * along });
    // Up-ramp: a slab whose top face runs from the foot up to the flat top.
    surfaces.set(
      physics.addFixedBox(
        at(d.rampLength / 2 + (RAMP_THICKNESS / 2) * sin, h.rise / 2 - (RAMP_THICKNESS / 2) * cos),
        size,
        quatFromEulerDeg(pitch, yaw, 0),
      ),
      'hill',
    );
    // Flat top, solid down to the ground.
    surfaces.set(
      physics.addFixedBox(
        at(d.rampLength + d.plateauLength / 2, h.rise / 2),
        { x: d.width, y: h.rise, z: d.plateauLength },
        quatFromEulerDeg(0, yaw, 0),
      ),
      'hill',
    );
    // Down-ramp, mirrored.
    surfaces.set(
      physics.addFixedBox(
        at(d.rampLength + d.plateauLength + d.rampLength / 2 - (RAMP_THICKNESS / 2) * sin, h.rise / 2 - (RAMP_THICKNESS / 2) * cos),
        size,
        quatFromEulerDeg(-pitch, yaw, 0),
      ),
      'hill',
    );
  }

  for (const s of def.solids) {
    if (s.shape === 'box') {
      const rotation: Quat | undefined = s.yawDeg ? quatFromEulerDeg(0, s.yawDeg, 0) : undefined;
      surfaces.set(
        physics.addFixedBox(
          { x: s.center[0], y: s.center[1], z: s.center[2] },
          { x: s.size[0], y: s.size[1], z: s.size[2] },
          rotation,
        ),
        s.kind,
      );
    } else if (s.shape === 'cylinder') {
      surfaces.set(
        physics.addFixedCylinder({ x: s.center[0], y: s.center[1], z: s.center[2] }, s.height, s.radius),
        s.kind,
      );
    } else {
      // A cylinder lying across the lane, buried so only `height` shows.
      surfaces.set(
        physics.addFixedCylinder(
          { x: s.center[0], y: s.height - s.radius, z: s.center[1] },
          s.width,
          s.radius,
          quatFromEulerDeg(0, -(s.headingDeg ?? 0), 90),
        ),
        'bump',
      );
    }
  }

  for (const m of def.mosques ?? []) {
    surfaces.set(
      physics.addFixedBox({ x: m.x, y: MOSQUE.hallHeight / 2, z: m.z }, { x: MOSQUE.hall, y: MOSQUE.hallHeight, z: MOSQUE.hall }),
      'building',
    );
    surfaces.set(
      physics.addFixedCylinder({ x: m.x + MOSQUE.minaretOffset, y: MOSQUE.minaretHeight / 2, z: m.z + MOSQUE.minaretOffset }, MOSQUE.minaretHeight, MOSQUE.minaretRadius),
      'building',
    );
  }

  const cones = def.cones.map(([x, z]) =>
    physics.addLooseCone({ x, y: 0, z }, CONE_HEIGHT, CONE_RADIUS, CONE_MASS),
  );

  const spawn = {
    position: { x: def.spawn.x, y: 0, z: def.spawn.z },
    heading: (def.spawn.headingDeg * Math.PI) / 180,
  };
  return { def, hills, cones, surfaces, spawn, network };
}

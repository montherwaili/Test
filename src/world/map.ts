/**
 * Map data: the description of a place (ground, roads, hills, solid objects,
 * loose cones, painted markings) as plain data, and the code that builds its
 * physics colliders. Rendering reads the same description, so what you see is
 * what you hit.
 */
import type { Quat, Vec3 } from '../sim/vehicle';
import { quatFromEulerDeg, type LooseBody, type PhysicsWorld } from './physics';

export type SolidKind = 'wall' | 'kerb' | 'pole' | 'bump';

export interface BoxSolid {
  kind: SolidKind;
  shape: 'box';
  /** Centre [x, y, z], m. */
  center: [number, number, number];
  /** Full size [x, y, z], m. */
  size: [number, number, number];
  yawDeg?: number;
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
}

export type SolidDef = BoxSolid | CylinderSolid | BumpSolid;

/** A hill on a straight lane heading north (-Z): up-ramp, flat top, down-ramp. */
export interface HillDef {
  /** Centre line x and the z where the climb begins. */
  x: number;
  z: number;
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
  | { type: 'rect'; center: [number, number]; size: [number, number]; width: number; color: MarkingColor }
  | { type: 'circle'; center: [number, number]; radius: number; width: number; color: MarkingColor };

export interface MapDef {
  id: string;
  /** Side of the square ground, m. */
  groundSize: number;
  spawn: { x: number; z: number; headingDeg: number };
  roads: RoadDef[];
  hills: HillDef[];
  solids: SolidDef[];
  /** Loose cones, [x, z]. */
  cones: [number, number][];
  markings: MarkingDef[];
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
}

export function hillShape(def: HillDef): HillShape {
  const angle = Math.atan(def.gradePercent / 100);
  return { def, angle, rise: def.rampLength * Math.tan(angle) };
}

/** Height of the driving surface at a point, ignoring bumps and kerbs. */
export function surfaceHeight(map: BuiltMap, x: number, z: number): number {
  for (const h of map.hills) {
    const d = h.def;
    if (Math.abs(x - d.x) > d.width / 2) continue;
    const along = d.z - z; // distance travelled north from the foot of the climb
    if (along < 0) continue;
    if (along <= d.rampLength) return (along / d.rampLength) * h.rise;
    if (along <= d.rampLength + d.plateauLength) return h.rise;
    const down = along - d.rampLength - d.plateauLength;
    if (down <= d.rampLength) return h.rise * (1 - down / d.rampLength);
  }
  return 0;
}

/** Create the colliders for a map. */
export function buildMap(def: MapDef, physics: PhysicsWorld): BuiltMap {
  const surfaces: BuiltMap['surfaces'] = new Map();

  // Ground: a slab whose top face is y = 0.
  surfaces.set(
    physics.addFixedBox({ x: 0, y: -0.5, z: 0 }, { x: def.groundSize, y: 1, z: def.groundSize }),
    'ground',
  );

  const hills = def.hills.map(hillShape);
  for (const h of hills) {
    const d = h.def;
    const slopeLength = d.rampLength / Math.cos(h.angle);
    const sin = Math.sin(h.angle);
    const cos = Math.cos(h.angle);
    const size = { x: d.width, y: RAMP_THICKNESS, z: slopeLength };
    // Up-ramp: its top face runs from (z, 0) to (z - rampLength, rise).
    const upTop = { y: h.rise / 2, z: d.z - d.rampLength / 2 };
    surfaces.set(
      physics.addFixedBox(
        { x: d.x, y: upTop.y - (RAMP_THICKNESS / 2) * cos, z: upTop.z - (RAMP_THICKNESS / 2) * sin },
        size,
        quatFromEulerDeg((h.angle * 180) / Math.PI, 0, 0),
      ),
      'hill',
    );
    // Flat top, solid down to the ground.
    const topStart = d.z - d.rampLength;
    surfaces.set(
      physics.addFixedBox(
        { x: d.x, y: h.rise / 2, z: topStart - d.plateauLength / 2 },
        { x: d.width, y: h.rise, z: d.plateauLength },
      ),
      'hill',
    );
    // Down-ramp, mirrored.
    const downTop = { y: h.rise / 2, z: topStart - d.plateauLength - d.rampLength / 2 };
    surfaces.set(
      physics.addFixedBox(
        { x: d.x, y: downTop.y - (RAMP_THICKNESS / 2) * cos, z: downTop.z + (RAMP_THICKNESS / 2) * sin },
        size,
        quatFromEulerDeg((-h.angle * 180) / Math.PI, 0, 0),
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
          quatFromEulerDeg(0, 0, 90),
        ),
        'bump',
      );
    }
  }

  const cones = def.cones.map(([x, z]) =>
    physics.addLooseCone({ x, y: 0, z }, CONE_HEIGHT, CONE_RADIUS, CONE_MASS),
  );

  const spawn = {
    position: { x: def.spawn.x, y: 0, z: def.spawn.z },
    heading: (def.spawn.headingDeg * Math.PI) / 180,
  };
  return { def, hills, cones, surfaces, spawn };
}

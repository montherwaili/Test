/**
 * Builds a town from a compact description: intersections on a grid and the
 * roads between them. Out come the lane-level road network (for traffic, the
 * examiner and routes) and the shapes to pave, paint and put up (for physics
 * and rendering). Pure: no engine or rendering imports, no randomness that is
 * not seeded.
 *
 * Right-hand traffic: vehicles keep to the right of the road and go round
 * roundabouts anticlockwise.
 *
 * TODO(verify with ROP / Oman standards) - these are sensible defaults, not
 * checked against Omani practice:
 *   - road marking colours (white centre and lane lines, yellow edge lines);
 *   - which roundabout lane may take which exit;
 *   - signal phasing (each approach gets its own green);
 *   - sign designs and where they stand.
 */
import { DEG, Path, arcPoints, connectPoses, headingDiff, headingVector, rightOf, type P2 } from './geometry';
import { RoadNetwork, type EndControl, type Lane, type LaneKind, type Turn } from './network';

export type ArmDir = 'N' | 'E' | 'S' | 'W';

/** Compass heading pointing away from an intersection along each arm. */
const ARM_HEADING: Record<ArmDir, number> = { N: 0, E: 90, S: 180, W: 270 };
/** Angle of each arm on a roundabout: degrees from east, anticlockwise. */
const ARM_ANGLE: Record<ArmDir, number> = { E: 0, N: 90, W: 180, S: 270 };
const OPPOSITE: Record<ArmDir, ArmDir> = { N: 'S', S: 'N', E: 'W', W: 'E' };

export type IntersectionType = 'signal' | 'priority' | 'roundabout' | 'bend' | 'end';

export interface IntersectionDef {
  id: string;
  x: number;
  z: number;
  type: IntersectionType;
  /** Roundabouts: circulating lanes (1 or 2). */
  ringLanes?: number;
  /** Priority junctions: the arm that must stop. */
  stopArm?: ArmDir;
  /** Bends: radius of the curve at the road's centre, m (a tight town corner if not given). */
  radius?: number;
}

export type RoadFeature =
  | { type: 'bump'; at: number }
  | { type: 'crossing'; at: number }
  | { type: 'hill'; at: number; gradePercent: number; rampLength: number; plateauLength: number }
  | { type: 'parking'; at: number; count: number };

export interface TownRoadDef {
  id: string;
  from: string;
  to: string;
  /** Lanes in each direction. */
  lanes: number;
  /** km/h */
  limit: number;
  /** Distances (`at`) are metres from the centre of `from`. */
  features?: RoadFeature[];
  sidewalks?: boolean;
  /** Width of the central reservation of a two-way road with 2+ lanes each way, m (the map's default if not given). */
  median?: number;
}

export interface BlockDef {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** 0..1: share of plots that get a building. */
  density: number;
}

export interface TownDef {
  id: string;
  groundSize: number;
  laneWidth: number;
  medianWidth: number;
  intersections: IntersectionDef[];
  roads: TownRoadDef[];
  spawn: { lane: string; at: number };
  blocks: BlockDef[];
  mosques: { x: number; z: number; headingDeg: number }[];
  seed: number;
}

// --- what the generator produces ---------------------------------------------

export type Surface =
  | { type: 'rect'; from: P2; to: P2; width: number }
  | { type: 'disc'; center: P2; radius: number };

export type PaintColor = 'white' | 'yellow';

export interface Paint {
  points: P2[];
  width: number;
  color: PaintColor;
  /** [painted, gap] in metres; omitted = solid. */
  dash?: [number, number];
}

export type Raised =
  | { type: 'box'; kind: 'kerb' | 'building' | 'wall'; center: P2; size: [number, number, number]; style?: number; yawDeg?: number }
  | { type: 'cylinder'; kind: 'kerb' | 'palm'; center: P2; radius: number; height: number };

export interface HillOnRoad {
  /** Foot of the climb, on the road centre line. */
  x: number;
  z: number;
  /** Direction of the climb, compass degrees. */
  headingDeg: number;
  width: number;
  gradePercent: number;
  rampLength: number;
  plateauLength: number;
  /** Width of the central reservation running over it, m (0 for none). */
  median?: number;
}

export interface BumpOnRoad {
  x: number;
  z: number;
  headingDeg: number;
  width: number;
}

export type SignKind = 'stop' | 'giveWay' | 'limit' | 'roundabout' | 'crossing' | 'bump' | 'parking';

export interface SignDef {
  kind: SignKind;
  x: number;
  z: number;
  /** Direction the sign's face points (towards the drivers it is for). */
  facingDeg: number;
  /** Speed limit signs: km/h. */
  value?: number;
}

export interface SignalHeadDef {
  junction: string;
  group: string;
  x: number;
  z: number;
  facingDeg: number;
}

export interface MosqueDef {
  x: number;
  z: number;
  headingDeg: number;
}

export interface TownLayout {
  def: TownDef;
  network: RoadNetwork;
  surfaces: Surface[];
  paint: Paint[];
  raised: Raised[];
  hills: HillOnRoad[];
  bumps: BumpOnRoad[];
  signs: SignDef[];
  signalHeads: SignalHeadDef[];
  mosques: MosqueDef[];
  spawn: { x: number; z: number; headingDeg: number };
}

// --- dimensions ------------------------------------------------------------------

const SHOULDER = 0.4;
const BEND_RADIUS = 14;
const JUNCTION_CORNER = 4;
const ROUNDABOUT_APPROACH = 10;
/** Entry and exit points sit this many degrees either side of an arm's axis. */
const RING_OFFSET_DEG = 28;
const TURNAROUND_RADIUS = 7;
const SIDEWALK_WIDTH = 2;
const KERB_HEIGHT = 0.15;
/**
 * The central reservation stands higher than a kerb, and a wide one (a
 * motorway's) carries a concrete barrier: a low strip of kerb was lost
 * against the road a little way off and seemed to come and go.
 */
const MEDIAN_HEIGHT = 0.3;
const BARRIER_MEDIAN = 6;
const BARRIER_WIDTH = 0.5;
const BARRIER_HEIGHT = 0.85;
/** The test town keeps its low kerbed medians (its routes and lessons are set out on them). */
const medianHeight = (width: number) => (width >= 3 ? MEDIAN_HEIGHT : KERB_HEIGHT);
const JUNCTION_SPEED = 25;
const ROUNDABOUT_SPEED = 30;
const SIGNAL_GREEN = 14;
const SIGNAL_AMBER = 3;
const SIGNAL_ALL_RED = 2;
const BAY_WIDTH = 2.6;
const BAY_DEPTH = 5.5;
/** Boundary walls round house plots, m. */
const WALL_HEIGHT = 1.9;
const WALL_THICK = 0.25;
const GATE_WIDTH = 4;

interface RingSpec {
  island: number;
  laneWidth: number;
  lanes: number;
  outer: number;
  /** Centre radius of each ring lane, index 0 = outer. */
  radii: number[];
}

function ringSpec(lanes: number): RingSpec {
  if (lanes >= 2) {
    const island = 12;
    const laneWidth = 4.25;
    return { island, laneWidth, lanes: 2, outer: island + 2 * laneWidth, radii: [island + 1.5 * laneWidth, island + 0.5 * laneWidth] };
  }
  const island = 9;
  const laneWidth = 5.5;
  return { island, laneWidth, lanes: 1, outer: island + laneWidth, radii: [island + laneWidth / 2] };
}

interface Arm {
  dir: ArmDir;
  road: TownRoadDef;
  /** Unit vector pointing away from the intersection. */
  out: P2;
  halfWidth: number;
  /** Distance from the centre at which the road's lanes stop. */
  extent: number;
  /** Lane ids arriving / leaving, index 0 = right-hand lane. */
  incoming: string[];
  outgoing: string[];
}

interface Node {
  def: IntersectionDef;
  centre: P2;
  arms: Arm[];
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function add(p: P2, d: P2, k: number): P2 {
  return { x: p.x + d.x * k, z: p.z + d.z * k };
}

function neg(d: P2): P2 {
  return { x: -d.x, z: -d.z };
}

/** Hill height at distance `along` from the foot of the climb. */
export function hillProfile(h: { gradePercent: number; rampLength: number; plateauLength: number }, along: number): number {
  const rise = (h.rampLength * h.gradePercent) / 100;
  if (along <= 0) return 0;
  if (along <= h.rampLength) return (along / h.rampLength) * rise;
  if (along <= h.rampLength + h.plateauLength) return rise;
  const down = along - h.rampLength - h.plateauLength;
  return down <= h.rampLength ? rise * (1 - down / h.rampLength) : 0;
}

export function generateTown(def: TownDef): TownLayout {
  const w = def.laneWidth;
  const network = new RoadNetwork();
  const surfaces: Surface[] = [];
  const paint: Paint[] = [];
  const raised: Raised[] = [];
  const hills: HillOnRoad[] = [];
  const bumps: BumpOnRoad[] = [];
  const signs: SignDef[] = [];
  const signalHeads: SignalHeadDef[] = [];

  const medianOf = (r: TownRoadDef) => (r.lanes >= 2 ? (r.median ?? def.medianWidth) : 0);
  const halfWidthOf = (r: TownRoadDef) => r.lanes * w + medianOf(r) / 2 + SHOULDER;
  /** Centre of lane `i` (0 = right-hand), measured to the right of the direction of travel. */
  const laneOffset = (r: TownRoadDef, i: number) => medianOf(r) / 2 + (r.lanes - i - 0.5) * w;

  // --- intersections and their arms ------------------------------------------------
  const nodes = new Map<string, Node>();
  for (const d of def.intersections) nodes.set(d.id, { def: d, centre: { x: d.x, z: d.z }, arms: [] });
  const node = (id: string): Node => {
    const n = nodes.get(id);
    if (!n) throw new Error(`road refers to unknown intersection "${id}"`);
    return n;
  };

  const armDirection = (from: P2, to: P2, roadId: string): ArmDir => {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    if (Math.abs(dx) > 1e-6 && Math.abs(dz) > 1e-6) throw new Error(`road ${roadId} is not north-south or east-west`);
    if (Math.abs(dx) > 1e-6) return dx > 0 ? 'E' : 'W';
    return dz > 0 ? 'S' : 'N';
  };

  for (const r of def.roads) {
    const a = node(r.from);
    const b = node(r.to);
    const dirA = armDirection(a.centre, b.centre, r.id);
    for (const [n, dir] of [
      [a, dirA],
      [b, OPPOSITE[dirA]],
    ] as const) {
      if (n.arms.some((arm) => arm.dir === dir)) throw new Error(`intersection ${n.def.id} has two roads on its ${dir} arm`);
      n.arms.push({ dir, road: r, out: headingVector(ARM_HEADING[dir]), halfWidth: halfWidthOf(r), extent: 0, incoming: [], outgoing: [] });
    }
  }

  for (const n of nodes.values()) {
    const t = n.def.type;
    for (const arm of n.arms) {
      if (t === 'roundabout') arm.extent = ringSpec(n.def.ringLanes ?? 1).outer + ROUNDABOUT_APPROACH;
      else if (t === 'bend') arm.extent = n.def.radius ?? BEND_RADIUS;
      else if (t === 'end') arm.extent = 4;
      else {
        const across = n.arms.filter((o) => o.dir !== arm.dir && o.dir !== OPPOSITE[arm.dir]);
        const widest = across.length > 0 ? Math.max(...across.map((o) => o.halfWidth)) : arm.halfWidth;
        arm.extent = widest + JUNCTION_CORNER;
      }
    }
    if (t === 'bend' && n.arms.length !== 2) throw new Error(`bend ${n.def.id} must join exactly two roads`);
    if (t === 'end' && n.arms.length !== 1) throw new Error(`dead end ${n.def.id} must have exactly one road`);
  }

  // --- lanes ----------------------------------------------------------------------
  const newLane = (
    id: string,
    kind: LaneKind,
    points: P2[],
    elevations: number[] | null,
    width: number,
    speedLimit: number,
    owner: string,
    index: number,
    turn: Turn | null = null,
  ): Lane => {
    const lane: Lane = {
      id,
      kind,
      path: new Path(points),
      elevations: elevations ?? points.map(() => 0),
      width,
      speedLimit,
      next: [],
      previous: [],
      left: null,
      right: null,
      end: { type: 'none' },
      turn,
      yieldTo: [],
      owner,
      index,
    };
    network.addLane(lane);
    return lane;
  };

  const armOf = (n: Node, r: TownRoadDef): Arm => n.arms.find((a) => a.road === r)!;

  for (const r of def.roads) {
    const a = node(r.from);
    const b = node(r.to);
    const armA = armOf(a, r);
    const armB = armOf(b, r);
    const d = armA.out; // direction of travel from -> to
    const right = rightOf(d);
    const total = Math.hypot(b.centre.x - a.centre.x, b.centre.z - a.centre.z);
    const startAt = armA.extent;
    const endAt = total - armB.extent;
    if (endAt - startAt < 10) throw new Error(`road ${r.id} is too short for its junctions`);
    const hw = armA.halfWidth;
    const hill = r.features?.find((f) => f.type === 'hill');
    const height = (along: number) => (hill && hill.type === 'hill' ? hillProfile(hill, along - hill.at) : 0);

    // Sample points: every few metres, plus the corners of the hill profile.
    const stations = new Set<number>();
    const pieces = Math.ceil((endAt - startAt) / 6);
    for (let i = 0; i <= pieces; i++) stations.add(startAt + ((endAt - startAt) * i) / pieces);
    if (hill && hill.type === 'hill') {
      for (const k of [0, hill.rampLength, hill.rampLength + hill.plateauLength, 2 * hill.rampLength + hill.plateauLength]) {
        const s = hill.at + k;
        if (s > startAt && s < endAt) stations.add(s);
      }
    }
    const along = [...stations].sort((p, q) => p - q);

    const forward: string[] = [];
    const backward: string[] = [];
    for (let i = 0; i < r.lanes; i++) {
      const o = laneOffset(r, i);
      const f = newLane(
        `${r.id}:f${i}`,
        'road',
        along.map((s) => add(add(a.centre, d, s), right, o)),
        along.map(height),
        w,
        r.limit,
        r.id,
        i,
      );
      const rev = [...along].reverse();
      const bk = newLane(
        `${r.id}:b${i}`,
        'road',
        rev.map((s) => add(add(a.centre, d, s), right, -o)),
        rev.map(height),
        w,
        r.limit,
        r.id,
        i,
      );
      forward.push(f.id);
      backward.push(bk.id);
    }
    for (const list of [forward, backward]) {
      for (let i = 0; i < list.length; i++) {
        network.lane(list[i]!).left = list[i + 1] ?? null;
        network.lane(list[i]!).right = list[i - 1] ?? null;
      }
    }
    armA.outgoing = forward;
    armA.incoming = backward;
    armB.incoming = forward;
    armB.outgoing = backward;

    // Paving: the whole length, centre to centre, so junction pads meet it.
    surfaces.push({ type: 'rect', from: add(a.centre, d, startAt - 0.5), to: add(a.centre, d, endAt + 0.5), width: hw * 2 });

    // Paint: edges, centre or median, lane dividers.
    const line = (offset: number, color: PaintColor, dash?: [number, number], from = startAt, to = endAt): void => {
      const pts: P2[] = [];
      const n = Math.max(1, Math.ceil((to - from) / 8));
      for (let i = 0; i <= n; i++) pts.push(add(add(a.centre, d, from + ((to - from) * i) / n), right, offset));
      const p: Paint = { points: pts, width: 0.12, color };
      if (dash) p.dash = dash;
      paint.push(p);
    };
    line(hw - 0.25, 'yellow');
    line(-(hw - 0.25), 'yellow');
    if (r.lanes >= 2) {
      const m = medianOf(r) / 2;
      line(m + 0.15, 'yellow');
      line(-(m + 0.15), 'yellow');
      for (let i = 1; i < r.lanes; i++) {
        line(m + i * w, 'white', [3, 6]);
        line(-(m + i * w), 'white', [3, 6]);
      }
      // The central reservation: a kerbed strip, broken where a hill carries its own.
      const spans: [number, number][] = [];
      if (hill && hill.type === 'hill') {
        const hillEnd = hill.at + 2 * hill.rampLength + hill.plateauLength;
        spans.push([startAt + 1.5, hill.at - 0.5], [hillEnd + 0.5, endAt - 1.5]);
      } else spans.push([startAt + 1.5, endAt - 1.5]);
      for (const [from, to] of spans) {
        if (to - from <= 2) continue;
        raised.push(boxAlong(a.centre, d, from, to, 0, medianOf(r) - 0.5, medianHeight(medianOf(r))));
        if (medianOf(r) >= BARRIER_MEDIAN) raised.push(boxAlong(a.centre, d, from - 1, to + 1, 0, BARRIER_WIDTH, BARRIER_HEIGHT));
      }
    } else {
      line(0, 'white', [3, 6]);
    }

    const hasParking = r.features?.some((f) => f.type === 'parking') ?? false;
    if (r.sidewalks !== false && !hill && !hasParking) {
      for (const side of [1, -1]) {
        raised.push(boxAlong(a.centre, d, startAt + 0.5, endAt - 0.5, side * (hw + SIDEWALK_WIDTH / 2), SIDEWALK_WIDTH, KERB_HEIGHT));
      }
    }

    // Speed limit signs, a little way into each direction of the road.
    const signSide = hw + 0.9;
    signs.push({ kind: 'limit', value: r.limit, ...add(add(a.centre, d, startAt + 12), right, signSide), facingDeg: ARM_HEADING[OPPOSITE[armA.dir]] });
    signs.push({ kind: 'limit', value: r.limit, ...add(add(a.centre, d, endAt - 12), right, -signSide), facingDeg: ARM_HEADING[armA.dir] });

    for (const f of r.features ?? []) {
      if (f.at <= startAt + 4 || f.at >= endAt - 4) throw new Error(`feature on road ${r.id} at ${f.at} m is inside a junction`);
      const at = add(a.centre, d, f.at);
      const warn = (kind: SignKind): void => {
        signs.push({ kind, ...add(add(a.centre, d, f.at - 22), right, signSide), facingDeg: ARM_HEADING[OPPOSITE[armA.dir]] });
        signs.push({ kind, ...add(add(a.centre, d, f.at + 22), right, -signSide), facingDeg: ARM_HEADING[armA.dir] });
      };
      const lanesAt = (s: number) => [
        ...forward.map((id) => ({ lane: id, s: s - startAt })),
        ...backward.map((id) => ({ lane: id, s: endAt - s })),
      ];
      if (f.type === 'hill') {
        hills.push({
          x: at.x,
          z: at.z,
          headingDeg: ARM_HEADING[armA.dir],
          width: hw * 2 + 0.6,
          gradePercent: f.gradePercent,
          rampLength: f.rampLength,
          plateauLength: f.plateauLength,
          median: medianOf(r),
        });
      } else if (f.type === 'bump') {
        bumps.push({ x: at.x, z: at.z, headingDeg: ARM_HEADING[armA.dir], width: hw * 2 - 0.4 });
        network.bumps.push({ id: `${r.id}:bump@${f.at}`, position: at, lanes: lanesAt(f.at) });
        warn('bump');
      } else if (f.type === 'crossing') {
        const length = 3;
        for (let o = -(hw - 0.6); o <= hw - 0.6 + 1e-6; o += 1) {
          paint.push({ points: [add(add(at, d, -length / 2), right, o), add(add(at, d, length / 2), right, o)], width: 0.5, color: 'white' });
        }
        network.crossings.push({
          id: `${r.id}:crossing@${f.at}`,
          from: add(at, right, -(hw + 1)),
          to: add(at, right, hw + 1),
          width: length,
          lanes: lanesAt(f.at),
        });
        warn('crossing');
      } else {
        // Bays at right angles to the road, on both sides.
        const run = f.count * BAY_WIDTH;
        for (const side of [1, -1]) {
          const inner = side * hw;
          const outer = side * (hw + BAY_DEPTH);
          surfaces.push({ type: 'rect', from: add(add(a.centre, d, f.at), right, (inner + outer) / 2), to: add(add(a.centre, d, f.at + run), right, (inner + outer) / 2), width: BAY_DEPTH + 0.6 });
          for (let i = 0; i <= f.count; i++) {
            const s = f.at + i * BAY_WIDTH;
            paint.push({ points: [add(add(a.centre, d, s), right, inner), add(add(a.centre, d, s), right, outer)], width: 0.1, color: 'white' });
          }
        }
        signs.push({ kind: 'parking', ...add(add(a.centre, d, f.at - 3), right, hw + BAY_DEPTH + 0.8), facingDeg: ARM_HEADING[OPPOSITE[armA.dir]] });
      }
    }
  }

  // --- helpers for junction lanes -----------------------------------------------
  const endPose = (laneId: string): { p: P2; d: P2 } => {
    const l = network.lane(laneId);
    return { p: l.path.points[l.path.points.length - 1]!, d: l.path.directionAt(l.path.length) };
  };
  const startPose = (laneId: string): { p: P2; d: P2 } => {
    const l = network.lane(laneId);
    return { p: l.path.points[0]!, d: l.path.directionAt(0) };
  };
  const setEnd = (laneIds: string[], end: EndControl): void => {
    for (const id of laneIds) network.lane(id).end = end;
  };
  /** A line across the incoming lanes of an arm, just short of where they end. */
  const lineAcross = (n: Node, arm: Arm, dashed: boolean): void => {
    const inward = neg(arm.out);
    const right = rightOf(inward);
    const at = add(n.centre, arm.out, arm.extent + 0.5);
    const near = arm.road.lanes >= 2 ? medianOf(arm.road) / 2 + 0.2 : 0.15;
    const p: Paint = { points: [add(at, right, near), add(at, right, arm.halfWidth - 0.3)], width: 0.45, color: 'white' };
    if (dashed) p.dash = [0.6, 0.4];
    paint.push(p);
  };
  /** Where a sign for traffic arriving on an arm stands: on the right, `back` metres before the line. */
  const signSpot = (n: Node, arm: Arm, back: number): P2 => add(add(n.centre, arm.out, arm.extent + back), rightOf(neg(arm.out)), arm.halfWidth + 0.9);
  const turnOf = (inArm: Arm, outArm: Arm): Turn => {
    const diff = headingDiff(ARM_HEADING[outArm.dir], ARM_HEADING[OPPOSITE[inArm.dir]]);
    if (Math.abs(diff) < 1) return 'straight';
    if (Math.abs(Math.abs(diff) - 180) < 1) return 'uturn';
    return diff > 0 ? 'right' : 'left';
  };

  let signalIndex = 0;
  for (const n of nodes.values()) {
    const id = n.def.id;
    const c = n.centre;

    if (n.def.type === 'bend') {
      const [a, b] = n.arms as [Arm, Arm];
      const e = a.extent;
      const turnCentre = add(add(c, a.out, e), b.out, e);
      const arc = (radius: number, reverse: boolean): P2[] => {
        const pts: P2[] = [];
        // A point every 4 m or so along the curve.
        const steps = Math.max(10, Math.ceil((radius * Math.PI) / 2 / 4));
        for (let i = 0; i <= steps; i++) {
          const phi = ((reverse ? steps - i : i) / steps) * 90 * DEG;
          pts.push({
            x: turnCentre.x - radius * (b.out.x * Math.cos(phi) + a.out.x * Math.sin(phi)),
            z: turnCentre.z - radius * (b.out.z * Math.cos(phi) + a.out.z * Math.sin(phi)),
          });
        }
        return pts;
      };
      // How fast the curve can be taken comfortably (about 3 m/s² sideways), in steps of 10 km/h.
      const bendSpeed = Math.min(a.road.limit, Math.max(30, 10 * Math.floor((3.6 * Math.sqrt(3 * e)) / 10)));
      // Is the inside of the bend on the right of traffic arriving on arm a?
      const inner = rightOf(neg(a.out));
      const side = inner.x * b.out.x + inner.z * b.out.z;
      for (let i = 0; i < a.road.lanes; i++) {
        const o = laneOffset(a.road, i);
        const ab = newLane(`${id}:${a.dir}${i}>${b.dir}${i}`, 'junction', arc(e - o * side, false), null, w, bendSpeed, id, i, side > 0 ? 'right' : 'left');
        network.connect(a.incoming[i]!, ab.id);
        network.connect(ab.id, b.outgoing[i]!);
        const ba = newLane(`${id}:${b.dir}${i}>${a.dir}${i}`, 'junction', arc(e + o * side, true), null, w, bendSpeed, id, i, side > 0 ? 'left' : 'right');
        network.connect(b.incoming[i]!, ba.id);
        network.connect(ba.id, a.outgoing[i]!);
      }
      const hw = a.halfWidth;
      if (e <= BEND_RADIUS + 1e-6) {
        // A tight town corner: a square of paving covers both the outside and the inside of it.
        const mid = (e - hw) / 2;
        surfaces.push({ type: 'rect', from: add(add(c, a.out, -hw), b.out, mid), to: add(add(c, a.out, e), b.out, mid), width: e + hw });
      } else {
        // A wide curve: paved piece by piece along it, each piece overlapping the next.
        const centre = arc(e, false);
        for (let k = 0; k < centre.length - 1; k++) {
          const p0 = centre[k]!;
          const p1 = centre[k + 1]!;
          const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
          const u = { x: (p1.x - p0.x) / len, z: (p1.z - p0.z) / len };
          const grow = 0.6 + (hw * len) / e;
          surfaces.push({ type: 'rect', from: add(p0, u, -grow), to: add(p1, u, grow), width: hw * 2 });
        }
        if (a.road.lanes >= 2) {
          // The central reservation carries on round the curve, in short straight pieces.
          for (let k = 0; k < centre.length - 1; k++) {
            const p0 = centre[k]!;
            const p1 = centre[k + 1]!;
            const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
            const piece = (width: number, height: number) =>
              raised.push({
                type: 'box',
                kind: 'kerb',
                center: { x: (p0.x + p1.x) / 2, z: (p0.z + p1.z) / 2 },
                size: [len + 0.3, height, width],
                yawDeg: (Math.atan2(-(p1.z - p0.z), p1.x - p0.x) * 180) / Math.PI,
              });
            piece(medianOf(a.road) - 0.5, medianHeight(medianOf(a.road)));
            if (medianOf(a.road) >= BARRIER_MEDIAN) piece(BARRIER_WIDTH, BARRIER_HEIGHT);
          }
          const m = medianOf(a.road) / 2;
          paint.push({ points: arc(e - m - 0.15, false), width: 0.12, color: 'yellow' });
          paint.push({ points: arc(e + m + 0.15, false), width: 0.12, color: 'yellow' });
          for (let i = 1; i < a.road.lanes; i++) {
            paint.push({ points: arc(e - m - i * w, false), width: 0.12, color: 'white', dash: [3, 6] });
            paint.push({ points: arc(e + m + i * w, false), width: 0.12, color: 'white', dash: [3, 6] });
          }
        }
      }
      paint.push({ points: arc(e + hw - 0.25, false), width: 0.12, color: 'yellow' });
      paint.push({ points: arc(e - hw + 0.25, false), width: 0.12, color: 'yellow' });
      if (a.road.lanes < 2) paint.push({ points: arc(e, false), width: 0.12, color: 'white' });
      continue;
    }

    if (n.def.type === 'end') {
      const arm = n.arms[0]!;
      const right = rightOf(arm.out);
      // Far enough past the end of the lanes for a gentle swing out to the right before the loop.
      const loopCentre = add(c, arm.out, arm.extent + TURNAROUND_RADIUS + 9);
      for (let i = 0; i < arm.road.lanes; i++) {
        const from = endPose(arm.incoming[i]!);
        const to = startPose(arm.outgoing[i]!);
        const enter = add(loopCentre, right, TURNAROUND_RADIUS);
        const leave = add(loopCentre, right, -TURNAROUND_RADIUS);
        const loop: P2[] = [];
        for (let k = 0; k <= 14; k++) {
          const phi = (k / 14) * 180 * DEG;
          loop.push({
            x: loopCentre.x + TURNAROUND_RADIUS * (right.x * Math.cos(phi) + arm.out.x * Math.sin(phi)),
            z: loopCentre.z + TURNAROUND_RADIUS * (right.z * Math.cos(phi) + arm.out.z * Math.sin(phi)),
          });
        }
        const pts = [
          ...connectPoses(from.p, from.d, enter, arm.out, 14).slice(0, -1),
          ...loop,
          ...connectPoses(leave, neg(arm.out), to.p, to.d, 14).slice(1),
        ];
        const u = newLane(`${id}:turn${i}`, 'junction', pts, null, w, 15, id, i, 'uturn');
        network.connect(arm.incoming[i]!, u.id);
        network.connect(u.id, arm.outgoing[i]!);
      }
      surfaces.push({ type: 'rect', from: c, to: loopCentre, width: (TURNAROUND_RADIUS + 3.2) * 2 });
      surfaces.push({ type: 'disc', center: loopCentre, radius: TURNAROUND_RADIUS + 3.2 });
      paint.push({ points: arcPoints(loopCentre, TURNAROUND_RADIUS + 2.9, 0, 360, 10), width: 0.12, color: 'yellow' });
      continue;
    }

    if (n.def.type === 'roundabout') {
      const ring = ringSpec(n.def.ringLanes ?? 1);
      // Ring nodes in the order traffic meets them: each arm's exit, then its entry.
      const present = (['E', 'N', 'W', 'S'] as ArmDir[]).filter((d) => n.arms.some((a) => a.dir === d));
      interface RingNode {
        arm: Arm;
        kind: 'exit' | 'entry';
        angle: number;
      }
      const ringNodes: RingNode[] = [];
      for (const d of present) {
        const arm = n.arms.find((a) => a.dir === d)!;
        ringNodes.push({ arm, kind: 'exit', angle: ARM_ANGLE[d] - RING_OFFSET_DEG });
        ringNodes.push({ arm, kind: 'entry', angle: ARM_ANGLE[d] + RING_OFFSET_DEG });
      }
      // Segment k runs from ring node k to ring node k+1.
      const segId = (lane: number, k: number) => `${id}:ring${lane}:${k}`;
      for (let j = 0; j < ring.lanes; j++) {
        for (let k = 0; k < ringNodes.length; k++) {
          const from = ringNodes[k]!.angle;
          let to = ringNodes[(k + 1) % ringNodes.length]!.angle;
          while (to <= from) to += 360;
          newLane(segId(j, k), 'roundabout', arcPoints(c, ring.radii[j]!, from, to, 5), null, ring.laneWidth, ROUNDABOUT_SPEED, id, j);
        }
        for (let k = 0; k < ringNodes.length; k++) network.connect(segId(j, k), segId(j, (k + 1) % ringNodes.length));
      }
      if (ring.lanes === 2) {
        for (let k = 0; k < ringNodes.length; k++) {
          network.lane(segId(0, k)).left = segId(1, k);
          network.lane(segId(1, k)).right = segId(0, k);
        }
      }
      const pointOn = (radius: number, angle: number): P2 => ({ x: c.x + radius * Math.cos(angle * DEG), z: c.z - radius * Math.sin(angle * DEG) });
      const tangent = (angle: number): P2 => ({ x: -Math.sin(angle * DEG), z: -Math.cos(angle * DEG) });

      for (let k = 0; k < ringNodes.length; k++) {
        const rn = ringNodes[k]!;
        const arm = rn.arm;
        if (rn.kind === 'entry') {
          // Segment k starts here; the segment before it passes in front of this arm.
          const before = (k - 1 + ringNodes.length) % ringNodes.length;
          const beforeThat = (k - 2 + ringNodes.length) % ringNodes.length;
          const priority: string[] = [];
          for (let j = 0; j < ring.lanes; j++) priority.push(segId(j, before), segId(j, beforeThat));
          for (let i = 0; i < arm.incoming.length; i++) {
            const j = Math.min(i, ring.lanes - 1);
            const from = endPose(arm.incoming[i]!);
            const entry = newLane(
              `${id}:in:${arm.dir}${i}`,
              'junction',
              connectPoses(from.p, from.d, pointOn(ring.radii[j]!, rn.angle), tangent(rn.angle)),
              null,
              w,
              JUNCTION_SPEED,
              id,
              i,
              'right',
            );
            entry.yieldTo = [...priority];
            network.connect(arm.incoming[i]!, entry.id);
            network.connect(entry.id, segId(j, k));
          }
          setEnd(arm.incoming, { type: 'giveWay' });
          lineAcross(n, arm, true);
          signs.push({ kind: 'giveWay', ...signSpot(n, arm, 1.5), facingDeg: ARM_HEADING[arm.dir] });
          signs.push({ kind: 'roundabout', ...signSpot(n, arm, 32), facingDeg: ARM_HEADING[arm.dir] });
        } else {
          // Segment k-1 ends here: traffic may leave by this arm.
          const arriving = (k - 1 + ringNodes.length) % ringNodes.length;
          const exits = arm.outgoing.length;
          for (let j = 0; j < ring.lanes; j++) {
            // Outer ring lane leaves into the right-hand lane, inner into the left-hand one.
            const target = Math.min(j, exits - 1);
            const to = startPose(arm.outgoing[target]!);
            const exit = newLane(
              `${id}:out:${arm.dir}${j}`,
              'junction',
              connectPoses(pointOn(ring.radii[j]!, rn.angle), tangent(rn.angle), to.p, to.d),
              null,
              w,
              JUNCTION_SPEED,
              id,
              j,
              'right',
            );
            // Leaving from the inner lane crosses the outer one.
            if (j > 0) exit.yieldTo = [segId(0, arriving), segId(0, k)];
            network.connect(segId(j, arriving), exit.id);
            network.connect(exit.id, arm.outgoing[target]!);
          }
          // A road with more lanes than the ring: the inner ring lane also leaves into the lanes beyond.
          const inner = ring.lanes - 1;
          for (let t = ring.lanes; t < exits; t++) {
            const to = startPose(arm.outgoing[t]!);
            const exit = newLane(
              `${id}:out:${arm.dir}${t}`,
              'junction',
              connectPoses(pointOn(ring.radii[inner]!, rn.angle), tangent(rn.angle), to.p, to.d),
              null,
              w,
              JUNCTION_SPEED,
              id,
              t,
              'right',
            );
            if (inner > 0) exit.yieldTo = [segId(0, arriving), segId(0, k)];
            network.connect(segId(inner, arriving), exit.id);
            network.connect(exit.id, arm.outgoing[t]!);
          }
        }
      }

      surfaces.push({ type: 'disc', center: c, radius: ring.outer + 0.5 });
      for (const arm of n.arms) {
        // Flared approach, wide enough for the curving entry and exit lanes.
        surfaces.push({ type: 'rect', from: add(c, arm.out, ring.outer - 3), to: add(c, arm.out, arm.extent + 0.6), width: (arm.halfWidth + 3.5) * 2 });
      }
      raised.push({ type: 'cylinder', kind: 'kerb', center: c, radius: ring.island, height: KERB_HEIGHT + 0.05 });
      raised.push({ type: 'cylinder', kind: 'kerb', center: c, radius: ring.island - 2.5, height: 0.7 });
      paint.push({ points: arcPoints(c, ring.island + 0.3, 0, 360, 5), width: 0.12, color: 'yellow' });
      if (ring.lanes === 2) paint.push({ points: arcPoints(c, ring.island + ring.laneWidth, 0, 360, 4), width: 0.12, color: 'white', dash: [2, 3] });
      // Outer edge, broken at each arm.
      const gaps = present.map((d) => {
        const arm = n.arms.find((a) => a.dir === d)!;
        const half = Math.asin(Math.min(1, (arm.halfWidth + 3.5) / ring.outer)) / DEG;
        return { from: ARM_ANGLE[d] - half, to: ARM_ANGLE[d] + half };
      });
      for (let g = 0; g < gaps.length; g++) {
        const from = gaps[g]!.to;
        let to = gaps[(g + 1) % gaps.length]!.from;
        while (to <= from) to += 360;
        paint.push({ points: arcPoints(c, ring.outer - 0.15, from, to, 5), width: 0.12, color: 'yellow' });
      }
      continue;
    }

    // --- signalled and priority junctions --------------------------------------------
    const isSignal = n.def.type === 'signal';
    const stopArm = n.def.stopArm;
    if (!isSignal && !stopArm) throw new Error(`priority junction ${id} needs a stopArm`);
    const connectors: { lane: Lane; from: Arm; to: Arm; turn: Turn }[] = [];
    for (const from of n.arms) {
      const options = n.arms.filter((a) => a !== from).map((to) => ({ to, turn: turnOf(from, to) }));
      const lanes = from.incoming.length;
      for (let i = 0; i < lanes; i++) {
        // One lane: any way out. Two: the right lane turns right, the left lane turns left, both may go straight.
        const allowed = options.filter((o) => {
          if (lanes === 1) return true;
          if (o.turn === 'right') return i === 0;
          if (o.turn === 'left') return i === lanes - 1;
          return true;
        });
        for (const o of allowed) {
          const targets = o.to.outgoing.length;
          const target = o.turn === 'right' ? 0 : o.turn === 'left' ? targets - 1 : Math.min(i, targets - 1);
          const a = endPose(from.incoming[i]!);
          const b = startPose(o.to.outgoing[target]!);
          const lane = newLane(
            `${id}:${from.dir}${i}>${o.to.dir}${target}`,
            'junction',
            connectPoses(a.p, a.d, b.p, b.d),
            null,
            w,
            JUNCTION_SPEED,
            id,
            i,
            o.turn,
          );
          network.connect(from.incoming[i]!, lane.id);
          network.connect(lane.id, o.to.outgoing[target]!);
          connectors.push({ lane, from, to: o.to, turn: o.turn });
        }
      }
    }

    // Paving: a pad out to where each road stops (or to the road edge where there is no arm).
    const reach = (dir: ArmDir): number => {
      const arm = n.arms.find((a) => a.dir === dir);
      if (arm) return arm.extent + 0.6;
      const across = n.arms.filter((a) => a.dir !== OPPOSITE[dir]);
      return Math.max(...across.map((a) => a.halfWidth));
    };
    const west = reach('W');
    const east = reach('E');
    const north = reach('N');
    const south = reach('S');
    surfaces.push({
      type: 'rect',
      from: { x: c.x - west, z: c.z + (south - north) / 2 },
      to: { x: c.x + east, z: c.z + (south - north) / 2 },
      width: north + south,
    });

    if (isSignal) {
      const groups = (['N', 'E', 'S', 'W'] as ArmDir[]).filter((d) => n.arms.some((a) => a.dir === d));
      network.signals.set(id, { id, groups, green: SIGNAL_GREEN, amber: SIGNAL_AMBER, allRed: SIGNAL_ALL_RED, offset: signalIndex * 7 });
      signalIndex++;
      for (const arm of n.arms) {
        setEnd(arm.incoming, { type: 'signal', junction: id, group: arm.dir });
        lineAcross(n, arm, false);
        signalHeads.push({ junction: id, group: arm.dir, ...signSpot(n, arm, 0.3), facingDeg: ARM_HEADING[arm.dir] });
        if (arm.road.lanes >= 2) {
          // A second head on the median for the left-hand lane.
          signalHeads.push({ junction: id, group: arm.dir, ...add(c, arm.out, arm.extent + 2.2), facingDeg: ARM_HEADING[arm.dir] });
        }
      }
    } else {
      const minor = n.arms.find((a) => a.dir === stopArm);
      if (!minor) throw new Error(`priority junction ${id}: no road on stop arm ${stopArm}`);
      setEnd(minor.incoming, { type: 'stop' });
      lineAcross(n, minor, false);
      signs.push({ kind: 'stop', ...signSpot(n, minor, 1.5), facingDeg: ARM_HEADING[minor.dir] });
      for (const k of connectors) {
        if (k.from === minor) {
          // From the side road: give way to everything on the main road.
          for (const other of connectors) if (other.from !== minor) k.lane.yieldTo.push(other.lane.id);
          for (const arm of n.arms) if (arm !== minor) k.lane.yieldTo.push(...arm.incoming);
        } else if (k.turn === 'left') {
          // Turning left off the main road: give way to oncoming traffic.
          const oncoming = n.arms.find((a) => a.dir === OPPOSITE[k.from.dir]);
          if (oncoming) {
            k.lane.yieldTo.push(...oncoming.incoming);
            for (const other of connectors) if (other.from === oncoming) k.lane.yieldTo.push(other.lane.id);
          }
        }
      }
    }
  }

  network.finish();

  // --- buildings and palms ----------------------------------------------------------
  const rnd = seeded(def.seed);
  const plot = 26;
  for (const b of def.blocks) {
    for (let x = b.x0 + plot / 2; x < b.x1 - plot / 2 + 1e-6; x += plot) {
      for (let z = b.z0 + plot / 2; z < b.z1 - plot / 2 + 1e-6; z += plot) {
        const roll = rnd();
        if (def.mosques.some((m) => Math.hypot(m.x - x, m.z - z) < 30)) continue;
        if (roll < b.density) {
          const wide = 10 + rnd() * 8;
          const deep = 10 + rnd() * 8;
          const tall = 4 + Math.floor(rnd() * 3) * 3.2;
          const style = Math.floor(rnd() * 4);
          raised.push({
            type: 'box',
            kind: 'building',
            center: { x: x + (rnd() - 0.5) * 4, z: z + (rnd() - 0.5) * 4 },
            size: [wide, tall, deep],
            style,
          });
          // A boundary wall round the plot, as round most Omani houses, with a gate
          // on the side nearest the edge of the block (where the street is).
          const gateSide = [x - b.x0, b.x1 - x, z - b.z0, b.z1 - z].reduce((best, d, i, all) => (d < all[best]! ? i : best), 0);
          const half = plot / 2 - 0.4;
          const h = WALL_HEIGHT;
          const side = (cx: number, cz: number, along: 'x' | 'z', length: number, gate: boolean) => {
            const piece = (offset: number, len: number) => {
              const c = along === 'x' ? { x: cx + offset, z: cz } : { x: cx, z: cz + offset };
              raised.push({ type: 'box', kind: 'wall', center: c, size: along === 'x' ? [len, h, WALL_THICK] : [WALL_THICK, h, len], style });
            };
            if (!gate) piece(0, length);
            else {
              const part = (length - GATE_WIDTH) / 2;
              piece(-(GATE_WIDTH + part) / 2, part);
              piece((GATE_WIDTH + part) / 2, part);
            }
          };
          side(x - half, z, 'z', 2 * half, gateSide === 0);
          side(x + half, z, 'z', 2 * half, gateSide === 1);
          side(x, z - half, 'x', 2 * half, gateSide === 2);
          side(x, z + half, 'x', 2 * half, gateSide === 3);
        } else if (roll < b.density + 0.25) {
          raised.push({ type: 'cylinder', kind: 'palm', center: { x: x + (rnd() - 0.5) * 12, z: z + (rnd() - 0.5) * 12 }, radius: 0.22, height: 5 + rnd() * 3 });
        }
      }
    }
  }

  const spawnLane = network.lane(def.spawn.lane);
  const sp = spawnLane.path.pointAt(def.spawn.at);
  const sd = spawnLane.path.directionAt(def.spawn.at);
  const heading = Math.atan2(sd.x, -sd.z) / DEG;

  return {
    def,
    network,
    surfaces,
    paint,
    raised,
    hills,
    bumps,
    signs,
    signalHeads,
    mosques: def.mosques,
    spawn: { x: sp.x, z: sp.z, headingDeg: heading },
  };

  /** A low box running along a road: from `s0` to `s1` from the `from` centre, `offset` to the right. */
  function boxAlong(origin: P2, d: P2, s0: number, s1: number, offset: number, width: number, height: number): Raised {
    const right = rightOf(d);
    const mid = add(add(origin, d, (s0 + s1) / 2), right, offset);
    const length = s1 - s0;
    const alongX = Math.abs(d.x) > 0.5;
    return { type: 'box', kind: 'kerb', center: mid, size: alongX ? [length, height, width] : [width, height, length] };
  }
}

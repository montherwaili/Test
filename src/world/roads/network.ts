/**
 * The road network at lane level: every lane is a path with a speed limit,
 * the lanes that follow it, the lanes beside it, and the rule at its end
 * (signal, stop, give way). Traffic follows it, the examiner judges against
 * it, and routes are sequences of its lanes. Pure data and geometry.
 */
import { Path, headingDiff, headingOf, type P2 } from './geometry';
import { signalState, type SignalPlan, type SignalState } from './signals';

export type LaneKind = 'road' | 'junction' | 'roundabout';
export type Turn = 'straight' | 'left' | 'right' | 'uturn';

/** What a driver must do at the end of a lane, before taking the next one. */
export type EndControl =
  | { type: 'none' }
  | { type: 'signal'; junction: string; group: string }
  | { type: 'stop' }
  | { type: 'giveWay' };

export interface Lane {
  id: string;
  kind: LaneKind;
  path: Path;
  /** Height of the road surface at each path point, m. */
  elevations: number[];
  width: number;
  /** km/h */
  speedLimit: number;
  /** Lanes that can follow this one. */
  next: string[];
  /** Lanes that lead into this one. */
  previous: string[];
  /** Same-direction lane immediately to the left / right, if any (lane changes). */
  left: string | null;
  right: string | null;
  /** Rule at the end of this lane. */
  end: EndControl;
  /** For junction lanes: the manoeuvre this lane is. */
  turn: Turn | null;
  /** Lanes whose traffic has priority over traffic on this lane. */
  yieldTo: string[];
  /** Junction or roundabout this lane belongs to (connectors and ring lanes), or the road id. */
  owner: string;
  /** 0 = right-hand (kerb-side) lane, counting up towards the centre of the road. */
  index: number;
}

export interface LanePosition {
  lane: Lane;
  /** Distance along the lane, m. */
  s: number;
  /** Offset from the lane centre, m, positive = right of travel. */
  lateral: number;
  /** Distance from the lane centre line, m. */
  distance: number;
}

export interface PedestrianCrossing {
  id: string;
  /** The two kerb ends of the crossing. */
  from: P2;
  to: P2;
  width: number;
  /** Lanes the crossing passes over, with the distance along each. */
  lanes: { lane: string; s: number }[];
}

export interface SpeedBump {
  id: string;
  position: P2;
  /** Lanes it lies across, with the distance along each. */
  lanes: { lane: string; s: number }[];
}

const CELL = 24;

export class RoadNetwork {
  readonly lanes = new Map<string, Lane>();
  readonly signals = new Map<string, SignalPlan>();
  readonly crossings: PedestrianCrossing[] = [];
  readonly bumps: SpeedBump[] = [];
  private grid = new Map<string, Lane[]>();

  addLane(lane: Lane): void {
    if (this.lanes.has(lane.id)) throw new Error(`duplicate lane id ${lane.id}`);
    this.lanes.set(lane.id, lane);
  }

  lane(id: string): Lane {
    const l = this.lanes.get(id);
    if (!l) throw new Error(`no lane ${id}`);
    return l;
  }

  /** Join `from` to `to` (both directions of the link are recorded). */
  connect(from: string, to: string): void {
    const a = this.lane(from);
    const b = this.lane(to);
    if (!a.next.includes(to)) a.next.push(to);
    if (!b.previous.includes(from)) b.previous.push(from);
  }

  /** Call once all lanes are added: builds the spatial index. */
  finish(): void {
    this.grid.clear();
    for (const lane of this.lanes.values()) {
      const seen = new Set<string>();
      const pts = lane.path.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (CELL / 2)));
        for (let k = 0; k <= steps; k++) {
          const x = a.x + ((b.x - a.x) * k) / steps;
          const z = a.z + ((b.z - a.z) * k) / steps;
          const cx = Math.floor(x / CELL);
          const cz = Math.floor(z / CELL);
          // Register in the neighbouring cells too, so a query only reads its own cell.
          for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
              const key = `${cx + dx},${cz + dz}`;
              if (seen.has(key)) continue;
              seen.add(key);
              let list = this.grid.get(key);
              if (!list) this.grid.set(key, (list = []));
              list.push(lane);
            }
          }
        }
      }
    }
  }

  /**
   * The lane a point is on (or nearest to, within `maxDistance`). Where lanes
   * overlap, as they do inside junctions, `headingDeg` picks the one going the
   * same way as the vehicle.
   */
  locate(p: P2, headingDeg?: number, maxDistance = 6): LanePosition | null {
    const list = this.grid.get(`${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`);
    if (!list) return null;
    let best: LanePosition | null = null;
    let bestScore = Infinity;
    for (const lane of list) {
      const pr = lane.path.project(p);
      if (pr.distance > maxDistance) continue;
      let score = pr.distance;
      if (headingDeg !== undefined) {
        const off = Math.abs(headingDiff(headingOf(lane.path.directionAt(pr.s)), headingDeg));
        // Facing the wrong way along a lane is a much worse match than being a metre off it.
        score += off > 90 ? 50 : off * 0.08;
      }
      if (score < bestScore) {
        bestScore = score;
        best = { lane, s: pr.s, lateral: pr.lateral, distance: pr.distance };
      }
    }
    return best;
  }

  /** Signal colour facing traffic at the end of `lane` at `time`; null if not signalled. */
  signalFor(lane: Lane, time: number): SignalState | null {
    if (lane.end.type !== 'signal') return null;
    const plan = this.signals.get(lane.end.junction);
    return plan ? signalState(plan, lane.end.group, time) : null;
  }

  /** Height of the surface at distance `s` along a lane. */
  elevationAt(lane: Lane, s: number): number {
    const o = lane.path.offsets;
    if (s <= 0) return lane.elevations[0]!;
    if (s >= lane.path.length) return lane.elevations[o.length - 1]!;
    let i = 0;
    while (i < o.length - 2 && o[i + 1]! < s) i++;
    const t = (s - o[i]!) / (o[i + 1]! - o[i]! || 1);
    return lane.elevations[i]! + (lane.elevations[i + 1]! - lane.elevations[i]!) * t;
  }

  /**
   * A route between two lanes as a list of lane ids (fewest metres), or null.
   * Lane changes to a neighbouring lane are allowed.
   */
  route(fromId: string, toId: string): string[] | null {
    const distTo = new Map<string, number>([[fromId, 0]]);
    const prev = new Map<string, string>();
    const open = new Set<string>([fromId]);
    while (open.size > 0) {
      let current = '';
      let best = Infinity;
      for (const id of open) {
        const d = distTo.get(id)!;
        if (d < best) {
          best = d;
          current = id;
        }
      }
      if (current === toId) {
        const out = [toId];
        while (out[0] !== fromId) out.unshift(prev.get(out[0]!)!);
        return out;
      }
      open.delete(current);
      const lane = this.lane(current);
      const options: [string, number][] = lane.next.map((n) => [n, lane.path.length]);
      // Changing lane costs a little, so routes do not weave.
      if (lane.left) options.push([lane.left, 15]);
      if (lane.right) options.push([lane.right, 15]);
      for (const [n, cost] of options) {
        const d = best + cost;
        if (d < (distTo.get(n) ?? Infinity)) {
          distTo.set(n, d);
          prev.set(n, current);
          open.add(n);
        }
      }
    }
    return null;
  }
}

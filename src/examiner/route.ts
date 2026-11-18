/**
 * The road test route: which lanes to drive, what the examiner says and when,
 * putting the learner back on course after a wrong turn, and recognising the
 * finish. Pure TypeScript on the road network.
 *
 * TODO(verify with ROP): a wrong turn is not counted as a fault here (most
 * examiners simply redirect); the wording of instructions is ours.
 */
import { headingDiff, headingOf } from '../world/roads/geometry';
import type { Lane, RoadNetwork } from '../world/roads/network';
import type { Text } from './rules';

export interface RouteDef {
  id: string;
  title: Text;
  start: { lane: string; at: number };
  checkpoints: string[];
  finish: { lane: string; at: number };
  timeLimitS: number;
}

export type Instruction =
  | { kind: 'start' }
  | { kind: 'turn'; turn: 'left' | 'right' | 'straight' }
  | { kind: 'roundabout'; exit: number }
  | { kind: 'finish' };

export interface PlannedInstruction {
  /** Index in the lane list of the junction or roundabout entry it is about. */
  at: number;
  instruction: Instruction;
}

export type GuideEvent =
  | { type: 'instruction'; instruction: Instruction }
  | { type: 'offRoute' }
  | { type: 'finished' };

/** Instructions are given this far before the junction, m. */
export const ANNOUNCE_M = 70;
/** Seconds off the planned lanes before the route is re-planned. */
const OFF_ROUTE_S = 1;
/** Stationary with the handbrake on this long at the finish ends the test, s. */
const FINISH_STILL_S = 1.5;
/** How many lanes ahead progress is looked for. */
const WINDOW = 6;

/** The lanes from `from` through each checkpoint in turn, and where each checkpoint falls in them. */
export function planRoute(net: RoadNetwork, from: string, checkpoints: string[]): { lanes: string[]; checkpointAt: number[] } {
  const lanes = [from];
  const checkpointAt: number[] = [];
  for (const cp of checkpoints) {
    const last = lanes[lanes.length - 1]!;
    if (last === cp && lanes.length === 1) {
      // Already on it.
      checkpointAt.push(0);
      continue;
    }
    // The route may come back to the lane it is on: go round and come back to it then.
    const leg = last === cp ? loopBack(net, last) : net.route(last, cp);
    if (!leg) throw new Error(`no way from ${last} to ${cp}`);
    lanes.push(...leg.slice(1));
    checkpointAt.push(lanes.length - 1);
  }
  return { lanes, checkpointAt };
}

function loopBack(net: RoadNetwork, lane: string): string[] | null {
  let best: string[] | null = null;
  for (const n of net.lane(lane).next) {
    const r = net.route(n, lane);
    if (r && (!best || r.length < best.length)) best = [lane, ...r];
  }
  return best;
}

/** Is `b` the lane beside `a` (a lane change, not a move along the road)? */
function beside(net: RoadNetwork, a: string, b: string): boolean {
  const l = net.lane(a);
  return l.left === b || l.right === b;
}

/** What the examiner will say along a list of lanes. */
export function instructionsFor(net: RoadNetwork, lanes: string[]): PlannedInstruction[] {
  const out: PlannedInstruction[] = [];
  for (let i = 1; i < lanes.length; i++) {
    const lane = net.lane(lanes[i]!);
    const prev = net.lane(lanes[i - 1]!);
    if (lane.kind !== 'junction' || prev.kind !== 'road') continue;
    // Only one way to go (a bend in the road, the turning loop): nothing to say.
    if (prev.next.length === 1 && !enters(net, lane)) continue;
    if (enters(net, lane)) {
      let exit = 0;
      for (let j = i + 1; j < lanes.length && net.lane(lanes[j]!).kind === 'roundabout'; j++) {
        if (net.lane(lanes[j]!).next.some((id) => net.lane(id).kind !== 'roundabout')) exit++;
      }
      out.push({ at: i, instruction: { kind: 'roundabout', exit } });
    } else {
      const after = lanes[i + 1] ? net.lane(lanes[i + 1]!) : null;
      if (!after) continue;
      const turn = headingDiff(headingOf(after.path.directionAt(0)), headingOf(prev.path.directionAt(prev.path.length)));
      const abs = Math.abs(turn);
      out.push({ at: i, instruction: { kind: 'turn', turn: abs < 35 ? 'straight' : turn > 0 ? 'right' : 'left' } });
    }
  }
  return out;
}

function enters(net: RoadNetwork, lane: Lane): boolean {
  return lane.next.some((id) => net.lane(id).kind === 'roundabout');
}

export class RouteGuide {
  lanes: string[] = [];
  plan: PlannedInstruction[] = [];
  /** Index of the lane the car is on. */
  index = 0;
  /** Distance along that lane, m. */
  s = 0;
  finished = false;
  /** Checkpoints of the current plan and where they fall in `lanes`. */
  private checkpoints: string[] = [];
  private checkpointAt: number[] = [];
  private announced = new Set<number>();
  private startSaid = false;
  private finishSaid = false;
  private offFor = 0;
  private stillFor = 0;

  constructor(
    readonly net: RoadNetwork,
    readonly def: RouteDef,
  ) {
    this.replan(def.start.lane, def.checkpoints);
    this.s = def.start.at;
  }

  /** Checkpoints not yet reached. */
  get remaining(): string[] {
    return this.checkpoints.filter((_, j) => this.checkpointAt[j]! > this.index);
  }

  /** Metres from the car to the start of lane `i` along the route. */
  distanceTo(i: number): number {
    let d = -this.s;
    for (let k = this.index; k < i; k++) {
      // A lane change runs alongside the next lane: do not count both.
      if (k + 1 < this.lanes.length && beside(this.net, this.lanes[k]!, this.lanes[k + 1]!)) continue;
      d += this.net.lane(this.lanes[k]!).path.length;
    }
    return d;
  }

  /** On the last lane, with every checkpoint passed. */
  get onLastLane(): boolean {
    return this.index === this.lanes.length - 1 && this.remaining.length === 0;
  }

  step(o: { x: number; z: number; headingDeg: number; speed: number; handbrake: boolean; dt: number }): GuideEvent[] {
    const events: GuideEvent[] = [];
    if (this.finished) return events;
    if (!this.startSaid) {
      this.startSaid = true;
      events.push({ type: 'instruction', instruction: { kind: 'start' } });
    }

    this.track(o, events);

    for (const p of this.plan) {
      if (this.announced.has(p.at) || p.at <= this.index) continue;
      if (this.distanceTo(p.at) <= ANNOUNCE_M) {
        this.announced.add(p.at);
        events.push({ type: 'instruction', instruction: p.instruction });
      }
      break; // only ever the next junction
    }

    const lastJunction = this.plan.length ? this.plan[this.plan.length - 1]!.at : 0;
    if (!this.finishSaid && this.remaining.length === 0 && this.index > lastJunction) {
      this.finishSaid = true;
      events.push({ type: 'instruction', instruction: { kind: 'finish' } });
    }

    this.stillFor = Math.abs(o.speed) < 0.05 ? this.stillFor + o.dt : 0;
    if (this.finishSaid && this.onLastLane && this.s >= this.def.finish.at && this.stillFor >= FINISH_STILL_S && o.handbrake) {
      this.finished = true;
      events.push({ type: 'finished' });
    }
    return events;
  }

  private replan(from: string, checkpoints: string[]): void {
    const p = planRoute(this.net, from, checkpoints);
    this.lanes = p.lanes;
    this.checkpoints = [...checkpoints];
    this.checkpointAt = p.checkpointAt;
    this.plan = instructionsFor(this.net, this.lanes);
    this.announced.clear();
    this.index = 0;
  }

  /** Follow the car along the planned lanes; re-plan after a wrong turn. */
  private track(o: { x: number; z: number; headingDeg: number; dt: number }, events: GuideEvent[]): void {
    const at = this.net.locate(o, o.headingDeg, 4);
    if (!at || at.distance > at.lane.width / 2 + 0.6) return;
    const id = at.lane.id;
    // The lane itself first; failing that, the lane beside a planned one (a lane change).
    const end = Math.min(this.lanes.length, this.index + WINDOW);
    let found = -1;
    for (let k = this.index; k < end && found < 0; k++) if (this.lanes[k] === id) found = k;
    for (let k = this.index; k < end && found < 0; k++) if (beside(this.net, this.lanes[k]!, id)) found = k;
    if (found >= 0) {
      this.index = found;
      this.s = at.s;
      this.offFor = 0;
      return;
    }
    // Inside a junction, overlapping lanes can be mistaken for each other: only judge on roads.
    if (at.lane.kind !== 'road') return;
    this.offFor += o.dt;
    if (this.offFor < OFF_ROUTE_S) return;
    this.offFor = 0;
    const left = this.remaining;
    this.replan(id, left.length ? left : [this.def.finish.lane]);
    this.s = at.s;
    this.finishSaid = false;
    events.push({ type: 'offRoute' });
  }
}

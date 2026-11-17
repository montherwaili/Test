/**
 * Pedestrians. They use the marked crossings: walk up to the kerb, wait
 * until any approaching car could stop for them, then cross at walking pace.
 * Cars, in turn, are told to stop for anyone waiting or crossing. Pure logic,
 * seeded, repeatable.
 */
import type { P2 } from '../world/roads/geometry';
import type { Lane, PedestrianCrossing, RoadNetwork } from '../world/roads/network';
import type { Obstacle } from './vehicles';

export type PedestrianState = 'idle' | 'waiting' | 'crossing';

export interface Pedestrian {
  id: number;
  /** Index into the network's crossings. */
  crossing: number;
  /** Which end they are at (or set out from): 0 = `from`, 1 = `to`. */
  side: 0 | 1;
  state: PedestrianState;
  /** Seconds in the current state. */
  time: number;
  /** Idle: seconds until they next want to cross. */
  idleFor: number;
  /** Crossing: distance walked, m. */
  walked: number;
  x: number;
  z: number;
  headingDeg: number;
  /** Clothing, for drawing. */
  style: number;
  /** Where along the pavement they stand when idle, m from the crossing. */
  standAt: number;
  rng: number;
}

export interface PedestrianTuning {
  /** m/s */
  walkSpeed: number;
  /** Idle time between crossings, seconds, min and max. */
  idle: [number, number];
  /** Braking a pedestrian assumes a driver will use for them, m/s². */
  assumedBraking: number;
  /** Cars stop this far before the middle of the crossing, m. */
  stopBefore: number;
}

export const defaultPedestrianTuning: PedestrianTuning = {
  walkSpeed: 1.3,
  idle: [8, 30],
  assumedBraking: 3,
  stopBefore: 2.4,
};

function rnd(p: Pedestrian): number {
  p.rng = (p.rng * 1664525 + 1013904223) >>> 0;
  return p.rng / 0x100000000;
}

function pointToSegment(p: P2, a: P2, b: P2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz || 1;
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

export class Pedestrians {
  readonly list: Pedestrian[] = [];

  constructor(
    readonly network: RoadNetwork,
    readonly tuning: PedestrianTuning = { ...defaultPedestrianTuning },
  ) {}

  /** Put `perCrossing` pedestrians at every crossing, starting at staggered times. */
  populate(perCrossing: number, seed: number): void {
    this.network.crossings.forEach((_c, index) => {
      for (let k = 0; k < perCrossing; k++) this.add(index, (k % 2) as 0 | 1, seed + index * 31 + k * 7);
    });
  }

  add(crossing: number, side: 0 | 1, seed: number): Pedestrian {
    const p: Pedestrian = {
      id: this.list.length + 1,
      crossing,
      side,
      state: 'idle',
      time: 0,
      idleFor: 0,
      walked: 0,
      x: 0,
      z: 0,
      headingDeg: 0,
      style: 0,
      standAt: 0,
      rng: (seed * 2654435761) >>> 0,
    };
    p.style = Math.floor(rnd(p) * 4);
    p.idleFor = 2 + rnd(p) * this.tuning.idle[1];
    p.standAt = 1 + rnd(p) * 3;
    this.place(p);
    this.list.push(p);
    return p;
  }

  /** Is anyone waiting at or walking over this crossing? */
  occupied(crossing: number): { waiting: boolean; crossing: boolean } {
    let waiting = false;
    let crossingNow = false;
    for (const p of this.list) {
      if (p.crossing !== crossing) continue;
      if (p.state === 'crossing') crossingNow = true;
      else if (p.state === 'waiting' && p.time > 0.3) waiting = true;
    }
    return { waiting, crossing: crossingNow };
  }

  /**
   * How far along `lane` from `fromS` a car doing `speed` must stop for
   * pedestrians, or Infinity if it need not. A car too close to stop gently
   * does not brake for someone who is only waiting (they will let it pass).
   */
  stopDistance(lane: Lane, fromS: number, speed: number, carLength: number): number {
    const t = this.tuning;
    let best = Infinity;
    this.network.crossings.forEach((c, index) => {
      const on = c.lanes.find((l) => l.lane === lane.id);
      if (!on) return;
      const d = on.s - t.stopBefore - fromS;
      // Already at or past the stopping point: keep going and clear the crossing.
      if (d < carLength / 2 - 0.2) return;
      const state = this.occupied(index);
      if (!state.waiting && !state.crossing) return;
      if (!state.crossing) {
        const room = d - carLength / 2;
        if ((speed * speed) / (2 * Math.max(room, 0.1)) > t.assumedBraking) return;
      }
      best = Math.min(best, d);
    });
    return best;
  }

  step(dt: number, vehicles: Obstacle[]): void {
    const t = this.tuning;
    for (const p of this.list) {
      const c = this.network.crossings[p.crossing]!;
      p.time += dt;
      if (p.state === 'idle') {
        if (p.time >= p.idleFor) {
          p.state = 'waiting';
          p.time = 0;
        }
      } else if (p.state === 'waiting') {
        if (this.safeToCross(c, vehicles)) {
          p.state = 'crossing';
          p.time = 0;
          p.walked = 0;
        }
      } else {
        p.walked += t.walkSpeed * dt;
        const length = Math.hypot(c.to.x - c.from.x, c.to.z - c.from.z);
        if (p.walked >= length) {
          p.side = p.side === 0 ? 1 : 0;
          p.state = 'idle';
          p.time = 0;
          p.idleFor = t.idle[0] + rnd(p) * (t.idle[1] - t.idle[0]);
          p.standAt = 1 + rnd(p) * 3;
        }
      }
      this.place(p);
    }
  }

  /** Would stepping out now be safe: nothing on the crossing, and everything coming can stop? */
  private safeToCross(c: PedestrianCrossing, vehicles: Obstacle[]): boolean {
    const t = this.tuning;
    for (const v of vehicles) {
      const on = v.lane === null ? undefined : c.lanes.find((l) => l.lane === v.lane);
      if (on) {
        const d = on.s - v.s; // centre of the vehicle to the middle of the crossing
        const clearance = v.length / 2 + c.width / 2;
        if (d > -(clearance + 1) && d < clearance) return false; // on it, or only just off it
        if (d >= clearance) {
          const room = d - clearance;
          const speed = Math.abs(v.speed);
          if (speed > 0.5 && room < (speed * speed) / (2 * t.assumedBraking) + 1) return false;
        }
      } else if (pointToSegment(v, c.from, c.to) < v.length / 2 + c.width / 2) {
        // Not on a known lane (a car turning round, or off its line) but physically there.
        return false;
      }
    }
    return true;
  }

  private place(p: Pedestrian): void {
    const c = this.network.crossings[p.crossing]!;
    const a = p.side === 0 ? c.from : c.to;
    const b = p.side === 0 ? c.to : c.from;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz) || 1;
    const ux = dx / length;
    const uz = dz / length;
    const facing = (Math.atan2(ux, -uz) * 180) / Math.PI;
    if (p.state === 'crossing') {
      p.x = a.x + ux * p.walked;
      p.z = a.z + uz * p.walked;
      p.headingDeg = facing;
    } else if (p.state === 'waiting') {
      p.x = a.x;
      p.z = a.z;
      p.headingDeg = facing;
    } else {
      // Standing a little way along the pavement, back from the kerb.
      p.x = a.x - ux * 0.8 - uz * p.standAt;
      p.z = a.z - uz * 0.8 + ux * p.standAt;
      p.headingDeg = facing;
    }
  }
}

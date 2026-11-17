/**
 * Traffic cars. Each one follows the lanes of the road network, keeps a safe
 * distance from whatever is ahead, obeys speed limits, signals and stop
 * signs, and gives way where the network says it must. Pure logic: no
 * physics engine, no rendering, and all randomness comes from a seed, so a
 * run can be repeated exactly.
 *
 * The cars move along lane centre lines (they are not full physics cars);
 * the world layer gives them solid bodies so the player cannot drive through.
 */
import { headingDiff, headingOf, type P2 } from '../world/roads/geometry';
import type { Lane, RoadNetwork } from '../world/roads/network';

export interface TrafficTuning {
  /** Car length and width, m. */
  length: number;
  width: number;
  /** Most it accelerates, m/s². */
  maxAccel: number;
  /** Braking it is comfortable with, m/s². */
  comfortBrake: number;
  /** Hardest it will ever brake, m/s². */
  maxBrake: number;
  /** Gap it leaves behind a stopped vehicle, bumper to bumper, m. */
  standstillGap: number;
  /** Time gap it keeps to the vehicle ahead, s. */
  headway: number;
  /** How far ahead it looks, m. */
  lookahead: number;
  /** Gap in priority traffic it needs before pulling out, s. */
  gapTime: number;
  /** Seconds it must be stationary at a stop sign. */
  stopTime: number;
  /** Seconds stuck behind something stationary before it sounds the horn. */
  honkAfter: number;
  /** Seconds of waiting to pull out after which it accepts a smaller gap. */
  impatientAfter: number;
}

export const defaultTrafficTuning: TrafficTuning = {
  length: 4.2,
  width: 1.7,
  maxAccel: 1.8,
  comfortBrake: 2.5,
  maxBrake: 7,
  standstillGap: 2.5,
  headway: 1.4,
  lookahead: 70,
  gapTime: 4,
  stopTime: 1,
  honkAfter: 6,
  impatientAfter: 30,
};

/** Anything the traffic must not hit: other traffic cars and the player's car. */
export interface Obstacle {
  id: number;
  x: number;
  z: number;
  /** Compass heading, degrees. */
  headingDeg: number;
  /** m/s along its heading (negative = reversing). */
  speed: number;
  length: number;
  width: number;
  /** Lane it is on and how far along, if known. */
  lane: string | null;
  s: number;
}

export type Indicator = 'off' | 'left' | 'right';

export interface TrafficCar extends Obstacle {
  /** Lanes it will take: [current, next, ...]. */
  plan: string[];
  /** Lane it has just left (the rear of the car may still be on it). */
  previous: string | null;
  /** m/s² over the last step. */
  accel: number;
  /** Speed it likes, as a fraction of the limit. */
  eagerness: number;
  braking: boolean;
  indicator: Indicator;
  /** Height of the road under the car and its nose-up pitch, for drawing. */
  y: number;
  pitch: number;
  /** Has made its stop at the stop line it is waiting at. */
  stopped: number;
  /** Seconds spent waiting to pull out. */
  waiting: number;
  /** Seconds stuck behind a stationary obstacle. */
  blocked: number;
  /** Paint colour index, for drawing. */
  color: number;
  rng: number;
}

export type TrafficEvent = { type: 'honk'; car: number; time: number };

/** Something on the road ahead that a car may have to stop for. */
export interface StopRequest {
  /** Distance from the car's centre to where it must stop, m. */
  distance: number;
}

/** Extra reasons to stop that this module does not know about (pedestrians on a crossing). */
export type ExtraStops = (car: TrafficCar, lane: Lane, fromS: number, offset: number) => number;

const PLAN_LENGTH = 5;

function nextRandom(car: TrafficCar): number {
  car.rng = (car.rng * 1664525 + 1013904223) >>> 0;
  return car.rng / 0x100000000;
}

export class TrafficVehicles {
  readonly cars: TrafficCar[] = [];
  time = 0;
  private events: TrafficEvent[] = [];

  constructor(
    readonly network: RoadNetwork,
    readonly tuning: TrafficTuning = { ...defaultTrafficTuning },
  ) {}

  /** Put a car on a lane. `seed` decides its temperament and the turns it will choose. */
  add(laneId: string, s: number, seed: number, speed = 0): TrafficCar {
    const lane = this.network.lane(laneId);
    const car: TrafficCar = {
      id: this.cars.length + 1,
      x: 0,
      z: 0,
      headingDeg: 0,
      speed,
      length: this.tuning.length,
      width: this.tuning.width,
      lane: laneId,
      s: Math.min(Math.max(s, 0), lane.path.length - 0.01),
      plan: [laneId],
      previous: null,
      accel: 0,
      eagerness: 1,
      braking: false,
      indicator: 'off',
      y: 0,
      pitch: 0,
      stopped: 0,
      waiting: 0,
      blocked: 0,
      color: 0,
      rng: (seed * 2654435761) >>> 0,
    };
    car.eagerness = 0.82 + nextRandom(car) * 0.16;
    car.color = Math.floor(nextRandom(car) * 8);
    this.extendPlan(car);
    this.place(car);
    this.cars.push(car);
    return car;
  }

  /**
   * Scatter `count` cars over the road lanes, spaced apart. Deterministic for
   * a given seed. Lanes named in `avoid` (where the player starts) are left clear.
   */
  populate(count: number, seed: number, avoid: string[] = []): void {
    let s = (seed * 2654435761) >>> 0;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
    const roads = [...this.network.lanes.values()].filter((l) => l.kind === 'road' && !avoid.includes(l.id) && l.path.length > 40);
    const spots: { lane: string; s: number }[] = [];
    for (const lane of roads) {
      for (let at = 12; at < lane.path.length - 25; at += 22) spots.push({ lane: lane.id, s: at });
    }
    // Shuffle, then take the first `count`.
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [spots[i], spots[j]] = [spots[j]!, spots[i]!];
    }
    for (const spot of spots.slice(0, count)) this.add(spot.lane, spot.s, Math.floor(rnd() * 1e9) + 1);
  }

  /** Events raised since the last call (horns). */
  takeEvents(): TrafficEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /**
   * Advance all cars by `dt`. `others` are obstacles that are not traffic
   * cars (the player). `extraStops` lets the caller add stop requests.
   *
   * With `think` false the cars only move, holding the acceleration they last
   * chose: drivers do not need to reconsider 120 times a second, so the game
   * thinks on every fourth step. `thinkDt` is the time since they last thought.
   */
  step(dt: number, others: Obstacle[] = [], extraStops?: ExtraStops, think = true, thinkDt = dt): void {
    this.time += dt;
    if (think) {
      const all: Obstacle[] = [...this.cars, ...others];
      // Decide every car's acceleration from the same snapshot, then move them all.
      for (const car of this.cars) car.accel = this.decide(car, all, thinkDt, extraStops);
    }
    for (const car of this.cars) this.move(car, dt);
  }

  // --- decisions -------------------------------------------------------------------

  private decide(car: TrafficCar, all: Obstacle[], dt: number, extraStops?: ExtraStops): number {
    const t = this.tuning;
    const net = this.network;
    const lane = net.lane(car.plan[0]!);
    const v = car.speed;

    // 1. Speed it would like: the limit here, and slow enough in time for what is coming.
    let desired = (lane.speedLimit / 3.6) * car.eagerness;
    let offset = lane.path.length - car.s;
    for (let i = 1; i < car.plan.length && offset < t.lookahead; i++) {
      const ahead = net.lane(car.plan[i]!);
      const limit = (ahead.speedLimit / 3.6) * car.eagerness;
      // Fastest it can be going now and still be down to `limit` on arrival, braking gently.
      desired = Math.min(desired, Math.sqrt(limit * limit + 2 * t.comfortBrake * 0.7 * Math.max(0, offset)));
      offset += ahead.path.length;
    }

    // 2. Nearest thing in the way: a vehicle on the path, or a line it must stop at.
    let gap = Infinity;
    let leaderSpeed = 0;
    let blockedBy: Obstacle | null = null;
    for (const o of all) {
      if (o.id === car.id) continue;
      const dx = o.x - car.x;
      const dz = o.z - car.z;
      if (dx * dx + dz * dz > (t.lookahead + 10) * (t.lookahead + 10)) continue;
      const found = this.alongPath(car, o);
      if (!found) continue;
      const g = found.distance - (car.length + o.length) / 2;
      if (g < gap) {
        gap = g;
        // Only the part of its speed that takes it along our path counts.
        const along = Math.cos((headingDiff(o.headingDeg, found.headingDeg) * Math.PI) / 180);
        leaderSpeed = Math.max(0, o.speed * along);
        blockedBy = o;
      }
    }

    let stopGap = Infinity;
    const line = this.stopLine(car, lane, all, dt);
    // A line is treated as a stopped vehicle placed so that the car comes to rest with its
    // front bumper about 0.7 m short of it.
    const lineAllowance = t.standstillGap - 0.7 - car.length / 2;
    if (line !== null) stopGap = line + lineAllowance;
    if (extraStops) {
      let from = car.s;
      let off = 0;
      for (let i = 0; i < car.plan.length && off < t.lookahead; i++) {
        const l = net.lane(car.plan[i]!);
        const d = extraStops(car, l, from, off);
        if (d < Infinity) stopGap = Math.min(stopGap, d + lineAllowance);
        off += l.path.length - from;
        from = 0;
      }
    }
    if (stopGap < gap) {
      gap = stopGap;
      leaderSpeed = 0;
      blockedBy = null;
    }

    // 3. Intelligent Driver Model: accelerate towards the desired speed, eased off by the gap.
    let accel = t.maxAccel * (1 - Math.pow(v / Math.max(desired, 0.1), 4));
    if (gap < Infinity) {
      const closing = v - leaderSpeed;
      const wanted = t.standstillGap + Math.max(0, v * t.headway + (v * closing) / (2 * Math.sqrt(t.maxAccel * t.comfortBrake)));
      const g = Math.max(gap, 0.05);
      accel -= t.maxAccel * (wanted / g) * (wanted / g);
      // Out of room: whatever it takes.
      if (gap < 0.3 && closing >= 0) accel = -t.maxBrake;
    }
    accel = Math.max(-t.maxBrake, Math.min(t.maxAccel, accel));

    // 4. Horn: stuck behind something that is not moving (and is not just queueing traffic).
    const stuck = blockedBy !== null && v < 0.3 && gap < t.standstillGap + 2 && Math.abs(blockedBy.speed) < 0.3;
    const inQueue = stuck && this.cars.includes(blockedBy as TrafficCar);
    if (stuck && !inQueue) {
      car.blocked += dt;
      if (car.blocked >= t.honkAfter) {
        this.events.push({ type: 'honk', car: car.id, time: this.time });
        car.blocked = 0;
      }
    } else {
      car.blocked = 0;
    }

    car.braking = accel < -0.6;
    return accel;
  }

  /**
   * Distance to the line at the end of the current lane if the car must stop
   * there now (red light, stop sign not yet obeyed, or no gap to pull out
   * into); null if it may carry on.
   */
  private stopLine(car: TrafficCar, lane: Lane, all: Obstacle[], dt: number): number | null {
    const t = this.tuning;
    const toLine = lane.path.length - car.s;
    if (toLine > t.lookahead) return null;
    const nextId = car.plan[1];
    if (!nextId) return toLine;
    const next = this.network.lane(nextId);
    const near = toLine - car.length / 2 < 3;

    if (lane.end.type === 'signal') {
      const state = this.network.signalFor(lane, this.time);
      if (state === 'red') return toLine;
      if (state === 'amber') {
        // Stop if that can be done comfortably; otherwise it is safer to clear the junction.
        const needed = (car.speed * car.speed) / (2 * Math.max(toLine - car.length / 2, 0.1));
        if (needed <= t.comfortBrake * 1.3) return toLine;
      }
    }

    if (lane.end.type === 'stop' && car.stopped < t.stopTime) {
      // A stop sign means the wheels stop turning: finish the last crawl outright, then count.
      if (near && car.speed < 0.3) {
        car.speed = 0;
        car.stopped += dt;
      }
      return toLine;
    }

    if (next.yieldTo.length > 0) {
      const clear = this.gapClear(car, next, all, toLine);
      if (!clear) {
        if (near && car.speed < 0.5) car.waiting += dt;
        return toLine;
      }
    }
    return null;
  }

  /** Is there room to enter `next` without cutting across traffic that has priority? */
  private gapClear(car: TrafficCar, next: Lane, all: Obstacle[], toLine: number): boolean {
    const t = this.tuning;
    const net = this.network;
    // Time for us to get there and through; a long wait makes a driver settle for less.
    const patience = car.waiting > t.impatientAfter ? 0.5 : 1;
    const needTime = t.gapTime * patience + toLine / Math.max(car.speed, 3);
    for (const o of all) {
      if (o.id === car.id || o.lane === null) continue;
      // Traffic queueing behind us on our own approach is not in the way.
      if (o.lane === car.plan[0]) continue;
      for (const pid of next.yieldTo) {
        const p = net.lane(pid);
        if (o.lane === pid) {
          if (p.kind === 'road') {
            // On an approach road: only matters if it will arrive soon.
            const dist = p.path.length - o.s;
            if (dist < 12 || dist / Math.max(o.speed, 0.5) < needTime) return false;
          } else {
            // On the roundabout or in the junction, in or heading for our way.
            return false;
          }
        } else if (p.previous.includes(o.lane) && p.kind !== 'road') {
          // About to move onto a lane we must give way to.
          const from = net.lane(o.lane);
          const dist = from.path.length - o.s;
          if (dist / Math.max(o.speed, 0.5) < needTime * 0.6) {
            // Unless it is itself held at its own line.
            if (o.speed > 0.5 || from.kind !== 'road') return false;
          }
        }
      }
    }
    return true;
  }

  /**
   * Is `o` on the path this car is about to drive? If so, how far ahead
   * (centre to centre along the path) and which way the path points there.
   */
  private alongPath(car: TrafficCar, o: Obstacle): { distance: number; headingDeg: number } | null {
    const net = this.network;
    const p: P2 = { x: o.x, z: o.z };
    const reach = (car.width + o.width) / 2 + 0.25;
    let offset = -car.s;
    for (let i = 0; i < car.plan.length; i++) {
      const lane = net.lane(car.plan[i]!);
      if (offset > this.tuning.lookahead) break;
      const pr = lane.path.project(p);
      if (pr.distance < reach) {
        const d = offset + pr.s;
        if (d > 0.5) return { distance: d, headingDeg: headingOf(lane.path.directionAt(pr.s)) };
      }
      offset += lane.path.length;
    }
    return null;
  }

  // --- motion --------------------------------------------------------------------

  private move(car: TrafficCar, dt: number): void {
    const net = this.network;
    car.speed = Math.max(0, car.speed + car.accel * dt);
    car.s += car.speed * dt;
    let lane = net.lane(car.plan[0]!);
    while (car.s >= lane.path.length && car.plan.length > 1) {
      car.s -= lane.path.length;
      car.previous = car.plan.shift()!;
      car.stopped = 0;
      car.waiting = 0;
      lane = net.lane(car.plan[0]!);
      this.extendPlan(car);
    }
    car.lane = lane.id;
    this.place(car);
    car.indicator = this.indicatorFor(car);
  }

  private extendPlan(car: TrafficCar): void {
    const net = this.network;
    while (car.plan.length < PLAN_LENGTH) {
      const last = net.lane(car.plan[car.plan.length - 1]!);
      if (last.next.length === 0) break;
      // Dead ends are for parking, not for through traffic: take them only now and then.
      const options = last.next.filter((id) => !this.leadsToDeadEnd(id) || nextRandom(car) < 0.15);
      const pool = options.length > 0 ? options : last.next;
      car.plan.push(pool[Math.floor(nextRandom(car) * pool.length)]!);
    }
  }

  private leadsToDeadEnd(laneId: string): boolean {
    const lane = this.network.lane(laneId);
    const after = lane.next.map((id) => this.network.lane(id));
    return after.some((l) => l.next.some((id) => this.network.lane(id).turn === 'uturn'));
  }

  /** Signal for the next turn once it is close; keep signalling through it. */
  private indicatorFor(car: TrafficCar): Indicator {
    const net = this.network;
    const lane = net.lane(car.plan[0]!);
    const here = lane.turn;
    if (lane.kind === 'junction' && (here === 'left' || here === 'right')) {
      // Entering a roundabout is not a turn; leaving one is.
      if (lane.id.includes(':in:')) return 'off';
      return here;
    }
    const next = car.plan[1] ? net.lane(car.plan[1]) : null;
    if (next && next.kind === 'junction' && lane.path.length - car.s < 35) {
      if (next.id.includes(':in:')) return 'off';
      if (next.turn === 'left' || next.turn === 'right') return next.turn;
    }
    return 'off';
  }

  /** Work out where the car is in the world from its lane position. */
  private place(car: TrafficCar): void {
    const net = this.network;
    const lane = net.lane(car.plan[0]!);
    const half = car.length * 0.3;
    // Front and rear reference points, which may lie on the next / previous lane.
    let front: P2;
    let frontY: number;
    if (car.s + half <= lane.path.length || car.plan.length < 2) {
      front = lane.path.pointAt(car.s + half);
      frontY = net.elevationAt(lane, car.s + half);
    } else {
      const n = net.lane(car.plan[1]!);
      front = n.path.pointAt(car.s + half - lane.path.length);
      frontY = net.elevationAt(n, car.s + half - lane.path.length);
    }
    let rear: P2;
    let rearY: number;
    if (car.s - half >= 0 || !car.previous) {
      rear = lane.path.pointAt(car.s - half);
      rearY = net.elevationAt(lane, car.s - half);
    } else {
      const pv = net.lane(car.previous);
      rear = pv.path.pointAt(pv.path.length + car.s - half);
      rearY = net.elevationAt(pv, pv.path.length + car.s - half);
    }
    car.x = (front.x + rear.x) / 2;
    car.z = (front.z + rear.z) / 2;
    const dx = front.x - rear.x;
    const dz = front.z - rear.z;
    const run = Math.hypot(dx, dz) || 1;
    car.headingDeg = headingOf({ x: dx / run, z: dz / run });
    car.y = (frontY + rearY) / 2;
    car.pitch = Math.atan2(frontY - rearY, run);
  }
}

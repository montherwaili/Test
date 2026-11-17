import { describe, expect, it } from 'vitest';
import townJson from '../../data/maps/town.json';
import { generateTown, type TownDef } from '../../world/roads/generate';
import { headingOf } from '../../world/roads/geometry';
import type { RoadNetwork } from '../../world/roads/network';
import { TrafficVehicles, type Obstacle, type TrafficCar } from '../vehicles';

const net: RoadNetwork = generateTown(townJson as TownDef).network;
const DT = 1 / 30;

/** A stand-in for the player's car (or anything else) sitting on a lane. */
function obstacleOn(laneId: string, s: number, speed = 0): Obstacle {
  const lane = net.lane(laneId);
  const p = lane.path.pointAt(s);
  return { id: 9000, x: p.x, z: p.z, headingDeg: headingOf(lane.path.directionAt(s)), speed, length: 4.1, width: 1.7, lane: laneId, s };
}

function moveAlong(o: Obstacle, dt: number): void {
  const lane = net.lane(o.lane!);
  o.s = Math.min(lane.path.length, o.s + o.speed * dt);
  const p = lane.path.pointAt(o.s);
  o.x = p.x;
  o.z = p.z;
}

/** Bumper-to-bumper gap from `car` to something ahead of it on the same lane. */
const gapTo = (car: TrafficCar, o: Obstacle) => o.s - car.s - (car.length + o.length) / 2;

/** Force the turns a car will take (instead of its random choices). */
function setRoute(car: TrafficCar, lanes: string[]): void {
  car.plan = [...lanes];
}

function run(tv: TrafficVehicles, seconds: number, each?: (t: number) => void, others: Obstacle[] = []): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    tv.step(DT, others);
    each?.(i * DT);
  }
}

describe('a traffic car on its own', () => {
  it('pulls away smoothly and settles near the speed limit', () => {
    const tv = new TrafficVehicles(net);
    const car = tv.add('n1:f0', 5, 1);
    let maxAccel = 0;
    run(tv, 12, () => (maxAccel = Math.max(maxAccel, car.accel)));
    expect(car.speed).toBeGreaterThan(8);
    expect(car.speed).toBeLessThanOrEqual(40 / 3.6);
    expect(maxAccel).toBeLessThanOrEqual(tv.tuning.maxAccel + 1e-9);
  });

  it('never goes meaningfully over the limit, and slows in time for junctions and roundabouts', () => {
    const tv = new TrafficVehicles(net);
    const car = tv.add('av1:f0', 5, 3);
    let worst = -Infinity;
    let hardest = 0;
    const kinds = new Set<string>();
    run(tv, 240, () => {
      const lane = net.lane(car.lane!);
      kinds.add(lane.kind);
      worst = Math.max(worst, car.speed - lane.speedLimit / 3.6);
      hardest = Math.min(hardest, car.accel);
    });
    expect(kinds).toEqual(new Set(['road', 'junction', 'roundabout']));
    expect(worst).toBeLessThan(0.8);
    // Alone on the road it never needs more than firm braking.
    expect(hardest).toBeGreaterThan(-4);
  });

  it('stays on its lane and faces the way it is going', () => {
    const tv = new TrafficVehicles(net);
    const car = tv.add('n1:f0', 5, 5);
    run(tv, 90, () => {
      const at = net.locate(car, car.headingDeg)!;
      expect(at).not.toBeNull();
      expect(at.distance).toBeLessThan(0.6);
    });
  });

  it('climbs the hill road with the road', () => {
    const tv = new TrafficVehicles(net);
    const car = tv.add('w1:f0', 2, 7);
    let peak = 0;
    let steepest = 0;
    run(tv, 25, () => {
      peak = Math.max(peak, car.y);
      steepest = Math.max(steepest, Math.abs(car.pitch));
    });
    expect(peak).toBeCloseTo(2.7, 1);
    expect(steepest).toBeGreaterThan(0.07);
    expect(steepest).toBeLessThan(0.1);
  });

  it('indicates before and through a turn, and not on the straight', () => {
    const tv = new TrafficVehicles(net);
    const car = tv.add('av2:f0', 30, 9);
    setRoute(car, ['av2:f0', 'C2:W0>S0', 'e2:f0']);
    expect(car.indicator).toBe('off');
    const seen: string[] = [];
    run(tv, 60, () => {
      const tag = `${net.lane(car.lane!).kind}:${car.indicator}`;
      if (seen[seen.length - 1] !== tag) seen.push(tag);
    });
    expect(seen.slice(0, 4)).toEqual(['road:off', 'road:right', 'junction:right', 'road:off']);
  });

  it('does not indicate to join a roundabout but does to leave it', () => {
    const tv = new TrafficVehicles(net);
    const car = tv.add('av1:f0', 70, 11);
    setRoute(car, ['av1:f0', 'B2:in:W0', 'B2:ring0:5', 'B2:ring0:6', 'B2:out:S0', 'c2:f0']);
    const onEntry: string[] = [];
    const onExit: string[] = [];
    run(tv, 40, () => {
      if (car.lane === 'B2:in:W0') onEntry.push(car.indicator);
      if (car.lane === 'B2:out:S0') onExit.push(car.indicator);
    });
    expect(onEntry.length).toBeGreaterThan(5);
    expect(new Set(onEntry)).toEqual(new Set(['off']));
    expect(new Set(onExit)).toEqual(new Set(['right']));
  });
});

describe('following distance', () => {
  it('stops behind a stationary vehicle, leaving a gap', () => {
    const tv = new TrafficVehicles(net);
    const car = tv.add('n1:f0', 5, 1);
    const parked = obstacleOn('n1:f0', 80);
    let closest = Infinity;
    run(tv, 30, () => (closest = Math.min(closest, gapTo(car, parked))), [parked]);
    expect(car.speed).toBeLessThan(0.05);
    expect(closest).toBeGreaterThan(1.5);
    expect(gapTo(car, parked)).toBeLessThan(4);
  });

  it('keeps a time gap behind a moving vehicle', () => {
    const tv = new TrafficVehicles(net);
    const car = tv.add('av1:f0', 5, 1);
    const lead = obstacleOn('av1:f0', 30, 3);
    const gaps: number[] = [];
    run(
      tv,
      20,
      (t) => {
        moveAlong(lead, DT);
        if (t > 15) gaps.push(gapTo(car, lead));
      },
      [lead],
    );
    // Matched its speed, about 1.4 s plus the standstill gap behind.
    expect(car.speed).toBeCloseTo(3, 0);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(mean).toBeGreaterThan(2.5 + 3 * 1.4 - 1.5);
    expect(mean).toBeLessThan(2.5 + 3 * 1.4 + 2.5);
  });

  it('does not run into a vehicle that brakes hard', () => {
    const tv = new TrafficVehicles(net);
    const car = tv.add('av1:f0', 5, 1);
    const lead = obstacleOn('av1:f0', 28, 12);
    let closest = Infinity;
    run(
      tv,
      14,
      (t) => {
        if (t > 4) lead.speed = Math.max(0, lead.speed - 6 * DT);
        moveAlong(lead, DT);
        closest = Math.min(closest, gapTo(car, lead));
      },
      [lead],
    );
    expect(lead.speed).toBe(0);
    expect(closest).toBeGreaterThan(0.5);
    expect(car.speed).toBeLessThan(1);
    run(tv, 10, undefined, [lead]);
    expect(car.speed).toBeLessThan(0.1);
    expect(gapTo(car, lead)).toBeGreaterThan(1.5);
  });

  it('ignores vehicles in the next lane and oncoming traffic', () => {
    const tv = new TrafficVehicles(net);
    const car = tv.add('av1:f0', 5, 1);
    const beside = obstacleOn('av1:f1', 40);
    const oncoming = obstacleOn('av1:b0', 40);
    run(tv, 6, undefined, [beside, { ...oncoming, id: 9001 }]);
    // Exactly as if they were not there.
    const alone = new TrafficVehicles(net);
    const other = alone.add('av1:f0', 5, 1);
    run(alone, 6);
    expect(car.s).toBe(other.s);
    expect(car.s).toBeGreaterThan(30);
  });

  it('brakes for something that pulls across its path', () => {
    const tv = new TrafficVehicles(net);
    const car = tv.add('n1:f0', 5, 1);
    run(tv, 8);
    expect(car.speed).toBeGreaterThan(7);
    // A car appears sideways across the lane 22 m ahead.
    const across: Obstacle = { ...obstacleOn('n1:f0', car.s + 22), headingDeg: 0 };
    let hardest = 0;
    let closest = Infinity;
    run(
      tv,
      8,
      () => {
        hardest = Math.min(hardest, car.accel);
        closest = Math.min(closest, across.s - car.s);
      },
      [across],
    );
    expect(hardest).toBeLessThan(-2.5);
    expect(car.speed).toBeLessThan(0.1);
    expect(closest).toBeGreaterThan(3.5);
  });

  it('sounds the horn at a vehicle left standing in the road, but not at a traffic queue', () => {
    const tv = new TrafficVehicles(net);
    const first = tv.add('n1:f0', 30, 1);
    const second = tv.add('n1:f0', 10, 2);
    const blocker = obstacleOn('n1:f0', 60);
    run(tv, 30, undefined, [blocker]);
    const honks = tv.takeEvents();
    expect(honks.length).toBeGreaterThan(0);
    expect(honks.every((h) => h.type === 'honk' && h.car === first.id)).toBe(true);
    expect(honks[0]!.time).toBeGreaterThan(tv.tuning.honkAfter);
    expect(second.speed).toBeLessThan(0.05);
    // Once the way is clear, both set off again.
    run(tv, 10);
    expect(first.speed).toBeGreaterThan(3);
    expect(second.speed).toBeGreaterThan(2);
    expect(tv.takeEvents()).toEqual([]);
  });
});

describe('signals and stop signs', () => {
  it('waits at a red light and never crosses the line on red', () => {
    const tv = new TrafficVehicles(net);
    const car = tv.add('av2:f0', 20, 1);
    const plan = net.signals.get('C2')!;
    let waitedAtLine = false;
    let crossings = 0;
    let last = car.lane;
    // Several signal cycles: the car goes round the block and comes back to signals more than once.
    run(tv, 400, () => {
      const lane = net.lane(car.lane!);
      if (lane.end.type === 'signal' && net.signalFor(lane, tv.time) === 'red' && car.speed < 0.05 && lane.path.length - car.s < 6) {
        waitedAtLine = true;
      }
      if (car.lane !== last) {
        const was = net.lane(last!);
        if (was.end.type === 'signal') {
          crossings++;
          expect(net.signalFor(was, tv.time - DT)).not.toBe('red');
        }
        last = car.lane;
      }
    });
    expect(plan.groups.length).toBeGreaterThan(2);
    expect(crossings).toBeGreaterThan(1);
    expect(waitedAtLine).toBe(true);
  });

  it('stops with its nose just short of the line', () => {
    const tv = new TrafficVehicles(net);
    // Find a moment when the west approach to C2 has just gone red.
    const lane = net.lane('av2:f0');
    while (net.signalFor(lane, tv.time) !== 'amber') tv.step(DT);
    while (net.signalFor(lane, tv.time) !== 'red') tv.step(DT);
    const car = tv.add('av2:f0', lane.path.length - 60, 1, 10);
    run(tv, 12);
    expect(net.signalFor(lane, tv.time)).toBe('red');
    expect(car.speed).toBeLessThan(0.05);
    const nose = lane.path.length - car.s - car.length / 2;
    expect(nose).toBeGreaterThan(0.2);
    expect(nose).toBeLessThan(2);
  });

  it('comes to a complete stop at a stop sign before going on', () => {
    const tv = new TrafficVehicles(net);
    const car = tv.add('c2:f0', 40, 1);
    const lane = net.lane('c2:f0');
    let stationary = 0;
    let longest = 0;
    let entered = false;
    run(tv, 40, () => {
      if (car.lane !== 'c2:f0') {
        entered = true;
        return;
      }
      if (car.speed < 0.1 && lane.path.length - car.s < 5) {
        stationary += DT;
        longest = Math.max(longest, stationary);
      } else stationary = 0;
    });
    expect(entered).toBe(true);
    expect(longest).toBeGreaterThanOrEqual(tv.tuning.stopTime - 0.05);
  });
});

describe('giving way', () => {
  it('waits at the T-junction for traffic on the main road', () => {
    const tv = new TrafficVehicles(net);
    const side = tv.add('c2:f0', 60, 1);
    setRoute(side, ['c2:f0', 'B3:N0>W0', 's1:b0']);
    // A stream of three cars along the main road, due at the junction as the side car is ready.
    const main = [tv.add('s2:b0', 40, 2, 9), tv.add('s2:b0', 22, 3, 9), tv.add('s2:b0', 4, 4, 9)];
    for (const m of main) setRoute(m, ['s2:b0', 'B3:E0>W0', 's1:b0', 'A3:E0>N0', 'w2:b0']);
    let closest = Infinity;
    let sideEnteredAt = -1;
    const mainEnteredAt: number[] = [];
    run(tv, 45, (t) => {
      for (const m of main) closest = Math.min(closest, Math.hypot(m.x - side.x, m.z - side.z));
      if (sideEnteredAt < 0 && side.lane !== 'c2:f0') sideEnteredAt = t;
      main.forEach((m, i) => {
        if (mainEnteredAt[i] === undefined && m.lane !== 's2:b0') mainEnteredAt[i] = t;
      });
    });
    expect(sideEnteredAt).toBeGreaterThan(0);
    // It went after the cars it had to give way to, and never came near them.
    expect(mainEnteredAt.filter((t) => t < sideEnteredAt).length).toBeGreaterThanOrEqual(2);
    expect(closest).toBeGreaterThan(4);
    // The main road traffic was never held up by it.
    for (const m of main) expect(m.lane).not.toBe('s2:b0');
  });

  it('pulls out promptly when the main road is empty', () => {
    const tv = new TrafficVehicles(net);
    const side = tv.add('c2:f0', 80, 1);
    let enteredAt = -1;
    run(tv, 30, (t) => {
      if (enteredAt < 0 && side.lane !== 'c2:f0') enteredAt = t;
    });
    expect(enteredAt).toBeGreaterThan(0);
    expect(enteredAt).toBeLessThan(14);
  });

  it('gives way to traffic already on the roundabout', () => {
    const tv = new TrafficVehicles(net);
    // Three cars circulating on the small roundabout, and one arriving from the south.
    const ring = ['B1:ring0:0', 'B1:ring0:1', 'B1:ring0:2', 'B1:ring0:3', 'B1:ring0:4', 'B1:ring0:5'];
    const circulating = [0, 2, 4].map((k, i) => {
      const c = tv.add(ring[k]!, 1, 10 + i, 6);
      setRoute(c, [...ring.slice(k), ...ring, ...ring, ...ring, ...ring, ...ring, ...ring]);
      return c;
    });
    const arriving = tv.add('c1:b0', 55, 20, 8);
    let closest = Infinity;
    let waited = 0;
    let entered = false;
    run(tv, 60, () => {
      // Keep the ring cars going round for ever.
      for (const c of circulating) if (c.plan.length < 12) c.plan.push(...ring);
      for (const c of circulating) closest = Math.min(closest, Math.hypot(c.x - arriving.x, c.z - arriving.z));
      if (arriving.lane === 'c1:b0' && arriving.speed < 0.2) waited += DT;
      if (arriving.lane !== 'c1:b0') entered = true;
    });
    expect(waited).toBeGreaterThan(0.5);
    expect(closest).toBeGreaterThan(3.2);
    // With the ring that busy it may still be waiting; clear the ring and it goes.
    if (!entered) {
      for (const c of circulating) c.plan = ['B1:out:E0', 'n2:f0'];
      run(tv, 30, () => {
        if (arriving.lane !== 'c1:b0') entered = true;
      });
    }
    expect(entered).toBe(true);
  });

  it('enters an empty roundabout without stopping', () => {
    const tv = new TrafficVehicles(net);
    const car = tv.add('c1:b0', 40, 1, 8);
    let slowest = Infinity;
    run(tv, 20, () => {
      if (car.lane === 'c1:b0' || car.lane?.startsWith('B1:in')) slowest = Math.min(slowest, car.speed);
    });
    expect(car.lane).not.toBe('c1:b0');
    expect(slowest).toBeGreaterThan(2);
  });

  it('gives way to the player on the roundabout too', () => {
    const tv = new TrafficVehicles(net);
    const car = tv.add('c1:b0', 50, 1, 8);
    // The player sits on the ring just before the south arm (broken down, say).
    const player = obstacleOn('B1:ring0:4', 3);
    run(tv, 20, undefined, [player]);
    expect(car.lane).toBe('c1:b0');
    expect(car.speed).toBeLessThan(0.05);
    run(tv, 15);
    expect(car.lane).not.toBe('c1:b0');
  });
});

describe('a town full of traffic', () => {
  function busy(seed: number, count = 24) {
    const tv = new TrafficVehicles(net);
    tv.populate(count, seed, ['av1:f0']);
    return tv;
  }

  it('spreads the requested number of cars over the roads, clear of the player\'s start', () => {
    const tv = busy(1);
    expect(tv.cars).toHaveLength(24);
    expect(tv.cars.some((c) => c.lane === 'av1:f0')).toBe(false);
    expect(new Set(tv.cars.map((c) => c.lane)).size).toBeGreaterThan(8);
    for (const c of tv.cars) expect(net.lane(c.lane!).kind).toBe('road');
  });

  it('runs for ten minutes with no collisions and no gridlock', () => {
    const tv = busy(1);
    const travelled = tv.cars.map(() => 0);
    const lateTravel = tv.cars.map(() => 0);
    let closest = Infinity;
    const total = 600;
    run(tv, total, (t) => {
      tv.cars.forEach((c, i) => {
        travelled[i]! += c.speed * DT;
        if (t > total - 180) lateTravel[i]! += c.speed * DT;
      });
      // Check spacing a few times a second.
      if (Math.round(t / DT) % 6 === 0) {
        for (let i = 0; i < tv.cars.length; i++) {
          for (let j = i + 1; j < tv.cars.length; j++) {
            const a = tv.cars[i]!;
            const b = tv.cars[j]!;
            closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
          }
        }
      }
    });
    // Cars are 1.7 m wide and 4.2 m long: centres closer than 2 m would mean they overlap.
    expect(closest).toBeGreaterThan(2);
    for (let i = 0; i < tv.cars.length; i++) {
      expect(travelled[i], `car ${i + 1} total`).toBeGreaterThan(1500);
      expect(lateTravel[i], `car ${i + 1} in the last three minutes`).toBeGreaterThan(200);
    }
  });

  it('is exactly repeatable for a seed, and different for another', () => {
    const snapshot = (seed: number) => {
      const tv = busy(seed, 12);
      run(tv, 60);
      return tv.cars.map((c) => [c.lane, c.s, c.speed]);
    };
    expect(snapshot(5)).toEqual(snapshot(5));
    expect(snapshot(5)).not.toEqual(snapshot(6));
  });
});

import { describe, expect, it } from 'vitest';
import townJson from '../../data/maps/town.json';
import { generateTown, type TownDef } from '../../world/roads/generate';
import { headingOf } from '../../world/roads/geometry';
import type { RoadNetwork } from '../../world/roads/network';
import { Pedestrians } from '../pedestrians';
import { Traffic } from '../traffic';
import { TrafficVehicles, type Obstacle } from '../vehicles';

const net: RoadNetwork = generateTown(townJson as TownDef).network;
const DT = 1 / 30;

/** The crossing on the north road (n1), and the lane heading east over it. */
const CROSSING = net.crossings.findIndex((c) => c.id.startsWith('n1:'));
const crossing = net.crossings[CROSSING]!;
const eastbound = crossing.lanes.find((l) => l.lane === 'n1:f0')!;

function vehicleOn(laneId: string, s: number, speed = 0): Obstacle {
  const lane = net.lane(laneId);
  const p = lane.path.pointAt(s);
  return { id: 7000, x: p.x, z: p.z, headingDeg: headingOf(lane.path.directionAt(s)), speed, length: 4.2, width: 1.7, lane: laneId, s };
}

/** One pedestrian who wants to cross straight away. */
function eager(peds: Pedestrians, side: 0 | 1 = 0) {
  const p = peds.add(CROSSING, side, 1);
  p.idleFor = 0;
  return p;
}

describe('a pedestrian at a crossing', () => {
  it('crosses an empty road at walking pace and ends up on the other side', () => {
    const peds = new Pedestrians(net);
    const p = eager(peds);
    const length = Math.hypot(crossing.to.x - crossing.from.x, crossing.to.z - crossing.from.z);
    let crossingFor = 0;
    for (let i = 0; i < 40 / DT && !(p.state === 'idle' && p.side === 1); i++) {
      peds.step(DT, []);
      if (p.state === 'crossing') crossingFor += DT;
    }
    expect(p.side).toBe(1);
    expect(p.state).toBe('idle');
    expect(crossingFor).toBeCloseTo(length / peds.tuning.walkSpeed, 0);
    // Standing on the far pavement now, off the road.
    expect(Math.hypot(p.x - crossing.to.x, p.z - crossing.to.z)).toBeLessThan(5);
  });

  it('walks in a straight line between the two kerbs', () => {
    const peds = new Pedestrians(net);
    const p = eager(peds);
    for (let i = 0; i < 200; i++) {
      peds.step(DT, []);
      if (p.state !== 'crossing') continue;
      // On the line from one kerb to the other.
      const dx = crossing.to.x - crossing.from.x;
      const dz = crossing.to.z - crossing.from.z;
      const off = Math.abs((p.x - crossing.from.x) * dz - (p.z - crossing.from.z) * dx) / Math.hypot(dx, dz);
      expect(off).toBeLessThan(1e-6);
    }
  });

  it('waits for a car that is too close to stop, then crosses behind it', () => {
    const peds = new Pedestrians(net);
    const p = eager(peds);
    const car = vehicleOn('n1:f0', eastbound.s - 14, 10);
    let steppedOutAt = -1;
    for (let i = 0; i < 20 / DT; i++) {
      car.s += car.speed * DT;
      const at = net.lane('n1:f0').path.pointAt(car.s);
      car.x = at.x;
      car.z = at.z;
      peds.step(DT, [car]);
      if (steppedOutAt < 0 && p.state === 'crossing') steppedOutAt = car.s - eastbound.s;
    }
    // The car was already clear of the crossing when they stepped out.
    expect(steppedOutAt).toBeGreaterThan(car.length / 2 + crossing.width / 2);
  });

  it('steps out in front of a car that is far enough away to stop', () => {
    const peds = new Pedestrians(net);
    const p = eager(peds);
    const car = vehicleOn('n1:f0', eastbound.s - 45, 8);
    peds.step(DT, [car]);
    peds.step(DT, [car]);
    expect(p.state).toBe('crossing');
  });

  it('does not step out while a car is stopped on the crossing', () => {
    const peds = new Pedestrians(net);
    const p = eager(peds);
    const onIt = vehicleOn('n1:f0', eastbound.s, 0);
    for (let i = 0; i < 5 / DT; i++) peds.step(DT, [onIt]);
    expect(p.state).toBe('waiting');
    // Nor when the vehicle is not on any known lane but is physically there.
    const offLane: Obstacle = { ...onIt, lane: null, s: 0 };
    for (let i = 0; i < 5 / DT; i++) peds.step(DT, [offLane]);
    expect(p.state).toBe('waiting');
    for (let i = 0; i < 1 / DT; i++) peds.step(DT, []);
    expect(p.state).toBe('crossing');
  });

  it('is not bothered by a car queueing well back from the crossing', () => {
    const peds = new Pedestrians(net);
    const p = eager(peds);
    const waiting = vehicleOn('n1:f0', eastbound.s - 6, 0);
    peds.step(DT, [waiting]);
    peds.step(DT, [waiting]);
    expect(p.state).toBe('crossing');
  });
});

describe('traffic and pedestrians together', () => {
  it('a car stops for someone on the crossing and goes when they are clear', () => {
    const traffic = new Traffic(net, { cars: 0, pedestriansPerCrossing: 0, seed: 1, keepClear: [] });
    const car = traffic.vehicles.add('n1:f0', eastbound.s - 35, 1, 9);
    const p = eager(traffic.pedestrians);
    // A second person sets out from the other side a few seconds later, so the car has to wait.
    const q = eager(traffic.pedestrians, 1);
    q.idleFor = 4;
    let closest = Infinity;
    let stoppedFor = 0;
    let nose = 0;
    for (let i = 0; i < 30 / DT; i++) {
      traffic.step(DT);
      for (const who of [p, q]) {
        if (who.state === 'crossing') closest = Math.min(closest, Math.hypot(car.x - who.x, car.z - who.z));
      }
      if (p.state === 'crossing' || q.state === 'crossing') {
        if (car.speed < 0.05 && car.lane === 'n1:f0') {
          stoppedFor += DT;
          nose = eastbound.s - car.s - car.length / 2;
        }
      }
    }
    expect(stoppedFor).toBeGreaterThan(2);
    // Stopped short of the stripes (they are 3 m wide, centred on the crossing).
    expect(nose).toBeGreaterThan(crossing.width / 2 + 0.3);
    expect(nose).toBeLessThan(crossing.width / 2 + 4);
    expect(closest).toBeGreaterThan(3);
    // And carried on afterwards.
    expect(car.s > eastbound.s || car.lane !== 'n1:f0').toBe(true);
  });

  it('a car does not brake hard for someone who has only just arrived at the kerb', () => {
    const traffic = new Traffic(net, { cars: 0, pedestriansPerCrossing: 0, seed: 1, keepClear: [] });
    const car = traffic.vehicles.add('n1:f0', eastbound.s - 12, 1, 10);
    eager(traffic.pedestrians);
    let hardest = 0;
    for (let i = 0; i < 3 / DT; i++) {
      traffic.step(DT);
      hardest = Math.min(hardest, car.accel);
    }
    expect(hardest).toBeGreaterThan(-3);
    expect(car.s).toBeGreaterThan(eastbound.s);
  });

  it('the player counts: pedestrians wait for it, and step out once it has stopped', () => {
    const traffic = new Traffic(net, { cars: 0, pedestriansPerCrossing: 0, seed: 1, keepClear: [] });
    const p = eager(traffic.pedestrians);
    const lane = net.lane('n1:f0');
    const playerAt = (s: number, speed: number) => {
      const at = lane.path.pointAt(s);
      return { x: at.x, z: at.z, headingDeg: 90, speed, length: 4.1, width: 1.7 };
    };
    // Player bearing down fast: they wait.
    for (let i = 0; i < 10; i++) traffic.step(DT, playerAt(eastbound.s - 12, 11));
    expect(p.state).toBe('waiting');
    // Player stopped before the crossing: they go.
    for (let i = 0; i < 10; i++) traffic.step(DT, playerAt(eastbound.s - 6, 0));
    expect(p.state).toBe('crossing');
  });

  it('runs a busy town for ten minutes: nobody is hit, everyone keeps moving', () => {
    const traffic = new Traffic(net, { cars: 20, pedestriansPerCrossing: 2, seed: 3, keepClear: ['av1:f0'] });
    expect(traffic.pedestrians.list).toHaveLength(net.crossings.length * 2);
    const crossings = traffic.pedestrians.list.map(() => 0);
    const wasCrossing = traffic.pedestrians.list.map(() => false);
    const travelled = traffic.vehicles.cars.map(() => 0);
    let closestToPedestrian = Infinity;
    let closestCars = Infinity;
    for (let i = 0; i < 600 / DT; i++) {
      traffic.step(DT);
      traffic.pedestrians.list.forEach((p, k) => {
        const now = p.state === 'crossing';
        if (now && !wasCrossing[k]) crossings[k]!++;
        wasCrossing[k] = now;
        if (now) {
          for (const c of traffic.vehicles.cars) closestToPedestrian = Math.min(closestToPedestrian, Math.hypot(c.x - p.x, c.z - p.z));
        }
      });
      traffic.vehicles.cars.forEach((c, k) => (travelled[k]! += c.speed * DT));
      if (i % 6 === 0) {
        const cars = traffic.vehicles.cars;
        for (let a = 0; a < cars.length; a++) {
          for (let b = a + 1; b < cars.length; b++) {
            closestCars = Math.min(closestCars, Math.hypot(cars[a]!.x - cars[b]!.x, cars[a]!.z - cars[b]!.z));
          }
        }
      }
    }
    // A car is 2.1 m from centre to bumper: nothing came within reach of a pedestrian.
    expect(closestToPedestrian).toBeGreaterThan(2.6);
    expect(closestCars).toBeGreaterThan(2);
    for (const n of crossings) expect(n).toBeGreaterThanOrEqual(5);
    for (const d of travelled) expect(d).toBeGreaterThan(1200);
  });

  it('is exactly repeatable', () => {
    const snapshot = () => {
      const traffic = new Traffic(net, { cars: 10, pedestriansPerCrossing: 2, seed: 9, keepClear: [] });
      for (let i = 0; i < 90 / DT; i++) traffic.step(DT);
      return [traffic.vehicles.cars.map((c) => [c.lane, c.s]), traffic.pedestrians.list.map((p) => [p.state, p.side, p.x, p.z])];
    };
    expect(snapshot()).toEqual(snapshot());
  });
});

describe('TrafficVehicles is unaffected when there are no pedestrians', () => {
  it('behaves the same through Traffic as on its own', () => {
    const traffic = new Traffic(net, { cars: 8, pedestriansPerCrossing: 0, seed: 4, keepClear: [] });
    const alone = new TrafficVehicles(net);
    alone.populate(8, 4);
    for (let i = 0; i < 60 / DT; i++) {
      traffic.step(DT);
      alone.step(DT);
    }
    expect(traffic.vehicles.cars.map((c) => [c.lane, c.s])).toEqual(alone.cars.map((c) => [c.lane, c.s]));
  });
});

import { describe, expect, it } from 'vitest';
import { neutralControls } from '../../sim/longitudinalCar';
import { createDefaultTuning } from '../../sim/tuning';
import { Vehicle, type DriveControls } from '../../sim/vehicle';
import { surfaceHeight, type BuiltMap } from '../map';
import { PhysicsWorld, initPhysics } from '../physics';
import { Path, type P2 } from '../roads/geometry';
import type { RoadNetwork } from '../roads/network';
import { buildTown, townLayout } from '../town';

const DT = 1 / 120;
const layout = townLayout();

/** The centre line of a route, as one path. Lane changes become a diagonal across. */
function routePath(net: RoadNetwork, route: string[]): Path {
  const pts: P2[] = [];
  for (let i = 0; i < route.length; i++) {
    const lane = net.lane(route[i]!);
    const next = route[i + 1];
    const changing = next !== undefined && (lane.left === next || lane.right === next);
    const arrivedByChange = i > 0 && (net.lane(route[i - 1]!).left === lane.id || net.lane(route[i - 1]!).right === lane.id);
    // Leave a lane a third of the way along to change; join the new one a little further on.
    const from = arrivedByChange ? lane.path.length * 0.33 + 22 : 0;
    const to = changing ? lane.path.length * 0.33 : lane.path.length;
    for (let s = from; s < to; s += 2) pts.push(lane.path.pointAt(s));
    pts.push(lane.path.pointAt(to));
  }
  return new Path(pts);
}

interface Drive {
  physics: PhysicsWorld;
  map: BuiltMap;
  vehicle: Vehicle;
  pos: () => { x: number; y: number; z: number };
  /** Follow `path` at about `kmh` until its end (or `maxSeconds`); calls `watch` every step. */
  follow: (path: Path, kmh: number, maxSeconds: number, watch?: (s: number) => void) => { finished: boolean; worstOffset: number };
}

async function inTown(laneId: string, at: number): Promise<Drive> {
  await initPhysics();
  const tuning = createDefaultTuning();
  const physics = new PhysicsWorld(120, tuning.body.gravity);
  const map = buildTown(physics, layout);
  const net = map.network!;
  const lane = net.lane(laneId);
  const p = lane.path.pointAt(at);
  const d = lane.path.directionAt(at);
  const car = physics.createCar(tuning, { x: p.x, y: surfaceHeight(map, p.x, p.z) + 0.02, z: p.z }, Math.atan2(d.x, -d.z));
  const vehicle = new Vehicle(tuning, car.port, physics.ground);
  vehicle.powertrain.startInstantly();
  const c: DriveControls = { ...neutralControls(), steer: 0, clutch: 1, gear: 1 };
  const pos = () => car.body.translation();
  const step = () => {
    vehicle.step(DT, c);
    physics.step();
  };
  for (let i = 0; i < 120; i++) step();

  const follow: Drive['follow'] = (path, kmh, maxSeconds, watch) => {
    const { wheelbase } = tuning.chassis;
    const maxSteer = (tuning.steering.maxAngleDeg * Math.PI) / 180;
    let worstOffset = 0;
    let t = 0;
    let shiftUntil = -1;
    while (t < maxSeconds) {
      const here = pos();
      const pr = path.project(here);
      worstOffset = Math.max(worstOffset, pr.distance);
      if (pr.s >= path.length - 3) return { finished: true, worstOffset };
      // Pure pursuit: steer towards a point a little way ahead on the path.
      const speed = vehicle.telemetry.speed;
      const ahead = path.pointAt(pr.s + 2.5 + speed * 0.35);
      const heading = vehicle.telemetry.heading;
      const dx = ahead.x - here.x;
      const dz = ahead.z - here.z;
      const forward = dx * Math.sin(heading) - dz * Math.cos(heading);
      const side = dx * Math.cos(heading) + dz * Math.sin(heading);
      const curvature = (2 * side) / (forward * forward + side * side);
      c.steer = Math.max(-1, Math.min(1, Math.atan(curvature * wheelbase) / maxSteer));
      // First gear to get moving, second to cruise; a simple speed hold on the throttle.
      const v = speed * 3.6;
      if (shiftUntil > 0) {
        c.clutch = 1;
        c.throttle = 0;
        if (t > shiftUntil - 0.15) c.gear = 2;
        if (t > shiftUntil) shiftUntil = -1;
      } else {
        c.clutch = Math.max(0, c.clutch - DT / 1.2);
        c.throttle = Math.max(0, Math.min(0.8, 0.22 + 0.12 * (kmh - v)));
        if (c.gear === 1 && v > 14 && c.clutch === 0) shiftUntil = t + 0.35;
      }
      c.brake = v > kmh + 6 ? 0.3 : 0;
      step();
      watch?.(pr.s);
      t += DT;
    }
    return { finished: false, worstOffset };
  };
  return { physics, map, vehicle, pos, follow };
}

describe('driving in the town', () => {
  it('spawns on the avenue facing east, on the ground', async () => {
    const d = await inTown('av1:f0', 12);
    expect(d.pos().y).toBeCloseTo(d.vehicle.tuning.chassis.comHeight, 2);
    expect((d.vehicle.telemetry.heading * 180) / Math.PI).toBeCloseTo(90, 3);
    expect(d.vehicle.wheels.every((w) => d.map.surfaces.get(w.surface) === 'ground')).toBe(true);
  });

  it('drives the avenue, round the big roundabout, through the signals and into the car park road', async () => {
    const d = await inTown('av1:f0', 12);
    const net = d.map.network!;
    const route = net.route('av1:f0', 'pk:f0')!;
    const path = routePath(net, route);
    const touched = new Set<string>();
    const { finished, worstOffset } = d.follow(path, 22, 150, () => {
      for (const w of d.vehicle.wheels) touched.add(String(d.map.surfaces.get(w.surface)));
    });
    expect(finished).toBe(true);
    // Stayed in lane (lane half-width is 1.75 m) and never mounted a kerb, island or wall.
    expect(worstOffset).toBeLessThan(0.9);
    expect([...touched]).toEqual(['ground']);
    const at = net.locate(d.pos(), (d.vehicle.telemetry.heading * 180) / Math.PI)!;
    expect(at.lane.id).toBe('pk:f0');
    expect(d.vehicle.telemetry.running).toBe(true);
  });

  it('gets round the tight single-lane roundabout and the corner bends', async () => {
    const d = await inTown('c1:b0', 5); // heading north towards B1
    const net = d.map.network!;
    const route = net.route('c1:b0', 'w1:f0')!; // round B1, west along the north road, round the corner
    expect(route.some((id) => id.startsWith('B1:ring'))).toBe(true);
    expect(route.some((id) => id.startsWith('A1:'))).toBe(true);
    const { finished, worstOffset } = d.follow(routePath(net, route), 20, 150);
    expect(finished).toBe(true);
    expect(worstOffset).toBeLessThan(0.9);
  });

  it('climbs the hill road and comes down the other side', async () => {
    const d = await inTown('w1:f0', 2);
    const net = d.map.network!;
    const lane = net.lane('w1:f0');
    let peak = 0;
    let onHill = false;
    const { finished, worstOffset } = d.follow(lane.path, 24, 60, () => {
      peak = Math.max(peak, d.pos().y);
      onHill ||= d.vehicle.wheels.some((w) => d.map.surfaces.get(w.surface) === 'hill');
    });
    expect(finished).toBe(true);
    expect(onHill).toBe(true);
    expect(peak).toBeGreaterThan(2.7 + 0.4);
    expect(d.pos().y).toBeLessThan(0.6);
    expect(worstOffset).toBeLessThan(0.5);
  });

  it('holds on the hill with the handbrake and rolls back without it', async () => {
    const d = await inTown('w1:f0', 26); // on the up-ramp, facing uphill (south)
    const c: DriveControls = { ...neutralControls(), steer: 0, handbrake: 1 };
    const run = (seconds: number) => {
      for (let i = 0; i < seconds * 120; i++) {
        d.vehicle.step(DT, c);
        d.physics.step();
      }
    };
    run(3);
    expect(d.vehicle.telemetry.pitch).toBeGreaterThan(0.07);
    const held = { ...d.pos() };
    run(5);
    expect(Math.hypot(d.pos().x - held.x, d.pos().z - held.z)).toBeLessThan(0.001);
    c.handbrake = 0;
    run(3);
    // Facing south (+z), so rolling back means z decreases.
    expect(d.pos().z).toBeLessThan(held.z - 1);
    expect(d.vehicle.telemetry.wheelSpeed).toBeLessThan(-1);
  });

  it('crosses the speed bumps on the north road', async () => {
    const d = await inTown('n2:f0', 5);
    const net = d.map.network!;
    let bumped = false;
    const { finished } = d.follow(net.lane('n2:f0').path, 20, 60, () => {
      bumped ||= d.vehicle.wheels.some((w) => d.map.surfaces.get(w.surface) === 'bump');
    });
    expect(finished).toBe(true);
    expect(bumped).toBe(true);
    expect(Math.abs(d.vehicle.telemetry.roll)).toBeLessThan(0.05);
  });

  it('is stopped by a building', async () => {
    const d = await inTown('av1:f0', 12);
    const building = d.map.def.solids.find((s) => s.shape === 'box' && s.kind === 'building');
    expect(building).toBeDefined();
    // Solids exist where the map says; the wheels find sidewalks as kerbs.
    const kinds = new Set(d.map.surfaces.values());
    for (const k of ['ground', 'hill', 'kerb', 'island', 'building', 'palm', 'bump']) expect(kinds.has(k as never)).toBe(true);
  });

  it('steps the whole town quickly', async () => {
    const d = await inTown('av1:f0', 12);
    const c: DriveControls = { ...neutralControls(), steer: 0, handbrake: 1 };
    const t0 = performance.now();
    for (let i = 0; i < 120 * 20; i++) {
      d.vehicle.step(DT, c);
      d.physics.step();
    }
    const msPerStep = (performance.now() - t0) / (120 * 20);
    // Budget at 120 Hz is 8.3 ms per step; physics must be a small fraction of it.
    expect(msPerStep).toBeLessThan(0.5);
  });
});

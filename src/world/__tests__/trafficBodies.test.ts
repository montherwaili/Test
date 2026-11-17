import { describe, expect, it } from 'vitest';
import { neutralControls } from '../../sim/longitudinalCar';
import { createDefaultTuning } from '../../sim/tuning';
import { Vehicle, type DriveControls } from '../../sim/vehicle';
import { Traffic } from '../../traffic/traffic';
import { PhysicsWorld, initPhysics } from '../physics';
import { buildTown, townLayout } from '../town';
import { TrafficBodies } from '../trafficBodies';

const DT = 1 / 120;
const layout = townLayout();

async function scene() {
  await initPhysics();
  const tuning = createDefaultTuning();
  const physics = new PhysicsWorld(120, tuning.body.gravity);
  const map = buildTown(physics, layout);
  const net = map.network!;
  const traffic = new Traffic(net, { cars: 0, pedestriansPerCrossing: 0, seed: 1, keepClear: [] });
  // The player on the north road heading east.
  const lane = net.lane('n1:f0');
  const p = lane.path.pointAt(10);
  const car = physics.createCar(tuning, { x: p.x, y: 0.02, z: p.z }, Math.PI / 2);
  const vehicle = new Vehicle(tuning, car.port, physics.ground);
  vehicle.powertrain.startInstantly();
  const c: DriveControls = { ...neutralControls(), steer: 0, clutch: 1, gear: 1 };
  let bodies: TrafficBodies | null = null;
  let steps = 0;
  const run = (seconds: number, patch: (t: number) => Partial<DriveControls> = () => ({})) => {
    bodies ??= new TrafficBodies(physics, traffic);
    for (let i = 0; i < Math.round(seconds * 120); i++) {
      Object.assign(c, patch(i * DT));
      const pos = car.body.translation();
      traffic.step(
        DT,
        { x: pos.x, z: pos.z, headingDeg: (vehicle.telemetry.heading * 180) / Math.PI, speed: vehicle.telemetry.wheelSpeed, length: 4.1, width: 1.7 },
        steps % 4 === 0,
        DT * 4,
      );
      bodies.sync();
      vehicle.step(DT, c);
      physics.step();
      steps++;
    }
  };
  return { traffic, net, car, vehicle, run, pos: () => car.body.translation() };
}

describe('traffic as solid objects', () => {
  it('the player cannot drive through a stopped traffic car', async () => {
    const s = await scene();
    const blocker = s.traffic.vehicles.add('n1:f0', 40, 1);
    // Hold the traffic car where it is, as if it had broken down.
    const hold = () => {
      blocker.speed = 0;
      blocker.s = 40;
    };
    const frozen = s.net.lane('n1:f0').path.pointAt(40);
    s.run(1, () => (hold(), {}));
    expect(blocker.x - s.pos().x).toBeGreaterThan(25);
    // Drive at it, keeping the throttle on.
    s.run(9, (t) => (hold(), { throttle: 0.35, clutch: Math.max(0, 1 - t / 1.5) }));
    expect(blocker.x).toBeCloseTo(frozen.x, 3);
    // The player's nose (1.9 m ahead of its centre) is held at the traffic car's tail (2.1 m behind its centre).
    expect(s.pos().x).toBeLessThan(blocker.x - 3.6);
    expect(s.pos().x).toBeGreaterThan(blocker.x - 6);
    expect(Math.abs(s.pos().z - frozen.z)).toBeLessThan(1);
  });

  it('a traffic car stops behind the stationary player instead of pushing through', async () => {
    const s = await scene();
    const follower = s.traffic.vehicles.add('n1:f0', 0.5, 1);
    follower.s = 0.5;
    // Move the player further up the road, parked with the handbrake on.
    const lane = s.net.lane('n1:f0');
    const at = lane.path.pointAt(60);
    s.car.place({ x: at.x, y: 0.02, z: at.z }, Math.PI / 2);
    const honks: number[] = [];
    let closest = Infinity;
    for (let i = 0; i < 30; i++) {
      s.run(1, () => ({ handbrake: 1, clutch: 0, gear: 0 }));
      closest = Math.min(closest, s.pos().x - follower.x);
      honks.push(...s.traffic.vehicles.takeEvents().map((e) => e.time));
    }
    expect(follower.speed).toBeLessThan(0.05);
    // Centres stay a car length plus a gap apart, and the player has not been shoved.
    expect(closest).toBeGreaterThan(4.2 + 1.5);
    expect(s.pos().x).toBeCloseTo(at.x, 1);
  });

  it('gives pedestrians bodies that follow them', async () => {
    await initPhysics();
    const physics = new PhysicsWorld(120);
    const map = buildTown(physics, layout);
    const traffic = new Traffic(map.network!, { cars: 3, pedestriansPerCrossing: 2, seed: 2, keepClear: [] });
    const bodies = new TrafficBodies(physics, traffic);
    expect(bodies.cars).toHaveLength(3);
    expect(bodies.people).toHaveLength(map.network!.crossings.length * 2);
    expect([...bodies.kinds.values()].filter((k) => k === 'pedestrian')).toHaveLength(bodies.people.length);
    // Handles are distinct from the scenery's.
    for (const h of bodies.kinds.keys()) expect(map.surfaces.has(h)).toBe(false);
  });
});

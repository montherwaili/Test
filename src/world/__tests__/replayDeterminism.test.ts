import { describe, expect, it } from 'vitest';
import { Recording, INPUT_FIELDS } from '../../replay/recording';
import { neutralControls } from '../../sim/longitudinalCar';
import { createDefaultTuning } from '../../sim/tuning';
import { Vehicle, type DriveControls } from '../../sim/vehicle';
import { Traffic } from '../../traffic/traffic';
import { PhysicsWorld, initPhysics } from '../physics';
import { buildTown, townLayout } from '../town';
import { TrafficBodies } from '../trafficBodies';

const DT = 1 / 120;
const layout = townLayout();

/** The game's own step order: traffic, then the car, then physics. */
async function world() {
  await initPhysics();
  const tuning = createDefaultTuning();
  const physics = new PhysicsWorld(120, tuning.body.gravity);
  const map = buildTown(physics, layout);
  const net = map.network!;
  const traffic = new Traffic(net, { cars: 10, pedestriansPerCrossing: 2, seed: 2026, keepClear: ['av1:f0'] });
  const bodies = new TrafficBodies(physics, traffic);
  const lane = net.lane('av1:f0');
  const p = lane.path.pointAt(12);
  const car = physics.createCar(tuning, { x: p.x, y: 0.02, z: p.z }, Math.PI / 2);
  const vehicle = new Vehicle(tuning, car.port, physics.ground);
  vehicle.powertrain.startInstantly();
  let steps = 0;
  const step = (c: DriveControls) => {
    const pos = car.body.translation();
    traffic.step(DT, { x: pos.x, z: pos.z, headingDeg: (vehicle.telemetry.heading * 180) / Math.PI, speed: vehicle.telemetry.wheelSpeed, length: 4.1, width: 1.7 }, steps % 4 === 0, DT * 4);
    bodies.sync();
    vehicle.step(DT, c);
    physics.step();
    steps++;
  };
  const snapshot = () => ({
    car: { ...car.body.translation() },
    rot: { ...car.body.rotation() },
    rpm: vehicle.telemetry.rpm,
    traffic: traffic.vehicles.cars.map((c) => [c.lane, c.s, c.speed]),
    people: traffic.pedestrians.list.map((q) => [q.state, q.x, q.z]),
  });
  return { step, snapshot, vehicle };
}

/** A busy, varied drive: move off, weave, accelerate, brake hard, turn. */
function script(i: number): DriveControls {
  const t = i * DT;
  const c: DriveControls = { ...neutralControls(), steer: 0 };
  c.gear = t < 0.3 ? 0 : t < 8 ? 1 : 2;
  c.clutch = t < 0.5 ? 1 : t < 2.5 ? 1 - (t - 0.5) / 2 : t > 7.8 && t < 8.4 ? 1 : 0;
  c.throttle = t < 0.5 ? 0 : t > 7.8 && t < 8.4 ? 0 : t < 14 ? 0.4 : 0;
  c.brake = t > 14 ? 0.5 : 0;
  c.steer = Math.sin(t * 0.9) * 0.15;
  return c;
}

describe('replaying a drive from its recorded inputs', () => {
  it('reproduces the car, the traffic and the pedestrians exactly', async () => {
    const STEPS = 120 * 20;
    const rec = new Recording({ traffic: 10, pedestrians: 8, loose: 0 });

    const original = await world();
    const checkpoints: ReturnType<typeof original.snapshot>[] = [];
    for (let i = 0; i < STEPS; i++) {
      const c = script(i);
      rec.addInput(i * DT, DT, {
        throttle: c.throttle,
        brake: c.brake,
        clutch: c.clutch,
        steer: c.steer,
        handbrake: c.handbrake,
        gear: c.gear,
        ignition: c.ignition ? 1 : 0,
        starter: c.starter ? 1 : 0,
      });
      original.step(c);
      if (i % 600 === 599) checkpoints.push(original.snapshot());
    }
    // The drive went somewhere (it ends braking, so the car may have stopped by now).
    const last = checkpoints[checkpoints.length - 1]!.car;
    expect(Math.hypot(last.x - checkpoints[0]!.car.x, last.z - checkpoints[0]!.car.z)).toBeGreaterThan(20);
    expect(checkpoints[1]!.car.x - checkpoints[0]!.car.x).not.toBe(0);

    // A fresh world, driven only by what was recorded.
    const again = await world();
    const replayed: ReturnType<typeof again.snapshot>[] = [];
    for (let i = 0; i < rec.inputCount; i++) {
      const v = rec.input(i);
      const c: DriveControls = {
        throttle: v.throttle,
        brake: v.brake,
        clutch: v.clutch,
        steer: v.steer,
        handbrake: v.handbrake,
        gear: v.gear,
        ignition: v.ignition > 0.5,
        starter: v.starter > 0.5,
      };
      again.step(c);
      if (i % 600 === 599) replayed.push(again.snapshot());
    }
    expect(INPUT_FIELDS.length).toBe(8);
    expect(replayed).toEqual(checkpoints);
  });
});

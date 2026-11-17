import { describe, expect, it } from 'vitest';
import yardJson from '../../data/maps/yard.json';
import { ExamSession, carGeometry } from '../../app/examining';
import type { ManoeuvreDef } from '../../examiner/yard';
import { Ancillaries } from '../../sim/ancillaries';
import { neutralControls } from '../../sim/longitudinalCar';
import { createDefaultTuning } from '../../sim/tuning';
import { Vehicle, type DriveControls } from '../../sim/vehicle';
import { buildMap, surfaceHeight, type MapDef } from '../map';
import { PhysicsWorld, initPhysics } from '../physics';

const DT = 1 / 120;

async function inYard(x: number, z: number, headingDeg: number) {
  await initPhysics();
  const tuning = createDefaultTuning();
  const physics = new PhysicsWorld(120, tuning.body.gravity);
  const map = buildMap(yardJson as unknown as MapDef, physics);
  const car = physics.createCar(tuning, { x, y: surfaceHeight(map, x, z) + 0.02, z }, (headingDeg * Math.PI) / 180);
  const vehicle = new Vehicle(tuning, car.port, physics.ground);
  vehicle.powertrain.startInstantly();
  const c: DriveControls = { ...neutralControls(), steer: 0, handbrake: 1, clutch: 1 };
  const anc = new Ancillaries();
  anc.toggleSeatbelt();
  const faults: string[] = [];
  const done: [string, boolean][] = [];
  const exam = new ExamSession(physics, map, vehicle, car.collider.handle, () => car.body.translation(), c, anc, null, null, tuning, yardJson.manoeuvres as ManoeuvreDef[], {
    onFault: (f) => faults.push(f.rule),
    onManoeuvre: (d, e, ok) => {
      if (e === 'done') done.push([d.id, ok!]);
    },
  });
  const step = (patch: Partial<DriveControls> = {}) => {
    Object.assign(c, patch);
    for (const e of vehicle.step(DT, c)) exam.noteEvent(e.type);
    physics.step();
    anc.step(DT, c.steer);
    exam.step(DT);
  };
  const geo = carGeometry(tuning);
  return { physics, map, car, vehicle, c, anc, step, faults, done, geo, pos: () => car.body.translation() };
}

describe('the test yard on the real physics', () => {
  it('stopping at the line, driven properly, passes with no faults', async () => {
    const y = await inYard(-25, 18, 0);
    for (let i = 0; i < 120; i++) y.step();
    y.anc.glance('centre');
    y.c.gear = 1;
    for (let i = 0; i < 30; i++) y.step();
    // Move off, then hold a walking pace and brake so the front stops at the line.
    const lineZ = -10;
    for (let i = 0; i < 120 * 25; i++) {
      const toLine = y.pos().z - y.geo.front - lineZ; // the car heads north (-z)
      const v = y.vehicle.telemetry.speed;
      if (i < 120 * 2) y.step({ handbrake: 0, throttle: 0.2, clutch: Math.max(0, 1 - i / 180) });
      else if (toLine > 6) y.step({ throttle: v < 3 ? 0.15 : 0, clutch: 0, brake: 0 });
      else if (v > 0.02) y.step({ throttle: 0, clutch: 1, brake: Math.min(1, Math.max(0.05, (v * v) / (2 * Math.max(toLine + 0.35, 0.05)) / 8)) });
      else y.step({ brake: 0.6, handbrake: 1, clutch: 1 });
      if (y.done.length > 0) break;
    }
    const past = -(y.pos().z - y.geo.front - lineZ);
    expect(Math.abs(past), `front ${past.toFixed(2)} m past the line`).toBeLessThan(0.5);
    expect(y.done).toEqual([['stopLine', true]]);
    expect(y.faults).toEqual([]);
  });

  it('driving into a pole is caught by the physics and reported', async () => {
    const y = await inYard(15.4, -58, 0); // facing north, lined up on a bay corner pole
    for (let i = 0; i < 60; i++) y.step();
    y.anc.glance('centre');
    for (let i = 0; i < 120 * 8 && !y.faults.includes('touchPole'); i++) {
      y.step({ gear: 1, handbrake: 0, throttle: 0.15, clutch: Math.max(0, 1 - i / 200) });
    }
    expect(y.faults).toContain('touchPole');
  });

  it('a tyre over the parallel-parking kerb is reported', async () => {
    const y = await inYard(29.1, -58, 0); // heading north beside the kerb
    for (let i = 0; i < 60; i++) y.step();
    y.anc.glance('centre');
    for (let i = 0; i < 120 * 8 && !y.faults.includes('touchKerb'); i++) {
      y.step({ gear: 1, handbrake: 0, throttle: 0.15, clutch: Math.max(0, 1 - i / 200), steer: 0.12 });
    }
    expect(y.faults).toContain('touchKerb');
  });

  it('a car on its roof can be put back on its wheels where it lies', async () => {
    const y = await inYard(0, 0, 0);
    // Upside down.
    y.car.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
    y.car.body.setTranslation({ x: 0, y: 1.2, z: 0 }, true);
    for (let i = 0; i < 240; i++) y.step();
    expect(y.vehicle.wheels.every((w) => !w.grounded)).toBe(true);
    const lay = y.pos();
    y.car.place({ x: lay.x, y: surfaceHeight(y.map, lay.x, lay.z) + 0.05, z: lay.z }, y.vehicle.telemetry.heading);
    y.vehicle.resetSolver();
    for (let i = 0; i < 240; i++) y.step();
    expect(y.vehicle.wheels.every((w) => w.grounded)).toBe(true);
    expect(Math.abs(y.vehicle.telemetry.roll)).toBeLessThan(0.01);
    expect(Math.hypot(y.pos().x - lay.x, y.pos().z - lay.z)).toBeLessThan(0.1);
  });
});

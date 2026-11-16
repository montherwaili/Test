import { describe, expect, it } from 'vitest';
import testTrack from '../../data/maps/testTrack.json';
import { neutralControls } from '../../sim/longitudinalCar';
import { createDefaultTuning } from '../../sim/tuning';
import { Vehicle, type DriveControls } from '../../sim/vehicle';
import { buildMap, surfaceHeight, type MapDef } from '../map';
import { PhysicsWorld, initPhysics } from '../physics';

const DT = 1 / 120;

async function onTrack(x: number, z: number, headingDeg = 0) {
  await initPhysics();
  const tuning = createDefaultTuning();
  const physics = new PhysicsWorld(120, tuning.body.gravity);
  const map = buildMap(testTrack as MapDef, physics);
  const car = physics.createCar(tuning, { x, y: surfaceHeight(map, x, z) + 0.02, z }, (headingDeg * Math.PI) / 180);
  const vehicle = new Vehicle(tuning, car.port, physics.ground);
  vehicle.powertrain.startInstantly();
  const c: DriveControls = { ...neutralControls(), steer: 0 };
  const run = (seconds: number, patch: Partial<DriveControls> | ((t: number) => Partial<DriveControls>) = {}) => {
    for (let i = 0; i < Math.round(seconds * 120); i++) {
      Object.assign(c, typeof patch === 'function' ? patch(i * DT) : patch);
      vehicle.step(DT, c);
      physics.step();
    }
  };
  return { physics, map, car, vehicle, c, run, pos: () => car.body.translation() };
}

const moveOff = (t: number) => ({ throttle: 0.3, clutch: Math.max(0, 1 - t / 1.5) });

describe('test track', () => {
  it('spawns the car on the ground, settled', async () => {
    const t = await onTrack(testTrack.spawn.x, testTrack.spawn.z);
    t.run(3, { handbrake: 1 });
    expect(t.pos().y).toBeCloseTo(t.vehicle.tuning.chassis.comHeight, 2);
    expect(t.vehicle.wheels.every((w) => w.grounded)).toBe(true);
    expect(t.map.surfaces.get(t.vehicle.wheels[0]!.surface)).toBe('ground');
  });

  it('reports the hill profile', async () => {
    const t = await onTrack(0, 0);
    const hill = t.map.hills[0]!;
    expect(hill.rise).toBeCloseTo(3, 5);
    expect(surfaceHeight(t.map, 14, -19)).toBe(0);
    expect(surfaceHeight(t.map, 14, -35)).toBeCloseTo(1.5, 5);
    expect(surfaceHeight(t.map, 14, -55)).toBeCloseTo(3, 5);
    expect(surfaceHeight(t.map, 14, -79)).toBeCloseTo(1.5, 5);
    expect(surfaceHeight(t.map, 14, -100)).toBe(0);
    expect(surfaceHeight(t.map, 0, -55)).toBe(0);
  });

  it('lets the car climb the hill, and rolls it back down when left in neutral', async () => {
    const t = await onTrack(14, -8);
    t.run(0.3, { clutch: 1, gear: 1 });
    t.run(5, moveOff);
    // On the 10% ramp now.
    expect(t.pos().y).toBeGreaterThan(0.9);
    expect(t.vehicle.telemetry.pitch).toBeGreaterThan(0.08);
    expect(t.vehicle.telemetry.pitch).toBeLessThan(0.12);
    expect(t.map.surfaces.get(t.vehicle.wheels[2]!.surface)).toBe('hill');
    expect(Math.abs(t.pos().x - 14)).toBeLessThan(0.02);

    // Stop on the ramp with the handbrake: it holds.
    t.run(3, { throttle: 0, clutch: 1, brake: 0.5 });
    t.run(1, { brake: 0, handbrake: 1, gear: 0, clutch: 0 });
    const held = { ...t.pos() };
    t.run(5);
    expect(Math.hypot(t.pos().z - held.z, t.pos().y - held.y)).toBeLessThan(0.001);

    // Release it: back down the hill it goes.
    t.run(3, { handbrake: 0 });
    expect(t.pos().z).toBeGreaterThan(held.z + 1);
    expect(t.vehicle.telemetry.wheelSpeed).toBeLessThan(-1);
  });

  it('drives over the top of the hill and down the far side', async () => {
    const t = await onTrack(14, -8);
    t.run(0.3, { clutch: 1, gear: 1 });
    let peak = 0;
    for (let i = 0; i < 17; i++) {
      t.run(1, i < 2 ? moveOff : { throttle: 0.3, clutch: 0 });
      peak = Math.max(peak, t.pos().y);
    }
    expect(peak).toBeGreaterThan(3 + 0.4);
    expect(t.pos().z).toBeLessThan(-96);
    expect(t.pos().y).toBeCloseTo(t.vehicle.tuning.chassis.comHeight, 1);
    // Dead straight the whole way: nothing in the crest or the foot pulls it off line.
    expect(Math.abs(t.pos().x - 14)).toBeLessThan(0.001);
    expect(Math.abs(t.vehicle.telemetry.heading)).toBeLessThan(1e-4);
  });

  it('jolts the suspension over a speed bump without launching the car', async () => {
    const t = await onTrack(0, -30);
    t.run(0.3, { clutch: 1, gear: 1 });
    t.run(2.5, moveOff);
    let maxCompression = 0;
    let minLoad = Infinity;
    let maxY = 0;
    let sawBump = false;
    for (let i = 0; i < 120 * 6; i++) {
      t.run(DT, { throttle: 0.2 });
      const w = t.vehicle.wheels[0]!;
      sawBump ||= t.map.surfaces.get(w.surface) === 'bump';
      maxCompression = Math.max(maxCompression, w.compression);
      minLoad = Math.min(minLoad, w.load);
      maxY = Math.max(maxY, t.pos().y);
    }
    expect(sawBump).toBe(true);
    expect(t.pos().z).toBeLessThan(-58);
    // Front spring squeezed beyond its resting compression by the bump...
    expect(maxCompression).toBeGreaterThan(0.121 + 0.02);
    // ...but the body barely rises and the car is still pointing straight.
    expect(maxY).toBeLessThan(t.vehicle.tuning.chassis.comHeight + 0.08);
    expect(Math.abs(t.vehicle.telemetry.heading)).toBeLessThan(0.01);
  });

  it('has loose cones standing where the map says', async () => {
    const t = await onTrack(0, 0);
    t.run(2, { handbrake: 1 });
    expect(t.map.cones).toHaveLength(testTrack.cones.length);
    const first = t.map.cones[0]!.body.translation();
    expect(first.x).toBeCloseTo(-16, 2);
    expect(first.z).toBeCloseTo(-10, 2);
    expect(first.y).toBeCloseTo(0.25, 1);
  });

  it('stops the car at the end wall', async () => {
    const t = await onTrack(0, -150);
    t.run(0.3, { clutch: 1, gear: 1 });
    t.run(8, moveOff);
    expect(t.pos().z).toBeGreaterThan(-171.7);
    expect(Math.abs(t.vehicle.telemetry.speedKmh)).toBeLessThan(3);
  });
});

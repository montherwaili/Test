import { describe, expect, it } from 'vitest';
import { LongitudinalCar, neutralControls } from '../../sim/longitudinalCar';
import { createDefaultTuning } from '../../sim/tuning';
import {
  DT,
  accelerateTo,
  controls,
  drive,
  eventTypes,
  getMoving,
  makeRig,
  moved,
  position,
  ramp,
  type Rig,
} from './helpers';

const DEG = 180 / Math.PI;
const loads = (rig: Rig) => rig.vehicle.wheels.map((w) => w.load);

describe('at rest', () => {
  it('settles at its ride height with 60% of the weight on the front', async () => {
    const rig = await makeRig();
    drive(rig, controls(), 3);
    const { chassis, body } = rig.tuning;
    expect(position(rig).y).toBeCloseTo(chassis.comHeight, 2);
    const [fl, fr, rl, rr] = loads(rig) as [number, number, number, number];
    const total = fl + fr + rl + rr;
    expect(total).toBeCloseTo(body.mass * body.gravity, -1);
    expect((fl + fr) / total).toBeCloseTo(chassis.frontWeightFraction, 2);
    expect(fl).toBeCloseTo(fr, 0);
    expect(rig.vehicle.wheels.every((w) => w.grounded)).toBe(true);
  });

  it('stays exactly where it is, level, for 20 seconds', async () => {
    const rig = await makeRig();
    const c = controls();
    drive(rig, c, 3);
    const a = position(rig);
    drive(rig, c, 20);
    expect(moved(a, position(rig))).toBeLessThan(0.0005);
    expect(Math.abs(rig.vehicle.telemetry.pitch * DEG)).toBeLessThan(0.1);
    expect(Math.abs(rig.vehicle.telemetry.roll * DEG)).toBeLessThan(0.01);
    expect(Math.abs(rig.vehicle.telemetry.heading * DEG)).toBeLessThan(0.001);
  });

  it('lands and settles when dropped from a metre up', async () => {
    const rig = await makeRig();
    rig.car.body.setTranslation({ x: 0, y: 1.5, z: 0 }, true);
    rig.vehicle.resetSolver();
    const c = controls({ handbrake: 1 });
    let sawAir = false;
    drive(rig, c, 4, (_t, r) => {
      sawAir ||= r.vehicle.wheels.every((w) => !w.grounded);
      return {};
    });
    expect(sawAir).toBe(true);
    expect(position(rig).y).toBeCloseTo(rig.tuning.chassis.comHeight, 2);
    expect(Math.abs(rig.vehicle.telemetry.speed)).toBeLessThan(0.001);
  });
});

describe('driving in a straight line', () => {
  it('moves off straight and true', async () => {
    const rig = await makeRig();
    const c = controls();
    drive(rig, c, 1);
    const events = [
      ...drive(rig, c, 0.3, { clutch: 1, gear: 1 }),
      ...drive(rig, c, 5, (t) => ({ throttle: 0.25, clutch: ramp(t, 1, 0, 2) })),
    ];
    expect(eventTypes(events)).toEqual(['shift']);
    expect(rig.vehicle.telemetry.speedKmh).toBeGreaterThan(10);
    expect(position(rig).z).toBeLessThan(-5); // forward is -Z
    expect(Math.abs(position(rig).x)).toBeLessThan(0.001);
    expect(Math.abs(rig.vehicle.telemetry.drivelineSlipRpm)).toBeLessThan(1);
    expect(rig.vehicle.telemetry.wheelspin).toBe(false);
  });

  it('agrees with the straight-line test car from phase 1', async () => {
    // Same script through both models: the 3D car should end at nearly the
    // same speed (it differs only by suspension and tyre detail).
    const script = (t: number) =>
      t < 0.3
        ? { clutch: 1, gear: 1, throttle: 0 }
        : { clutch: Math.max(0, 1 - (t - 0.3) / 2), gear: 1, throttle: 0.3 };

    const rig = await makeRig();
    const c = controls();
    drive(rig, c, 6, (t) => script(t));

    const simple = new LongitudinalCar(createDefaultTuning());
    simple.powertrain.startInstantly();
    const sc = neutralControls();
    for (let i = 0; i < 6 * 120; i++) simple.step(DT, Object.assign(sc, script(i * DT)));

    expect(rig.vehicle.telemetry.speed).toBeGreaterThan(3);
    expect(rig.vehicle.telemetry.speed / simple.speed).toBeGreaterThan(0.93);
    expect(rig.vehicle.telemetry.speed / simple.speed).toBeLessThan(1.07);
    expect(rig.vehicle.telemetry.rpm / simple.telemetry.rpm).toBeGreaterThan(0.93);
    expect(rig.vehicle.telemetry.rpm / simple.telemetry.rpm).toBeLessThan(1.07);
  });

  it('stalls when the clutch is dumped at idle', async () => {
    const rig = await makeRig();
    const c = controls({ clutch: 1, gear: 1 });
    drive(rig, c, 1);
    const events = drive(rig, c, 2, { clutch: 0 });
    expect(eventTypes(events)).toEqual(['stall']);
    expect(rig.vehicle.telemetry.running).toBe(false);
    expect(Math.abs(rig.vehicle.telemetry.speed)).toBeLessThan(0.001);
    expect(-position(rig).z).toBeGreaterThan(0);
    expect(-position(rig).z).toBeLessThan(0.5);
  });

  it('stalls when braked to a stop in gear, not when the clutch goes down', async () => {
    const a = await makeRig();
    const ca = controls();
    getMoving(a, ca);
    expect(eventTypes(drive(a, ca, 5, { throttle: 0, brake: 0.4 }))).toEqual(['stall']);

    const b = await makeRig();
    const cb = controls();
    getMoving(b, cb);
    const events = drive(b, cb, 5, (_t, r) => ({
      throttle: 0,
      brake: 0.4,
      clutch: r.vehicle.telemetry.rpm < 1100 ? 1 : cb.clutch,
    }));
    expect(eventTypes(events)).toEqual([]);
    expect(b.vehicle.telemetry.running).toBe(true);
    expect(Math.abs(b.vehicle.telemetry.speed)).toBeLessThan(0.001);
  });

  it('does 0-100 km/h in a small-saloon time and reaches a believable top speed', async () => {
    const rig = await makeRig();
    const c = controls();
    drive(rig, c, 1);
    const t = accelerateTo(rig, c, 100);
    expect(t).toBeGreaterThan(8);
    expect(t).toBeLessThan(14);
    accelerateTo(rig, c, 1000, 60);
    expect(rig.vehicle.telemetry.speedKmh).toBeGreaterThan(165);
    expect(rig.vehicle.telemetry.speedKmh).toBeLessThan(200);
    expect(Math.abs(position(rig).x)).toBeLessThan(0.05);
  });

  it('spins its front wheels on a brutal launch but not on a gentle one', async () => {
    const hard = await makeRig();
    const ch = controls({ clutch: 1, gear: 1 });
    drive(hard, ch, 1.5, { throttle: 1 });
    let spun = false;
    let peakSlip = 0;
    drive(hard, ch, 1.5, (_t, r) => {
      spun ||= r.vehicle.telemetry.wheelspin;
      peakSlip = Math.max(peakSlip, r.vehicle.telemetry.slipRatio);
      return { clutch: 0 };
    });
    expect(spun).toBe(true);
    expect(peakSlip).toBeGreaterThan(0.2);
    // Driven wheels turn faster than the undriven ones while spinning... and it still gets going.
    expect(hard.vehicle.telemetry.speedKmh).toBeGreaterThan(15);

    const gentle = await makeRig();
    const cg = controls({ clutch: 1, gear: 1 });
    drive(gentle, cg, 0.5);
    let gentleSpin = false;
    drive(gentle, cg, 4, (t, r) => {
      gentleSpin ||= r.vehicle.telemetry.wheelspin;
      return { throttle: 0.15, clutch: ramp(t, 1, 0, 2.5) };
    });
    expect(gentleSpin).toBe(false);
    expect(gentle.vehicle.telemetry.speedKmh).toBeGreaterThan(5);
  });

  it('drives backwards in reverse', async () => {
    const rig = await makeRig();
    const c = controls({ clutch: 1, gear: -1 });
    drive(rig, c, 0.5);
    drive(rig, c, 4, (t) => ({ throttle: 0.2, clutch: ramp(t, 1, 0, 2) }));
    expect(rig.vehicle.telemetry.speed).toBeLessThan(-1);
    expect(position(rig).z).toBeGreaterThan(1);
    expect(Math.abs(position(rig).x)).toBeLessThan(0.001);
  });
});

describe('braking', () => {
  it('stops from 100 km/h in 35-50 m, straight, diving onto its nose', async () => {
    const rig = await makeRig();
    const c = controls();
    drive(rig, c, 1);
    accelerateTo(rig, c, 100);
    const start = position(rig);
    const staticFront = loads(rig)[0]! + loads(rig)[1]!;
    let minPitch = 0;
    let maxFront = 0;
    let minRear = Infinity;
    drive(rig, c, 7, (_t, r) => {
      minPitch = Math.min(minPitch, r.vehicle.telemetry.pitch);
      const l = loads(r);
      maxFront = Math.max(maxFront, l[0]! + l[1]!);
      minRear = Math.min(minRear, l[2]! + l[3]!);
      return { throttle: 0, brake: 1, clutch: 1 };
    });
    const distance = start.z - position(rig).z;
    expect(distance).toBeGreaterThan(35);
    expect(distance).toBeLessThan(50);
    expect(Math.abs(position(rig).x)).toBeLessThan(0.05);
    expect(minPitch * DEG).toBeLessThan(-1);
    // Weight transfer: the front tyres carry clearly more, the rears clearly less.
    expect(maxFront).toBeGreaterThan(staticFront * 1.2);
    expect(minRear).toBeLessThan(rig.tuning.body.mass * rig.tuning.body.gravity * 0.3);
  });

  it('comes to a dead stop and stays there', async () => {
    const rig = await makeRig();
    const c = controls();
    getMoving(rig, c, 0.5);
    drive(rig, c, 6, { throttle: 0, brake: 0.6, clutch: 1 });
    expect(Math.abs(rig.vehicle.telemetry.speed)).toBeLessThan(1e-4);
    const a = position(rig);
    drive(rig, c, 5);
    expect(moved(a, position(rig))).toBeLessThan(0.0005);
    expect(rig.vehicle.telemetry.running).toBe(true);
  });

  it('never rolls backwards while braking on the flat', async () => {
    const rig = await makeRig();
    const c = controls();
    getMoving(rig, c, 0.5);
    drive(rig, c, 6, (_t, r) => {
      // The body rocks back on its springs as it stops; the wheels must not turn back.
      expect(r.vehicle.telemetry.wheelSpeed).toBeGreaterThan(-0.002);
      return { throttle: 0, brake: 0.8, clutch: 1 };
    });
    expect(rig.vehicle.telemetry.wheelSpeed).toBeCloseTo(0, 5);
  });
});

describe('steering', () => {
  /** Roll along slowly in first on idle, then hold a steering angle. */
  async function circling(steer: number) {
    const rig = await makeRig();
    const c = controls();
    getMoving(rig, c, 0.25, 3);
    drive(rig, c, 3, { throttle: 0 });
    drive(rig, c, 8, { steer });
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    drive(rig, c, 30, (_t, r) => {
      const p = position(r);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
      return {};
    });
    return { rig, radius: (maxX - minX + (maxZ - minZ)) / 4 };
  }

  it('turns right for positive steering and left for negative', async () => {
    const right = await makeRig();
    const cr = controls();
    getMoving(right, cr, 0.25, 3);
    drive(right, cr, 2, { steer: 0.4, throttle: 0 });
    expect(right.vehicle.telemetry.heading).toBeGreaterThan(0.2);
    expect(right.vehicle.telemetry.yawRate).toBeGreaterThan(0);
    expect(position(right).x).toBeGreaterThan(0.2);

    const left = await makeRig();
    const cl = controls();
    getMoving(left, cl, 0.25, 3);
    drive(left, cl, 2, { steer: -0.4, throttle: 0 });
    // A mirror image of the right turn.
    expect(left.vehicle.telemetry.heading).toBeCloseTo(-right.vehicle.telemetry.heading, 4);
    expect(position(left).x).toBeCloseTo(-position(right).x, 4);
    expect(position(left).z).toBeCloseTo(position(right).z, 4);
  });

  it('follows the turning circle its steering geometry predicts at low speed', async () => {
    for (const steer of [0.5, 1]) {
      const { rig, radius } = await circling(steer);
      const { chassis, steering } = rig.tuning;
      const rearAxleRadius = chassis.wheelbase / Math.tan((steer * steering.maxAngleDeg * Math.PI) / 180);
      const toRear = chassis.frontWeightFraction * chassis.wheelbase;
      const expected = Math.hypot(rearAxleRadius, toRear);
      expect(radius / expected).toBeGreaterThan(0.97);
      expect(radius / expected).toBeLessThan(1.03);
    }
  });

  it('has a kerb-to-kerb turning circle of about 10 m at full lock', async () => {
    const { rig } = await circling(1);
    const { chassis, steering } = rig.tuning;
    const rear = chassis.wheelbase / Math.tan((steering.maxAngleDeg * Math.PI) / 180);
    const outerFront = Math.hypot(rear + chassis.track / 2, chassis.wheelbase);
    expect(outerFront * 2).toBeGreaterThan(9);
    expect(outerFront * 2).toBeLessThan(11.5);
    // The outer front wheel is steered less than the inner one (Ackermann).
    const [fl, fr] = rig.vehicle.wheels;
    expect(fr!.steerAngle).toBeGreaterThan(fl!.steerAngle);
    expect(fl!.steerAngle).toBeGreaterThan(0);
  });

  it('leans out of the corner and loads the outside tyres', async () => {
    const rig = await makeRig();
    const c = controls();
    getMoving(rig, c, 0.35, 5);
    drive(rig, c, 4, { steer: 0.2 });
    const t = rig.vehicle.telemetry;
    expect(t.lateralAccel).toBeGreaterThan(1.5);
    expect(t.roll * DEG).toBeLessThan(-0.5); // right turn: leans left
    const [fl, fr, rl, rr] = loads(rig) as [number, number, number, number];
    expect(fl).toBeGreaterThan(fr * 1.3);
    expect(rl).toBeGreaterThan(rr * 1.3);
  });

  it('runs wide when the corner is taken too fast, with cornering force capped by grip', async () => {
    const rig = await makeRig();
    const c = controls();
    drive(rig, c, 1);
    accelerateTo(rig, c, 80);
    let peakLat = 0;
    let minX = Infinity, maxX = -Infinity;
    drive(rig, c, 12, (t, r) => {
      if (t > 1) peakLat = Math.max(peakLat, Math.abs(r.vehicle.telemetry.lateralAccel));
      const p = position(r);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      return { steer: 0.5, throttle: 0.6 };
    });
    const g = rig.tuning.body.gravity;
    expect(peakLat).toBeGreaterThan(0.6 * g);
    expect(peakLat).toBeLessThan(1.05 * rig.tuning.tyres.grip * g);
    const kinematicDiameter =
      2 * (rig.tuning.chassis.wheelbase / Math.tan((0.5 * rig.tuning.steering.maxAngleDeg * Math.PI) / 180));
    expect(maxX - minX).toBeGreaterThan(kinematicDiameter * 2);
    // Front tyres are past their peak slip angle: it is understeering.
    expect(rig.vehicle.wheels[0]!.slipAngle * DEG).toBeGreaterThan(rig.tuning.tyres.peakSlipAngleDeg);
    // ...and it has not rolled over.
    expect(Math.abs(rig.vehicle.telemetry.roll * DEG)).toBeLessThan(10);
  });

  it('swings its tail round when the handbrake is pulled in a turn', async () => {
    const yawAfterTurn = async (handbrake: number) => {
      const rig = await makeRig();
      const c = controls();
      getMoving(rig, c, 0.6, 6);
      drive(rig, c, 1.5, { throttle: 0, clutch: 1, steer: 0.5, handbrake });
      return rig.vehicle.telemetry.heading;
    };
    const plain = await yawAfterTurn(0);
    const handbrake = await yawAfterTurn(1);
    expect(plain).toBeGreaterThan(0.3);
    expect(handbrake).toBeGreaterThan(plain * 1.4);
  });
});

describe('slopes', () => {
  it('rolls back in neutral on a 10% hill', async () => {
    const rig = await makeRig({ gradePercent: 10 });
    const c = controls({ handbrake: 1 });
    drive(rig, c, 2);
    const a = position(rig);
    drive(rig, c, 2, { handbrake: 0 });
    expect(rig.vehicle.telemetry.speed).toBeLessThan(-1);
    expect(position(rig).z).toBeGreaterThan(a.z + 1);
    expect(position(rig).y).toBeLessThan(a.y - 0.1);
  });

  it('is held without creeping by the handbrake, and by the foot brake', async () => {
    for (const hold of [{ handbrake: 1 }, { brake: 0.5 }]) {
      const rig = await makeRig({ gradePercent: 12 });
      const c = controls(hold);
      drive(rig, c, 3);
      const a = position(rig);
      drive(rig, c, 15);
      expect(moved(a, position(rig))).toBeLessThan(0.0005);
    }
  });

  it('stays parked in gear with the engine off', async () => {
    const rig = await makeRig({ gradePercent: 10, engineOff: true });
    const c = controls({ ignition: false, clutch: 1, gear: 1, handbrake: 1 });
    drive(rig, c, 2);
    drive(rig, c, 1, { clutch: 0 });
    const a = position(rig);
    drive(rig, c, 15, { handbrake: 0 });
    expect(moved(a, position(rig))).toBeLessThan(0.002);
  });

  it('sits still across a 10% side slope', async () => {
    const rig = await makeRig({ bankPercent: 10 });
    const c = controls();
    drive(rig, c, 3);
    const a = position(rig);
    drive(rig, c, 15);
    expect(moved(a, position(rig))).toBeLessThan(0.0005);
    // Leaning with the slope, downhill tyres loaded more.
    expect(rig.vehicle.telemetry.roll * DEG).toBeGreaterThan(4);
    expect(loads(rig)[1]!).toBeGreaterThan(loads(rig)[0]!);
  });

  it('pulls away on a hill start without rolling back', async () => {
    const rig = await makeRig({ gradePercent: 10 });
    const c = controls({ clutch: 1, gear: 1, handbrake: 1 });
    drive(rig, c, 2);
    const start = position(rig);
    let rollback = 0;
    const events = drive(rig, c, 8, (t, r) => {
      rollback = Math.max(rollback, position(r).z - start.z);
      return {
        throttle: ramp(t, 0, 0.25, 0.5),
        clutch: t < 1 ? ramp(t, 1, 0.5, 1) : t < 3 ? 0.5 : ramp(t - 3, 0.5, 0, 1.5),
        handbrake: t < 1.5 ? 1 : 0,
      };
    });
    expect(eventTypes(events)).toEqual([]);
    expect(rollback).toBeLessThan(0.005);
    expect(rig.vehicle.telemetry.speedKmh).toBeGreaterThan(8);
    expect(position(rig).y).toBeGreaterThan(start.y + 0.5);
  });

  it('stalls on a hill start with no gas, then stays put in gear', async () => {
    const rig = await makeRig({ gradePercent: 10 });
    const c = controls({ clutch: 1, gear: 1, handbrake: 1 });
    drive(rig, c, 2);
    const start = position(rig);
    const events = drive(rig, c, 8, (t) => ({
      clutch: t < 1 ? ramp(t, 1, 0.5, 1) : t < 3 ? 0.5 : ramp(t - 3, 0.5, 0, 1.5),
      handbrake: t < 1.5 ? 1 : 0,
    }));
    expect(eventTypes(events)).toContain('stall');
    expect(moved(start, position(rig))).toBeLessThan(0.05);
  });
});

describe('collisions', () => {
  it('is stopped by a wall instead of passing through it', async () => {
    const rig = await makeRig();
    rig.physics.addFixedBox({ x: 0, y: 1, z: -40 }, { x: 20, y: 2, z: 1 });
    const c = controls();
    getMoving(rig, c, 0.5, 4);
    expect(rig.vehicle.telemetry.speedKmh).toBeGreaterThan(20);
    drive(rig, c, 6);
    // Nose (about 1.9 m ahead of the centre of mass) rests against the wall face at z = -39.5.
    expect(position(rig).z).toBeGreaterThan(-39.5 + 1.5);
    expect(position(rig).z).toBeLessThan(-36);
    expect(Math.abs(rig.vehicle.telemetry.speedKmh)).toBeLessThan(3);
  });

  it('cannot drive through a thin pole even at speed', async () => {
    const rig = await makeRig();
    rig.physics.addFixedCylinder({ x: 0.3, y: 0.75, z: -120 }, 1.5, 0.04);
    const c = controls();
    drive(rig, c, 1);
    accelerateTo(rig, c, 70);
    expect(position(rig).z).toBeGreaterThan(-110);
    drive(rig, c, 4);
    expect(position(rig).z).toBeGreaterThan(-120);
  });

  it('knocks a cone out of the way and carries on', async () => {
    const rig = await makeRig();
    const cone = rig.physics.addLooseCone({ x: 0, y: 0, z: -15 }, 0.5, 0.14, 2);
    const c = controls();
    getMoving(rig, c, 0.4, 5);
    const p = cone.body.translation();
    expect(Math.hypot(p.x, p.z + 15)).toBeGreaterThan(0.5);
    expect(position(rig).z).toBeLessThan(-20);
    expect(rig.vehicle.telemetry.speedKmh).toBeGreaterThan(15);
  });
});

describe('robustness', () => {
  it('is deterministic: the same drive twice gives identical results', async () => {
    const run = async () => {
      const rig = await makeRig();
      const c = controls();
      getMoving(rig, c, 0.4, 4);
      drive(rig, c, 3, (t) => ({ steer: Math.sin(t * 2) * 0.6, throttle: 0.5 }));
      drive(rig, c, 2, { brake: 0.7, clutch: 1, steer: -0.3, throttle: 0 });
      return { p: position(rig), q: { ...rig.car.body.rotation() }, t: rig.vehicle.telemetry };
    };
    const a = await run();
    const b = await run();
    expect(b).toEqual(a);
  });

  it('stays finite and on its wheels through an abusive drive', async () => {
    const rig = await makeRig();
    const c = controls();
    let seed = 2024;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    for (let i = 0; i < 240; i++) {
      c.throttle = rnd() < 0.4 ? 0 : rnd();
      c.brake = rnd() < 0.75 ? 0 : rnd();
      c.clutch = rnd() < 0.5 ? 0 : rnd() < 0.5 ? 1 : rnd();
      c.handbrake = rnd() < 0.9 ? 0 : 1;
      c.steer = rnd() * 2 - 1;
      c.gear = Math.floor(rnd() * 7) - 1;
      c.starter = rnd() < 0.2;
      drive(rig, c, 0.25);
      const t = rig.vehicle.telemetry;
      const p = position(rig);
      for (const v of [t.speed, t.rpm, t.pitch, t.roll, p.x, p.y, p.z]) expect(Number.isFinite(v)).toBe(true);
      expect(p.y).toBeGreaterThan(0.2);
      expect(p.y).toBeLessThan(1.2);
      expect(Math.abs(t.roll * DEG)).toBeLessThan(25);
      expect(Math.abs(t.speedKmh)).toBeLessThan(220);
    }
  });
});

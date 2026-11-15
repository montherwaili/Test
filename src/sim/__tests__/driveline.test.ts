import { describe, expect, it } from 'vitest';
import { solveDriveline, type DrivelineInput } from '../driveline';

const DT = 1 / 120;

function input(patch: Partial<DrivelineInput>): DrivelineInput {
  return {
    dt: DT,
    iterations: 12,
    engineOmega: 0,
    engineInertia: 0.2,
    engineTorque: 0,
    engineFriction: 0,
    wheelOmega: 0,
    wheelInertia: 100,
    wheelTorque: 0,
    wheelFriction: 0,
    ratio: 10,
    clutchCapacity: 0,
    efficiency: 1,
    ...patch,
  };
}

describe('driveline solver', () => {
  it('leaves engine and wheels independent in neutral', () => {
    const r = solveDriveline(input({ ratio: 0, clutchCapacity: 300, engineOmega: 100, engineTorque: 20, wheelOmega: 5 }));
    expect(r.engineOmega).toBeCloseTo(100 + (20 / 0.2) * DT);
    expect(r.wheelOmega).toBe(5);
    expect(r.clutchTorque).toBe(0);
    expect(r.clutchSlip).toBe(0);
  });

  it('leaves them independent with the clutch pedal down', () => {
    const r = solveDriveline(input({ clutchCapacity: 0, engineOmega: 100, wheelOmega: 5 }));
    expect(r.engineOmega).toBe(100);
    expect(r.wheelOmega).toBe(5);
    expect(r.clutchTorque).toBe(0);
  });

  it('transmits exactly the capacity while slipping', () => {
    const r = solveDriveline(input({ clutchCapacity: 40, engineOmega: 200, wheelOmega: 0 }));
    expect(r.clutchTorque).toBeCloseTo(40);
    expect(r.driveTorque).toBeCloseTo(400);
    expect(r.engineOmega).toBeCloseTo(200 - (40 / 0.2) * DT);
    expect(r.wheelOmega).toBeCloseTo((400 / 100) * DT);
    expect(r.clutchSlip).toBeGreaterThan(0);
  });

  it('drags the engine up when the wheels are faster (engine braking direction)', () => {
    const r = solveDriveline(input({ clutchCapacity: 40, engineOmega: 50, wheelOmega: 20 }));
    expect(r.clutchTorque).toBeCloseTo(-40);
    expect(r.engineOmega).toBeGreaterThan(50);
    expect(r.wheelOmega).toBeLessThan(20);
  });

  it('locks: a strong clutch brings both sides to a common speed in one step', () => {
    const r = solveDriveline(input({ clutchCapacity: 5000, engineOmega: 105, wheelOmega: 10 }));
    expect(r.clutchSlip).toBeCloseTo(0, 9);
    expect(r.engineOmega).toBeCloseTo(r.wheelOmega * 10, 9);
  });

  it('conserves angular momentum through a lossless clutch', () => {
    const before = 0.2 * 300 * 10 + 100 * 2; // reflected to the wheel side: Ie*we*G + Iw*ww
    const r = solveDriveline(input({ clutchCapacity: 5000, engineOmega: 300, wheelOmega: 2 }));
    const after = 0.2 * r.engineOmega * 10 + 100 * r.wheelOmega;
    expect(after).toBeCloseTo(before, 6);
  });

  it('a locked driveline accelerates as one body', () => {
    // 50 N·m at the engine through a 10:1 ratio onto Ie*G^2 + Iw = 120 kg·m².
    let s = input({ clutchCapacity: 300, engineOmega: 100, wheelOmega: 10, engineTorque: 50 });
    for (let i = 0; i < 120; i++) {
      const r = solveDriveline(s);
      s = { ...s, engineOmega: r.engineOmega, wheelOmega: r.wheelOmega };
    }
    expect(s.wheelOmega).toBeCloseTo(10 + 500 / 120, 4);
    expect(s.engineOmega).toBeCloseTo(s.wheelOmega * 10, 6);
  });

  it('reverses the drive direction with a negative ratio', () => {
    const r = solveDriveline(input({ ratio: -10, clutchCapacity: 40, engineOmega: 200 }));
    expect(r.wheelOmega).toBeLessThan(0);
    expect(r.driveTorque).toBeCloseTo(-400);
  });

  it('loses the stated fraction of torque to the gearbox', () => {
    const r = solveDriveline(input({ clutchCapacity: 40, engineOmega: 200, efficiency: 0.9 }));
    expect(r.driveTorque).toBeCloseTo(360);
  });

  it('friction holds stationary wheels against a smaller torque', () => {
    const r = solveDriveline(input({ ratio: 0, wheelTorque: -300, wheelFriction: 500 }));
    expect(r.wheelOmega).toBe(0);
    expect(r.wheelFrictionTorque).toBeCloseTo(300);
  });

  it('friction gives way to a larger torque', () => {
    const r = solveDriveline(input({ ratio: 0, wheelTorque: -800, wheelFriction: 500 }));
    expect(r.wheelOmega).toBeCloseTo((-300 / 100) * DT);
    expect(r.wheelFrictionTorque).toBeCloseTo(500);
  });

  it('friction stops moving wheels without reversing them', () => {
    const r = solveDriveline(input({ ratio: 0, wheelOmega: 0.01, wheelFriction: 5000 }));
    expect(r.wheelOmega).toBe(0);
  });

  it('a dead engine in gear holds the car through the locked clutch', () => {
    // Slope torque 300 N·m at the wheels; engine friction 40 N·m × 10 = 400 N·m of hold.
    const r = solveDriveline(input({ clutchCapacity: 260, engineFriction: 40, wheelTorque: -300 }));
    expect(r.wheelOmega).toBe(0);
    expect(r.engineOmega).toBe(0);
    expect(r.clutchTorque).toBeCloseTo(30);
    expect(r.wheelFrictionTorque).toBeCloseTo(0);
  });

  it('a dead engine in gear lets go when the slope is too steep', () => {
    const r = solveDriveline(input({ clutchCapacity: 260, engineFriction: 40, wheelTorque: -500 }));
    expect(r.wheelOmega).toBeLessThan(0);
    expect(r.engineOmega).toBeLessThan(0);
  });

  it('a weak clutch limits how much a dead engine can hold', () => {
    // Only 20 N·m gets through the clutch: 200 N·m of hold against 300 N·m.
    const r = solveDriveline(input({ clutchCapacity: 20, engineFriction: 40, wheelTorque: -300 }));
    expect(r.wheelOmega).toBeLessThan(0);
  });

  it('wheel brakes and a dead engine share the load', () => {
    const r = solveDriveline(
      input({ clutchCapacity: 260, engineFriction: 40, wheelTorque: -600, wheelFriction: 250 }),
    );
    expect(r.wheelOmega).toBe(0);
    expect(r.engineOmega).toBe(0);
  });

  it('stays bounded with a huge clutch capacity and a huge time step', () => {
    let s = input({ clutchCapacity: 1e6, engineOmega: 500, wheelOmega: -30, dt: 0.1 });
    for (let i = 0; i < 100; i++) {
      const r = solveDriveline(s);
      s = { ...s, engineOmega: r.engineOmega, wheelOmega: r.wheelOmega };
      expect(Number.isFinite(r.engineOmega)).toBe(true);
      expect(Math.abs(r.engineOmega)).toBeLessThanOrEqual(500);
    }
  });
});

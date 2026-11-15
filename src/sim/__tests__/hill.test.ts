import { describe, expect, it } from 'vitest';
import { LongitudinalCar } from '../longitudinalCar';
import { createDefaultTuning } from '../tuning';
import { controls, drive, eventTypes, idlingCar, ramp } from './helpers';

function carOnHill(percent: number) {
  const car = idlingCar();
  car.setGradePercent(percent);
  return car;
}

describe('slopes and rollback', () => {
  it('rolls back in neutral with no brakes', () => {
    const car = carOnHill(10);
    drive(car, controls(), 2);
    expect(car.telemetry.speed).toBeLessThan(-1);
    expect(car.position).toBeLessThan(-1);
  });

  it('rolls back with the clutch down in gear (the classic hill-start fault)', () => {
    const car = carOnHill(10);
    const c = controls({ clutch: 1, gear: 1 });
    drive(car, c, 1.5);
    expect(car.position).toBeLessThan(-0.5);
    expect(car.telemetry.running).toBe(true);
  });

  it('rolls forwards down a descent', () => {
    const car = carOnHill(-10);
    drive(car, controls(), 2);
    expect(car.position).toBeGreaterThan(1);
  });

  it('stays put on the flat and on a very gentle slope', () => {
    for (const grade of [0, 1]) {
      const car = carOnHill(grade);
      drive(car, controls(), 5);
      expect(car.position).toBe(0);
    }
  });

  it('is held by the handbrake', () => {
    const car = carOnHill(12);
    drive(car, controls({ handbrake: 1 }), 10);
    expect(car.position).toBe(0);
    expect(car.telemetry.speed).toBe(0);
  });

  it('is held by the foot brake', () => {
    const car = carOnHill(12);
    drive(car, controls({ brake: 0.4 }), 10);
    expect(car.position).toBe(0);
  });

  it('a half-applied handbrake does not hold a steep hill', () => {
    const car = carOnHill(25);
    drive(car, controls({ handbrake: 0.3 }), 3);
    expect(car.position).toBeLessThan(-0.5);
  });

  it('stays exactly still when parked in gear with the engine off', () => {
    const car = new LongitudinalCar(createDefaultTuning());
    car.setGradePercent(10);
    const c = controls({ ignition: false, clutch: 1, gear: 1, handbrake: 1 });
    drive(car, c, 0.5);
    drive(car, c, 0.5, { clutch: 0 });
    drive(car, c, 30, { handbrake: 0 });
    expect(car.position).toBe(0);
    expect(car.telemetry.speed).toBe(0);
  });

  it('parked in gear holds in reverse too, facing downhill', () => {
    const car = new LongitudinalCar(createDefaultTuning());
    car.setGradePercent(-10);
    const c = controls({ ignition: false, clutch: 1, gear: -1, handbrake: 1 });
    drive(car, c, 0.5);
    drive(car, c, 0.5, { clutch: 0 });
    drive(car, c, 30, { handbrake: 0 });
    expect(car.position).toBe(0);
  });

  it('a high gear holds less than first gear', () => {
    const car = new LongitudinalCar(createDefaultTuning());
    car.setGradePercent(10);
    const c = controls({ ignition: false, clutch: 1, gear: 5, handbrake: 1 });
    drive(car, c, 0.5);
    drive(car, c, 0.5, { clutch: 0 });
    drive(car, c, 5, { handbrake: 0 });
    expect(car.position).toBeLessThan(-0.2);
  });
});

describe('hill start', () => {
  /** Handbrake hill start: find the bite, add gas, release the handbrake, drive away. */
  function handbrakeStart(grade: number, gas: number) {
    const car = carOnHill(grade);
    const c = controls({ clutch: 1, gear: 1, handbrake: 1 });
    drive(car, c, 0.5);
    let lowest = 0;
    const events = drive(car, c, 8, (t, car) => {
      lowest = Math.min(lowest, car.position);
      return {
        throttle: ramp(t, 0, gas, 0.5),
        clutch: t < 1 ? ramp(t, 1, 0.5, 1) : t < 3 ? 0.5 : ramp(t - 3, 0.5, 0, 1.5),
        handbrake: t < 1.5 ? 1 : 0,
      };
    });
    return { car, events, rollback: 0 - lowest };
  }

  it('pulls away uphill without rolling back when done properly', () => {
    const { car, events, rollback } = handbrakeStart(10, 0.25);
    expect(eventTypes(events)).toEqual([]);
    expect(rollback).toBe(0);
    expect(car.telemetry.running).toBe(true);
    expect(car.telemetry.speedKmh).toBeGreaterThan(8);
    expect(car.position).toBeGreaterThan(5);
  });

  it('stalls on the hill with no gas', () => {
    const { car, events } = handbrakeStart(10, 0);
    expect(eventTypes(events)).toContain('stall');
    expect(car.telemetry.running).toBe(false);
  });

  it('a stalled car left in gear stays on the hill', () => {
    const { car } = handbrakeStart(10, 0);
    expect(car.telemetry.speed).toBe(0);
    expect(Math.abs(car.position)).toBeLessThan(0.05);
  });

  it('rolls back if the handbrake comes off before the clutch bites', () => {
    const car = carOnHill(10);
    const c = controls({ clutch: 1, gear: 1, handbrake: 1 });
    drive(car, c, 0.5);
    let lowest = 0;
    const events = drive(car, c, 8, (t, car) => {
      lowest = Math.min(lowest, car.position);
      return {
        handbrake: 0,
        throttle: t > 0.6 ? 0.45 : 0,
        clutch: t < 0.6 ? 1 : ramp(t - 0.6, 1, 0, 2.5),
      };
    });
    expect(lowest).toBeLessThan(-0.2);
    // ...but the driver recovers and drives away.
    expect(eventTypes(events)).toEqual([]);
    expect(car.telemetry.speed).toBeGreaterThan(1);
  });

  it('holds on the clutch alone at the right bite point and revs', () => {
    const car = carOnHill(10);
    const c = controls({ clutch: 1, gear: 1, handbrake: 1 });
    drive(car, c, 0.5);
    // Hunt for the balance: ease the clutch one way or the other depending on drift.
    drive(car, c, 2, (t) => ({ throttle: 0.14, clutch: ramp(t, 1, 0.58, 1) }));
    drive(car, c, 6, (_t, car) => ({
      handbrake: 0,
      clutch: Math.min(0.65, Math.max(0.45, c.clutch + (car.telemetry.speed > 0 ? 0.0005 : -0.0005))),
    }));
    expect(car.telemetry.running).toBe(true);
    expect(Math.abs(car.telemetry.speed)).toBeLessThan(0.3);
    expect(Math.abs(car.position)).toBeLessThan(1);
    expect(car.telemetry.clutchSlipRpm).toBeGreaterThan(300);
  });

  it('needs more clutch torque on a steeper hill', () => {
    const gentle = handbrakeStart(5, 0.25);
    const steep = handbrakeStart(14, 0.25);
    expect(gentle.car.position).toBeGreaterThan(steep.car.position);
  });
});

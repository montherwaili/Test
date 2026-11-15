import { describe, expect, it } from 'vitest';
import { GEAR_NEUTRAL, GEAR_REVERSE, checkShift, gearLabel, isValidGear, totalRatio } from '../gearbox';
import { controls, drive, eventTypes, idlingCar } from './helpers';
import { createDefaultTuning } from '../tuning';

describe('gear ratios', () => {
  const t = createDefaultTuning();
  const gb = t.gearbox;

  it('gets taller with each forward gear', () => {
    for (let g = 2; g <= gb.forward.length; g++) {
      expect(totalRatio(g, gb)).toBeLessThan(totalRatio(g - 1, gb));
      expect(totalRatio(g, gb)).toBeGreaterThan(0);
    }
  });

  it('includes the final drive', () => {
    expect(totalRatio(1, gb)).toBeCloseTo(gb.forward[0]! * gb.finalDrive);
  });

  it('is zero in neutral and negative in reverse', () => {
    expect(totalRatio(GEAR_NEUTRAL, gb)).toBe(0);
    expect(totalRatio(GEAR_REVERSE, gb)).toBeCloseTo(-gb.reverse * gb.finalDrive);
  });

  it('knows which gears exist', () => {
    expect(isValidGear(-1, gb)).toBe(true);
    expect(isValidGear(5, gb)).toBe(true);
    expect(isValidGear(6, gb)).toBe(false);
    expect(isValidGear(-2, gb)).toBe(false);
    expect(isValidGear(1.5, gb)).toBe(false);
  });

  it('labels gears', () => {
    expect([-1, 0, 1, 5].map(gearLabel)).toEqual(['R', 'N', '1', '5']);
  });
});

describe('shift rules', () => {
  const t = createDefaultTuning();

  it('needs the clutch pressed to select a gear', () => {
    expect(checkShift(0, 1, 1, 0, t.gearbox, t.clutch)).toBe('ok');
    expect(checkShift(0, 1, 0, 0, t.gearbox, t.clutch)).toBe('grind-clutch');
    expect(checkShift(1, 2, 0.5, 5, t.gearbox, t.clutch)).toBe('grind-clutch');
  });

  it('always allows pulling into neutral', () => {
    expect(checkShift(3, 0, 0, 20, t.gearbox, t.clutch)).toBe('ok');
  });

  it('locks out reverse while rolling forwards', () => {
    expect(checkShift(0, -1, 1, 5, t.gearbox, t.clutch)).toBe('grind-reverse');
    expect(checkShift(0, -1, 1, 0, t.gearbox, t.clutch)).toBe('ok');
    expect(checkShift(0, -1, 1, -2, t.gearbox, t.clutch)).toBe('ok');
  });

  it('rejects gears that do not exist', () => {
    expect(checkShift(0, 6, 1, 0, t.gearbox, t.clutch)).toBe('invalid');
  });
});

describe('gear lever in the car', () => {
  it('selects a gear with the clutch down', () => {
    const car = idlingCar();
    const c = controls({ clutch: 1 });
    const events = drive(car, c, 0.1, { gear: 1 });
    expect(car.telemetry.gear).toBe(1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'shift', from: 0, to: 1 }));
  });

  it('grinds once, and stays in neutral, when the clutch is up', () => {
    const car = idlingCar();
    const c = controls({ clutch: 0 });
    const events = drive(car, c, 1, { gear: 1 });
    expect(car.telemetry.gear).toBe(0);
    expect(eventTypes(events)).toEqual(['gearGrind']);
    expect(car.telemetry.speed).toBe(0);
  });

  it('goes in once the clutch is pressed after a grind', () => {
    const car = idlingCar();
    const c = controls({ clutch: 0 });
    drive(car, c, 0.2, { gear: 1 });
    const events = drive(car, c, 0.2, { clutch: 1 });
    expect(car.telemetry.gear).toBe(1);
    expect(eventTypes(events)).toEqual(['shift']);
  });

  it('logs a new grind for each new attempt', () => {
    const car = idlingCar();
    const c = controls({ clutch: 0 });
    const events = [
      ...drive(car, c, 0.2, { gear: 1 }),
      ...drive(car, c, 0.2, { gear: 0 }),
      ...drive(car, c, 0.2, { gear: 2 }),
    ];
    expect(eventTypes(events)).toEqual(['gearGrind', 'gearGrind']);
  });

  it('drops out of gear when the next gear is forced without the clutch', () => {
    const car = idlingCar();
    const c = controls({ clutch: 1, gear: 1 });
    drive(car, c, 0.2);
    drive(car, c, 3, (t) => ({ throttle: 0.3, clutch: Math.max(0, 1 - t) }));
    expect(car.telemetry.gear).toBe(1);
    const events = drive(car, c, 0.2, { gear: 2 });
    expect(car.telemetry.gear).toBe(0);
    expect(eventTypes(events)).toEqual(['shift', 'gearGrind']);
  });

  it('refuses reverse while driving forwards', () => {
    const car = idlingCar();
    const c = controls({ clutch: 1, gear: 1 });
    drive(car, c, 0.2);
    drive(car, c, 3, (t) => ({ throttle: 0.3, clutch: Math.max(0, 1 - t) }));
    expect(car.telemetry.speed).toBeGreaterThan(2);
    const events = drive(car, c, 0.2, { clutch: 1, throttle: 0, gear: -1 });
    expect(car.telemetry.gear).toBe(0);
    expect(events).toContainEqual(expect.objectContaining({ type: 'gearGrind', reason: 'reverse' }));
  });

  it('drives backwards in reverse', () => {
    const car = idlingCar();
    const c = controls({ clutch: 1, gear: -1 });
    drive(car, c, 0.2);
    drive(car, c, 4, (t) => ({ throttle: 0.2, clutch: Math.max(0, 1 - t / 2) }));
    expect(car.telemetry.gear).toBe(-1);
    expect(car.telemetry.speed).toBeLessThan(-1);
    expect(car.position).toBeLessThan(-1);
    expect(car.telemetry.rpm).toBeGreaterThan(700);
  });
});

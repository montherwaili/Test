import { describe, expect, it } from 'vitest';
import { controls, drive, eventTypes, idlingCar, ramp } from './helpers';

/** Clutch down, select a gear, wait a moment. */
function readyInGear(gear: number) {
  const car = idlingCar();
  const c = controls({ clutch: 1, gear });
  drive(car, c, 0.3);
  return { car, c };
}

describe('moving off on the flat', () => {
  it('pulls away smoothly with some gas and a steady clutch release', () => {
    const { car, c } = readyInGear(1);
    let minRpm = Infinity;
    const events = drive(car, c, 5, (t, car) => {
      if (t > 0.1) minRpm = Math.min(minRpm, car.telemetry.rpm);
      return { throttle: 0.25, clutch: ramp(t, 1, 0, 2) };
    });
    expect(eventTypes(events)).toEqual([]);
    expect(car.telemetry.running).toBe(true);
    expect(car.telemetry.speedKmh).toBeGreaterThan(10);
    expect(minRpm).toBeGreaterThan(600);
    // Clutch fully home: no slip left.
    expect(Math.abs(car.telemetry.clutchSlipRpm)).toBeLessThan(1);
  });

  it('creeps at idle on the clutch alone when held at the bite point', () => {
    const { car, c } = readyInGear(1);
    const events = drive(car, c, 8, (t) => ({
      clutch: t < 1 ? ramp(t, 1, 0.56, 1) : t < 4 ? 0.56 : ramp(t - 4, 0.56, 0, 1),
    }));
    expect(eventTypes(events)).toEqual([]);
    expect(car.telemetry.running).toBe(true);
    // Idle speed in 1st gear is a walking pace.
    expect(car.telemetry.speedKmh).toBeGreaterThan(4);
    expect(car.telemetry.speedKmh).toBeLessThan(9);
    expect(car.telemetry.rpm).toBeGreaterThan(700);
  });

  it('stalls when the clutch is dumped at idle', () => {
    const { car, c } = readyInGear(1);
    const events = drive(car, c, 2, { clutch: 0 });
    expect(eventTypes(events)).toEqual(['stall']);
    expect(events[0]!.time).toBeLessThan(0.6);
    expect(car.telemetry.running).toBe(false);
    expect(car.telemetry.rpm).toBe(0);
    expect(car.telemetry.speed).toBe(0);
    // It lurches a little, but goes nowhere.
    expect(car.position).toBeGreaterThan(0);
    expect(car.position).toBeLessThan(0.5);
  });

  it('stalls when the clutch comes up too fast for the gas given', () => {
    const { car, c } = readyInGear(1);
    const events = drive(car, c, 3, (t) => ({ throttle: 0.08, clutch: ramp(t, 1, 0, 0.6) }));
    expect(eventTypes(events)).toContain('stall');
  });

  it('stalls when moving off in third gear without enough gas', () => {
    const { car, c } = readyInGear(3);
    const events = drive(car, c, 5, (t) => ({ throttle: 0.1, clutch: ramp(t, 1, 0, 1.5) }));
    expect(eventTypes(events)).toContain('stall');
    expect(car.telemetry.speed).toBe(0);
  });

  it('does not stall while the clutch pedal stays down', () => {
    const { car, c } = readyInGear(1);
    const events = drive(car, c, 5);
    expect(events).toEqual([]);
    expect(car.telemetry.speed).toBe(0);
    expect(car.telemetry.rpm).toBeGreaterThan(780);
  });

  it('can be restarted after a stall', () => {
    const { car, c } = readyInGear(1);
    drive(car, c, 1, { clutch: 0 });
    expect(car.telemetry.running).toBe(false);
    drive(car, c, 0.2, { clutch: 1 });
    const events = drive(car, c, 1, { starter: true });
    expect(eventTypes(events)).toEqual(['engineStart']);
    drive(car, c, 2, { starter: false });
    expect(car.telemetry.running).toBe(true);
    expect(car.telemetry.rpm).toBeGreaterThan(780);
  });

  it('a stall event records the gear and a sub-stall rpm', () => {
    const { car, c } = readyInGear(1);
    const stall = drive(car, c, 1, { clutch: 0 }).find((e) => e.type === 'stall');
    expect(stall).toBeDefined();
    if (stall?.type !== 'stall') throw new Error('expected stall');
    expect(stall.gear).toBe(1);
    expect(stall.rpm).toBeLessThan(car.tuning.engine.stallRpm);
  });
});

describe('slipping clutch', () => {
  it('holds the car on the brakes with the clutch at the bite point, engine labouring', () => {
    const { car, c } = readyInGear(1);
    drive(car, c, 3, (t) => ({ brake: 0.6, clutch: ramp(t, 1, 0.58, 1) }));
    expect(car.telemetry.speed).toBe(0);
    expect(car.telemetry.running).toBe(true);
    expect(car.telemetry.clutchTorque).toBeGreaterThan(5);
    // The idle controller is working against the drag.
    expect(car.telemetry.engineLoad).toBeGreaterThan(0.15);
    expect(car.telemetry.clutchSlipRpm).toBeGreaterThan(500);
  });

  it('stalls against the brakes if the clutch comes all the way up', () => {
    const { car, c } = readyInGear(1);
    const events = drive(car, c, 3, (t) => ({ brake: 0.6, clutch: ramp(t, 1, 0, 1.5) }));
    expect(eventTypes(events)).toEqual(['stall']);
    expect(car.position).toBe(0);
  });

  it('never transmits more than the clutch capacity', () => {
    const { car, c } = readyInGear(1);
    drive(car, c, 4, (t, car) => {
      expect(Math.abs(car.telemetry.clutchTorque)).toBeLessThanOrEqual(car.telemetry.clutchCapacity + 1e-9);
      return { throttle: 0.5, clutch: ramp(t, 1, 0, 2) };
    });
  });
});

describe('gear changes and stopping', () => {
  function cruisingInSecond() {
    const { car, c } = readyInGear(1);
    drive(car, c, 4, (t) => ({ throttle: 0.3, clutch: ramp(t, 1, 0, 2) }));
    drive(car, c, 0.3, { throttle: 0, clutch: 1 });
    drive(car, c, 0.2, { gear: 2 });
    drive(car, c, 4, (t) => ({ throttle: 0.3, clutch: ramp(t, 1, 0, 0.6) }));
    return { car, c };
  }

  it('changes up to second and keeps accelerating', () => {
    const { car } = cruisingInSecond();
    expect(car.telemetry.gear).toBe(2);
    expect(car.telemetry.running).toBe(true);
    expect(car.telemetry.speedKmh).toBeGreaterThan(25);
  });

  it('engine speed matches road speed with the clutch home', () => {
    const { car } = cruisingInSecond();
    const g = car.tuning.gearbox;
    const expectedRpm =
      ((car.telemetry.speed / car.tuning.body.wheelRadius) * g.forward[1]! * g.finalDrive * 60) / (2 * Math.PI);
    expect(car.telemetry.rpm).toBeCloseTo(expectedRpm, 3);
  });

  it('stalls when braked to a stop in gear without the clutch', () => {
    const { car, c } = cruisingInSecond();
    const events = drive(car, c, 6, { throttle: 0, brake: 0.3 });
    expect(eventTypes(events)).toEqual(['stall']);
    expect(car.telemetry.speed).toBe(0);
  });

  it('stops cleanly when the clutch goes down before the revs drop too far', () => {
    const { car, c } = cruisingInSecond();
    const events = drive(car, c, 6, (_t, car) => ({
      throttle: 0,
      brake: 0.3,
      clutch: car.telemetry.rpm < 1100 ? 1 : c.clutch,
    }));
    expect(eventTypes(events)).toEqual([]);
    expect(car.telemetry.speed).toBe(0);
    expect(car.telemetry.running).toBe(true);
    expect(car.telemetry.rpm).toBeGreaterThan(780);
  });

  it('slows faster on engine braking than coasting in neutral', () => {
    const a = cruisingInSecond();
    const state = a.car.getState();
    drive(a.car, a.c, 4, { throttle: 0 });
    const inGear = a.car.telemetry.speed;

    a.car.setState(state);
    drive(a.car, a.c, 4, { throttle: 0, gear: 0 });
    const coasting = a.car.telemetry.speed;

    expect(inGear).toBeLessThan(coasting - 0.5);
    expect(coasting).toBeLessThan(state.speed);
  });

  it('flags an over-rev when a low gear is selected at speed', () => {
    const { car, c } = readyInGear(1);
    // Get to ~90 km/h in third, then drop it into first.
    drive(car, c, 3, (t) => ({ throttle: 1, clutch: ramp(t, 1, 0, 0.5) }));
    drive(car, c, 0.3, { throttle: 0, clutch: 1, gear: 2 });
    drive(car, c, 5, (t) => ({ throttle: 1, clutch: ramp(t, 1, 0, 0.4) }));
    drive(car, c, 0.3, { throttle: 0, clutch: 1, gear: 3 });
    drive(car, c, 4, (t) => ({ throttle: 1, clutch: ramp(t, 1, 0, 0.4) }));
    expect(car.telemetry.speedKmh).toBeGreaterThan(80);
    drive(car, c, 0.3, { throttle: 0, clutch: 1, gear: 1 });
    const events = drive(car, c, 1, (t) => ({ clutch: ramp(t, 1, 0, 0.3) }));
    expect(eventTypes(events)).toContain('overRev');
  });
});

import { describe, expect, it } from 'vitest';
import {
  engineFriction,
  fullThrottleTorque,
  idleBaseFill,
  idleFill,
  indicatedTorque,
  throttleFill,
} from '../engine';
import { LongitudinalCar } from '../longitudinalCar';
import { createDefaultTuning } from '../tuning';
import { controls, drive, eventTypes, idlingCar } from './helpers';

describe('engine torque model', () => {
  const t = createDefaultTuning().engine;

  it('nets exactly the torque curve at full throttle', () => {
    for (const rpm of [800, 2000, 3000, 4000]) {
      const net = indicatedTorque(rpm, throttleFill(1, rpm, t), t) - engineFriction(rpm, t);
      expect(net).toBeCloseTo(fullThrottleTorque(rpm, t), 6);
    }
  });

  it('nets pure friction (engine braking) with the throttle closed', () => {
    expect(indicatedTorque(3000, throttleFill(0, 3000, t), t)).toBe(0);
    expect(engineFriction(3000, t)).toBeGreaterThan(engineFriction(1000, t));
  });

  it('gives more torque for more pedal', () => {
    for (const rpm of [1000, 2500, 4000]) {
      let last = -1;
      for (let p = 0; p <= 1.0001; p += 0.05) {
        const fill = throttleFill(p, rpm, t);
        expect(fill).toBeGreaterThanOrEqual(last);
        last = fill;
      }
    }
  });

  it('fills the cylinders with less pedal at low rpm than at high rpm', () => {
    expect(throttleFill(0.3, 1500, t)).toBeGreaterThan(throttleFill(0.3, 5000, t) * 2);
  });

  it('makes no torque when turning backwards', () => {
    expect(fullThrottleTorque(-500, t)).toBe(0);
    expect(indicatedTorque(-500, 1, t)).toBe(0);
  });

  it('idle controller balances friction at idle and adds fill as rpm sags', () => {
    const base = idleBaseFill(t);
    expect(indicatedTorque(t.idleRpm, base, t)).toBeCloseTo(engineFriction(t.idleRpm, t), 6);
    expect(idleFill(t.idleRpm, t)).toBeCloseTo(base, 6);
    expect(idleFill(t.idleRpm - 100, t)).toBeGreaterThan(base);
    expect(idleFill(100, t)).toBe(t.idleAuthority);
    expect(idleFill(2000, t)).toBe(0);
  });

  it('has its power peak somewhere sensible', () => {
    let bestRpm = 0;
    let bestKw = 0;
    for (let rpm = 500; rpm <= t.redlineRpm; rpm += 100) {
      const kw = (fullThrottleTorque(rpm, t) * rpm * 2 * Math.PI) / 60 / 1000;
      if (kw > bestKw) {
        bestKw = kw;
        bestRpm = rpm;
      }
    }
    // A small turbodiesel: about 65 kW, peaking in the upper middle of a short rev range.
    expect(bestKw).toBeGreaterThan(55);
    expect(bestKw).toBeLessThan(90);
    expect(bestRpm).toBeGreaterThan(3000);
    expect(bestRpm).toBeLessThan(4400);
  });
});

describe('engine running in neutral', () => {
  it('idles at 800 rpm', () => {
    const car = idlingCar();
    drive(car, controls(), 5);
    expect(car.telemetry.rpm).toBeGreaterThan(780);
    expect(car.telemetry.rpm).toBeLessThan(820);
    expect(car.telemetry.running).toBe(true);
  });

  it('returns to idle after a blip of throttle', () => {
    const car = idlingCar();
    const c = controls();
    drive(car, c, 0.5, { throttle: 0.6 });
    expect(car.telemetry.rpm).toBeGreaterThan(2500);
    drive(car, c, 6, { throttle: 0 });
    expect(car.telemetry.rpm).toBeGreaterThan(780);
    expect(car.telemetry.rpm).toBeLessThan(820);
  });

  it('holds a steady speed at a light, steady pedal', () => {
    const car = idlingCar();
    const c = controls({ throttle: 0.15 });
    drive(car, c, 12);
    const a = car.telemetry.rpm;
    drive(car, c, 2);
    expect(a).toBeGreaterThan(1500);
    expect(a).toBeLessThan(3500);
    expect(Math.abs(car.telemetry.rpm - a)).toBeLessThan(10);
  });

  it('is held at the redline by the rev limiter', () => {
    const car = idlingCar();
    const c = controls({ throttle: 1 });
    let peak = 0;
    let sawCut = false;
    drive(car, c, 4, (_t, car) => {
      peak = Math.max(peak, car.telemetry.rpm);
      sawCut ||= car.telemetry.limiterCut;
      return {};
    });
    const redline = car.tuning.engine.redlineRpm;
    expect(sawCut).toBe(true);
    expect(peak).toBeGreaterThan(redline - 50);
    expect(peak).toBeLessThan(redline + 150);
    expect(car.telemetry.rpm).toBeGreaterThan(redline - 400);
  });

  it('takes a believable time to rev from idle to the redline', () => {
    const car = idlingCar();
    const c = controls({ throttle: 1 });
    let t = 0;
    while (car.telemetry.rpm < car.tuning.engine.redlineRpm - 100 && t < 5) {
      drive(car, c, 1 / 120);
      t += 1 / 120;
    }
    expect(t).toBeGreaterThan(0.5);
    expect(t).toBeLessThan(2);
  });
});

describe('ignition and starter', () => {
  it('starts dead: no rpm until cranked', () => {
    const car = new LongitudinalCar(createDefaultTuning());
    drive(car, controls(), 2);
    expect(car.telemetry.rpm).toBe(0);
    expect(car.telemetry.running).toBe(false);
  });

  it('fires when cranked and settles to idle', () => {
    const car = new LongitudinalCar(createDefaultTuning());
    const c = controls();
    const events = drive(car, c, 1, { starter: true });
    expect(eventTypes(events)).toEqual(['engineStart']);
    expect(events[0]!.time).toBeGreaterThan(0.1);
    expect(events[0]!.time).toBeLessThan(0.8);
    drive(car, c, 3, { starter: false });
    expect(car.telemetry.running).toBe(true);
    expect(car.telemetry.rpm).toBeGreaterThan(780);
    expect(car.telemetry.rpm).toBeLessThan(820);
  });

  it('keeps running when the key is released the moment it fires', () => {
    const car = new LongitudinalCar(createDefaultTuning());
    const c = controls({ starter: true });
    const events = [];
    // Crank only until the engine catches, then let go at once.
    for (let i = 0; i < 240 && !car.telemetry.running; i++) events.push(...drive(car, c, 1 / 120));
    expect(car.telemetry.rpm).toBeLessThan(car.tuning.engine.stallRpm);
    events.push(...drive(car, c, 3, { starter: false }));
    expect(eventTypes(events)).toEqual(['engineStart']);
    expect(car.telemetry.running).toBe(true);
    expect(car.telemetry.rpm).toBeGreaterThan(780);
    expect(car.telemetry.rpm).toBeLessThan(820);
  });

  it('a freshly started engine can then stall normally', () => {
    const car = new LongitudinalCar(createDefaultTuning());
    const c = controls({ clutch: 1, gear: 1, starter: true });
    drive(car, c, 1);
    drive(car, c, 2, { starter: false });
    const events = drive(car, c, 1, { clutch: 0 });
    expect(eventTypes(events)).toEqual(['stall']);
  });

  it('does not start with the ignition off', () => {
    const car = new LongitudinalCar(createDefaultTuning());
    const events = drive(car, controls(), 2, { ignition: false, starter: true });
    expect(events).toEqual([]);
    expect(car.telemetry.rpm).toBe(0);
  });

  it('dies if the key is released before the engine catches', () => {
    const car = new LongitudinalCar(createDefaultTuning());
    const c = controls();
    drive(car, c, 0.05, { starter: true });
    const events = drive(car, c, 2, { starter: false });
    expect(car.telemetry.running).toBe(false);
    expect(car.telemetry.rpm).toBe(0);
    expect(eventTypes(events)).not.toContain('engineStart');
  });

  it('switching off stops the engine without counting as a stall', () => {
    const car = idlingCar();
    const events = drive(car, controls(), 3, { ignition: false });
    expect(eventTypes(events)).toEqual(['engineOff']);
    expect(car.telemetry.rpm).toBe(0);
  });

  it('lurches forward if started in gear with the clutch up', () => {
    const car = new LongitudinalCar(createDefaultTuning());
    const c = controls({ clutch: 1, gear: 1 });
    drive(car, c, 0.1);
    drive(car, c, 0.5, { clutch: 0, starter: true });
    expect(car.position).toBeGreaterThan(0.05);
  });

  it('starts cleanly in gear with the clutch held down', () => {
    const car = new LongitudinalCar(createDefaultTuning());
    const c = controls({ clutch: 1, gear: 1 });
    drive(car, c, 1, { starter: true });
    drive(car, c, 2, { starter: false });
    expect(car.telemetry.running).toBe(true);
    expect(car.position).toBe(0);
  });
});

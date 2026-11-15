import { describe, expect, it } from 'vitest';
import { accelerateTo, controls, drive, idlingCar } from './helpers';

/**
 * Sanity checks that the tuning describes a believable small saloon
 * (~1.6 litre, ~1150 kg). The bands are deliberately wide: they catch a
 * tuning edit that makes the car absurd, not small changes of character.
 */
describe('whole-car plausibility', () => {
  it('does 0-100 km/h in a small-saloon time', () => {
    const car = idlingCar();
    const t = accelerateTo(car, controls(), 100);
    expect(t).toBeGreaterThan(8);
    expect(t).toBeLessThan(14);
  });

  it('tops out between 170 and 200 km/h in fifth', () => {
    const car = idlingCar();
    const c = controls();
    accelerateTo(car, c, 1000, 120);
    expect(car.telemetry.gear).toBe(5);
    expect(car.telemetry.speedKmh).toBeGreaterThan(170);
    expect(car.telemetry.speedKmh).toBeLessThan(200);
    // Settled: barely accelerating any more.
    expect(Math.abs(car.telemetry.acceleration)).toBeLessThan(0.05);
  });

  it('reaches roughly the expected speed at the redline in each gear', () => {
    const car = idlingCar();
    const { gearbox, body, engine } = car.tuning;
    const redlineSpeeds = gearbox.forward.map(
      (ratio) => ((engine.redlineRpm * 2 * Math.PI) / 60 / (ratio * gearbox.finalDrive)) * body.wheelRadius * 3.6,
    );
    expect(redlineSpeeds[0]!).toBeGreaterThan(40);
    expect(redlineSpeeds[0]!).toBeLessThan(60);
    expect(redlineSpeeds[1]!).toBeGreaterThan(80);
    expect(redlineSpeeds[1]!).toBeLessThan(110);
  });

  it('stops from 100 km/h in 35-50 m under full braking', () => {
    const car = idlingCar();
    const c = controls();
    accelerateTo(car, c, 100);
    const start = car.position;
    drive(car, c, 6, { throttle: 0, brake: 1, clutch: 1 });
    expect(car.telemetry.speed).toBe(0);
    const distance = car.position - start;
    expect(distance).toBeGreaterThan(35);
    expect(distance).toBeLessThan(50);
  });

  it('brakes harder with more pedal', () => {
    const stops: number[] = [];
    for (const pedal of [0.25, 0.5, 1]) {
      const car = idlingCar();
      const c = controls();
      accelerateTo(car, c, 60);
      const start = car.position;
      drive(car, c, 15, { throttle: 0, brake: pedal, clutch: 1 });
      expect(car.telemetry.speed).toBe(0);
      stops.push(car.position - start);
    }
    expect(stops[0]!).toBeGreaterThan(stops[1]!);
    expect(stops[1]!).toBeGreaterThan(stops[2]!);
  });

  it('never moves backwards under braking on the flat', () => {
    const car = idlingCar();
    const c = controls();
    accelerateTo(car, c, 50);
    drive(car, c, 8, (_t, car) => {
      expect(car.telemetry.speed).toBeGreaterThanOrEqual(0);
      return { throttle: 0, brake: 0.7, clutch: 1 };
    });
    expect(car.telemetry.speed).toBe(0);
  });

  it('coasts to a stop in neutral and stays stopped', () => {
    const car = idlingCar();
    const c = controls();
    accelerateTo(car, c, 30);
    drive(car, c, 0.3, { throttle: 0, clutch: 1 });
    drive(car, c, 120, { gear: 0, clutch: 0 });
    expect(car.telemetry.speed).toBe(0);
    const x = car.position;
    drive(car, c, 5);
    expect(car.position).toBe(x);
  });

  it('keeps every quantity finite through a clumsy, abusive drive', () => {
    const car = idlingCar();
    car.setGradePercent(8);
    const c = controls();
    // Pseudo-random but fixed stabs at every control.
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    for (let i = 0; i < 400; i++) {
      c.throttle = rnd() < 0.5 ? 0 : rnd();
      c.brake = rnd() < 0.7 ? 0 : rnd();
      c.clutch = rnd() < 0.4 ? 0 : rnd() < 0.5 ? 1 : rnd();
      c.handbrake = rnd() < 0.9 ? 0 : 1;
      c.gear = Math.floor(rnd() * 7) - 1;
      c.starter = rnd() < 0.2;
      c.ignition = rnd() < 0.95;
      drive(car, c, 0.25, (_t, car) => {
        const tm = car.telemetry;
        for (const v of [tm.rpm, tm.speed, tm.position, tm.clutchTorque, tm.engineTorque, tm.driveForce]) {
          expect(Number.isFinite(v)).toBe(true);
        }
        expect(Math.abs(tm.rpm)).toBeLessThan(12000);
        expect(Math.abs(tm.speedKmh)).toBeLessThan(250);
        return {};
      });
    }
  });
});

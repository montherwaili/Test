import {
  LongitudinalCar,
  neutralControls,
  type CarControls,
  type CarEvent,
} from '../longitudinalCar';
import { createDefaultTuning, type VehicleTuning } from '../tuning';

export const HZ = 120;
export const DT = 1 / HZ;

/** A car on flat ground with the engine already idling, in neutral. */
export function idlingCar(tuning: VehicleTuning = createDefaultTuning()): LongitudinalCar {
  const car = new LongitudinalCar(tuning);
  car.powertrain.startInstantly();
  return car;
}

export type ControlFn = (t: number, car: LongitudinalCar) => Partial<CarControls>;

/**
 * Scripted drive: run `seconds` of simulation. `controls` is either a fixed
 * set of pedal positions or a function of the time since this call started.
 * Unspecified controls keep the values in `base` (which is updated in place,
 * so consecutive `drive` calls continue from where the last one left off).
 */
export function drive(
  car: LongitudinalCar,
  base: CarControls,
  seconds: number,
  controls: Partial<CarControls> | ControlFn = {},
): CarEvent[] {
  const events: CarEvent[] = [];
  const steps = Math.round(seconds * HZ);
  for (let i = 0; i < steps; i++) {
    const patch = typeof controls === 'function' ? controls(i * DT, car) : controls;
    Object.assign(base, patch);
    events.push(...car.step(DT, base));
  }
  return events;
}

export function controls(patch: Partial<CarControls> = {}): CarControls {
  return { ...neutralControls(), ...patch };
}

/** Linear ramp from `from` to `to` over `duration` seconds, then held. */
export function ramp(t: number, from: number, to: number, duration: number): number {
  if (duration <= 0 || t >= duration) return to;
  return from + ((to - from) * t) / duration;
}

export function eventTypes(events: CarEvent[]): string[] {
  return events.map((e) => e.type);
}

/**
 * Full-throttle run up through the gears until `targetKmh` (or `maxSeconds`).
 * Shifts at `shiftRpm` with a 0.3 s clutch-in gear change.
 * Returns the time taken, or -1 if the target was not reached.
 */
export function accelerateTo(
  car: LongitudinalCar,
  c: CarControls,
  targetKmh: number,
  maxSeconds = 120,
  shiftRpm = 6200,
): number {
  const topGear = car.tuning.gearbox.forward.length;
  c.clutch = 1;
  c.gear = Math.max(1, c.gear);
  car.step(DT, c);
  let shiftStarted = -1;
  let shifted = false;
  const steps = Math.round(maxSeconds * HZ);
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    if (shiftStarted < 0) {
      c.throttle = 1;
      c.clutch = Math.max(0, c.clutch - DT / 0.4);
      if (c.clutch === 0 && car.telemetry.rpm > shiftRpm && c.gear < topGear) {
        shiftStarted = t;
        shifted = false;
      }
    } else {
      c.throttle = 0;
      c.clutch = 1;
      if (t - shiftStarted > 0.15 && !shifted) {
        c.gear += 1;
        shifted = true;
      }
      if (t - shiftStarted > 0.3) shiftStarted = -1;
    }
    car.step(DT, c);
    if (car.telemetry.speedKmh >= targetKmh) return t;
  }
  return -1;
}

/**
 * Turns on/off inputs (keys, or a lifted finger) into the smooth pedal and
 * steering movements a foot or hand would make. Pure logic, no DOM.
 *
 * The clutch gets special care because a key cannot be "half pressed":
 * pressing floors the pedal quickly; releasing lets it up fast through the
 * free travel, slowly through the bite range, then fast again - the motion a
 * learner is taught. Pressing again at any point catches it.
 */
import type { ClutchTuning } from '../sim/tuning';

export interface DigitalInput {
  throttle: boolean;
  brake: boolean;
  clutch: boolean;
  left: boolean;
  right: boolean;
}

/** Direct positions from analog devices (touch pedals, later a wheel); undefined = not in use. */
export interface AnalogInput {
  throttle?: number | undefined;
  brake?: number | undefined;
  clutch?: number | undefined;
  steer?: number | undefined;
}

export interface InputFilterOptions {
  /** Seconds for the keyboard clutch to rise through the bite range. */
  clutchBiteTime: number;
  /** Seconds for the keyboard throttle to go from closed to floored. */
  throttleRiseTime: number;
}

export const defaultInputFilterOptions: InputFilterOptions = {
  clutchBiteTime: 1.6,
  throttleRiseTime: 1.1,
};

const THROTTLE_FALL = 4; // per second
const BRAKE_RISE = 2.5;
const BRAKE_FALL = 6;
const CLUTCH_PRESS = 8;
const CLUTCH_FREE = 4;
/** Extra pedal travel either side of the bite range that is still taken slowly. */
const BITE_MARGIN = 0.03;
const STEER_RATE = 2.4;
const STEER_RETURN = 3.2;
/** Speed (m/s) at which keyboard steering lock is halved. */
const STEER_HALF_LOCK_SPEED = 9;

function approach(value: number, target: number, maxStep: number): number {
  if (value < target) return Math.min(target, value + maxStep);
  return Math.max(target, value - maxStep);
}

export class InputFilter {
  throttle = 0;
  brake = 0;
  clutch = 0;
  steer = 0;

  constructor(public options: InputFilterOptions = { ...defaultInputFilterOptions }) {}

  reset(): void {
    this.throttle = 0;
    this.brake = 0;
    this.clutch = 0;
    this.steer = 0;
  }

  /**
   * @param speed car speed in m/s, used to tame keyboard steering at speed
   */
  update(dt: number, digital: DigitalInput, analog: AnalogInput, speed: number, clutch: ClutchTuning): void {
    // Throttle
    if (analog.throttle !== undefined) this.throttle = clamp01(analog.throttle);
    else if (digital.throttle) this.throttle = approach(this.throttle, 1, dt / this.options.throttleRiseTime);
    else this.throttle = approach(this.throttle, 0, THROTTLE_FALL * dt);

    // Brake
    if (analog.brake !== undefined) this.brake = clamp01(analog.brake);
    else if (digital.brake) this.brake = approach(this.brake, 1, BRAKE_RISE * dt);
    else this.brake = approach(this.brake, 0, BRAKE_FALL * dt);

    // Clutch
    if (analog.clutch !== undefined) this.clutch = clamp01(analog.clutch);
    else if (digital.clutch) this.clutch = approach(this.clutch, 1, CLUTCH_PRESS * dt);
    else {
      const slowTop = clutch.biteStart + BITE_MARGIN;
      const slowBottom = clutch.biteEnd - BITE_MARGIN;
      const inBite = this.clutch <= slowTop && this.clutch > slowBottom;
      const rate = inBite ? (slowTop - slowBottom) / this.options.clutchBiteTime : CLUTCH_FREE;
      let next = this.clutch - rate * dt;
      // Do not skip into the bite range at free-travel speed.
      if (!inBite && this.clutch > slowTop && next < slowTop) next = slowTop;
      this.clutch = Math.max(0, next);
    }

    // Steering
    if (analog.steer !== undefined) {
      this.steer = Math.max(-1, Math.min(1, analog.steer));
    } else {
      const want = (digital.right ? 1 : 0) - (digital.left ? 1 : 0);
      // Full lock is for car parks: the faster the car, the less lock a key gives.
      const ratio = speed / STEER_HALF_LOCK_SPEED;
      const lock = 1 / (1 + ratio * ratio);
      const target = want * lock;
      const rate = want === 0 ? STEER_RETURN : STEER_RATE * (0.35 + 0.65 * lock);
      this.steer = approach(this.steer, target, rate * dt);
    }
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

import type { ClutchTuning, GearboxTuning } from './tuning';

/** -1 = reverse, 0 = neutral, 1..n = forward gears. */
export type Gear = number;

export const GEAR_REVERSE = -1;
export const GEAR_NEUTRAL = 0;

export function isValidGear(gear: Gear, t: GearboxTuning): boolean {
  return Number.isInteger(gear) && gear >= GEAR_REVERSE && gear <= t.forward.length;
}

/**
 * Engine revolutions per wheel revolution for a gear, including the final
 * drive. Negative in reverse, 0 in neutral.
 */
export function totalRatio(gear: Gear, t: GearboxTuning): number {
  if (gear === GEAR_NEUTRAL) return 0;
  if (gear === GEAR_REVERSE) return -t.reverse * t.finalDrive;
  const r = t.forward[gear - 1];
  return r === undefined ? 0 : r * t.finalDrive;
}

export type ShiftResult = 'ok' | 'grind-clutch' | 'grind-reverse' | 'invalid';

/**
 * Can the lever move from `from` into `to` right now?
 *  - Pulling into neutral always works.
 *  - Selecting any gear needs the clutch pedal pressed past the shift threshold.
 *  - Reverse additionally needs the car (nearly) stopped or rolling backwards.
 */
export function checkShift(
  from: Gear,
  to: Gear,
  clutchPedal: number,
  forwardSpeed: number,
  gearbox: GearboxTuning,
  clutch: ClutchTuning,
): ShiftResult {
  if (!isValidGear(to, gearbox)) return 'invalid';
  if (to === from) return 'ok';
  if (to === GEAR_NEUTRAL) return 'ok';
  if (clutchPedal < clutch.shiftThreshold) return 'grind-clutch';
  if (to === GEAR_REVERSE && forwardSpeed > gearbox.reverseMaxSpeed) return 'grind-reverse';
  return 'ok';
}

export function gearLabel(gear: Gear): string {
  if (gear === GEAR_REVERSE) return 'R';
  if (gear === GEAR_NEUTRAL) return 'N';
  return String(gear);
}

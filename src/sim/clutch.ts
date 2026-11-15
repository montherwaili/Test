import { clamp } from './curve';
import type { ClutchTuning } from './tuning';

/**
 * Fraction of full clamping force for a pedal position.
 * Pedal: 0 = foot off (fully engaged), 1 = floored (fully disengaged).
 * Returns 0 above the bite point, rising to 1 once the pedal is up past `biteEnd`.
 */
export function clutchEngagement(pedal: number, t: ClutchTuning): number {
  const p = clamp(pedal, 0, 1);
  if (p >= t.biteStart) return 0;
  if (p <= t.biteEnd) return 1;
  const linear = (t.biteStart - p) / (t.biteStart - t.biteEnd);
  return Math.pow(linear, t.curveExponent);
}

/** Maximum torque the clutch can transmit at this pedal position, N·m. */
export function clutchCapacity(pedal: number, t: ClutchTuning): number {
  return t.maxTorque * clutchEngagement(pedal, t);
}

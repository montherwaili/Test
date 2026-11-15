import { clamp, sampleCurve } from './curve';
import type { EngineTuning } from './tuning';

/** Friction + pumping torque capacity of a turning engine, N·m (always >= 0). */
export function engineFriction(rpm: number, t: EngineTuning): number {
  return t.frictionBase + t.frictionPerRpm * Math.abs(rpm);
}

/** Full-throttle net torque from the curve, N·m. Zero when turning backwards. */
export function fullThrottleTorque(rpm: number, t: EngineTuning): number {
  return rpm <= 0 ? 0 : sampleCurve(t.torqueCurve, rpm);
}

/** Smooth saturation: ~x for small x, levelling off at 1. */
function saturate(x: number): number {
  return x / Math.cbrt(1 + x * x * x);
}

/**
 * Cylinder fill (0..1 of what full throttle would give at this rpm) for an
 * accelerator pedal position.
 *
 * A throttle is an air valve, and a slow-turning engine needs little air: at
 * low rpm a small opening already fills the cylinders, at high rpm the same
 * opening starves them. So a little pedal gives strong torque when the revs
 * are low (which is what saves a sagging engine from stalling) and the pedal
 * behaves roughly like a power demand overall. Full pedal always gives the
 * full torque curve.
 */
export function throttleFill(pedal: number, rpm: number, t: EngineTuning): number {
  const area = Math.pow(clamp(pedal, 0, 1), t.pedalExponent);
  const flow = t.throttleFullFlowRpm / Math.max(rpm, 100);
  return saturate(area * flow) / saturate(flow);
}

/**
 * Torque made by combustion (before friction is subtracted) at a cylinder
 * fill. Scaled so that a fill of 1 nets exactly the torque curve.
 */
export function indicatedTorque(rpm: number, fill: number, t: EngineTuning): number {
  if (rpm <= 0) return 0;
  return clamp(fill, 0, 1) * (fullThrottleTorque(rpm, t) + engineFriction(rpm, t));
}

/** Cylinder fill that exactly cancels friction at idle speed with no load. */
export function idleBaseFill(t: EngineTuning): number {
  const friction = engineFriction(t.idleRpm, t);
  const full = fullThrottleTorque(t.idleRpm, t) + friction;
  return full <= 0 ? 0 : friction / full;
}

/**
 * Idle speed controller: the cylinder fill the engine holds on its own with
 * the driver's foot off the pedal. It rises as rpm sags below idle, up to a
 * limited authority - which is exactly why a gentle clutch release lets the
 * car creep, and a clumsy one stalls it.
 */
export function idleFill(rpm: number, t: EngineTuning): number {
  return clamp(idleBaseFill(t) + t.idleGain * (t.idleRpm - rpm), 0, t.idleAuthority);
}

/** Starter motor torque, fading out as the engine approaches `starterMaxRpm`. */
export function starterTorque(rpm: number, t: EngineTuning): number {
  const fadeBand = 100;
  return t.starterTorque * clamp((t.starterMaxRpm - rpm) / fadeBand, 0, 1);
}

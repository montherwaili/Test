/**
 * What the car should sound like, as numbers: pure functions from the car's
 * state to pitches and loudness. The Web Audio graph (engineAudio.ts) just
 * follows these, so the sound design can be tested without a browser.
 */

export interface EngineVoice {
  /** Firing frequency of a four-cylinder four-stroke, Hz (two firings per revolution). */
  freq: number;
  /** 0..1 */
  gain: number;
  /** Low-pass cutoff: a labouring engine sounds brighter, Hz. */
  cutoff: number;
  /** Intake / exhaust roar on top, 0..1. */
  roar: number;
}

export function engineVoice(rpm: number, load: number, running: boolean, cranking: boolean): EngineVoice {
  const r = Math.max(0, rpm);
  const l = Math.min(1, Math.max(0, load));
  if (!running && !cranking) {
    // Spinning down after a stall or switch-off: fading with the revs.
    return { freq: Math.max(8, r / 30), gain: Math.min(0.25, r / 3000), cutoff: 400, roar: 0 };
  }
  if (cranking && !running) {
    // The starter's whirr and the engine turning over.
    return { freq: Math.max(10, r / 30), gain: 0.22, cutoff: 900, roar: 0 };
  }
  return {
    freq: r / 30,
    gain: 0.26 + 0.34 * l + 0.2 * Math.min(1, r / 6500),
    cutoff: 350 + 2600 * l + 0.25 * r,
    roar: l * Math.min(1, r / 4500) * 0.6,
  };
}

/**
 * Tyre noise, 0..1: squeal when the tyres slide sideways past their grip,
 * when the driven wheels spin, or when braking hard near the limit.
 */
export function tyreSqueal(slipAngleDeg: number, wheelspinRatio: number, brakeDecel: number, speed: number): number {
  if (speed < 1.5) return 0;
  const side = Math.max(0, (slipAngleDeg - 6) / 10);
  const spin = Math.max(0, (wheelspinRatio - 0.15) / 0.8);
  const brake = Math.max(0, (brakeDecel - 7.5) / 2.5);
  return Math.min(1, Math.max(side, spin, brake));
}

/** Wind and road noise rising with speed, 0..1. */
export function roadNoise(speed: number): number {
  const s = Math.abs(speed);
  return Math.min(1, 0.04 * s + 0.0006 * s * s);
}

/** A collision's loudness from the speed it happened at, 0..1. */
export function impactLoudness(speed: number): number {
  return Math.min(1, Math.max(0.15, Math.abs(speed) / 12));
}

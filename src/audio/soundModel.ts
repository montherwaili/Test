/**
 * What the car should sound like, as numbers: pure functions from the car's
 * state to levels and playback speeds. The Web Audio graph (carAudio.ts) just
 * follows these, so the sound design can be tested without a browser.
 */

/** The engine loops are rendered at these speeds (see dieselSynth) and played faster or slower. */
export const LOW_REF_RPM = 900;
export const HIGH_REF_RPM = 2600;
export const CRANK_REF_RPM = 250;

export interface DieselMix {
  /** Playback rates for the low- and high-rev loops and the cranking loop. */
  lowRate: number;
  highRate: number;
  crankRate: number;
  /** Share of the low- and high-rev loops (equal-power crossfade). */
  low: number;
  high: number;
  /** Share of the light- and heavy-load loops (equal-power crossfade). */
  light: number;
  heavy: number;
  /** Level of the running engine, 0..1. */
  engine: number;
  /** Level of the starter turning the engine over, 0..1. */
  crank: number;
  /** Level of the engine turning with no fuel (spinning down after it is switched off or stalls), 0..1. */
  coast: number;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * How the diesel sounds right now, from the engine's speed, its load
 * (cylinder fill, 0..1), whether it is running and whether the starter is
 * turning it.
 */
export function dieselMix(rpm: number, load: number, running: boolean, cranking: boolean): DieselMix {
  const r = Math.max(0, rpm);
  const l = Math.min(1, Math.max(0, load));
  const toHigh = smoothstep(1100, 2400, r);
  const toHeavy = smoothstep(0.15, 0.75, l);
  const mix: DieselMix = {
    lowRate: Math.max(0.05, r / LOW_REF_RPM),
    highRate: Math.max(0.05, r / HIGH_REF_RPM),
    crankRate: Math.max(0.05, r / CRANK_REF_RPM),
    low: Math.cos((toHigh * Math.PI) / 2),
    high: Math.sin((toHigh * Math.PI) / 2),
    light: Math.cos((toHeavy * Math.PI) / 2),
    heavy: Math.sin((toHeavy * Math.PI) / 2),
    engine: 0,
    crank: 0,
    coast: 0,
  };
  if (running) {
    // Louder with revs and with load; a diesel on the overrun (no fuel) is quieter still.
    mix.engine = Math.min(1, 0.42 + 0.3 * l + 0.28 * smoothstep(800, 4500, r));
  } else if (cranking) {
    mix.crank = r > 20 ? 0.9 : 0.6; // the starter strains even before the engine moves
  } else {
    // Spinning down: the compressions fade out with the revs.
    mix.coast = Math.min(0.7, r / 900);
  }
  return mix;
}

/**
 * Boost the turbocharger is being asked for, 0..1: it needs exhaust flow, so
 * it wakes from about 1500 rpm and only under load.
 */
export function turboTarget(rpm: number, load: number): number {
  return smoothstep(1400, 2800, rpm) * Math.min(1, Math.max(0, (load - 0.2) / 0.6));
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

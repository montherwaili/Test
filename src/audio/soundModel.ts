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

/** What the car ran into, as far as the sound goes. */
export type ImpactMaterial = 'hard' | 'soft' | 'plastic' | 'kerb';

/** Sort what was hit: walls, poles and cars are hard; palms and people give; cones are plastic. */
export function impactMaterial(kind: string): ImpactMaterial {
  if (kind === 'cone') return 'plastic';
  if (kind === 'kerb' || kind === 'island') return 'kerb';
  if (kind === 'palm' || kind === 'pedestrian') return 'soft';
  return 'hard';
}

export interface ImpactLayer {
  /** Which recordings: the car body's thump, the deep blow, bent metal, breaking glass. */
  layer: 'thump' | 'boom' | 'metal' | 'glass';
  level: number;
  /** Playback speed: lower is heavier. */
  rate: number;
  /** Seconds after the blow (metal crumples on, glass falls after). */
  delay: number;
}

/**
 * The recordings a collision is made of. Every knock thumps the body; from
 * walking pace it also has weight (the deep blow). Into something hard,
 * metal crumples from about 6 km/h - twice over in a real crash - and glass
 * breaks from about 20 km/h, its pieces falling a moment later. A cone is a
 * light, hollow knock; a kerb a dull one.
 */
export function impactLayers(material: ImpactMaterial, speed: number): ImpactLayer[] {
  const v = Math.abs(speed);
  const loud = impactLoudness(v);
  if (material === 'plastic') return [{ layer: 'thump', level: 0.25 + 0.3 * loud, rate: 1.5, delay: 0 }];
  const out: ImpactLayer[] = [{ layer: 'thump', level: 0.4 + 0.6 * loud, rate: material === 'kerb' ? 0.8 : 0.85, delay: 0 }];
  const weight = smoothstep(1, 7, v) * (material === 'kerb' ? 0.5 : 1);
  if (weight > 0) out.push({ layer: 'boom', level: weight, rate: 1, delay: 0 });
  if (material === 'hard') {
    const metal = smoothstep(1.5, 8, v);
    // Heavier panels sound lower: the harder the hit, the lower the metal.
    if (metal > 0) out.push({ layer: 'metal', level: metal, rate: 0.8 - 0.2 * metal, delay: 0 });
    const crumple = smoothstep(6, 13, v);
    if (crumple > 0) out.push({ layer: 'metal', level: 0.8 * crumple, rate: 0.62, delay: 0.07 });
    const glass = smoothstep(5, 11, v);
    if (glass > 0) {
      out.push({ layer: 'glass', level: 0.8 * glass, rate: 0.9, delay: 0.03 });
      out.push({ layer: 'glass', level: 0.35 * glass, rate: 1.15, delay: 0.32 });
    }
  }
  return out;
}

/** One looped layer of the recorded engine: how fast to play it and how loud. */
export interface LayerLevel {
  name: string;
  rate: number;
  gain: number;
}

/**
 * The recorded engine's mix. Light-load loops run from the idle up through
 * loops at `points` rpm; heavy-load loops likewise, from their own idle loop.
 * The two loops either side of the engine speed play, sped up or slowed to
 * match it and crossfaded at equal power; load blends light into heavy.
 * Every layer is returned, the ones not needed at gain 0.
 */
export function recordedMix(rpm: number, load: number, idleRpm: number, points: readonly number[]): LayerLevel[] {
  const r = Math.max(1, rpm);
  const toHeavy = smoothstep(0.2, 0.8, Math.min(1, Math.max(0, load)));
  const lightShare = Math.cos((toHeavy * Math.PI) / 2);
  const heavyShare = Math.sin((toHeavy * Math.PI) / 2);
  const ladder = (names: string[], refs: number[], share: number): LayerLevel[] => {
    const out = names.map((name, i) => ({ name, rate: r / refs[i]!, gain: 0 }));
    if (r <= refs[0]!) out[0]!.gain = share;
    else if (r >= refs[refs.length - 1]!) out[out.length - 1]!.gain = share;
    else {
      const i = refs.findIndex((ref, k) => r >= ref && r < refs[k + 1]!);
      const t = (r - refs[i]!) / (refs[i + 1]! - refs[i]!);
      out[i]!.gain = share * Math.cos((t * Math.PI) / 2);
      out[i + 1]!.gain = share * Math.sin((t * Math.PI) / 2);
    }
    return out;
  };
  return [
    ...ladder(['idle', ...points.map((p) => `light-${p}`)], [idleRpm, ...points], lightShare),
    ...ladder(['heavy-idle', ...points.map((p) => `heavy-${p}`)], [idleRpm, ...points], heavyShare),
  ];
}

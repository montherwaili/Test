/**
 * The car's sounds, built sample by sample from how a small four-cylinder
 * turbodiesel actually makes noise. No recordings: every buffer here is
 * computed, so the result is ours to ship and can be checked in tests.
 *
 * Engine loops are rendered one combustion event at a time:
 *   - exhaust pulse: the pressure wave leaving the cylinder rings the
 *     exhaust pipe (a low, damped "thump")
 *   - diesel knock: compression ignition is sudden, and the pressure spike
 *     rings the block and head at a few kilohertz - the "clatter" that
 *     makes a diesel sound like a diesel
 *   - injector tick: a tiny sharp click just before each firing
 *   - combustion roar: a burst of noise that grows with load
 * Each firing is a little different (cylinder to cylinder, cycle to cycle)
 * so the loop has the slight unevenness of a real engine instead of a buzz.
 * Loops wrap around, so they repeat without a seam.
 *
 * Pure functions: numbers in, Float32Array out.
 */

/** Small, fast, seeded random numbers (the same seed always gives the same sound). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

const TAU = Math.PI * 2;

/** Add a damped sine into `out` at `start` seconds (wrapping round the end when `wrap`). */
function ring(out: Float32Array, sr: number, start: number, freq: number, decay: number, amp: number, wrap: boolean, phase = 0): void {
  const n = Math.min(Math.ceil(decay * 7 * sr), wrap ? out.length : Infinity);
  const i0 = Math.round(start * sr);
  const w = (TAU * freq) / sr;
  const k = Math.exp(-1 / (decay * sr));
  let env = amp;
  for (let i = 0; i < n; i++) {
    let j = i0 + i;
    if (j >= out.length) {
      if (!wrap) break;
      j -= out.length;
    }
    // A quick rise (no click from a step), then the exponential decay.
    const attack = i < 24 ? i / 24 : 1;
    out[j]! += env * attack * Math.sin(w * i + phase);
    env *= k;
  }
}

/** Add a burst of filtered noise (one-pole band-pass) with an exponential decay. */
function noiseBurst(
  out: Float32Array,
  sr: number,
  start: number,
  lowHz: number,
  highHz: number,
  decay: number,
  amp: number,
  rand: () => number,
  wrap: boolean,
): void {
  const n = Math.min(Math.ceil(decay * 6 * sr), wrap ? out.length : Infinity);
  const i0 = Math.round(start * sr);
  const aHigh = Math.exp((-TAU * highHz) / sr);
  const aLow = Math.exp((-TAU * lowHz) / sr);
  const k = Math.exp(-1 / (decay * sr));
  let lp = 0;
  let lp2 = 0;
  let env = amp;
  for (let i = 0; i < n; i++) {
    let j = i0 + i;
    if (j >= out.length) {
      if (!wrap) break;
      j -= out.length;
    }
    const x = rand() * 2 - 1;
    lp = aHigh * lp + (1 - aHigh) * x; // remove what is above highHz
    lp2 = aLow * lp2 + (1 - aLow) * lp; // and what is below lowHz
    const attack = i < 16 ? i / 16 : 1;
    out[j]! += (lp - lp2) * env * attack * 3;
    env *= k;
  }
}

function normalise(out: Float32Array, peak: number): Float32Array {
  let max = 0;
  let mean = 0;
  for (const v of out) mean += v;
  mean /= out.length || 1;
  for (let i = 0; i < out.length; i++) {
    out[i]! -= mean;
    max = Math.max(max, Math.abs(out[i]!));
  }
  if (max > 0) for (let i = 0; i < out.length; i++) out[i]! *= peak / max;
  return out;
}

export interface EngineLoopSpec {
  /** Engine speed the loop is rendered at, rpm (play it faster or slower for other speeds). */
  rpm: number;
  /** How hard the engine works, 0..1: more thump and roar, relatively less clatter. */
  load: number;
  /** Engine cycles (720° each) in the loop. */
  cycles: number;
  seed: number;
}

/** Firings per second for a four-stroke four-cylinder: two per revolution. */
export function firingRate(rpm: number): number {
  return rpm / 30;
}

/** A running diesel: a seamless loop of `cycles` engine cycles. */
export function renderEngineLoop(spec: EngineLoopSpec, sr: number): Float32Array {
  const rand = rng(spec.seed);
  const interval = 1 / firingRate(spec.rpm);
  const firings = spec.cycles * 4;
  const out = new Float32Array(Math.round(firings * interval * sr));
  const load = Math.min(1, Math.max(0, spec.load));
  // Each cylinder has its own small character (injector, compression, distance to the exhaust).
  const cyl = [0, 1, 2, 3].map(() => ({ amp: 0.88 + rand() * 0.24, knock: 0.8 + rand() * 0.4, tone: 0.95 + rand() * 0.1 }));
  for (let f = 0; f < firings; f++) {
    const c = cyl[f % 4]!;
    const jitter = (rand() - 0.5) * 0.04 * interval;
    const t = f * interval + jitter;
    const a = c.amp * (0.9 + rand() * 0.2);
    // Exhaust pulse: the pipe rings low; a working engine pushes a bigger pulse.
    ring(out, sr, t, 78 * c.tone, 0.011 + 0.006 * load, a * (0.55 + 0.6 * load), true, -Math.PI / 2);
    ring(out, sr, t, 156 * c.tone, 0.006, a * (0.22 + 0.25 * load), true);
    // Combustion roar.
    noiseBurst(out, sr, t, 120, 900, 0.004 + 0.007 * load, a * (0.08 + 0.4 * load), rand, true);
    // Diesel knock: the block and head ring at a few kilohertz.
    const knock = a * c.knock * (0.5 - 0.15 * load);
    for (const [hz, decay, level] of [
      [1180, 0.0042, 0.55],
      [1930, 0.0032, 0.45],
      [2760, 0.0024, 0.35],
      [3880, 0.0016, 0.25],
    ] as const) {
      ring(out, sr, t + 0.0004, hz * (0.97 + rand() * 0.06), decay, knock * level, true, rand() * TAU);
    }
    noiseBurst(out, sr, t + 0.0003, 1500, 6000, 0.0012, knock * 0.5, rand, true);
    // Injector tick, a moment before the fuel lights.
    ring(out, sr, t - 0.0018 + (rand() - 0.5) * 0.0002, 5600, 0.0005, 0.08 * c.amp, true);
  }
  return normalise(out, 0.9);
}

export interface CrankSpec {
  /** Cranking speed the loop is rendered at, rpm. */
  rpm: number;
  cycles: number;
  /** With the starter motor (cranking), or without (an engine spinning down with no fuel). */
  starter: boolean;
  seed: number;
}

/**
 * The engine turning without firing. Each compression stroke slows it (the
 * starter strains and its whine drops, then picks up as the piston passes
 * the top) and lets out a soft "huff". With the starter: the electric
 * motor's buzz and whine and the pinion's gear noise on top.
 */
export function renderCrankLoop(spec: CrankSpec, sr: number): Float32Array {
  const rand = rng(spec.seed);
  const interval = 1 / firingRate(spec.rpm);
  const strokes = spec.cycles * 4;
  const n = Math.round(strokes * interval * sr);
  const out = new Float32Array(n);
  // How much each compression stroke loads the engine, through the cycle (peaks just before the top).
  const load = (t: number) => {
    const x = (t / interval) % 1;
    return Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, x / 0.85))), 3);
  };
  if (spec.starter) {
    // The starter motor turns about 11 times as fast as the engine; its buzz and
    // whine follow its speed, which dips at every compression.
    const ratio = 11;
    const base = (spec.rpm * ratio) / 60; // motor revolutions per second
    // Choose the speed so the loop ends on a whole number of motor turns: no seam.
    let total = 0;
    for (let i = 0; i < n; i++) total += 1 - 0.28 * load(i / sr);
    const turns = Math.max(1, Math.round((base * total) / sr));
    const scale = (turns * sr) / total;
    let phase = 0;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const l = load(i / sr);
      phase += (scale * (1 - 0.28 * l)) / sr;
      const p = TAU * phase;
      // Brush buzz (eight commutator segments), the armature hum and the pinion's gear whine.
      const buzz = Math.sin(8 * p) * 0.35 + Math.sin(16 * p + 0.5) * 0.18 + Math.sin(24 * p) * 0.1;
      const hum = Math.sin(p) * 0.25 + Math.sin(2 * p) * 0.2;
      const whine = Math.sin(13 * p) * 0.12;
      const grit = rand() * 2 - 1;
      lp = 0.7 * lp + 0.3 * grit;
      const strain = 0.65 + 0.5 * l; // working harder against compression
      out[i] = (buzz + hum + whine + lp * 0.25) * strain * 0.6;
    }
  }
  for (let s = 0; s < strokes; s++) {
    const t = (s + 0.85) * interval;
    // Air rushing back as the piston passes the top: a soft, low huff.
    noiseBurst(out, sr, t, 60, 500, 0.05, 0.9, rand, true);
    ring(out, sr, t, 52 + rand() * 6, 0.03, 0.7, true, -Math.PI / 2);
    // The valvetrain ticking along.
    ring(out, sr, (s + 0.4) * interval, 3100 + rand() * 300, 0.0012, 0.12, true);
  }
  return normalise(out, spec.starter ? 0.85 : 0.6);
}

/** The handbrake lever: a ratchet clicking up its teeth (pull) or the button and a release thunk. */
export function renderHandbrake(pull: boolean, sr: number, seed = 7): Float32Array {
  const rand = rng(seed);
  const out = new Float32Array(Math.round((pull ? 0.42 : 0.22) * sr));
  if (pull) {
    for (let i = 0; i < 7; i++) {
      // The pull slows as the cable tightens.
      const t = 0.02 + 0.32 * Math.sqrt(i / 6) + (rand() - 0.5) * 0.006;
      ring(out, sr, t, 3300 + rand() * 300, 0.0018, 0.6, false);
      ring(out, sr, t, 1450 + rand() * 100, 0.0035, 0.35, false);
      noiseBurst(out, sr, t, 2000, 7000, 0.0015, 0.25, rand, false);
    }
  } else {
    ring(out, sr, 0.01, 2900, 0.002, 0.5, false); // the button
    ring(out, sr, 0.06, 140, 0.025, 0.9, false, -Math.PI / 2); // lever down
    noiseBurst(out, sr, 0.06, 200, 1500, 0.02, 0.4, rand, false);
  }
  return normalise(out, 0.8);
}

/** The gear lever going into a gear: a solid little clunk. */
export function renderGearClunk(sr: number, seed = 11): Float32Array {
  const rand = rng(seed);
  const out = new Float32Array(Math.round(0.16 * sr));
  ring(out, sr, 0.004, 210, 0.018, 0.9, false, -Math.PI / 2);
  ring(out, sr, 0.004, 690, 0.008, 0.4, false);
  noiseBurst(out, sr, 0.003, 400, 3000, 0.01, 0.5, rand, false);
  ring(out, sr, 0.002, 2600, 0.0015, 0.25, false);
  return normalise(out, 0.8);
}

/** The seatbelt buckle latching. */
export function renderBuckle(sr: number, seed = 13): Float32Array {
  const rand = rng(seed);
  const out = new Float32Array(Math.round(0.12 * sr));
  ring(out, sr, 0.004, 2250, 0.006, 0.7, false);
  ring(out, sr, 0.004, 3480, 0.004, 0.5, false);
  ring(out, sr, 0.022, 1720, 0.008, 0.45, false);
  noiseBurst(out, sr, 0.004, 2500, 8000, 0.002, 0.4, rand, false);
  return normalise(out, 0.75);
}

/** The indicator relay: "tick" as the lamps light, a softer, lower "tock" as they go out. */
export function renderRelay(on: boolean, sr: number, seed = 17): Float32Array {
  const rand = rng(seed + (on ? 0 : 1));
  const out = new Float32Array(Math.round(0.05 * sr));
  const f = on ? 1 : 0.78;
  ring(out, sr, 0.002, 1850 * f, 0.004, 0.6, false);
  ring(out, sr, 0.002, 4100 * f, 0.0015, 0.45, false);
  noiseBurst(out, sr, 0.002, 1500, 6000, 0.001, 0.3, rand, false);
  return normalise(out, on ? 0.8 : 0.55);
}

/** A knock into something: the thud of the body and the ring of panels. */
export function renderCrunch(sr: number, seed = 19): Float32Array {
  const rand = rng(seed);
  const out = new Float32Array(Math.round(0.7 * sr));
  ring(out, sr, 0, 62, 0.06, 1, false, -Math.PI / 2);
  noiseBurst(out, sr, 0, 80, 1200, 0.06, 0.9, rand, false);
  // Panels ring at unrelated pitches - the sound of sheet metal.
  for (const hz of [430, 1130, 1790, 2610, 3320]) ring(out, sr, 0.003 + rand() * 0.01, hz * (0.95 + rand() * 0.1), 0.08 + rand() * 0.1, 0.18, false, rand() * TAU);
  // Bits of trim rattling.
  for (let i = 0; i < 6; i++) noiseBurst(out, sr, 0.05 + rand() * 0.3, 1500, 6000, 0.006, 0.25 * (1 - i / 7), rand, false);
  return normalise(out, 0.95);
}

/** The engine stopping: the last compression rocks it on its mounts. */
export function renderShudder(sr: number, seed = 23): Float32Array {
  const rand = rng(seed);
  const out = new Float32Array(Math.round(0.45 * sr));
  ring(out, sr, 0, 48, 0.07, 1, false, -Math.PI / 2);
  ring(out, sr, 0.09, 41, 0.06, 0.5, false, Math.PI / 2);
  noiseBurst(out, sr, 0, 60, 600, 0.05, 0.6, rand, false);
  // Something in the dashboard buzzing for a moment.
  ring(out, sr, 0.01, 260, 0.03, 0.15, false);
  return normalise(out, 0.8);
}

/** The ignition key turning: a small detent click. */
export function renderKey(sr: number, seed = 29): Float32Array {
  const rand = rng(seed);
  const out = new Float32Array(Math.round(0.06 * sr));
  ring(out, sr, 0.002, 2700, 0.0025, 0.6, false);
  ring(out, sr, 0.002, 950, 0.005, 0.3, false);
  noiseBurst(out, sr, 0.002, 2000, 8000, 0.0015, 0.3, rand, false);
  return normalise(out, 0.6);
}

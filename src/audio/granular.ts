/**
 * Real engine sound at any speed, from one recording of the engine idling.
 *
 * Playing an idle recording faster raises everything - the firing rate and
 * the ring of the block and exhaust - and a diesel at 3000 rpm made that way
 * sounds like a toy. A real engine at higher revs fires more often, but each
 * combustion still rings the same metal at the same pitches. So: cut the
 * recording into its combustion events ("grains"), and lay them down again
 * at the firing rate of the speed wanted, overlapping where they must.
 *
 * Pure functions on sample arrays, so they can be tested without a browser.
 */
import { rng } from './dieselSynth';

/** A smoothed loudness envelope (rectified, two-pole low-pass at `cutoffHz`). */
export function envelope(x: Float32Array, sr: number, cutoffHz: number): Float32Array {
  const a = Math.exp((-2 * Math.PI * cutoffHz) / sr);
  const out = new Float32Array(x.length);
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    y1 = a * y1 + (1 - a) * Math.abs(x[i]!);
    y2 = a * y2 + (1 - a) * y1;
    out[i] = y2;
  }
  return out;
}

/**
 * The firing interval (seconds) of the engine in a stretch of recording: the
 * strongest repeat of the loudness envelope between `minS` and `maxS`.
 */
export function firingInterval(x: Float32Array, sr: number, minS = 0.02, maxS = 0.08): number {
  const env = envelope(x, sr, 150);
  // Work on a reduced copy: the envelope changes slowly.
  const step = Math.max(1, Math.floor(sr / 4000));
  const e: number[] = [];
  for (let i = 0; i < env.length; i += step) e.push(env[i]!);
  const mean = e.reduce((a, v) => a + v, 0) / (e.length || 1);
  for (let i = 0; i < e.length; i++) e[i]! -= mean;
  const rate = sr / step;
  const lo = Math.max(1, Math.floor(minS * rate));
  const hi = Math.min(e.length - 1, Math.ceil(maxS * rate));
  const corr = (lag: number) => {
    let c = 0;
    let n = 0;
    for (let i = 0; i + lag < e.length; i++) {
      c += e[i]! * e[i + lag]!;
      n++;
    }
    return n ? c / n : 0;
  };
  let best = lo;
  let bestC = -Infinity;
  for (let lag = lo; lag <= hi; lag++) {
    const c = corr(lag);
    if (c > bestC) {
      bestC = c;
      best = lag;
    }
  }
  // A multiple of the true interval can score as well; prefer the shortest that nearly matches.
  for (let div = 4; div >= 2; div--) {
    const lag = Math.round(best / div);
    if (lag >= lo && corr(lag) > 0.8 * bestC) return lag / rate;
  }
  return best / rate;
}

/**
 * Where each combustion event starts: the steepest rise of loudness in each
 * firing interval, found one interval at a time so the spacing stays right.
 */
export function findFirings(x: Float32Array, sr: number, interval: number): number[] {
  const env = envelope(x, sr, 300);
  const n = Math.round(interval * sr);
  const rise = (i: number) => env[Math.min(env.length - 1, i + Math.round(sr * 0.003))]! - env[i]!;
  const onsets: number[] = [];
  // First event: the steepest rise in the first interval.
  let best = 0;
  for (let i = 0; i < Math.min(n, env.length); i++) if (rise(i) > rise(best)) best = i;
  let at = best;
  while (at < x.length - n) {
    onsets.push(at);
    // Look for the next one around where it should be.
    const from = at + Math.round(n * 0.75);
    const to = Math.min(x.length - 1, at + Math.round(n * 1.25));
    let next = from;
    for (let i = from; i < to; i++) if (rise(i) > rise(next)) next = i;
    at = next;
  }
  return onsets;
}

export interface Grain {
  data: Float32Array;
  /** Samples before the combustion starts (a short lead-in). */
  lead: number;
}

/**
 * Cut grains at the onsets: each one firing interval plus some ring-out,
 * with a short fade at each end so they join without clicks.
 */
export function cutGrains(x: Float32Array, sr: number, onsets: number[], interval: number, ringOut = 0.6): Grain[] {
  const lead = Math.round(0.002 * sr);
  const len = Math.round(interval * (1 + ringOut) * sr) + lead;
  const fadeIn = lead;
  const fadeOut = Math.round(interval * ringOut * sr);
  const grains: Grain[] = [];
  for (const o of onsets) {
    const start = o - lead;
    if (start < 0 || start + len > x.length) continue;
    const g = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      let w = 1;
      if (i < fadeIn) w = i / fadeIn;
      else if (i > len - fadeOut) w = 0.5 + 0.5 * Math.cos((Math.PI * (i - (len - fadeOut))) / fadeOut);
      g[i] = x[start + i]! * w;
    }
    grains.push({ data: g, lead });
  }
  return grains;
}

/**
 * Line the grains up on each other: the onset finder can be a millisecond or
 * two out, and that smears the engine's beat. Each grain is shifted to best
 * match a reference grain (cross-correlation over the first part, where the
 * combustion is), by at most `maxShiftS`.
 */
export function alignGrains(grains: Grain[], sr: number, maxShiftS = 0.003): Grain[] {
  if (grains.length < 2) return grains;
  const len = grains[0]!.data.length;
  // Reference: the average of all grains, which keeps what they have in common.
  const ref = new Float32Array(len);
  for (const g of grains) for (let i = 0; i < len; i++) ref[i]! += g.data[i]! / grains.length;
  const span = Math.round(len * 0.6);
  const maxShift = Math.round(maxShiftS * sr);
  return grains.map((g) => {
    let best = 0;
    let bestC = -Infinity;
    for (let s = -maxShift; s <= maxShift; s++) {
      let c = 0;
      for (let i = maxShift; i < span; i++) {
        const j = i + s;
        if (j >= 0 && j < len) c += g.data[j]! * ref[i]!;
      }
      if (c > bestC) {
        bestC = c;
        best = s;
      }
    }
    if (best === 0) return g;
    const data = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const j = i + best;
      data[i] = j >= 0 && j < len ? g.data[j]! : 0;
    }
    return { data, lead: g.lead };
  });
}

export interface GranularSpec {
  rpm: number;
  /** Engine cycles in the loop (four firings each). */
  cycles: number;
  /** How much of each grain rings on past the next firing at high revs (0..1): less ring, cleaner tone. */
  ringOut?: number;
  seed: number;
}

/**
 * A seamless loop of the engine at `rpm`, built from real grains. Runs of
 * four consecutive grains are kept together, so each cylinder's own
 * character stays in step.
 */
export function renderGranularLoop(grains: Grain[], sr: number, spec: GranularSpec): Float32Array {
  if (grains.length === 0) return new Float32Array(0);
  const rand = rng(spec.seed);
  const interval = 30 / spec.rpm;
  const firings = spec.cycles * 4;
  const out = new Float32Array(Math.round(firings * interval * sr));
  const ring = spec.ringOut ?? 1;
  // Grains in their recorded order from a random starting point: the engine's
  // own sequence of firings, cylinder by cylinder, with nothing reshuffled.
  const first = Math.floor(rand() * grains.length);
  for (let f = 0; f < firings; f++) {
    const g = grains[(first + f) % grains.length]!;
    // At high revs the next firing comes before this one has died away: shorten the tail.
    const keep = Math.min(g.data.length, g.lead + Math.round(interval * (1 + ring) * sr));
    const fade = Math.max(1, Math.round(interval * ring * sr * 0.8));
    const start = Math.round(f * interval * sr) - g.lead;
    for (let i = 0; i < keep; i++) {
      const w = i > keep - fade ? (keep - i) / fade : 1;
      let j = start + i;
      j = ((j % out.length) + out.length) % out.length; // wrap: a seamless loop
      out[j]! += g.data[i]! * w;
    }
  }
  // Level: the same loudness at every speed (the mix decides how loud).
  let sum = 0;
  for (const v of out) sum += v * v;
  const rms = Math.sqrt(sum / (out.length || 1));
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const gain = Math.min(0.25 / (rms || 1), 0.95 / (peak || 1));
  for (let i = 0; i < out.length; i++) out[i]! *= gain;
  return out;
}

/** Cut a stretch of recording into a seamless loop by crossfading its end into its start. */
export function crossfadeLoop(x: Float32Array, sr: number, fadeS = 0.08): Float32Array {
  const fade = Math.min(Math.round(fadeS * sr), Math.floor(x.length / 3));
  const out = new Float32Array(x.length - fade);
  out.set(x.subarray(0, out.length));
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    // Equal-power: the loudness does not dip in the middle of the join.
    out[i] = x[out.length + i]! * Math.cos((t * Math.PI) / 2) + x[i]! * Math.sin((t * Math.PI) / 2);
  }
  return out;
}

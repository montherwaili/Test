/**
 * Builds the engine sound bank in public/sounds/engine/ from the original
 * recording in assets/sounds-src/ (see the credits there): a Kia Carnival
 * 2.9-litre four-cylinder diesel, started from cold, idling, and switched
 * off. Run with `npm run sounds`; needs ffmpeg on the PATH to decode it.
 *
 *   1. decode to mono 32 kHz (the recording is clean: no denoising needed)
 *   2. the real starter (looped between two compression strokes while the
 *      game keeps cranking), the real first firings and flare, and the real
 *      switch-off, all at the recording's own levels relative to the idle
 *   3. the idle's combustion strokes cut out, lined up, and laid down again
 *      at the game's idle and at each engine speed in POINTS
 *      (src/audio/granular.ts); for the engine under load, the same strokes
 *      with a harder knock and more exhaust body - the recording has no
 *      driving in it
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { alignGrains, crossfadeLoop, cutGrains, findFirings, firingInterval, renderGranularLoop, type Grain } from '../../src/audio/granular';

const SRC = 'assets/sounds-src/';
const OUT = 'public/sounds/engine/';
const SR = 32000;
/** Speeds of the loops above idle: close enough that no loop is sped up or slowed by much. */
const POINTS = [1150, 1550, 2050, 2650, 3350, 4100, 4700];
const GAME_IDLE = (JSON.parse(readFileSync('src/data/tuning.json', 'utf8')) as { engine: { idleRpm: number } }).engine.idleRpm;

function decode(file: string): Float32Array {
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', SRC + file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], {
    maxBuffer: 1 << 28,
  });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice();
}

function writeWav(name: string, x: Float32Array, dir = OUT): void {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + x.length * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i]!)) * 32767), 44 + i * 2);
  writeFileSync(dir + name, b);
}

const seg = (x: Float32Array, a: number, b: number) => x.slice(Math.round(a * SR), Math.round(b * SR));

const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);

/** Keep peaks inside full scale (a soft limit; the recording rarely needs it). */
const clip = (x: Float32Array) => x.map((v) => (Math.abs(v) < 0.8 ? v : Math.sign(v) * (0.8 + 0.19 * Math.tanh((Math.abs(v) - 0.8) / 0.19))));

function fades(x: Float32Array, inS: number, outS: number): Float32Array {
  const y = x.slice();
  const a = Math.round(inS * SR);
  const b = Math.round(outS * SR);
  for (let i = 0; i < a; i++) y[i]! *= i / a;
  for (let i = 0; i < b; i++) y[y.length - 1 - i]! *= i / b;
  return y;
}

/**
 * The same strokes as a working engine makes them: the combustion knock at
 * the start of each stroke harder, and more body from the exhaust (a low
 * shelf). No distortion: it must stay the same engine, only working.
 */
function underLoad(grains: Grain[]): Grain[] {
  const knock = Math.round(0.006 * SR);
  const a = Math.exp((-2 * Math.PI * 260) / SR);
  return grains.map((g) => {
    const data = new Float32Array(g.data.length);
    let low = 0;
    for (let i = 0; i < data.length; i++) {
      const t = i - g.lead;
      const hit = t >= 0 && t < knock ? 1 + 0.6 * (1 - t / knock) : 1;
      const v = g.data[i]! * hit;
      low = a * low + (1 - a) * v;
      data[i] = v + 0.9 * low;
    }
    return { data, lead: g.lead };
  });
}

it('builds the engine sound bank', () => {
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT).filter((n) => n.endsWith('.wav'))) rmSync(OUT + f);
  const rec = decode('BigSoundBank-0967-Kia-Carnival-diesel.flac');

  // Settled idle (the cold engine idles fast, at about 1000 rpm).
  const idleSrc = seg(rec, 6, 14);
  const idleIv = firingInterval(idleSrc, SR, 0.02, 0.05);
  const realRpm = Math.round(30 / idleIv);
  // Everything cut from the recording keeps its loudness relative to the idle.
  const gain = 0.25 / rms(idleSrc);
  const level = (x: Float32Array) => clip(x.map((v) => v * gain));
  const points = POINTS;

  // Strokes from all of the idle: a long, varied sequence of them.
  const strokesSrc = seg(rec, 2.5, 47);
  const light = alignGrains(cutGrains(strokesSrc, SR, findFirings(strokesSrc, SR, idleIv), idleIv), SR);
  const heavy = underLoad(light);
  const loop = (name: string, grains: Grain[], rpm: number, seed: number) =>
    writeWav(name, renderGranularLoop(grains, SR, { rpm, cycles: Math.max(16, Math.round(rpm / 50)), seed, ringOut: 0.8 }));
  loop('idle.wav', light, GAME_IDLE, 1);
  loop('heavy-idle.wav', heavy, GAME_IDLE, 2);
  for (const rpm of points) {
    loop(`light-${rpm}.wav`, light, rpm, rpm);
    loop(`heavy-${rpm}.wav`, heavy, rpm, rpm + 1);
  }

  // The starter: silence to 0.14 s, compressions with low points at 0.37,
  // 0.56 and 0.72 s, first firing at 0.78 s.
  const CRANK = [0.14, 0.77];
  // Made louder than in the recording (taken from outside the car): from the
  // driver's seat the starter is the loudest thing until the engine fires.
  writeWav('crank.wav', clip(fades(seg(rec, CRANK[0]!, CRANK[1]!), 0.02, 0.01).map((v) => v * gain * 2)));
  // First firings, the flare to fast idle, and into the idle, faded out under the loops.
  writeWav('catch.wav', level(fades(seg(rec, 0.77, 3.1), 0.005, 0.6)));
  // Switch-off: the real run-down, from the last of the idle.
  writeWav('stop.wav', level(fades(seg(rec, 47.3, 49.4), 0.02, 0.3)));

  // A fingerprint of this build, so browsers fetch the new files instead of old copies.
  const hash = createHash('sha1');
  for (const f of readdirSync(OUT).filter((n) => n.endsWith('.wav')).sort()) hash.update(readFileSync(OUT + f));
  const meta = {
    version: hash.digest('hex').slice(0, 10),
    idleRpm: GAME_IDLE,
    points,
    // The part of crank.wav looped while the starter keeps turning (low point to low point).
    crankLoop: [0.37, 0.72].map((t) => Math.round((t - CRANK[0]!) * 1000) / 1000),
    // When the loops take over from catch.wav (seconds after it starts).
    catchHandover: [1.5, 2.2],
    // Where in crank.wav the engine fires: the catch follows from there.
    crankFires: Math.round((0.77 - CRANK[0]!) * 1000) / 1000,
  };
  writeFileSync(OUT + 'meta.json', JSON.stringify(meta, null, 1) + '\n');

  expect(realRpm).toBeGreaterThan(850);
  expect(realRpm).toBeLessThan(1150);
  expect(light.length).toBeGreaterThan(500);
});

// --- crashes ------------------------------------------------------------------------

const CRASH_SRC = 'crash/';
const CRASH_OUT = 'public/sounds/crash/';

/** Start of each loud event: where the loudness first comes within `withinDb` of the loudest. */
function loudOnsets(x: Float32Array, withinDb: number, gapS: number): number[] {
  const hop = Math.round(0.005 * SR);
  const levels: number[] = [];
  for (let i = 0; i + hop <= x.length; i += hop) levels.push(rms(x.subarray(i, i + hop)));
  const top = Math.max(...levels);
  const limit = top * 10 ** (-withinDb / 20);
  const onsets: number[] = [];
  for (let k = 0; k < levels.length; k++) {
    if (levels[k]! < limit) continue;
    const t = k * hop;
    if (onsets.length && t - onsets[onsets.length - 1]! < gapS * SR) continue;
    // Back up to where it starts rising.
    let s = k;
    while (s > 0 && levels[s - 1]! > top * 0.01 && k - s < 10) s--;
    onsets.push(s * hop);
  }
  return onsets;
}

/** Cut `lengthS` from `start` (samples), with a short lead-in and a fade-out, peak-normalised. */
function hit(x: Float32Array, start: number, lengthS: number): Float32Array {
  const from = Math.max(0, start - Math.round(0.004 * SR));
  const y = fades(x.slice(from, Math.min(x.length, from + Math.round(lengthS * SR))), 0.002, lengthS * 0.5);
  let peak = 0;
  for (const v of y) peak = Math.max(peak, Math.abs(v));
  return y.map((v) => (v / peak) * 0.85);
}

/** Slow a hit to 0.45x speed (lower and longer), keep below ~160 Hz, and saturate it. */
function boom(x: Float32Array): Float32Array {
  const rate = 0.45;
  const n = Math.floor(x.length / rate);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * rate;
    const k = Math.floor(p);
    const f = p - k;
    y[i] = (x[k] ?? 0) * (1 - f) + (x[k + 1] ?? 0) * f;
  }
  // Two passes of a one-pole low-pass at 160 Hz.
  const a = Math.exp((-2 * Math.PI * 160) / SR);
  for (let pass = 0; pass < 2; pass++) {
    let lp = 0;
    for (let i = 0; i < n; i++) y[i] = lp = a * lp + (1 - a) * y[i]!;
  }
  let peak = 0;
  for (const v of y) peak = Math.max(peak, Math.abs(v));
  return fades(y.map((v) => Math.tanh((v / peak) * 2.2) * 0.88), 0.002, 0.25);
}

it('builds the crash sound bank', () => {
  mkdirSync(CRASH_OUT, { recursive: true });
  for (const f of readdirSync(CRASH_OUT).filter((n) => n.endsWith('.wav'))) rmSync(CRASH_OUT + f);
  const write = (name: string, x: Float32Array) => writeWav(name, x, CRASH_OUT);

  // The body: a car door slammed, heard from inside the car (the loud closes, not the openings).
  const doors = decode(CRASH_SRC + 'BigSoundBank-0655-car-door-slam-inside.flac');
  const thumps = loudOnsets(doors, 8, 1).slice(0, 5);
  thumps.forEach((t, i) => write(`thump-${i + 1}.wav`, hit(doors, t, 0.55)));
  // The weight of a crash: the same slams an octave and more down, only their low end kept,
  // pushed into saturation - the deep blow a real crash has and a door does not.
  thumps.forEach((t, i) => write(`boom-${i + 1}.wav`, boom(hit(doors, t, 0.5))));

  // Bent metal: sheet-steel bars falling on a path.
  const steel = ['1771', '1772', '1773', '1776', '1777'];
  steel.forEach((n, i) => {
    const x = decode(`${CRASH_SRC}BigSoundBank-${n}-sheet-steel-fall.flac`);
    write(`metal-${i + 1}.wav`, hit(x, loudOnsets(x, 6, 1)[0]!, 1.1));
  });

  // Breaking glass, for the hardest knocks.
  const glass = decode(CRASH_SRC + 'BigSoundBank-0771-broken-glass.flac');
  const smashes = loudOnsets(glass, 14, 1).slice(0, 4);
  smashes.forEach((t, i) => write(`glass-${i + 1}.wav`, hit(glass, t, 0.9)));

  // Tyres squealing: the steady middle of it, looped.
  const tyres = decode(CRASH_SRC + 'BigSoundBank-2368-screeching-tires.flac');
  const squeal = seg(tyres, 0.3, 1.75);
  write('squeal.wav', clip(crossfadeLoop(squeal, SR, 0.15).map((v) => (v * 0.25) / rms(squeal))));

  const hash = createHash('sha1');
  for (const f of readdirSync(CRASH_OUT).filter((n) => n.endsWith('.wav')).sort()) hash.update(readFileSync(CRASH_OUT + f));
  const meta = { version: hash.digest('hex').slice(0, 10), thump: thumps.length, boom: thumps.length, metal: steel.length, glass: smashes.length };
  writeFileSync(CRASH_OUT + 'meta.json', JSON.stringify(meta, null, 1) + '\n');

  expect(thumps.length).toBeGreaterThanOrEqual(4);
  expect(smashes.length).toBeGreaterThanOrEqual(3);
});

// --- the car's controls ------------------------------------------------------------

const CONTROLS_SRC = 'controls/';
const CONTROLS_OUT = 'public/sounds/controls/';

it('builds the controls sound bank', () => {
  mkdirSync(CONTROLS_OUT, { recursive: true });
  for (const f of readdirSync(CONTROLS_OUT).filter((n) => n.endsWith('.wav'))) rmSync(CONTROLS_OUT + f);
  const write = (name: string, x: Float32Array) => writeWav(name, x, CONTROLS_OUT);
  const peakTo = (x: Float32Array, p: number) => {
    let m = 0;
    for (const v of x) m = Math.max(m, Math.abs(v));
    return x.map((v) => (v / m) * p);
  };

  // Indicator relay (a Citroën C3, inside): the click as the lamps light, and the softer one as they go out.
  const relay = decode(CONTROLS_SRC + 'BigSoundBank-3107-turn-signals-C3.flac');
  write('tick.wav', peakTo(fades(seg(relay, 0.68, 0.98), 0.003, 0.08), 0.8));
  write('tock.wav', peakTo(fades(seg(relay, 1.06, 1.3), 0.003, 0.08), 0.6));

  // Horn (a Peugeot 106): a steady stretch of it, looped while the horn is held.
  const horn = decode(CONTROLS_SRC + 'BigSoundBank-0850-horn-Peugeot106.flac');
  const steady = seg(horn, 4.9, 6.2);
  write('horn-loop.wav', peakTo(crossfadeLoop(steady, SR, 0.12), 0.8));

  // Handbrake (a Citroën C3): pulled up over its ratchet, and let down.
  write('handbrake-on.wav', peakTo(fades(seg(decode(CONTROLS_SRC + 'BigSoundBank-3100-handbrake-on-C3.flac'), 0.3, 1.4), 0.01, 0.2), 0.8));
  write('handbrake-off.wav', peakTo(fades(seg(decode(CONTROLS_SRC + 'BigSoundBank-3104-handbrake-off-C3.flac'), 0.25, 1.4), 0.01, 0.2), 0.8));

  // Seatbelt buckled.
  write('buckle.wav', peakTo(fades(seg(decode(CONTROLS_SRC + 'BigSoundBank-1506-seat-belt-in.flac'), 0.62, 1.25), 0.01, 0.15), 0.8));

  const hash = createHash('sha1');
  for (const f of readdirSync(CONTROLS_OUT).filter((n) => n.endsWith('.wav')).sort()) hash.update(readFileSync(CONTROLS_OUT + f));
  writeFileSync(CONTROLS_OUT + 'meta.json', JSON.stringify({ version: hash.digest('hex').slice(0, 10) }, null, 1) + '\n');
  expect(readdirSync(CONTROLS_OUT).filter((n) => n.endsWith('.wav'))).toHaveLength(6);
});

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
import { alignGrains, cutGrains, findFirings, firingInterval, renderGranularLoop, type Grain } from '../../src/audio/granular';

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

function writeWav(name: string, x: Float32Array): void {
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
  writeFileSync(OUT + name, b);
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

/**
 * Builds the engine sound bank in public/sounds/engine/ from the original
 * recordings in assets/sounds-src/ (see the credits there). Run with
 * `npm run sounds`; needs ffmpeg on the PATH to decode the recordings.
 *
 *   1. decode to mono 22.05 kHz
 *   2. take out the background (the recordings were made in a museum hall):
 *      spectral subtraction, with the noise measured where the engine is off
 *   3. idle: a stretch of the real idle, looped
 *   4. combustion strokes cut from the idle (light load) and from the van
 *      pulling past (under load), lined up, and laid down again at each of
 *      the speeds in POINTS (see src/audio/granular.ts)
 *   5. the real cranking (looped) and the real catch; a spin-down made of
 *      the real strokes slowing to a stop
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { alignGrains, crossfadeLoop, cutGrains, findFirings, firingInterval, renderGranularLoop } from '../../src/audio/granular';

const SRC = 'assets/sounds-src/';
const OUT = 'public/sounds/engine/';
const SR = 22050;
const POINTS = [1100, 1600, 2200, 3000, 3800, 4600];

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

/** In-place radix-2 FFT (re, im of length a power of two). */
function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b]! * wr - im[b]! * wi;
        const xi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a]! += xr;
        im[a]! += xi;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) (re[i]! /= n), (im[i]! /= n);
}

/** Spectral subtraction: the noise spectrum measured in [t0, t1] is taken out of the whole recording. */
function denoise(x: Float32Array, t0: number, t1: number, alpha: number, floor: number): Float32Array {
  const n = 1024;
  const hop = 256;
  const win = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  const frames = Math.ceil(x.length / hop) + 4;
  const spectra: { re: Float64Array; im: Float64Array }[] = [];
  for (let f = 0; f < frames; f++) {
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const j = f * hop + i - n;
      re[i] = j >= 0 && j < x.length ? x[j]! * win[i]! : 0;
    }
    fft(re, im);
    spectra.push({ re, im });
  }
  const noise = new Float64Array(n);
  const f0 = Math.floor((t0 * SR) / hop) + 4;
  const f1 = Math.floor((t1 * SR) / hop) + 4;
  for (let f = f0; f < f1; f++) for (let k = 0; k < n; k++) noise[k]! += (spectra[f]!.re[k]! ** 2 + spectra[f]!.im[k]! ** 2) / (f1 - f0);
  const out = new Float64Array(x.length + 3 * n);
  const norm = new Float64Array(out.length);
  let prev = new Float64Array(n).fill(1);
  for (let f = 0; f < frames; f++) {
    const { re, im } = spectra[f]!;
    const g = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const p = re[k]! ** 2 + im[k]! ** 2;
      // Gains are not allowed to fall faster than 0.6 a frame, so what noise is left does not warble.
      g[k] = Math.max(Math.max(1 - (alpha * noise[k]!) / Math.max(p, 1e-12), floor), 0.6 * prev[k]!);
      re[k]! *= Math.sqrt(g[k]!);
      im[k]! *= Math.sqrt(g[k]!);
    }
    prev = g;
    fft(re, im, true);
    for (let i = 0; i < n; i++) {
      out[f * hop + i]! += re[i]! * win[i]!;
      norm[f * hop + i]! += win[i]! ** 2;
    }
  }
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = out[i + n]! / Math.max(norm[i + n]!, 1e-6);
  return y;
}

const seg = (x: Float32Array, a: number, b: number) => x.slice(Math.round(a * SR), Math.round(b * SR));

function normalise(x: Float32Array, rmsTarget: number): Float32Array {
  const rms = Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const g = Math.min(rmsTarget / rms, 0.95 / peak);
  return x.map((v) => v * g);
}

function fades(x: Float32Array, inS: number, outS: number): Float32Array {
  const y = x.slice();
  const a = Math.round(inS * SR);
  const b = Math.round(outS * SR);
  for (let i = 0; i < a; i++) y[i]! *= i / a;
  for (let i = 0; i < b; i++) y[y.length - 1 - i]! *= i / b;
  return y;
}

it('builds the engine sound bank', () => {
  mkdirSync(OUT, { recursive: true });
  // The museum hall's background, measured where the engine is not running.
  const start = denoise(decode('WWS_FSRTarpan239Dvanstarting.ogg'), 1, 6, 2.0, 0.06);
  const drive = denoise(decode('WWS_FSRTarpan239Dvandriving.ogg'), 41.6, 43.4, 1.5, 0.08);

  const idleSrc = seg(start, 13, 18);
  const idleIv = firingInterval(idleSrc, SR, 0.03, 0.06);
  const idleRpm = Math.round(30 / idleIv);
  writeWav('idle.wav', normalise(crossfadeLoop(idleSrc, SR, 0.1), 0.2));

  const light = alignGrains(cutGrains(idleSrc, SR, findFirings(idleSrc, SR, idleIv), idleIv), SR);
  // The van pulling past, at its nearest: the steadiest stretch of it under load.
  const heavySrc = seg(drive, 5.8, 7.2);
  const heavyIv = firingInterval(heavySrc, SR, 0.03, 0.06);
  const heavy = alignGrains(cutGrains(heavySrc, SR, findFirings(heavySrc, SR, heavyIv), heavyIv), SR);
  for (const rpm of POINTS) {
    const cycles = Math.max(8, Math.round((0.9 * rpm) / 120));
    writeWav(`light-${rpm}.wav`, renderGranularLoop(light, SR, { rpm, cycles, seed: rpm, ringOut: 0.8 }));
    writeWav(`heavy-${rpm}.wav`, renderGranularLoop(heavy, SR, { rpm, cycles, seed: rpm + 1, ringOut: 0.8 }));
  }

  writeWav('crank.wav', normalise(crossfadeLoop(seg(start, 7.15, 8.8), SR, 0.06), 0.22));
  // From the last turns of the starter to the engine settling: the game's engine catches quickly, so the cranking is heard here too.
  writeWav('catch.wav', normalise(fades(seg(start, 8.25, 11.2), 0.05, 0.8), 0.28));

  // Switch-off: the real strokes, further and further apart, dying away.
  const stop = new Float32Array(Math.round(0.9 * SR));
  for (let t = 0, k = 0; t < 0.9; k++) {
    const rpm = idleRpm * Math.max(0.12, 1 - t / 0.75);
    const g = light[(k * 7) % light.length]!;
    const amp = Math.max(0, 1 - t / 0.85) ** 1.5;
    const i0 = Math.round(t * SR) - g.lead;
    for (let i = 0; i < g.data.length && i0 + i < stop.length; i++) if (i0 + i >= 0) stop[i0 + i]! += g.data[i]! * amp;
    t += 30 / rpm;
  }
  writeWav('stop.wav', normalise(fades(stop, 0, 0.1), 0.15));
  writeFileSync(OUT + 'meta.json', JSON.stringify({ idleRpm, points: POINTS }, null, 1) + '\n');

  // Sanity: a diesel's idle, and enough strokes to work with.
  expect(idleRpm).toBeGreaterThan(600);
  expect(idleRpm).toBeLessThan(900);
  expect(light.length).toBeGreaterThan(60);
  expect(heavy.length).toBeGreaterThan(20);
});

import { describe, expect, it } from 'vitest';
import { crossfadeLoop, cutGrains, findFirings, firingInterval, renderGranularLoop } from '../granular';
import { rng } from '../dieselSynth';

const SR = 16000;

/** A stand-in for a recording: firings every `interval` s, each a decaying ring, plus noise. */
function fakeEngine(seconds: number, interval: number): Float32Array {
  const x = new Float32Array(Math.round(seconds * SR));
  const r = rng(5);
  for (let i = 0; i < x.length; i++) x[i] = (r() - 0.5) * 0.02;
  for (let t = 0.013; t < seconds; t += interval) {
    const a = 0.7 + r() * 0.3;
    const i0 = Math.round(t * SR);
    for (let i = 0; i < SR * 0.03 && i0 + i < x.length; i++) {
      x[i0 + i]! += a * Math.exp(-i / (SR * 0.006)) * Math.sin((2 * Math.PI * 160 * i) / SR);
    }
  }
  return x;
}

describe('cutting a recording into combustion grains', () => {
  const interval = 30 / 800; // a four-cylinder at 800 rpm
  const rec = fakeEngine(3, interval);

  it('finds the firing interval', () => {
    expect(firingInterval(rec, SR)).toBeCloseTo(interval, 3);
  });

  it('finds each firing, evenly spaced', () => {
    const onsets = findFirings(rec, SR, interval);
    expect(onsets.length).toBeGreaterThan(70);
    for (let i = 1; i < onsets.length; i++) {
      expect(Math.abs((onsets[i]! - onsets[i - 1]!) / SR - interval)).toBeLessThan(0.002);
    }
  });

  it('cuts grains that start at silence and end at silence', () => {
    const grains = cutGrains(rec, SR, findFirings(rec, SR, interval), interval);
    expect(grains.length).toBeGreaterThan(70);
    for (const g of grains.slice(0, 10)) {
      expect(Math.abs(g.data[0]!)).toBeLessThan(1e-6);
      expect(Math.abs(g.data[g.data.length - 1]!)).toBeLessThan(0.01);
    }
  });
});

describe('re-assembling grains at another engine speed', () => {
  const interval = 30 / 800;
  const rec = fakeEngine(3, interval);
  const grains = cutGrains(rec, SR, findFirings(rec, SR, interval), interval);

  it('fires at the new rate, keeping the timbre', () => {
    const loop = renderGranularLoop(grains, SR, { rpm: 2400, cycles: 8, seed: 1 });
    // Eight cycles at 2400 rpm: 0.4 s, 32 firings.
    expect(loop.length).toBe(Math.round(0.4 * SR));
    expect(firingInterval(loop, SR, 0.008, 0.04)).toBeCloseTo(30 / 2400, 3);
    // The 160 Hz ring is still there, not pushed up to 480 Hz as speeding up the recording would.
    const power = (hz: number) => {
      let re = 0;
      let im = 0;
      for (let i = 0; i < loop.length; i++) {
        re += loop[i]! * Math.cos((2 * Math.PI * hz * i) / SR);
        im += loop[i]! * Math.sin((2 * Math.PI * hz * i) / SR);
      }
      return Math.hypot(re, im);
    };
    expect(power(160)).toBeGreaterThan(power(480));
  });

  it('keeps the same loudness whatever the speed, without clipping', () => {
    const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
    const slow = renderGranularLoop(grains, SR, { rpm: 900, cycles: 6, seed: 2 });
    const fast = renderGranularLoop(grains, SR, { rpm: 3600, cycles: 12, seed: 2 });
    expect(rms(fast) / rms(slow)).toBeGreaterThan(0.8);
    expect(rms(fast) / rms(slow)).toBeLessThan(1.25);
    for (const v of fast) expect(Math.abs(v)).toBeLessThanOrEqual(0.95 + 1e-6);
  });

  it('joins the end of a recorded loop to its start smoothly', () => {
    const x = new Float32Array(SR).map((_, i) => Math.sin((2 * Math.PI * 101.3 * i) / SR));
    const loop = crossfadeLoop(x, SR);
    expect(Math.abs(loop[0]! - loop[loop.length - 1]!)).toBeLessThan(0.1);
  });
});

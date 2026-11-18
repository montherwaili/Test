import { describe, expect, it } from 'vitest';
import {
  firingRate,
  renderBuckle,
  renderCrankLoop,
  renderCrunch,
  renderEngineLoop,
  renderGearClunk,
  renderHandbrake,
  renderKey,
  renderRelay,
  renderShudder,
} from '../dieselSynth';

const SR = 22050;

/** Indices where the short-term energy peaks: one per combustion event in a clean loop. */
function energyPeaks(x: Float32Array, window: number, minGap = 0): number[] {
  const e: number[] = [];
  for (let i = 0; i + window <= x.length; i += window) {
    let s = 0;
    for (let j = i; j < i + window; j++) s += x[j]! * x[j]!;
    e.push(s);
  }
  const max = Math.max(...e);
  const peaks: number[] = [];
  for (let i = 1; i < e.length - 1; i++) {
    if (!(e[i]! > max * 0.25 && e[i]! >= e[i - 1]! && e[i]! > e[i + 1]!)) continue;
    // Ringing after one event is not another event.
    if (peaks.length && i * window - peaks[peaks.length - 1]! < minGap) continue;
    peaks.push(i * window);
  }
  return peaks;
}

describe('diesel engine loop', () => {
  const spec = { rpm: 900, load: 0.15, cycles: 4, seed: 1 };
  const loop = renderEngineLoop(spec, SR);

  it('is exactly the right length for its cycles', () => {
    // 4 cycles at 900 rpm: each cycle is two revolutions, 2 / 15 s.
    expect(loop.length).toBe(Math.round(((4 * 2) / 15) * SR));
    expect(firingRate(900)).toBe(30);
  });

  it('has one combustion event per firing: 16 in four cycles of a four-cylinder', () => {
    // Firings are 33 ms apart at 900 rpm; anything closer is the same event ringing on.
    expect(energyPeaks(loop, Math.round(SR / 1000), Math.round(SR * 0.02)).length).toBe(16);
  });

  it('never clips, has no DC offset, and loops without a jump at the seam', () => {
    let max = 0;
    let sum = 0;
    for (const v of loop) {
      max = Math.max(max, Math.abs(v));
      sum += v;
    }
    expect(max).toBeLessThanOrEqual(0.9 + 1e-6);
    expect(Math.abs(sum / loop.length)).toBeLessThan(1e-3);
    // The step from the last sample back to the first is no bigger than an ordinary step.
    let typical = 0;
    for (let i = 1; i < loop.length; i++) typical = Math.max(typical, Math.abs(loop[i]! - loop[i - 1]!));
    expect(Math.abs(loop[0]! - loop[loop.length - 1]!)).toBeLessThanOrEqual(typical);
  });

  it('is the same every time for a seed, and different for another', () => {
    expect(renderEngineLoop(spec, SR)).toEqual(loop);
    expect(renderEngineLoop({ ...spec, seed: 2 }, SR)).not.toEqual(loop);
  });

  it('has the diesel clatter: more energy at a few kilohertz when lightly loaded than when pulling', () => {
    const highBand = (x: Float32Array) => {
      // A crude high-pass: the energy of the sample-to-sample difference, relative to the signal.
      let d = 0;
      let s = 0;
      for (let i = 1; i < x.length; i++) {
        d += (x[i]! - x[i - 1]!) ** 2;
        s += x[i]! ** 2;
      }
      return d / s;
    };
    const pulling = renderEngineLoop({ ...spec, load: 0.9 }, SR);
    expect(highBand(loop)).toBeGreaterThan(highBand(pulling));
  });
});

describe('cranking', () => {
  it('renders the starter and the compressions, and a quieter loop without the starter', () => {
    const crank = renderCrankLoop({ rpm: 250, cycles: 2, starter: true, seed: 3 }, SR);
    const coast = renderCrankLoop({ rpm: 250, cycles: 2, starter: false, seed: 3 }, SR);
    expect(crank.length).toBe(Math.round(((2 * 2 * 60) / 250) * SR));
    const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
    expect(rms(crank)).toBeGreaterThan(rms(coast));
    for (const v of crank) expect(Math.abs(v)).toBeLessThanOrEqual(0.85 + 1e-6);
  });
});

describe('one-shot sounds', () => {
  it('are short, finite, and within range', () => {
    for (const x of [renderHandbrake(true, SR), renderHandbrake(false, SR), renderGearClunk(SR), renderBuckle(SR), renderRelay(true, SR), renderRelay(false, SR), renderCrunch(SR), renderShudder(SR), renderKey(SR)]) {
      expect(x.length).toBeGreaterThan(0);
      expect(x.length).toBeLessThan(SR);
      let max = 0;
      for (const v of x) {
        expect(Number.isFinite(v)).toBe(true);
        max = Math.max(max, Math.abs(v));
      }
      expect(max).toBeGreaterThan(0.3);
      expect(max).toBeLessThanOrEqual(0.95 + 1e-6);
    }
  });

  it('the handbrake ratchet clicks over several teeth', () => {
    expect(energyPeaks(renderHandbrake(true, SR), Math.round(SR / 1000), Math.round(SR * 0.02)).length).toBeGreaterThanOrEqual(6);
  });
});

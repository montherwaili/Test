import { describe, expect, it } from 'vitest';
import { HIGH_REF_RPM, LOW_REF_RPM, dieselMix, impactLoudness, recordedMix, roadNoise, turboTarget, tyreSqueal } from '../soundModel';

describe('diesel engine mix', () => {
  it('plays the loops at the engine speed', () => {
    const m = dieselMix(1800, 0.3, true, false);
    expect(m.lowRate).toBeCloseTo(1800 / LOW_REF_RPM, 6);
    expect(m.highRate).toBeCloseTo(1800 / HIGH_REF_RPM, 6);
  });

  it('crossfades from the low-rev to the high-rev loop without a dip in level', () => {
    expect(dieselMix(800, 0.1, true, false).low).toBe(1);
    expect(dieselMix(3000, 0.1, true, false).high).toBe(1);
    for (const rpm of [800, 1500, 1800, 2200, 3000]) {
      const m = dieselMix(rpm, 0.5, true, false);
      expect(m.low ** 2 + m.high ** 2).toBeCloseTo(1, 6);
      expect(m.light ** 2 + m.heavy ** 2).toBeCloseTo(1, 6);
    }
  });

  it('sounds heavier and louder under load', () => {
    const idle = dieselMix(800, 0.1, true, false);
    const pulling = dieselMix(2500, 0.9, true, false);
    expect(idle.light).toBe(1);
    expect(pulling.heavy).toBe(1);
    expect(pulling.engine).toBeGreaterThan(idle.engine);
    expect(pulling.engine).toBeLessThanOrEqual(1);
  });

  it('cranks with the starter, then runs; switched off it spins down to silence', () => {
    const cranking = dieselMix(200, 0, false, true);
    expect(cranking.crank).toBeGreaterThan(0.5);
    expect(cranking.engine).toBe(0);
    const running = dieselMix(800, 0.1, true, false);
    expect(running.crank).toBe(0);
    expect(running.engine).toBeGreaterThan(0.3);
    expect(dieselMix(400, 0, false, false).coast).toBeGreaterThan(0.2);
    const stopped = dieselMix(0, 0, false, false);
    expect(stopped.engine + stopped.crank + stopped.coast).toBe(0);
  });

  it('the turbo only spools with revs and load', () => {
    expect(turboTarget(800, 1)).toBe(0);
    expect(turboTarget(3000, 0.1)).toBe(0);
    expect(turboTarget(3000, 1)).toBe(1);
    expect(turboTarget(2000, 0.6)).toBeGreaterThan(0);
  });
});

describe('tyres, road and impacts', () => {
  it('stays quiet in normal driving and squeals past the grip', () => {
    expect(tyreSqueal(2, 0, 3, 15)).toBe(0);
    expect(tyreSqueal(12, 0, 0, 15)).toBeGreaterThan(0.5);
    expect(tyreSqueal(0, 0.8, 0, 5)).toBeGreaterThan(0.5);
    expect(tyreSqueal(0, 0, 9.5, 20)).toBeGreaterThan(0.7);
    expect(tyreSqueal(40, 3, 12, 30)).toBe(1);
  });

  it('makes no tyre noise when barely moving (parking)', () => {
    expect(tyreSqueal(30, 0, 0, 1)).toBe(0);
  });

  it('road noise grows with speed and is the same either way', () => {
    expect(roadNoise(0)).toBe(0);
    expect(roadNoise(10)).toBeLessThan(roadNoise(25));
    expect(roadNoise(-10)).toBe(roadNoise(10));
    expect(roadNoise(60)).toBe(1);
  });

  it('a harder hit is louder, but even a nudge is heard', () => {
    expect(impactLoudness(1)).toBeCloseTo(0.15, 6);
    expect(impactLoudness(6)).toBe(0.5);
    expect(impactLoudness(30)).toBe(1);
  });
});

describe('recorded engine mix', () => {
  const POINTS = [1100, 1600, 2200, 3000, 3800, 4600];
  const level = (mix: ReturnType<typeof recordedMix>) => Math.sqrt(mix.reduce((a, l) => a + l.gain * l.gain, 0));
  const playing = (mix: ReturnType<typeof recordedMix>) => mix.filter((l) => l.gain > 1e-9).map((l) => l.name);

  it('plays the real idle at idle, at its own speed', () => {
    const mix = recordedMix(719, 0.1, 719, POINTS);
    expect(playing(mix)).toEqual(['idle']);
    expect(mix.find((l) => l.name === 'idle')!.rate).toBeCloseTo(1, 6);
  });

  it('crossfades the two loops either side of the revs, each matched to the engine speed', () => {
    const mix = recordedMix(1900, 0.1, 719, POINTS);
    expect(playing(mix)).toEqual(['light-1600', 'light-2200']);
    expect(mix.find((l) => l.name === 'light-1600')!.rate).toBeCloseTo(1900 / 1600, 6);
    expect(mix.find((l) => l.name === 'light-2200')!.rate).toBeCloseTo(1900 / 2200, 6);
  });

  it('keeps a steady level through every speed and load', () => {
    for (const rpm of [500, 719, 900, 1350, 2600, 4200, 4800]) {
      for (const load of [0, 0.3, 0.5, 0.9]) expect(level(recordedMix(rpm, load, 719, POINTS))).toBeCloseTo(1, 6);
    }
  });

  it('moves to the loops recorded under load as the engine works harder', () => {
    const light = recordedMix(2200, 0.1, 719, POINTS);
    const heavy = recordedMix(2200, 0.95, 719, POINTS);
    expect(playing(light)).toEqual(['light-2200']);
    expect(playing(heavy)).toEqual(['heavy-2200']);
    // Never sped up or slowed down by more than the gap between two loops.
    for (const rpm of [1000, 1500, 2500, 3500, 4400]) {
      for (const l of recordedMix(rpm, 0.5, 719, POINTS).filter((x) => x.gain > 0)) {
        expect(l.rate).toBeGreaterThan(0.6);
        expect(l.rate).toBeLessThan(1.6);
      }
    }
  });
});

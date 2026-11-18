import { describe, expect, it } from 'vitest';
import { engineVoice, impactLoudness, roadNoise, tyreSqueal } from '../soundModel';

describe('engine sound', () => {
  it('fires twice per revolution: about 27 Hz at idle, 200 Hz at 6000 rpm', () => {
    expect(engineVoice(800, 0.1, true, false).freq).toBeCloseTo(26.7, 1);
    expect(engineVoice(6000, 1, true, false).freq).toBeCloseTo(200, 6);
  });

  it('gets louder and brighter with load and revs', () => {
    const idle = engineVoice(800, 0.1, true, false);
    const pulling = engineVoice(3000, 0.9, true, false);
    expect(pulling.gain).toBeGreaterThan(idle.gain);
    expect(pulling.cutoff).toBeGreaterThan(idle.cutoff * 2);
    expect(pulling.roar).toBeGreaterThan(idle.roar);
    expect(pulling.gain).toBeLessThanOrEqual(1);
  });

  it('fades as a stalled engine spins down, and is silent when stopped', () => {
    expect(engineVoice(300, 0, false, false).gain).toBeLessThan(0.15);
    expect(engineVoice(0, 0, false, false).gain).toBe(0);
  });

  it('turns over audibly while cranking', () => {
    expect(engineVoice(200, 0, false, true).gain).toBeGreaterThan(0.1);
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

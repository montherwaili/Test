import { describe, expect, it } from 'vitest';
import { clutchCapacity, clutchEngagement } from '../clutch';
import { createDefaultTuning } from '../tuning';

describe('clutch', () => {
  const t = createDefaultTuning().clutch;

  it('transmits nothing with the pedal floored or above the bite point', () => {
    expect(clutchEngagement(1, t)).toBe(0);
    expect(clutchEngagement(t.biteStart, t)).toBe(0);
    expect(clutchEngagement(t.biteStart + 0.05, t)).toBe(0);
  });

  it('is fully clamped with the foot off and below the end of the bite range', () => {
    expect(clutchEngagement(0, t)).toBe(1);
    expect(clutchEngagement(t.biteEnd, t)).toBe(1);
    expect(clutchCapacity(0, t)).toBe(t.maxTorque);
  });

  it('bites progressively as the pedal comes up', () => {
    let last = -1;
    for (let p = 1; p >= 0; p -= 0.01) {
      const e = clutchEngagement(p, t);
      expect(e).toBeGreaterThanOrEqual(last);
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
      last = e;
    }
  });

  it('starts gently just past the bite point', () => {
    // A tenth of the way into the bite range carries well under a tenth of the torque.
    const p = t.biteStart - 0.1 * (t.biteStart - t.biteEnd);
    expect(clutchEngagement(p, t)).toBeGreaterThan(0);
    expect(clutchEngagement(p, t)).toBeLessThan(0.05);
  });

  it('tolerates out-of-range pedal values', () => {
    expect(clutchEngagement(-0.5, t)).toBe(1);
    expect(clutchEngagement(1.5, t)).toBe(0);
  });
});

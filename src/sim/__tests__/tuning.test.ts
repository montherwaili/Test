import { describe, expect, it } from 'vitest';
import raw from '../../data/tuning.json';
import { TuningError, createDefaultTuning, validateTuning } from '../tuning';

function broken(edit: (t: any) => void): unknown {
  const t = structuredClone(raw) as any;
  edit(t);
  return t;
}

describe('tuning file', () => {
  it('ships a valid default tuning', () => {
    const t = createDefaultTuning();
    expect(t.engine.idleRpm).toBe(800);
    expect(t.engine.redlineRpm).toBe(4500);
    expect(t.gearbox.forward).toHaveLength(5);
    expect(t.sim.stepHz).toBe(120);
  });

  it('gives each caller an independent copy', () => {
    const a = createDefaultTuning();
    const b = createDefaultTuning();
    a.engine.idleRpm = 1234;
    a.gearbox.forward[0] = 9;
    expect(b.engine.idleRpm).toBe(800);
    expect(b.gearbox.forward[0]).not.toBe(9);
  });

  it('rejects a missing section', () => {
    expect(() => validateTuning(broken((t) => delete t.clutch))).toThrow(TuningError);
  });

  it('rejects non-numeric and out-of-range values', () => {
    expect(() => validateTuning(broken((t) => (t.engine.inertia = 'heavy')))).toThrow(/engine\.inertia/);
    expect(() => validateTuning(broken((t) => (t.body.mass = -5)))).toThrow(/body\.mass/);
  });

  it('rejects a bite range that is the wrong way round', () => {
    expect(() =>
      validateTuning(
        broken((t) => {
          t.clutch.biteStart = 0.3;
          t.clutch.biteEnd = 0.6;
        }),
      ),
    ).toThrow(/biteEnd/);
  });

  it('rejects a torque curve that is not ascending in rpm', () => {
    expect(() =>
      validateTuning(
        broken((t) => {
          t.engine.torqueCurve = [
            [1000, 100],
            [500, 80],
          ];
        }),
      ),
    ).toThrow(/ascending/);
  });

  it('rejects a stall speed at or above idle', () => {
    expect(() => validateTuning(broken((t) => (t.engine.stallRpm = 900)))).toThrow(/stallRpm/);
  });

  it('reports every problem at once', () => {
    try {
      validateTuning(
        broken((t) => {
          t.body.mass = -1;
          t.gearbox.finalDrive = 0;
        }),
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TuningError);
      expect((e as TuningError).problems).toHaveLength(2);
    }
  });
});

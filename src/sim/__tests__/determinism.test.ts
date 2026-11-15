import { describe, expect, it } from 'vitest';
import type { CarControls } from '../longitudinalCar';
import { DT, controls, idlingCar } from './helpers';

/** A fixed, busy drive: move off, change up, brake, stall, restart. */
function scriptedControls(step: number): CarControls {
  const t = step * DT;
  const c = controls();
  if (t < 0.3) return { ...c, clutch: 1, gear: 1 };
  if (t < 3) return { ...c, gear: 1, throttle: 0.3, clutch: Math.max(0, 1 - (t - 0.3) / 1.5) };
  if (t < 3.3) return { ...c, gear: 1, clutch: 1 };
  if (t < 3.5) return { ...c, gear: 2, clutch: 1 };
  if (t < 7) return { ...c, gear: 2, throttle: 0.45, clutch: Math.max(0, 1 - (t - 3.5) / 0.5) };
  if (t < 11) return { ...c, gear: 2, brake: 0.35 };
  if (t < 12) return { ...c, gear: 2, clutch: 1, starter: true };
  return { ...c, gear: 2, clutch: 1 };
}

function run(steps: number, from = 0, car = idlingCar()) {
  const types: string[] = [];
  for (let i = from; i < steps; i++) {
    for (const e of car.step(DT, scriptedControls(i))) types.push(`${e.type}@${e.time}`);
  }
  return { car, types };
}

describe('determinism', () => {
  const STEPS = 14 * 120;

  it('the scripted drive does what it says (moves, stalls, restarts)', () => {
    const { car, types } = run(STEPS);
    expect(types.some((t) => t.startsWith('stall@'))).toBe(true);
    expect(types.some((t) => t.startsWith('engineStart@'))).toBe(true);
    expect(car.position).toBeGreaterThan(20);
    expect(car.telemetry.running).toBe(true);
  });

  it('two identical runs are bit-for-bit identical', () => {
    const a = run(STEPS);
    const b = run(STEPS);
    expect(b.car.getState()).toEqual(a.car.getState());
    expect(b.types).toEqual(a.types);
    // toEqual treats -0 and +0 alike; make sure not even that differs.
    expect(Object.is(a.car.position, b.car.position)).toBe(true);
    expect(JSON.stringify(a.car.getState())).toBe(JSON.stringify(b.car.getState()));
  });

  it('a snapshot restored into a new car continues identically', () => {
    const full = run(STEPS);

    const half = run(STEPS / 2);
    const snapshot = JSON.parse(JSON.stringify(half.car.getState()));
    const resumed = idlingCar();
    resumed.setState(snapshot);
    const rest = run(STEPS, STEPS / 2, resumed);

    expect(rest.car.getState()).toEqual(full.car.getState());
  });

  it('snapshots are copies, not live views', () => {
    const { car } = run(240);
    const snap = car.getState();
    const rpm = snap.powertrain.engineOmega;
    run(480, 240, car);
    expect(snap.powertrain.engineOmega).toBe(rpm);
  });

  it('time advances by exactly one step per step', () => {
    const { car } = run(1200);
    expect(car.time).toBeCloseTo(10, 9);
  });
});

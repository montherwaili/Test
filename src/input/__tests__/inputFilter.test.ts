import { describe, expect, it } from 'vitest';
import { createDefaultTuning } from '../../sim/tuning';
import { InputFilter, type AnalogInput, type DigitalInput } from '../inputFilter';

const DT = 1 / 60;
const clutch = createDefaultTuning().clutch;
const none: DigitalInput = { throttle: false, brake: false, clutch: false, left: false, right: false };

function run(f: InputFilter, seconds: number, d: Partial<DigitalInput> = {}, a: AnalogInput = {}, speed = 0) {
  for (let i = 0; i < Math.round(seconds / DT); i++) f.update(DT, { ...none, ...d }, a, speed, clutch);
}

describe('keyboard pedals', () => {
  it('throttle builds while held and drops quickly when released', () => {
    const f = new InputFilter();
    run(f, 0.25, { throttle: true });
    expect(f.throttle).toBeGreaterThan(0.15);
    expect(f.throttle).toBeLessThan(0.35);
    run(f, 2, { throttle: true });
    expect(f.throttle).toBe(1);
    run(f, 0.3);
    expect(f.throttle).toBe(0);
  });

  it('brake comes on faster than the throttle', () => {
    const f = new InputFilter();
    run(f, 0.2, { throttle: true, brake: true });
    expect(f.brake).toBeGreaterThan(f.throttle);
    run(f, 1, { brake: true });
    expect(f.brake).toBe(1);
  });

  it('clutch floors quickly when pressed', () => {
    const f = new InputFilter();
    run(f, 0.15, { clutch: true });
    expect(f.clutch).toBe(1);
  });

  it('clutch rises fast to the bite point, slowly through it, then fast again', () => {
    const f = new InputFilter();
    run(f, 0.3, { clutch: true });
    // Free travel above the bite point takes well under half a second.
    run(f, 0.2);
    expect(f.clutch).toBeLessThanOrEqual(clutch.biteStart + 0.031);
    expect(f.clutch).toBeGreaterThan(clutch.biteStart - 0.05);
    // Half the bite time later it is about half way through the bite range.
    run(f, f.options.clutchBiteTime / 2);
    const mid = (clutch.biteStart + clutch.biteEnd) / 2;
    expect(f.clutch).toBeGreaterThan(mid - 0.06);
    expect(f.clutch).toBeLessThan(mid + 0.06);
    // And after the rest of the bite time plus a moment, fully up.
    run(f, f.options.clutchBiteTime / 2 + 0.2);
    expect(f.clutch).toBe(0);
  });

  it('clutch release can be caught by pressing again', () => {
    const f = new InputFilter();
    run(f, 0.3, { clutch: true });
    run(f, 0.8);
    expect(f.clutch).toBeLessThan(0.6);
    run(f, 0.15, { clutch: true });
    expect(f.clutch).toBe(1);
  });

  it('never moves the clutch upwards while released, and always reaches zero', () => {
    const f = new InputFilter();
    run(f, 0.3, { clutch: true });
    let last = f.clutch;
    for (let i = 0; i < 300; i++) {
      run(f, DT);
      expect(f.clutch).toBeLessThanOrEqual(last);
      last = f.clutch;
    }
    expect(f.clutch).toBe(0);
  });
});

describe('keyboard steering', () => {
  it('reaches full lock at a standstill and returns to centre when released', () => {
    const f = new InputFilter();
    run(f, 1, { right: true });
    expect(f.steer).toBe(1);
    run(f, 1);
    expect(f.steer).toBe(0);
    run(f, 1, { left: true });
    expect(f.steer).toBe(-1);
  });

  it('gives less lock the faster the car is going', () => {
    const slow = new InputFilter();
    run(slow, 2, { right: true }, {}, 3);
    const fast = new InputFilter();
    run(fast, 2, { right: true }, {}, 25);
    expect(slow.steer).toBeGreaterThan(0.85);
    expect(fast.steer).toBeLessThan(0.2);
    expect(fast.steer).toBeGreaterThan(0.05);
  });

  it('both keys together cancel out', () => {
    const f = new InputFilter();
    run(f, 1, { left: true, right: true });
    expect(f.steer).toBe(0);
  });
});

describe('analog devices', () => {
  it('take over an axis directly while in use', () => {
    const f = new InputFilter();
    run(f, 0.1, { throttle: true }, { clutch: 0.57, steer: -0.4, brake: 0.3 });
    expect(f.clutch).toBe(0.57);
    expect(f.steer).toBe(-0.4);
    expect(f.brake).toBe(0.3);
    expect(f.throttle).toBeGreaterThan(0); // keyboard still drives the axis left alone
  });

  it('hand back smoothly when let go', () => {
    const f = new InputFilter();
    run(f, 0.1, {}, { clutch: 1, steer: 1, throttle: 0.8 });
    run(f, DT);
    expect(f.clutch).toBeLessThan(1);
    expect(f.clutch).toBeGreaterThan(0.9);
    expect(f.steer).toBeGreaterThan(0.9);
    run(f, 4);
    expect(f.clutch).toBe(0);
    expect(f.steer).toBe(0);
    expect(f.throttle).toBe(0);
  });

  it('clamps out-of-range values', () => {
    const f = new InputFilter();
    run(f, DT, {}, { clutch: 1.4, steer: -3, throttle: -1 });
    expect(f.clutch).toBe(1);
    expect(f.steer).toBe(-1);
    expect(f.throttle).toBe(0);
  });
});

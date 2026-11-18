import { describe, expect, it } from 'vitest';
import { WheelLearner, finishWheel, pedal, readController, standardGamepad, steering, type RawPad } from '../controllerMap';
import { gravityOnScreen, screenRoll, tiltSteer } from '../tilt';

const pad = (axes: number[], pressed: Record<number, number> = {}): RawPad => {
  const buttons = Array(17).fill(0);
  for (const [i, v] of Object.entries(pressed)) buttons[Number(i)] = v;
  return { axes, buttons };
};

describe('standard gamepad', () => {
  const m = standardGamepad();

  it('steers with the left stick, ignoring a little stick drift', () => {
    expect(readController(pad([0.05, 0]), m).steer).toBe(0);
    expect(readController(pad([1, 0]), m).steer).toBe(1);
    expect(readController(pad([-1, 0]), m).steer).toBe(-1);
    expect(readController(pad([0.54, 0]), m).steer).toBeCloseTo(0.5, 2);
  });

  it('uses the triggers as gas and brake', () => {
    const out = readController(pad([0, 0], { 7: 0.6, 6: 0.2 }), m);
    expect(out.throttle).toBeCloseTo(0.6, 6);
    expect(out.brake).toBeCloseTo(0.2, 6);
  });

  it('reports the buttons held', () => {
    const out = readController(pad([0, 0], { 4: 1, 0: 1, 12: 1 }), m);
    expect([...out.held].sort()).toEqual(['clutch', 'gearUp', 'starter']);
    expect(out.shifterGear).toBeNull();
  });
});

describe('pedal and steering axes', () => {
  it('reads a pedal whichever way its axis runs', () => {
    // Many wheels report a pedal as 1 at rest and -1 floored.
    const b = { source: 'axis' as const, index: 2, rest: 1, full: -1 };
    expect(pedal(pad([0, 0, 1]), b)).toBe(0);
    expect(pedal(pad([0, 0, 0]), b)).toBeCloseTo(0.5, 6);
    expect(pedal(pad([0, 0, -1]), b)).toBe(1);
    expect(pedal(pad([0, 0, 1.2]), b)).toBe(0);
  });

  it('centres the steering on the learned rest position', () => {
    const b = { source: 'axis' as const, index: 0, rest: 0.02, full: 0.98 };
    expect(steering(pad([0.02]), b, 0)).toBeCloseTo(0, 6);
    expect(steering(pad([0.98]), b, 0)).toBeCloseTo(1, 6);
    expect(steering(pad([-0.94]), b, 0)).toBeCloseTo(-1, 6);
  });
});

describe('learning a steering wheel', () => {
  /** Move axis `i` from rest to `to` and back, as a person would. */
  function sweep(l: WheelLearner, rest: number[], i: number, to: number) {
    l.update(pad(rest));
    for (let k = 1; k <= 10; k++) {
      const a = [...rest];
      a[i] = rest[i]! + ((to - rest[i]!) * k) / 10;
      l.update(pad(a));
    }
    for (let k = 9; k >= 0; k--) {
      const a = [...rest];
      a[i] = rest[i]! + ((to - rest[i]!) * k) / 10;
      if (l.update(pad(a))) return true;
    }
    return false;
  }

  it('learns the wheel, three pedals and an H-shifter', () => {
    const rest = [0, 1, 1, 1];
    const l = new WheelLearner();
    expect(l.current).toBe('steer');
    expect(sweep(l, rest, 0, 1)).toBe(true);
    expect(sweep(l, rest, 2, -1)).toBe(true); // gas
    expect(sweep(l, rest, 3, -1)).toBe(true); // brake
    expect(sweep(l, rest, 1, -1)).toBe(true); // clutch
    for (const [gear, button] of [['1', 8], ['2', 9], ['3', 10], ['4', 11], ['5', 12], ['R', 14]] as const) {
      expect(l.current).toBe(gear);
      l.update(pad(rest));
      expect(l.update(pad(rest, { [button]: 1 }))).toBe(true);
    }
    expect(l.done).toBe(true);
    const m = finishWheel(l.mapping);
    expect(m.steer).toEqual({ source: 'axis', index: 0, rest: 0, full: 1 });
    expect(m.throttle).toMatchObject({ index: 2, rest: 1, full: -1 });
    expect(m.brake).toMatchObject({ index: 3 });
    expect(m.clutch).toMatchObject({ index: 1 });
    expect(m.shifter).toEqual({ '1': 8, '2': 9, '3': 10, '4': 11, '5': 12, R: 14 });
    // The shifter's buttons are not also used for other things, and the clutch pedal replaces the clutch button.
    expect(Object.values(m.buttons)).not.toContain(12);
    expect(m.buttons.clutch).toBeUndefined();

    const out = readController(pad([0.5, 0, -1, 1], { 10: 1 }), m);
    expect(out.steer).toBeCloseTo(0.5 / 0.99 - 0.01 / 0.99, 2);
    expect(out.throttle).toBe(1);
    expect(out.brake).toBe(0);
    expect(out.clutch).toBeCloseTo(0.5, 6);
    expect(out.shifterGear).toBe(3);
    expect(readController(pad(rest), m).shifterGear).toBe(0);
  });

  it('can skip the clutch and shifter on a two-pedal wheel', () => {
    const rest = [0, 1, 1];
    const l = new WheelLearner();
    sweep(l, rest, 0, -1); // turned left instead of right: still learned, direction from the movement
    sweep(l, rest, 1, -1);
    sweep(l, rest, 2, -1);
    while (!l.done) l.skip();
    const m = finishWheel(l.mapping);
    expect(m.clutch).toBeNull();
    expect(m.shifter).toEqual({});
    expect(m.buttons.clutch).toBe(4);
    expect(readController(pad(rest), m).shifterGear).toBeNull();
  });

  it('ignores a small wobble on another axis', () => {
    const l = new WheelLearner();
    l.update(pad([0, 1, 1]));
    l.update(pad([0.2, 1, 1])); // wheel brushed
    l.update(pad([0.2, 1, 0])); // gas pressed half
    l.update(pad([0, 1, -1]));
    l.update(pad([0, 1, 1]));
    expect(l.mapping.steer).toMatchObject({ index: 2 });
  });
});

describe('tilt steering', () => {
  const G = 9.81;

  it('reads the phone held upright in landscape as level', () => {
    // Landscape (screen turned 90°), top of the screen up: gravity reads along the device's x axis.
    const s = gravityOnScreen(G, 0, 90);
    expect(s.x).toBeCloseTo(0, 6);
    expect(s.y).toBeCloseTo(G, 6);
    expect(screenRoll(G, 0, 90)).toBeCloseTo(0, 6);
  });

  it('turning the phone clockwise steers right, anticlockwise steers left', () => {
    const turn = (deg: number) => {
      // The phone turned clockwise by deg: "up" swings anticlockwise on the screen.
      const a = (deg * Math.PI) / 180;
      const sx = -Math.sin(a) * G;
      const sy = Math.cos(a) * G;
      // Back into device axes for a 90° landscape screen.
      const gx = sx * Math.cos(Math.PI / 2) + sy * Math.sin(Math.PI / 2);
      const gy = -sx * Math.sin(Math.PI / 2) + sy * Math.cos(Math.PI / 2);
      return screenRoll(gx, gy, 90);
    };
    expect(turn(20)).toBeCloseTo(20, 4);
    expect(turn(-15)).toBeCloseTo(-15, 4);
    expect(tiltSteer(turn(20), 0, 40)).toBeGreaterThan(0.45);
    expect(tiltSteer(turn(-40), 0, 40)).toBe(-1);
  });

  it('works the same in the other landscape and in portrait', () => {
    expect(screenRoll(-G, 0, 270)).toBeCloseTo(0, 6);
    expect(screenRoll(0, G, 0)).toBeCloseTo(0, 6);
  });

  it('steers relative to where the phone was held, with a small dead zone', () => {
    expect(tiltSteer(10, 10, 35)).toBe(0);
    expect(tiltSteer(10.5, 10, 35)).toBe(0);
    expect(tiltSteer(45, 10, 35)).toBe(1);
    expect(tiltSteer(-170, 175, 35)).toBeGreaterThan(0); // across the ±180° seam
    expect(tiltSteer(20, 0, 40, true)).toBeLessThan(0);
  });
});

describe('thumb stick steering', () => {
  it('is gentle near the centre and loses lock with speed', async () => {
    const { stickSteer } = await import('../controllerMap');
    expect(stickSteer(1, 0)).toBe(1);
    expect(stickSteer(-1, 0)).toBe(-1);
    expect(stickSteer(0.3, 0)).toBeLessThan(0.3);
    expect(stickSteer(1, 12)).toBeCloseTo(0.5, 6);
    expect(stickSteer(1, 25)).toBeLessThan(0.25);
  });
});

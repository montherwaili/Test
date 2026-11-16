import { describe, expect, it } from 'vitest';
import { SteeringWheelModel, WHEEL_LOCK } from '../steeringWheel';

/** Drag the finger round the hub from one angle to another (degrees, clockwise on screen) in small moves. */
function sweep(w: SteeringWheelModel, fromDeg: number, toDeg: number, radius = 60) {
  const steps = Math.ceil(Math.abs(toDeg - fromDeg) / 5);
  for (let i = 0; i <= steps; i++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180;
    const dx = Math.cos(a) * radius;
    const dy = Math.sin(a) * radius;
    if (i === 0) w.grab(dx, dy);
    else w.drag(dx, dy);
  }
}

describe('on-screen steering wheel', () => {
  it('turns right when dragged clockwise and left when dragged anticlockwise', () => {
    const w = new SteeringWheelModel();
    sweep(w, -90, 0); // from 12 o'clock to 3 o'clock
    expect(w.steer).toBeCloseTo(90 / 200, 3);
    w.release();
    const l = new SteeringWheelModel();
    sweep(l, -90, -180);
    expect(l.steer).toBeCloseTo(-90 / 200, 3);
  });

  it('follows the finger through the 180° seam without jumping', () => {
    const w = new SteeringWheelModel();
    sweep(w, 90, 270); // 6 o'clock, through 9 o'clock, to 12 o'clock: half a turn clockwise
    expect(w.angle).toBeCloseTo(Math.PI, 3);
  });

  it('stops at full lock however far it is dragged', () => {
    const w = new SteeringWheelModel();
    sweep(w, 0, 720);
    expect(w.steer).toBe(1);
    expect(w.angle).toBe(WHEEL_LOCK);
    sweep(w, 0, -1000);
    expect(w.steer).toBe(-1);
  });

  it('can be grabbed anywhere on the rim without the wheel jumping', () => {
    const w = new SteeringWheelModel();
    sweep(w, -90, -45);
    w.release();
    const before = w.angle;
    w.grab(-60, 0); // pick it up again on the opposite side
    expect(w.angle).toBe(before);
    w.drag(-60, -5);
    expect(Math.abs(w.angle - before)).toBeLessThan(0.1);
  });

  it('ignores touches right on the hub', () => {
    const w = new SteeringWheelModel();
    w.grab(50, 0);
    w.drag(1, 2);
    w.drag(-2, 1);
    expect(w.angle).toBe(0);
  });

  it('stays where it is left when the car is standing still', () => {
    const w = new SteeringWheelModel();
    sweep(w, -90, 30);
    w.release();
    const left = w.angle;
    for (let i = 0; i < 600; i++) w.update(1 / 60, 0);
    expect(w.angle).toBe(left);
    expect(w.active).toBe(true);
  });

  it('straightens itself when the car is rolling, faster at speed', () => {
    const slow = new SteeringWheelModel();
    sweep(slow, -90, 110);
    slow.release();
    const fast = new SteeringWheelModel();
    sweep(fast, -90, 110);
    fast.release();
    for (let i = 0; i < 30; i++) {
      slow.update(1 / 60, 1.5);
      fast.update(1 / 60, 10);
    }
    expect(slow.steer).toBeGreaterThan(fast.steer);
    expect(slow.steer).toBeLessThan(1);
    for (let i = 0; i < 600; i++) {
      slow.update(1 / 60, 1.5);
      fast.update(1 / 60, 10);
    }
    expect(slow.angle).toBe(0);
    expect(fast.angle).toBe(0);
    expect(fast.active).toBe(false);
  });

  it('does not straighten while it is being held', () => {
    const w = new SteeringWheelModel();
    sweep(w, -90, 0);
    const held = w.angle;
    for (let i = 0; i < 120; i++) w.update(1 / 60, 20);
    expect(w.angle).toBe(held);
  });
});

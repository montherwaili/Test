import { describe, expect, it } from 'vitest';
import { ReplayClock } from '../clock';
import { CAR_FIELDS, Recording, lerpAngle } from '../recording';

const layout = { traffic: 2, pedestrians: 1, loose: 1 };

function sampleRecording(): Recording {
  const r = new Recording(layout);
  for (let i = 0; i <= 10; i++) {
    const t = 10 + i * 0.05;
    r.addFrame(t, (w) => {
      w.car('x', i);
      w.car('z', -2 * i);
      w.car('qw', 1);
      w.car('rpm', 800 + 100 * i);
      w.car('gear', i < 5 ? 1 : 2);
      w.car('lights', i % 2);
      w.traffic(0, i, 0, 0, i < 5 ? 350 : 10, 0, i < 5 ? 1 : 2);
      w.traffic(1, 100, 0, 0, 90, 0, 0);
      w.pedestrian(0, i, 0, 0, i * 0.1, i < 8 ? 2 : 0);
      w.loose(0, 5, 0.25, 5, 0, 0, 0, 1);
    });
  }
  return r;
}

describe('recording frames', () => {
  it('reports its time span and size', () => {
    const r = sampleRecording();
    expect(r.frameCount).toBe(11);
    expect(r.start).toBe(10);
    expect(r.end).toBeCloseTo(10.5, 9);
    expect(r.stride).toBe(CAR_FIELDS.length + 2 * 6 + 5 + 7);
  });

  it('gives back exactly what was written at a frame time', () => {
    const r = sampleRecording();
    const f = r.sample(10.1);
    expect(f.car.x).toBeCloseTo(2, 5);
    expect(f.car.rpm).toBeCloseTo(1000, 3);
    expect(f.traffic[0]).toBeCloseTo(2, 5);
    expect(f.loose[3 + 3]).toBeCloseTo(1, 6);
  });

  it('glides between frames for smooth playback', () => {
    const r = sampleRecording();
    const f = r.sample(10.125); // half way between frames 2 and 3
    expect(f.car.x).toBeCloseTo(2.5, 5);
    expect(f.car.z).toBeCloseTo(-5, 5);
    expect(f.car.rpm).toBeCloseTo(1050, 3);
  });

  it('does not blend gears, lamps or flags: they switch at the frame', () => {
    const r = sampleRecording();
    expect(r.sample(10.24).car.gear).toBe(1);
    expect(r.sample(10.26).car.gear).toBe(2);
    expect(r.sample(10.125).car.lights).toBe(0);
    expect(r.sample(10.24).traffic[5]).toBe(1);
  });

  it('turns headings the short way round', () => {
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(360, 6);
    expect(lerpAngle(10, 350, 0.5)).toBeCloseTo(0, 6);
    const r = sampleRecording();
    const h = r.sample(10.225).traffic[3]!; // between 350 (frame 4) and 10 (frame 5)
    expect(((h % 360) + 360) % 360 > 355 || ((h % 360) + 360) % 360 < 5).toBe(true);
  });

  it('keeps a pedestrian from sliding back across the road when they reach the far side', () => {
    const r = sampleRecording();
    // Frame 7 (crossing) to frame 8 (idle on the far side): no in-between position.
    const f = r.sample(10.375);
    expect(f.pedestrians[0]).toBe(7);
    expect(f.pedestrians[4]).toBe(2);
  });

  it('holds the ends when asked for times outside the recording', () => {
    const r = sampleRecording();
    expect(r.sample(0).car.x).toBe(0);
    expect(r.sample(99).car.x).toBe(10);
  });

  it('refuses frames out of time order', () => {
    const r = sampleRecording();
    expect(() => r.addFrame(5, () => {})).toThrow();
  });

  it('stops growing at its time limit', () => {
    const r = new Recording({ traffic: 0, pedestrians: 0, loose: 0 }, 1);
    for (let i = 0; i < 100; i++) r.addFrame(i * 0.05, (w) => w.car('x', i));
    expect(r.duration).toBeCloseTo(1, 6);
    expect(r.full).toBe(true);
  });

  it('keeps a 15-minute test with traffic within a modest memory budget', () => {
    const r = new Recording({ traffic: 14, pedestrians: 8, loose: 0 });
    for (let i = 0; i < 15 * 60 * 20; i++) r.addFrame(i / 20, (w) => w.car('x', i));
    for (let i = 0; i < 15 * 60 * 120; i++) r.addInput(i / 120, 1 / 120, { throttle: 0.3, brake: 0, clutch: 0, steer: 0, handbrake: 0, gear: 2, ignition: 1, starter: 0 });
    expect(r.frameCount).toBe(18000);
    expect(r.inputCount).toBe(108000);
    expect(r.usedBytes / 1e6).toBeLessThan(20);
    // Arrays grow by doubling, so up to twice that may be reserved.
    expect(r.bytes / 1e6).toBeLessThan(40);
  });
});

describe('recording inputs', () => {
  it('stores every step and gives each back', () => {
    const r = new Recording(layout);
    for (let i = 0; i < 10; i++) {
      r.addInput(3 + i / 120, 1 / 120, { throttle: i / 10, brake: 0, clutch: 1 - i / 10, steer: -0.5, handbrake: 0, gear: 1, ignition: 1, starter: 0 });
    }
    expect(r.inputCount).toBe(10);
    expect(r.inputStart).toBe(3);
    expect(r.inputDt).toBeCloseTo(1 / 120, 9);
    expect(r.input(4)).toMatchObject({ throttle: expect.closeTo(0.4, 5), clutch: expect.closeTo(0.6, 5), gear: 1, steer: -0.5 });
  });
});

describe('replay clock', () => {
  it('plays at the chosen speed and stops at the end', () => {
    const c = new ReplayClock(0, 10);
    c.toggle();
    c.tick(2);
    expect(c.time).toBe(2);
    c.cycleSpeed(); // 1 -> 2x
    c.tick(2);
    expect(c.time).toBe(6);
    c.tick(10);
    expect(c.time).toBe(10);
    expect(c.playing).toBe(false);
  });

  it('starts again from the beginning when play is pressed at the end', () => {
    const c = new ReplayClock(5, 10);
    c.seek(10);
    c.toggle();
    expect(c.time).toBe(5);
    expect(c.playing).toBe(true);
  });

  it('keeps seeks and skips inside the recording', () => {
    const c = new ReplayClock(5, 10);
    c.seek(2);
    expect(c.time).toBe(5);
    c.skip(100);
    expect(c.time).toBe(10);
    expect(c.progress).toBe(1);
  });

  it('cycles through its speeds', () => {
    const c = new ReplayClock(0, 1);
    const seen = [];
    for (let i = 0; i < 5; i++) {
      c.cycleSpeed();
      seen.push(c.speed);
    }
    expect(seen).toEqual([2, 4, 0.25, 0.5, 1]);
  });
});

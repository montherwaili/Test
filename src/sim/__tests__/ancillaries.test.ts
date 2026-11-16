import { describe, expect, it } from 'vitest';
import { Ancillaries } from '../ancillaries';

const DT = 1 / 120;
function run(a: Ancillaries, seconds: number, steer: number | ((t: number) => number) = 0) {
  const events = [];
  for (let i = 0; i < Math.round(seconds * 120); i++) {
    events.push(...a.step(DT, typeof steer === 'function' ? steer(i * DT) : steer));
  }
  return events;
}

describe('indicators', () => {
  it('toggle on and off from the stalk', () => {
    const a = new Ancillaries();
    a.toggleIndicator('left');
    expect(a.state.indicator).toBe('left');
    a.toggleIndicator('left');
    expect(a.state.indicator).toBe('off');
    a.toggleIndicator('left');
    a.toggleIndicator('right');
    expect(a.state.indicator).toBe('right');
  });

  it('flash about 90 times a minute, starting lit', () => {
    const a = new Ancillaries();
    a.toggleIndicator('right');
    expect(a.lamps).toEqual({ left: false, right: true });
    let flashes = 0;
    let wasLit = true;
    for (let i = 0; i < 120 * 60; i++) {
      a.step(DT, 0);
      const lit = a.lamps.right;
      if (lit && !wasLit) flashes++;
      wasLit = lit;
      expect(a.lamps.left).toBe(false);
    }
    expect(flashes).toBeGreaterThanOrEqual(88);
    expect(flashes).toBeLessThanOrEqual(91);
  });

  it('hazards flash both sides together', () => {
    const a = new Ancillaries();
    a.toggleIndicator('hazard');
    expect(a.lamps).toEqual({ left: true, right: true });
    run(a, 0.4);
    expect(a.lamps).toEqual({ left: false, right: false });
  });

  it('cancel themselves when the wheel comes back after the turn', () => {
    const a = new Ancillaries();
    a.toggleIndicator('right');
    const events = run(a, 6, (t) => (t < 1 ? 0 : t < 4 ? 0.6 : 0));
    expect(a.state.indicator).toBe('off');
    expect(events).toContainEqual(expect.objectContaining({ type: 'indicator', mode: 'off', auto: true }));
  });

  it('stay on while waiting before the turn, and through a turn the other way', () => {
    const a = new Ancillaries();
    a.toggleIndicator('left');
    run(a, 5, 0);
    expect(a.state.indicator).toBe('left');
    run(a, 3, (t) => (t < 2 ? 0.6 : 0)); // steering right does not cancel a left signal
    expect(a.state.indicator).toBe('left');
  });

  it('hazards never self-cancel', () => {
    const a = new Ancillaries();
    a.toggleIndicator('hazard');
    run(a, 4, (t) => (t < 2 ? 0.8 : 0));
    expect(a.state.indicator).toBe('hazard');
  });

  it('record how long the signal has been on', () => {
    const a = new Ancillaries();
    run(a, 2);
    a.toggleIndicator('left');
    run(a, 3);
    expect(a.state.indicatorFor).toBeCloseTo(3, 5);
  });
});

describe('other controls', () => {
  it('cycles the headlights off, low, high', () => {
    const a = new Ancillaries();
    const seen = [];
    for (let i = 0; i < 4; i++) {
      a.cycleHeadlights();
      seen.push(a.state.headlights);
    }
    expect(seen).toEqual(['low', 'high', 'off', 'low']);
  });

  it('logs each change once, with the time', () => {
    const a = new Ancillaries();
    run(a, 1);
    a.toggleSeatbelt();
    a.setHorn(true);
    a.setHorn(true);
    a.glance('centre');
    const events = run(a, 0.1);
    expect(events.map((e) => e.type)).toEqual(['seatbelt', 'horn', 'mirror']);
    expect(events[0]!.time).toBeCloseTo(1, 5);
    expect(run(a, 0.1)).toEqual([]);
  });

  it('remembers when each mirror was last checked', () => {
    const a = new Ancillaries();
    expect(a.state.mirrorLeftAt).toBe(-Infinity);
    run(a, 2);
    a.glance('left');
    run(a, 1);
    a.glance('right');
    expect(a.state.mirrorLeftAt).toBeCloseTo(2, 5);
    expect(a.state.mirrorRightAt).toBeCloseTo(3, 5);
    expect(a.state.mirrorCentreAt).toBe(-Infinity);
  });
});

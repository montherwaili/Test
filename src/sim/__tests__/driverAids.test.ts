import { describe, expect, it } from 'vitest';
import { GearboxAssist, type GearboxMode } from '../driverAids';
import type { LongitudinalCar } from '../longitudinalCar';
import { DT, HZ, controls, eventTypes, idlingCar } from './helpers';

/** Drive with the assist between the "player" and the car. */
function run(mode: GearboxMode, seconds: number, player: (t: number, car: LongitudinalCar) => { selected: number; throttle: number; brake?: number }) {
  const car = idlingCar();
  const tune = car.tuning;
  const aid = new GearboxAssist(mode, { idleRpm: tune.engine.idleRpm, redlineRpm: tune.engine.redlineRpm, forwardGears: tune.gearbox.forward.length });
  const c = controls();
  const events: string[] = [];
  let maxGear = 0;
  for (let i = 0; i < Math.round(seconds * HZ); i++) {
    const t = i * DT;
    const p = player(t, car);
    const tel = car.telemetry;
    const out = aid.step(DT, { selected: p.selected, clutch: 0, throttle: p.throttle, rpm: tel.rpm, engaged: tel.gear, running: tel.running, speed: tel.speed });
    Object.assign(c, { gear: out.gear, clutch: out.clutch, throttle: out.throttle, brake: p.brake ?? 0 });
    events.push(...eventTypes(car.step(DT, c)));
    maxGear = Math.max(maxGear, car.telemetry.gear);
  }
  return { car, events, maxGear };
}

describe('gearbox help', () => {
  it('auto clutch: moves off in first without stalling or grinding', () => {
    const { car, events } = run('autoClutch', 6, () => ({ selected: 1, throttle: 0.35 }));
    expect(events).not.toContain('stall');
    expect(events).not.toContain('gearGrind');
    expect(car.telemetry.speed).toBeGreaterThan(3);
  });

  it('auto clutch: changes up when asked, smoothly, and the drive is taken up again', () => {
    const { car, events } = run('autoClutch', 12, (t) => ({ selected: t < 4 ? 1 : t < 8 ? 2 : 3, throttle: 0.5 }));
    expect(events.filter((e) => e === 'gearGrind')).toEqual([]);
    expect(events).not.toContain('stall');
    expect(car.telemetry.gear).toBe(3);
    expect(car.telemetry.clutchSlipRpm).toBeLessThan(50);
  });

  it('auto clutch: braking to a stop in gear does not stall the engine', () => {
    const { car, events } = run('autoClutch', 16, (t) => (t < 8 ? { selected: t < 4 ? 1 : 2, throttle: 0.5 } : { selected: 2, throttle: 0, brake: 0.6 }));
    expect(events).not.toContain('stall');
    expect(car.telemetry.running).toBe(true);
    expect(Math.abs(car.telemetry.speed)).toBeLessThan(0.3);
  });

  it('automatic: changes up by itself as the car gathers speed, and down again when it stops', () => {
    const r = run('automatic', 30, (t) => (t < 22 ? { selected: 1, throttle: 0.6 } : { selected: 1, throttle: 0, brake: 0.7 }));
    expect(r.events).not.toContain('stall');
    expect(r.events).not.toContain('gearGrind');
    expect(r.maxGear).toBeGreaterThanOrEqual(4);
    expect(r.car.telemetry.gear).toBe(1);
  });

  it('manual: passes the player straight through', () => {
    const aid = new GearboxAssist('manual', { idleRpm: 800, redlineRpm: 4500, forwardGears: 5 });
    expect(aid.step(DT, { selected: 3, clutch: 0.4, throttle: 0.2, rpm: 2000, engaged: 2, running: true, speed: 10 })).toEqual({ gear: 3, clutch: 0.4, throttle: 0.2 });
  });
});

import { afterAll, describe, expect, it } from 'vitest';
import { RULE_IDS, RuleBookError, loadRuleBook, validateRuleBook } from '../rules';
import raw from '../../data/rules.json';
import { Drive, net, raisedRules, signalTimeWhen } from './drive';

/** Signal right / left / off, keeping the indicator on as long as the script says. */
const GREEN_W = signalTimeWhen('C2', 'W', 'green');

/** Drive up a lane at `kmh` and stop with the front bumper `gap` m short of the line. */
function stopAtLine(d: Drive, kmh: number, gap: number, extra: Parameters<Drive['run']>[1] = {}): void {
  const patchOf = (t: number) => (typeof extra === 'function' ? extra(t, d) : extra);
  for (let i = 0; i < 2000 && d.toLine > gap; i++) {
    const v = Math.min(kmh / 3.6, Math.sqrt(2 * 2.5 * Math.max(0, d.toLine - gap)) + 0.05);
    d.run(1 / 30, (t) => ({ ...patchOf(t), speed: v }));
  }
  d.run(1.5, (t) => ({ ...patchOf(t), speed: 0 }));
}

describe('rule book', () => {
  it('defines every rule the examiner can raise, in Arabic and English', () => {
    const book = loadRuleBook();
    for (const id of RULE_IDS) {
      const r = book.rules.get(id)!;
      expect(r.title.ar).toMatch(/[؀-ۿ]/);
      expect(r.tip.ar).toMatch(/[؀-ۿ]/);
      expect(r.title.en.length).toBeGreaterThan(5);
      expect(['minor', 'serious', 'fail']).toContain(r.severity);
    }
  });

  it('marks every rule as not yet verified against the real test', () => {
    const book = loadRuleBook();
    expect([...book.rules.values()].every((r) => r.verified === false)).toBe(true);
    expect(book.scoring.verified).toBe(false);
  });

  it('rejects a broken rule book, listing every problem', () => {
    const bad = structuredClone(raw) as any;
    delete bad.rules.stall;
    bad.rules.redLight.severity = 'terrible';
    bad.rules.made_up = bad.rules.seatbelt;
    try {
      validateRuleBook(bad);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RuleBookError);
      expect((e as RuleBookError).problems).toHaveLength(3);
    }
  });
});

describe('in the car', () => {
  it('seatbelt: moving off unbelted is a fault, once', () => {
    const d = new Drive(['n1:f0']);
    d.run(1, { seatbelt: false });
    d.run(5, { seatbelt: false, speed: 5 });
    expect(d.faults()).toEqual(['seatbelt', 'mirrorsMoveOff'].filter((r) => r === 'seatbelt'));
  });

  it('seatbelt: fastened, no fault', () => {
    const d = new Drive(['n1:f0']);
    d.run(5, { speed: 5 });
    expect(d.faults()).not.toContain('seatbelt');
  });

  it('mirrors: moving off without a look is a fault; a look just before is not', () => {
    const d = new Drive(['n1:f0']);
    d.run(3);
    d.run(2, { speed: 3 });
    expect(d.faults()).toEqual(['mirrorsMoveOff']);

    const ok = new Drive(['n1:f0']);
    ok.run(2);
    ok.glance('centre');
    ok.run(1);
    ok.run(2, { speed: 3 });
    expect(ok.faults()).toEqual([]);
  });

  it('stall: each stall is a minor fault', () => {
    const d = new Drive(['n1:f0']);
    d.run(1, (t) => (t === 0 ? { events: ['stall'] } : {}));
    d.run(1, (t) => (t === 0 ? { events: ['stall'] } : {}));
    expect(d.faults()).toEqual(['stall', 'stall']);
    expect(d.ex.faults[0]!.severity).toBe('minor');
  });

  it('rollback: rolling back more than 30 cm without reverse is a fault', () => {
    const d = new Drive(['w1:f0'], 30);
    d.run(2, { speed: -0.2 }); // 40 cm
    expect(d.faults()).toEqual(['rollback']);
    expect(d.ex.faults[0]!.detail).toBe('0.31 m');

    const little = new Drive(['w1:f0'], 30);
    little.run(1, { speed: -0.2 }); // 20 cm
    expect(little.faults()).toEqual([]);

    const reversing = new Drive(['w1:f0'], 30);
    reversing.run(3, { speed: -1, gear: -1 });
    expect(reversing.faults()).toEqual([]);
  });

  it('collision: hitting a car, a person or a building fails at once', () => {
    for (const what of ['trafficCar', 'pedestrian', 'building'] as const) {
      const d = new Drive(['n1:f0']);
      d.run(0.5, (t) => (t === 0 ? { contacts: [what] } : {}));
      expect(d.faults()).toEqual(['collision']);
      expect(d.ex.faults[0]!.severity).toBe('fail');
      expect(d.ex.faults[0]!.detail).toBe(what);
    }
  });

  it('poles: touching one is serious, and one touch is one fault', () => {
    const d = new Drive(['n1:f0']);
    d.run(1, (t) => (t < 0.2 ? { contacts: ['pole'] } : {}));
    expect(d.faults()).toEqual(['touchPole']);
    expect(d.ex.faults[0]!.severity).toBe('serious');
  });

  it('kerbs: a tyre touching is minor; driving along on it is serious', () => {
    const touch = new Drive(['n1:f0']);
    touch.run(0.2, { wheelsOnKerb: 1, speed: 2 });
    touch.run(1, { wheelsOnKerb: 0, speed: 2 });
    expect(touch.faults()).toEqual(['touchKerb']);

    const mount = new Drive(['n1:f0']);
    mount.run(2, { wheelsOnKerb: 2, speed: 2 });
    expect(mount.faults()).toEqual(['touchKerb', 'mountKerb']);
  });
});

describe('on the road', () => {
  it('speeding: a little over for a while is minor, well over is serious, at the limit is fine', () => {
    const at = new Drive(['av1:f0']);
    at.run(8, { speed: 60 / 3.6 - 0.01 });
    expect(at.faults()).toEqual([]);

    const over = new Drive(['av1:f0']);
    over.run(5, { speed: 66 / 3.6 });
    expect(over.faults()).toEqual(['speeding']);
    expect(over.ex.faults[0]!.detail).toBe('66/60');

    const wellOver = new Drive(['av1:f0']);
    wellOver.run(4, { speed: 75 / 3.6 });
    expect(wellOver.faults()).toEqual(['speedingSerious']);
  });

  it('lane discipline: riding over the lane line is a fault; signalling for a change is not', () => {
    const d = new Drive(['av1:f0']);
    d.run(5, { speed: 12, lateral: -1.3 });
    expect(d.faults()).toEqual(['laneStraddle']);

    const ok = new Drive(['av1:f0']);
    ok.run(5, { speed: 12, lateral: -1.3, indicator: 'left' });
    expect(ok.faults()).toEqual([]);
  });

  it('lane change: without a signal and mirror check it is a fault', () => {
    const d = new Drive(['av1:f0']);
    d.run(3, { speed: 12 });
    d.run(3, (t) => ({ lateral: -Math.min(3.5, (t / 2) * 3.5) }));
    expect(d.faults()).toEqual(['indicatorLaneChange', 'mirrorsTurn']);
  });

  it('lane change: mirror, signal, then move over is fine', () => {
    const d = new Drive(['av1:f0']);
    d.run(1, { speed: 12 });
    d.glance('centre');
    d.run(2, { indicator: 'left' });
    d.run(3, (t) => ({ indicator: 'left', lateral: -Math.min(3.5, (t / 2) * 3.5) }));
    expect(d.faults()).toEqual([]);
  });

  it('wrong side: driving against the traffic fails', () => {
    const d = new Drive(['av1:b0'], 120);
    d.wrongWay = true;
    d.run(3, { speed: 8 });
    expect(d.faults()).toEqual(['wrongSide']);
  });

  it('following distance: under a second behind for a while is a fault', () => {
    const lane = net.lane('av1:f0');
    const close = new Drive(['av1:f0']);
    close.run(5, (_t, d) => ({ speed: 14, others: [{ id: 1, x: 0, z: 0, headingDeg: 90, speed: 14, accel: 0, length: 4.2, lane: lane.id, s: d.s + 9 }] }));
    expect(close.faults()).toEqual(['followingDistance']);

    const far = new Drive(['av1:f0']);
    far.run(5, (_t, d) => ({ speed: 14, others: [{ id: 1, x: 0, z: 0, headingDeg: 90, speed: 14, accel: 0, length: 4.2, lane: lane.id, s: d.s + 40 }] }));
    expect(far.faults()).toEqual([]);
  });

  it('pedestrians: driving over a crossing someone is walking on is a fault', () => {
    const index = net.crossings.findIndex((c) => c.id.startsWith('n1:'));
    const occupied = (state: number) => {
      const crossings = net.crossings.map(() => 0);
      crossings[index] = state;
      return crossings;
    };
    const d = new Drive(['n1:f0']);
    d.run(10, { speed: 8, crossings: occupied(2) });
    expect(d.faults()).toEqual(['giveWayPedestrians']);

    // Someone only waiting at the kerb (they wait when a car is too close to stop): not a fault.
    const waiting = new Drive(['n1:f0']);
    waiting.run(10, { speed: 8, crossings: occupied(1) });
    expect(waiting.faults()).toEqual([]);
  });
});

describe('junctions', () => {
  const rightAtC2 = () => ['av2:f0', 'C2:W0>S0', 'e2:f0'];
  const straightAtC2 = () => ['av2:f0', 'C2:W0>E0', 'pk:f0'];

  it('turning: signal on in good time and a mirror check is fine', () => {
    const d = new Drive(rightAtC2(), 20);
    d.glance('right');
    d.run(4, { speed: 8, signalTime: GREEN_W, indicator: 'right' });
    d.glance('right');
    d.until('e2:f0', { speed: 8, signalTime: GREEN_W, indicator: 'right' });
    d.run(1, { speed: 8, signalTime: GREEN_W, indicator: 'off' });
    expect(d.faults()).toEqual([]);
  });

  it('turning without a signal is a fault, and so is signalling the wrong way', () => {
    const none = new Drive(rightAtC2(), 20);
    none.until('e2:f0', (_t, dd) => (dd.toLine < 20 && dd.glance('right'), { speed: 8, signalTime: GREEN_W }));
    none.run(1);
    expect(none.faults()).toEqual(['indicatorTurn']);
    expect(none.ex.faults[0]!.detail).toBe('right');

    const wrong = new Drive(rightAtC2(), 20);
    wrong.until('e2:f0', (_t, dd) => (dd.toLine < 20 && dd.glance('right'), { speed: 8, signalTime: GREEN_W, indicator: 'left' }));
    wrong.run(1);
    expect(wrong.faults()).toEqual(['indicatorTurn']);
  });

  it('turning: signalling at the last moment counts as not signalling', () => {
    const d = new Drive(rightAtC2(), 20);
    d.until('e2:f0', (_t, dd) => (dd.toLine < 20 && dd.glance('right'), { speed: 8, signalTime: GREEN_W, indicator: dd.toLine < 4 ? 'right' : 'off' }));
    expect(d.faults()).toEqual(['indicatorTurn']);
  });

  it('turning without checking the mirror is a fault', () => {
    const d = new Drive(rightAtC2(), 20);
    d.until('e2:f0', { speed: 8, signalTime: GREEN_W, indicator: 'right' });
    expect(d.faults()).toEqual(['mirrorsTurn']);
  });

  it('going straight on needs no signal', () => {
    const d = new Drive(straightAtC2(), 20);
    d.until('pk:f0', { speed: 8, signalTime: GREEN_W });
    d.run(1);
    expect(d.faults()).toEqual([]);
  });

  it('a bend in the road needs no signal', () => {
    const d = new Drive(['n1:b0', 'A1:E0>S0', 'w1:f0'], 60);
    d.until('w1:f0', { speed: 8 });
    d.run(1);
    expect(d.faults()).toEqual([]);
  });

  it('red light: crossing the line on red fails; on green it does not', () => {
    const red = new Drive(straightAtC2(), 20);
    red.until('C2:W0>E0', { speed: 10, signalTime: signalTimeWhen('C2', 'W', 'red', 2) });
    expect(red.faults()).toEqual(['redLight']);
    expect(red.ex.faults[0]!.severity).toBe('fail');

    const green = new Drive(straightAtC2(), 20);
    green.until('C2:W0>E0', { speed: 10, signalTime: GREEN_W });
    expect(green.faults()).toEqual([]);
  });

  it('amber: going through well into the amber is a fault; just as it changes is not', () => {
    const late = new Drive(straightAtC2(), 20);
    late.until('C2:W0>E0', { speed: 10, signalTime: signalTimeWhen('C2', 'W', 'amber', 2.5) });
    expect(late.faults()).toEqual(['amberLight']);

    const justChanged = new Drive(straightAtC2(), 20);
    justChanged.until('C2:W0>E0', { speed: 10, signalTime: signalTimeWhen('C2', 'W', 'amber', 0.3) });
    expect(justChanged.faults()).toEqual([]);
  });

  it('stop sign: rolling through fails; a full stop is fine', () => {
    const route = () => ['c2:f0', 'B3:N0>W0', 's1:b0'];
    const rolling = new Drive(route(), 40);
    rolling.until('s1:b0', { speed: 3, indicator: 'right' });
    expect(rolling.faults()).toContain('stopSign');

    const stopped = new Drive(route(), 40);
    stopped.glance('right');
    stopAtLine(stopped, 25, 0.5, { indicator: 'right' });
    stopped.glance('right');
    stopped.until('s1:b0', { speed: 4, indicator: 'right' });
    expect(stopped.faults()).toEqual([]);
  });

  it('T-junction: pulling out in front of main road traffic is a fault', () => {
    const mainRoad = (t: number) => {
      const lane = net.lane('s2:b0');
      const s = lane.path.length - 12 + t * 9;
      const p = lane.path.pointAt(Math.min(s, lane.path.length));
      return [{ id: 7, x: p.x, z: p.z, headingDeg: 270, speed: 9, accel: 0, length: 4.2, lane: 's2:b0', s }];
    };
    const d = new Drive(['c2:f0', 'B3:N0>W0', 's1:b0'], 40);
    d.glance('right');
    stopAtLine(d, 25, 0.5, { indicator: 'right' });
    d.glance('right');
    d.until('s1:b0', (t) => ({ speed: 4, indicator: 'right', others: mainRoad(t) }));
    d.run(1);
    expect(d.faults()).toEqual(['giveWayJunction']);
  });

  it('T-junction: making a main road car brake hard is a fault even if it was not close yet', () => {
    const d = new Drive(['c2:f0', 'B3:N0>W0', 's1:b0'], 40);
    d.glance('right');
    stopAtLine(d, 25, 0.5, { indicator: 'right' });
    d.glance('right');
    const lane = net.lane('s2:b0');
    d.until('s1:b0', (t) => ({
      speed: 4,
      indicator: 'right',
      others: [{ id: 8, x: lane.path.pointAt(5).x, z: lane.path.pointAt(5).z, headingDeg: 270, speed: 3, accel: t > 0.5 ? -5 : 0, length: 4.2, lane: 's2:b0', s: 5 }],
    }));
    expect(d.faults()).toEqual(['giveWayJunction']);
  });
});

describe('roundabouts', () => {
  const route = () => net.route('c1:b0', 'n2:f0')!;

  it('needs no signal to go in, and a right signal to come out', () => {
    const d = new Drive(route(), 40);
    d.run(30, (_t, dd) => ({ speed: 7, indicator: net.lane(dd.lane).kind === 'roundabout' ? 'right' : 'off' }));
    expect(d.lane).toBe('n2:f0');
    expect(d.faults()).toEqual([]);
  });

  it('leaving without a signal is a fault', () => {
    const d = new Drive(route(), 40);
    d.run(30, { speed: 7 });
    expect(d.lane).toBe('n2:f0');
    expect(d.faults()).toEqual(['indicatorRoundaboutExit']);
  });

  it('going in in front of a car already on the roundabout is a fault', () => {
    const r = route();
    const entry = net.lane(r[1]!);
    const ring = net.lane(entry.yieldTo[0]!);
    const other = (t: number) => {
      const s = Math.min(ring.path.length, ring.path.length - 9 + t * 6);
      const p = ring.path.pointAt(s);
      return [{ id: 3, x: p.x, z: p.z, headingDeg: headingAt(ring.id, s), speed: 6, accel: 0, length: 4.2, lane: ring.id, s }];
    };
    const d = new Drive(r, net.lane(r[0]!).path.length - 9);
    d.run(8, (t, dd) => ({ speed: 6, others: other(t), indicator: net.lane(dd.lane).kind === 'roundabout' ? 'right' : 'off' }));
    expect(d.faults()).toEqual(['giveWayRoundabout']);
  });

  it('going in behind it, once it has passed, is fine', () => {
    const r = route();
    const entry = net.lane(r[1]!);
    const ring = net.lane(entry.yieldTo[0]!);
    const d = new Drive(r, net.lane(r[0]!).path.length - 9);
    const passed = [{ id: 3, x: 0, z: 0, headingDeg: 0, speed: 6, accel: 0, length: 4.2, lane: ring.next[0]!, s: 8 }];
    d.run(8, (_t, dd) => ({ speed: 6, others: passed, indicator: net.lane(dd.lane).kind === 'roundabout' ? 'right' : 'off' }));
    expect(d.faults()).toEqual([]);
  });
});

function headingAt(laneId: string, s: number): number {
  const d = net.lane(laneId).path.directionAt(s);
  return (Math.atan2(d.x, -d.z) * 180) / Math.PI;
}

describe('the verdict', () => {
  it('passes with a few minor faults, fails on too many, on one serious, or on one fail', () => {
    const book = loadRuleBook();
    const verdict = (faults: string[]) => {
      const d = new Drive(['n1:f0']);
      faults.forEach((rule, i) => d.ex.faults.push({ rule: rule as never, severity: book.rules.get(rule)!.severity, time: i, x: 0, z: 0 }));
      return d.ex.result();
    };
    expect(verdict([]).passed).toBe(true);
    expect(verdict(Array(book.scoring.maxMinor).fill('stall')).passed).toBe(true);
    expect(verdict(Array(book.scoring.maxMinor + 1).fill('stall')).passed).toBe(false);
    expect(verdict(['rollback']).passed).toBe(false);
    expect(verdict(['redLight']).passed).toBe(false);
    const r = verdict(['stall', 'rollback', 'redLight']);
    expect([r.minor, r.serious, r.fail]).toEqual([1, 1, 1]);
  });

  it('records where and when each fault happened', () => {
    const d = new Drive(['n1:f0']);
    d.run(2, { speed: 5 });
    d.run(0.1, { events: ['stall'] });
    const f = d.ex.faults.find((x) => x.rule === 'stall')!;
    expect(f.time).toBeCloseTo(2, 1);
    const at = net.lane('n1:f0').path.pointAt(5 + 2 * 5);
    expect(Math.hypot(f.x - at.x, f.z - at.z)).toBeLessThan(0.5);
  });
});

afterAll(() => {
  // Yard rules are covered in yard.test.ts.
  const yard = ['bayNotInside', 'manoeuvreTime', 'manoeuvreAbandoned', 'hillStartLine', 'stopLineAccuracy', 'stopLineOvershoot'];
  const missing = RULE_IDS.filter((id) => !yard.includes(id) && !raisedRules.has(id));
  expect(missing, 'rules with no test that raises them').toEqual([]);
});

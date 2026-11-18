import { describe, expect, it } from 'vitest';
import yardJson from '../../data/maps/yard.json';
import { planRoute } from '../../examiner/route';
import type { Observation } from '../../examiner/observation';
import { Manoeuvre, type ManoeuvreDef } from '../../examiner/yard';
import { net, CAR } from '../../examiner/__tests__/drive';
import { LessonRunner, loadLessons, type LessonDef, type LessonEvent, type LessonObservation } from '../lesson';
import { RULE_SKILL, emptyProgress, parseProgress, recommend, recordFaults, recordLesson, recordTest } from '../progress';
import { RULE_IDS } from '../../examiner/rules';

const lessons = loadLessons();

function obs(patch: Partial<LessonObservation> = {}): LessonObservation {
  return {
    time: 0, dt: 1 / 30, signalTime: 0, x: 0, z: 0, headingDeg: 0, speed: 0, gear: 0, handbrake: true, seatbelt: false,
    indicator: 'off', indicatorFor: 0, mirrorLeftAt: -Infinity, mirrorCentreAt: -Infinity, mirrorRightAt: -Infinity,
    wheelsOnKerb: 0, contacts: [], events: [], others: [], crossings: [], running: false,
    ...patch,
  };
}

/** Run a lesson over a list of observation patches, one step each (time advances). */
function feed(r: LessonRunner, patches: Partial<LessonObservation>[], from = 0) {
  const events: LessonEvent[] = [];
  patches.forEach((p, i) => events.push(...r.step(obs({ time: from + i / 30, ...p }))));
  return events;
}

const lesson = (id: string) => lessons.find((l) => l.id === id)!;

describe('the lessons file', () => {
  it('has the seven lessons, each with goals and both languages', () => {
    expect(lessons.map((l) => l.id)).toEqual(['controls', 'movingOff', 'gears', 'roundabouts', 'hillStart', 'parking', 'fullRoute']);
    for (const l of lessons) {
      expect(l.goals.length).toBeGreaterThan(0);
      for (const text of [l.title, l.intro, ...l.goals.flatMap((g) => [g.text, g.hint])]) {
        expect(text.ar).toMatch(/[؀-ۿ]/);
        expect(text.en.length).toBeGreaterThan(3);
      }
    }
  });

  it('refers only to lanes and exercises that exist', () => {
    const yardIds = (yardJson.manoeuvres as ManoeuvreDef[]).map((m) => m.id);
    for (const l of lessons) {
      if ('lane' in l.start) expect(() => net.lane((l.start as { lane: string }).lane)).not.toThrow();
      for (const g of l.goals) if (g.type === 'manoeuvre') expect(yardIds, `${l.id}: ${g.id}`).toContain(g.id);
      if (l.goals.some((g) => g.type === 'manoeuvre')) expect(l.map).toBe('yard');
      if (l.route) {
        expect(l.map).toBe('town');
        const start = (l.start as { lane: string }).lane;
        expect(() => planRoute(net, start, l.route!.checkpoints)).not.toThrow();
      }
      if (l.goals.some((g) => g.type === 'route')) expect(l.route).toBeDefined();
    }
  });

  it('gives every examiner rule a skill, and every skill a lesson', () => {
    for (const id of RULE_IDS) expect(RULE_SKILL[id], id).toBeDefined();
    const skills = new Set(lessons.map((l) => l.skill));
    for (const skill of new Set(Object.values(RULE_SKILL))) expect(skills.has(skill), skill).toBe(true);
  });
});

describe('lesson goals', () => {
  it('controls: belt, engine, three mirrors, both indicators, in order', () => {
    const r = new LessonRunner(lesson('controls'));
    expect(r.goal!.type).toBe('seatbelt');
    // Starting the engine first does not count until its turn comes.
    feed(r, [{ running: true }]);
    expect(r.current).toBe(0);
    const ev = feed(r, [{ seatbelt: true, running: true }], 1);
    // Belt done, and the engine was already running: both goals tick at once.
    expect(ev.map((e) => e.type)).toEqual(['goal', 'goal']);
    expect(r.goal!.type).toBe('mirrors');
    feed(r, [{ seatbelt: true, running: true, mirrorLeftAt: 2, mirrorCentreAt: 2 }], 2);
    expect(r.goal!.type).toBe('mirrors');
    feed(r, [{ seatbelt: true, running: true, mirrorLeftAt: 2, mirrorCentreAt: 2, mirrorRightAt: 3 }], 3);
    expect(r.goal!.type).toBe('indicators');
    feed(r, [{ indicator: 'left' }, { indicator: 'off' }], 4);
    expect(r.complete).toBe(false);
    const done = feed(r, [{ indicator: 'right' }], 5);
    expect(done.map((e) => e.type)).toEqual(['goal', 'complete']);
    expect(r.complete).toBe(true);
  });

  it('moving off: engine with belt, first gear, handbrake off, 8 km/h, then the stop line', () => {
    const yard = (yardJson.manoeuvres as ManoeuvreDef[]).map((d) => new Manoeuvre(d, CAR, () => ({})));
    const r = new LessonRunner(lesson('movingOff'), yard);
    feed(r, [{ running: true }]);
    expect(r.current).toBe(0); // no belt yet
    feed(r, [{ running: true, seatbelt: true, gear: 1 }]);
    expect(r.goal!.type).toBe('handbrake');
    feed(r, [{ running: true, seatbelt: true, gear: 1, handbrake: false, speed: 1 }]);
    expect(r.goal!.type).toBe('reachSpeed');
    feed(r, [{ speed: 2.5, gear: 1 }]);
    expect(r.goal!.type).toBe('manoeuvre');
    yard.find((m) => m.def.id === 'stopLine')!.state = 'done';
    expect(feed(r, [{}]).map((e) => e.type)).toEqual(['goal', 'complete']);
  });

  it('gears: each gear has to be used while moving', () => {
    const r = new LessonRunner(lesson('gears'));
    feed(r, [{ gear: 1, speed: 0 }, { gear: 2, speed: 0 }, { gear: 3, speed: 0 }]);
    expect(r.current).toBe(0);
    feed(r, [{ gear: 1, speed: 3 }, { gear: 2, speed: 5 }]);
    expect(r.current).toBe(0);
    feed(r, [{ gear: 3, speed: 7 }]);
    expect(r.goal!.type).toBe('reachSpeed');
    feed(r, [{ gear: 3, speed: 8.4 }, { gear: 3, speed: 8.4 }]);
    expect(r.goal!.type).toBe('stop');
    // A moment at rest is not yet a stop; a second is.
    feed(r, Array(20).fill({ speed: 0 }), 10);
    expect(r.complete).toBe(false);
    feed(r, Array(15).fill({ speed: 0 }), 11);
    expect(r.complete).toBe(true);
  });

  it('route lessons finish when the route does', () => {
    const route = { finished: false } as unknown as import('../../examiner/route').RouteGuide;
    const r = new LessonRunner(lesson('roundabouts'), [], route);
    feed(r, [{}]);
    expect(r.complete).toBe(false);
    (route as { finished: boolean }).finished = true;
    feed(r, [{}]);
    expect(r.complete).toBe(true);
  });
});

describe('stars', () => {
  const finished = (def: LessonDef, seconds: number) => {
    const r = new LessonRunner(def);
    r.step(obs({ time: 0, seatbelt: true }));
    r.step(obs({ time: seconds, seatbelt: true, running: true, mirrorLeftAt: 1, mirrorCentreAt: 1, mirrorRightAt: 1, indicator: 'left' }));
    r.step(obs({ time: seconds, seatbelt: true, running: true, mirrorLeftAt: 1, mirrorCentreAt: 1, mirrorRightAt: 1, indicator: 'right' }));
    expect(r.complete).toBe(true);
    return r;
  };

  it('three for a clean lesson, two for a few minor faults, one otherwise', () => {
    const r = finished(lesson('controls'), 20);
    expect(r.stars({ minor: 0, serious: 0, fail: 0 })).toBe(3);
    expect(r.stars({ minor: 2, serious: 0, fail: 0 })).toBe(2);
    expect(r.stars({ minor: 3, serious: 0, fail: 0 })).toBe(1);
    expect(r.stars({ minor: 0, serious: 1, fail: 0 })).toBe(1);
  });

  it('three stars need the target time, where a lesson sets one', () => {
    const quick = finished({ ...lesson('controls'), targetS: 30 }, 20);
    expect(quick.stars({ minor: 0, serious: 0, fail: 0 })).toBe(3);
    const slow = finished({ ...lesson('controls'), targetS: 30 }, 45);
    expect(slow.stars({ minor: 0, serious: 0, fail: 0 })).toBe(2);
  });

  it('none for an unfinished lesson', () => {
    expect(new LessonRunner(lesson('controls')).stars({ minor: 0, serious: 0, fail: 0 })).toBe(0);
  });
});

describe('progress and adaptive practice', () => {
  it('suggests the lesson for the skill with the most faults', () => {
    const p = emptyProgress();
    recordFaults(p, [
      { rule: 'stall', severity: 'minor' },
      { rule: 'stall', severity: 'minor' },
      { rule: 'rollback', severity: 'serious' },
    ]);
    expect(recommend(p, lessons)).toBe('hillStart'); // one serious (3) outweighs two minor (2)
    recordFaults(p, [{ rule: 'giveWayRoundabout', severity: 'serious' }, { rule: 'indicatorRoundaboutExit', severity: 'minor' }]);
    expect(recommend(p, lessons)).toBe('roundabouts');
  });

  it('lets old mistakes fade, and mastering a lesson knocks its skill down', () => {
    const p = emptyProgress();
    recordFaults(p, [{ rule: 'touchPole', severity: 'serious' }]);
    expect(recommend(p, lessons)).toBe('parking');
    recordLesson(p, 'parking', 'parking', 3);
    recordFaults(p, [{ rule: 'stall', severity: 'minor' }, { rule: 'stall', severity: 'minor' }]);
    expect(recommend(p, lessons)).toBe('movingOff');
  });

  it('with no faults on record, suggests the first lesson not yet mastered', () => {
    const p = emptyProgress();
    expect(recommend(p, lessons)).toBe('controls');
    recordLesson(p, 'controls', 'observation', 3);
    recordLesson(p, 'movingOff', 'movingOff', 2);
    expect(recommend(p, lessons)).toBe('movingOff');
    expect(p.stars).toEqual({ controls: 3, movingOff: 2 });
    recordLesson(p, 'movingOff', 'movingOff', 1);
    expect(p.stars['movingOff']).toBe(2); // best is kept
  });

  it('counts tests, and survives being saved and loaded', () => {
    const p = emptyProgress();
    recordTest(p, false);
    recordTest(p, true);
    recordFaults(p, [{ rule: 'redLight', severity: 'fail' }]);
    recordLesson(p, 'gears', 'gears', 2);
    const back = parseProgress(JSON.parse(JSON.stringify(p)));
    expect(back).toEqual(p);
  });

  it('ignores damaged saved data instead of crashing', () => {
    expect(parseProgress('nonsense')).toEqual(emptyProgress());
    const odd = parseProgress({ stars: { controls: 9, gears: -1, x: 'a' }, skills: { parking: NaN }, tests: { taken: 2, passed: 5 } });
    expect(odd.stars).toEqual({ controls: 3 });
    expect(odd.skills).toEqual({});
    expect(odd.tests).toEqual({ taken: 2, passed: 2 });
  });
});

void ({} as Observation);

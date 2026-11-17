import { afterAll, describe, expect, it } from 'vitest';
import yardJson from '../../data/maps/yard.json';
import { Examiner } from '../examiner';
import type { Observation } from '../observation';
import { loadRuleBook } from '../rules';
import { footprint, inRect, type ManoeuvreDef } from '../yard';
import { CAR, DT, raisedRules } from './drive';

const manoeuvres = yardJson.manoeuvres as ManoeuvreDef[];
const byId = (id: string) => manoeuvres.find((m) => m.id === id)!;

/** A car driven by hand on an empty yard: poses and controls straight from the script. */
class YardDrive {
  readonly ex = new Examiner(loadRuleBook(), null, CAR, manoeuvres);
  o: Observation = {
    time: 0,
    dt: DT,
    signalTime: 0,
    x: 0,
    z: 30,
    headingDeg: 0,
    speed: 0,
    gear: 1,
    handbrake: false,
    seatbelt: true,
    indicator: 'off',
    indicatorFor: 0,
    mirrorLeftAt: 0,
    mirrorCentreAt: 0,
    mirrorRightAt: 0,
    wheelsOnKerb: 0,
    contacts: [],
    events: [],
    others: [],
    crossings: [],
  };

  /** Move in a straight line to (x, z) facing `headingDeg` over `seconds`, then hold still for `rest`. */
  go(x: number, z: number, headingDeg: number, seconds: number, rest = 0, extra: Partial<Observation> = {}): void {
    // A careful driver checks the mirror before every move.
    this.o.mirrorCentreAt = this.o.time;
    const steps = Math.max(1, Math.round(seconds / DT));
    const x0 = this.o.x;
    const z0 = this.o.z;
    const dist = Math.hypot(x - x0, z - z0);
    // Forwards if heading towards the target, backwards otherwise.
    const a = (headingDeg * Math.PI) / 180;
    const ahead = (x - x0) * Math.sin(a) - (z - z0) * Math.cos(a) >= 0;
    for (let i = 1; i <= steps; i++) {
      this.step({ ...extra, x: x0 + ((x - x0) * i) / steps, z: z0 + ((z - z0) * i) / steps, headingDeg, speed: ((ahead ? 1 : -1) * dist) / seconds });
    }
    for (let i = 0; i < Math.round(rest / DT); i++) this.step({ ...extra, speed: 0 });
  }

  step(p: Partial<Observation>): void {
    Object.assign(this.o, p);
    for (const f of this.ex.step(this.o)) raisedRules.add(f.rule);
    this.o.time += DT;
    this.o.contacts = [];
  }

  faults(): string[] {
    return this.ex.faults.map((f) => f.rule);
  }

  result(id: string) {
    return this.ex.manoeuvres.find((m) => m.def.id === id)!.result;
  }
}

/** Front bumper `past` m beyond a north-facing line at z = lineZ: the car's centre z. */
const centreFor = (lineZ: number, past: number) => lineZ - past + CAR.front;

describe('yard geometry', () => {
  it('puts each bay inside its zone, and the poles at the bay corners', () => {
    for (const m of manoeuvres) {
      if (m.type !== 'bay') continue;
      const { center, size } = m.bay;
      for (const [x, z] of [[center[0] - size[0] / 2, center[1] - size[1] / 2], [center[0] + size[0] / 2, center[1] + size[1] / 2]] as const) {
        expect(inRect(m.zone, x, z)).toBe(true);
      }
    }
    const poles = yardJson.solids.filter((s) => s.kind === 'pole').map((s) => [s.center[0]!, s.center[2]!] as const);
    const bay = byId('reverseBay') as Extract<ManoeuvreDef, { type: 'bay' }>;
    expect(poles.filter(([x, z]) => Math.abs(Math.abs(x - bay.bay.center[0]) - 1.4) < 0.01 && Math.abs(Math.abs(z - bay.bay.center[1]) - 2.75) < 0.01)).toHaveLength(4);
  });

  it('fits the car in each bay with room to spare', () => {
    for (const m of manoeuvres) {
      if (m.type !== 'bay') continue;
      const corners = footprint({ x: m.bay.center[0], z: m.bay.center[1] + (CAR.front - CAR.rear) / 2, headingDeg: m.bay.headingDeg }, CAR);
      expect(corners.every(([x, z]) => inRect(m.bay, x, z, -0.25))).toBe(true);
    }
  });
});

describe('stop at the line', () => {
  it('stopping right on the line passes', () => {
    const d = new YardDrive();
    d.go(-25, 15, 0, 3);
    d.go(-25, centreFor(-10, 0.2), 0, 6, 2);
    expect(d.faults()).toEqual([]);
    expect(d.result('stopLine')).toMatchObject({ ok: true });
  });

  it('stopping short of the line is a minor fault', () => {
    const d = new YardDrive();
    d.go(-25, 15, 0, 3);
    d.go(-25, centreFor(-10, -0.9), 0, 6, 2);
    expect(d.faults()).toEqual(['stopLineAccuracy']);
    expect(d.result('stopLine')).toMatchObject({ ok: false });
  });

  it('stopping well past it is serious', () => {
    const d = new YardDrive();
    d.go(-25, 15, 0, 3);
    d.go(-25, centreFor(-10, 1.6), 0, 6, 2);
    expect(d.faults()).toEqual(['stopLineOvershoot']);
  });

  it('driving through without stopping does not start the exercise', () => {
    const d = new YardDrive();
    d.go(-25, 15, 0, 3);
    d.go(-25, -40, 0, 6);
    expect(d.faults()).toEqual([]);
    expect(d.result('stopLine')).toBeNull();
  });
});

describe('hill start', () => {
  it('stopping at the line and pulling away passes', () => {
    const d = new YardDrive();
    d.go(-8, 15, 0, 3);
    d.go(-8, centreFor(-5, -0.4), 0, 5, 2, { handbrake: true });
    d.go(-8, centreFor(-5, 8), 0, 4);
    expect(d.faults()).toEqual([]);
    expect(d.result('hillStart')).toMatchObject({ ok: true });
  });

  it('stopping far short of the line is a minor fault', () => {
    const d = new YardDrive();
    d.go(-8, 15, 0, 3);
    d.go(-8, centreFor(-5, -3), 0, 4, 2);
    d.go(-8, centreFor(-5, 8), 0, 4);
    expect(d.faults()).toEqual(['hillStartLine']);
  });

  it('rolling back on the hill is caught by the rollback rule', () => {
    const d = new YardDrive();
    d.go(-8, 15, 0, 3);
    d.go(-8, centreFor(-5, -0.4), 0, 5, 2);
    d.go(-8, centreFor(-5, -1.2), 0, 2); // rolls back 80 cm
    d.go(-8, centreFor(-5, 8), 0, 4);
    expect(d.faults()).toEqual(['rollback']);
  });

  it('stopping on the hill and turning away before the line abandons it', () => {
    const d = new YardDrive();
    d.go(-8, 15, 0, 3);
    d.go(-8, centreFor(-5, -0.4), 0, 5, 2);
    d.go(-8, 20, 0, 6, 0, { gear: -1 }); // reverses back down and out
    expect(d.faults()).toEqual(['manoeuvreAbandoned']);
  });
});

describe('reverse parking between the poles', () => {
  const bay = byId('reverseBay') as Extract<ManoeuvreDef, { type: 'bay' }>;
  const parkedZ = bay.bay.center[1] + (CAR.front - CAR.rear) / 2;

  it('reversing in square and setting the handbrake passes', () => {
    const d = new YardDrive();
    d.go(14, -52, 0, 3);
    d.go(14, parkedZ, 0, 10, 0, { gear: -1 });
    d.go(14, parkedZ, 0, 0.1, 2, { handbrake: true });
    expect(d.faults()).toEqual([]);
    expect(d.result('reverseBay')).toMatchObject({ ok: true });
  });

  it('parking with a wheel over the line is a serious fault', () => {
    const d = new YardDrive();
    d.go(14.9, -52, 0, 3);
    d.go(14.9, parkedZ, 0, 10, 0, { gear: -1 });
    d.go(14.9, parkedZ, 0, 0.1, 2, { handbrake: true });
    expect(d.faults()).toEqual(['bayNotInside']);
  });

  it('parking crooked is a serious fault', () => {
    const d = new YardDrive();
    d.go(14, -52, 0, 3);
    d.go(14, parkedZ, 14, 10, 0, { gear: -1 });
    d.go(14, parkedZ, 14, 0.1, 2, { handbrake: true });
    expect(d.faults()).toEqual(['bayNotInside']);
  });

  it('taking too long is a minor fault', () => {
    const d = new YardDrive();
    d.go(14, -52, 0, 3);
    d.go(14, parkedZ, 0, 130, 0, { gear: -1 });
    d.go(14, parkedZ, 0, 0.1, 2, { handbrake: true });
    expect(d.faults()).toEqual(['manoeuvreTime']);
  });

  it('driving away after starting into the bay abandons it', () => {
    const d = new YardDrive();
    d.go(14, -52, 0, 3);
    d.go(14, -67, 0, 4, 0, { gear: -1 });
    d.go(14, -40, 0, 4);
    expect(d.faults()).toEqual(['manoeuvreAbandoned']);
  });

  it('just driving past the bay does not count', () => {
    const d = new YardDrive();
    d.go(14, -40, 0, 3);
    d.go(0, -62, 270, 4);
    d.go(-10, -62, 270, 3);
    expect(d.faults()).toEqual([]);
  });
});

describe('parallel parking', () => {
  const bay = byId('parallel') as Extract<ManoeuvreDef, { type: 'bay' }>;
  const parkedZ = bay.bay.center[1] + (CAR.front - CAR.rear) / 2;

  it('in the bay, along the kerb, passes', () => {
    const d = new YardDrive();
    d.go(25, -60, 0, 3);
    d.go(28.9, parkedZ, 0, 8, 0, { gear: -1 });
    d.go(28.9, parkedZ, 0, 0.1, 2, { gear: 0 });
    expect(d.faults()).toEqual([]);
    expect(d.result('parallel')).toMatchObject({ ok: true });
  });

  it('left sticking out into the road is a serious fault', () => {
    const d = new YardDrive();
    d.go(25, -60, 0, 3);
    d.go(27.6, parkedZ, 0, 8, 0, { gear: -1 });
    d.go(27.6, parkedZ, 0, 0.1, 2, { handbrake: true });
    expect(d.faults()).toEqual(['bayNotInside']);
  });

  it('a tyre on the kerb is a fault on top', () => {
    const d = new YardDrive();
    d.go(25, -60, 0, 3);
    d.go(29.0, parkedZ, 0, 8, 0, { gear: -1, wheelsOnKerb: 0 });
    d.go(29.0, parkedZ + 0.4, 0, 0.6, 0, { gear: -1, wheelsOnKerb: 1 });
    d.go(29.0, parkedZ + 0.4, 0, 0.1, 2, { handbrake: true, wheelsOnKerb: 0 });
    expect(d.faults()).toEqual(['touchKerb']);
  });
});

afterAll(() => {
  const yardRules = ['bayNotInside', 'manoeuvreTime', 'manoeuvreAbandoned', 'hillStartLine', 'stopLineAccuracy', 'stopLineOvershoot'];
  expect(yardRules.filter((id) => !raisedRules.has(id)), 'yard rules with no test that raises them').toEqual([]);
});

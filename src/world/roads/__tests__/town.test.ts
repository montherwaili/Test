import { describe, expect, it } from 'vitest';
import townJson from '../../../data/maps/town.json';
import { generateTown, hillProfile, type TownDef } from '../generate';
import { dist, headingDiff, headingOf, type P2 } from '../geometry';
import type { Lane } from '../network';
import { cycleLength, signalState, timeToGreen } from '../signals';

const town = generateTown(townJson as TownDef);
const net = town.network;
const lanes = [...net.lanes.values()];

const start = (l: Lane) => l.path.points[0]!;
const end = (l: Lane) => l.path.points[l.path.points.length - 1]!;

function inside(p: P2): boolean {
  return town.surfaces.some((s) => {
    if (s.type === 'disc') return dist(p, s.center) <= s.radius;
    const dx = s.to.x - s.from.x;
    const dz = s.to.z - s.from.z;
    const len = Math.hypot(dx, dz);
    const along = ((p.x - s.from.x) * dx + (p.z - s.from.z) * dz) / len;
    const across = Math.abs(((p.x - s.from.x) * -dz + (p.z - s.from.z) * dx) / len);
    return along >= 0 && along <= len && across <= s.width / 2;
  });
}

describe('town road network', () => {
  it('builds a network of a believable size', () => {
    expect(lanes.length).toBeGreaterThan(100);
    expect(lanes.filter((l) => l.kind === 'road')).toHaveLength(30);
    expect(lanes.filter((l) => l.kind === 'roundabout').length).toBeGreaterThan(15);
    expect(net.signals.size).toBe(2);
  });

  it('gives every lane somewhere to come from and somewhere to go', () => {
    for (const l of lanes) {
      expect(l.next.length, `${l.id} next`).toBeGreaterThan(0);
      expect(l.previous.length, `${l.id} previous`).toBeGreaterThan(0);
    }
  });

  it('joins lanes end to start without gaps or kinks', () => {
    for (const l of lanes) {
      for (const id of l.next) {
        const n = net.lane(id);
        expect(dist(end(l), start(n)), `${l.id} -> ${id} gap`).toBeLessThan(0.05);
        const turn = headingDiff(headingOf(n.path.directionAt(0)), headingOf(l.path.directionAt(l.path.length)));
        expect(Math.abs(turn), `${l.id} -> ${id} kink`).toBeLessThan(16);
      }
    }
  });

  it('lets you drive from anywhere to anywhere', () => {
    const reach = (from: string, step: (l: Lane) => string[]) => {
      const seen = new Set([from]);
      const queue = [from];
      while (queue.length) for (const n of step(net.lane(queue.pop()!))) if (!seen.has(n)) (seen.add(n), queue.push(n));
      return seen;
    };
    const spawn = townJson.spawn.lane;
    expect(reach(spawn, (l) => l.next).size).toBe(lanes.length);
    expect(reach(spawn, (l) => l.previous).size).toBe(lanes.length);
  });

  it('keeps traffic on the right', () => {
    // Heading east along the avenue, the right-hand side is the south (larger z).
    const f0 = net.lane('av1:f0');
    const f1 = net.lane('av1:f1');
    const b0 = net.lane('av1:b0');
    expect(headingOf(f0.path.directionAt(10))).toBeCloseTo(90, 5);
    expect(start(f0).z).toBeGreaterThan(start(f1).z);
    expect(start(f1).z).toBeGreaterThan(0);
    expect(start(b0).z).toBeLessThan(0);
    expect(headingOf(b0.path.directionAt(10))).toBeCloseTo(270, 5);
    // Lane 0 is the right-hand one and knows its neighbour.
    expect(f0.left).toBe('av1:f1');
    expect(f1.right).toBe('av1:f0');
    expect(f0.right).toBeNull();
  });

  it('circulates anticlockwise on roundabouts', () => {
    for (const l of lanes.filter((x) => x.kind === 'roundabout')) {
      const centre = l.owner === 'B1' ? { x: 0, z: -140 } : { x: 0, z: 0 };
      const p = l.path.pointAt(l.path.length / 2);
      const d = l.path.directionAt(l.path.length / 2);
      // Anticlockwise on a north-up map: this cross product is negative.
      expect((p.x - centre.x) * d.z - (p.z - centre.z) * d.x, l.id).toBeLessThan(0);
    }
  });

  it('paves under every lane, to its full width', () => {
    for (const l of lanes) {
      for (let s = 0; s <= l.path.length; s += 2) {
        const p = l.path.pointAt(s);
        const d = l.path.directionAt(s);
        for (const side of [-1.5, 0, 1.5]) {
          const q = { x: p.x - d.z * side, z: p.z + d.x * side };
          expect(inside(q), `${l.id} at ${s.toFixed(0)} m, ${side} m aside (${q.x.toFixed(1)}, ${q.z.toFixed(1)})`).toBe(true);
        }
      }
    }
  });

  it('keeps kerbs, buildings and palms clear of every lane', () => {
    for (const l of lanes) {
      for (let s = 0; s <= l.path.length; s += 2) {
        const p = l.path.pointAt(s);
        for (const r of town.raised) {
          const gap =
            r.type === 'cylinder'
              ? dist(p, r.center) - r.radius
              : Math.max(Math.abs(p.x - r.center.x) - r.size[0] / 2, Math.abs(p.z - r.center.z) - r.size[2] / 2);
          expect(gap, `${l.id} at ${s.toFixed(0)} m vs ${r.kind} at (${r.center.x.toFixed(0)}, ${r.center.z.toFixed(0)})`).toBeGreaterThan(1.6);
        }
      }
    }
  });
});

describe('rules of the road', () => {
  it('gives each road its speed limit and slows junctions and roundabouts', () => {
    expect(net.lane('av1:f0').speedLimit).toBe(60);
    expect(net.lane('n1:f0').speedLimit).toBe(40);
    expect(net.lane('pk:f0').speedLimit).toBe(20);
    for (const l of lanes) {
      if (l.kind === 'roundabout') expect(l.speedLimit).toBe(30);
      if (l.kind === 'junction') expect(l.speedLimit).toBeLessThanOrEqual(30);
    }
  });

  it('makes roundabout entries give way to traffic already on the roundabout', () => {
    const entries = lanes.filter((l) => l.id.includes(':in:'));
    // B2: two 2-lane arms and two 1-lane arms; B1: three 1-lane arms.
    expect(entries).toHaveLength(2 * 2 + 2 * 1 + 3);
    for (const e of entries) {
      expect(e.yieldTo.length).toBeGreaterThan(0);
      for (const id of e.yieldTo) expect(net.lane(id).kind).toBe('roundabout');
      for (const p of e.previous) expect(net.lane(p).end).toEqual({ type: 'giveWay' });
      // The lane it joins is not one it gives way to (that is the lane ahead, not across).
      expect(e.yieldTo).not.toContain(e.next[0]);
    }
  });

  it('puts both ring lanes of the big roundabout to use', () => {
    // Right-hand approach lane joins the outer ring lane, left-hand the inner.
    expect(net.lane('B2:in:W0').next[0]).toMatch(/^B2:ring0:/);
    expect(net.lane('B2:in:W1').next[0]).toMatch(/^B2:ring1:/);
    // Leaving from the inner lane crosses the outer one, so it gives way to it.
    expect(net.lane('B2:out:E1').yieldTo.every((id) => id.startsWith('B2:ring0:'))).toBe(true);
    expect(net.lane('B2:out:E1').yieldTo.length).toBeGreaterThan(0);
    expect(net.lane('B2:out:E0').yieldTo).toEqual([]);
    expect(net.lane('B2:out:E0').next).toEqual(['av2:f0']);
    expect(net.lane('B2:out:E1').next).toEqual(['av2:f1']);
  });

  it('makes the side road stop at the T-junction and give way to the main road', () => {
    expect(net.lane('c2:f0').end).toEqual({ type: 'stop' });
    expect(net.lane('s1:f0').end).toEqual({ type: 'none' });
    const fromSide = lanes.filter((l) => l.owner === 'B3' && l.id.startsWith('B3:N'));
    expect(fromSide).toHaveLength(2);
    for (const l of fromSide) {
      expect(l.yieldTo).toContain('s1:f0');
      expect(l.yieldTo).toContain('s2:b0');
    }
    // Turning left off the main road gives way to oncoming traffic; going straight does not.
    expect(net.lane('B3:E0>N0').turn).toBe('right');
    expect(net.lane('B3:W0>N0').turn).toBe('left');
    expect(net.lane('B3:W0>N0').yieldTo).toContain('s2:b0');
    expect(net.lane('B3:W0>E0').yieldTo).toEqual([]);
  });

  it('assigns turns to lanes at the signalled junction', () => {
    // Avenue arriving at C2 from the west: right lane goes right or straight, left lane left or straight.
    const from = (lane: string) =>
      net.lane(lane).next.map((id) => net.lane(id).turn).sort();
    expect(from('av2:f0')).toEqual(['right', 'straight']);
    expect(from('av2:f1')).toEqual(['left', 'straight']);
    expect(net.lane('av2:f0').end).toEqual({ type: 'signal', junction: 'C2', group: 'W' });
  });

  it('records crossings and bumps against the lanes they lie on', () => {
    expect(net.crossings).toHaveLength(4);
    expect(net.bumps).toHaveLength(4);
    for (const item of [...net.crossings, ...net.bumps]) {
      expect(item.lanes.length).toBeGreaterThanOrEqual(2);
      for (const { lane, s } of item.lanes) {
        const l = net.lane(lane);
        expect(s).toBeGreaterThan(0);
        expect(s).toBeLessThan(l.path.length);
        const at = 'position' in item ? item.position : { x: (item.from.x + item.to.x) / 2, z: (item.from.z + item.to.z) / 2 };
        expect(dist(l.path.pointAt(s), at)).toBeLessThan(4);
      }
    }
  });

  it('puts up the signs a driver needs', () => {
    const count = (kind: string) => town.signs.filter((s) => s.kind === kind).length;
    expect(count('stop')).toBe(1);
    expect(count('giveWay')).toBe(7);
    expect(count('roundabout')).toBe(7);
    expect(count('limit')).toBe(26);
    expect(count('crossing')).toBe(8);
    expect(count('bump')).toBe(8);
    expect(town.signalHeads.length).toBeGreaterThanOrEqual(7);
  });
});

describe('hill road', () => {
  it('rises and falls along the road, the same for both directions', () => {
    const up = net.lane('w1:f0');
    const down = net.lane('w1:b0');
    const peak = (30 * 9) / 100;
    expect(Math.max(...up.elevations)).toBeCloseTo(peak, 5);
    expect(up.elevations[0]).toBe(0);
    expect(up.elevations[up.elevations.length - 1]).toBe(0);
    // Same place, either direction: same height.
    for (let s = 0; s <= up.path.length; s += 5) {
      const p = up.path.pointAt(s);
      const other = down.path.project(p);
      expect(net.elevationAt(down, other.s)).toBeCloseTo(net.elevationAt(up, s), 2);
    }
    expect(town.hills).toHaveLength(1);
    expect(town.hills[0]!.headingDeg).toBe(180);
  });

  it('has the profile it was asked for', () => {
    const h = { gradePercent: 10, rampLength: 30, plateauLength: 10 };
    expect(hillProfile(h, -5)).toBe(0);
    expect(hillProfile(h, 15)).toBeCloseTo(1.5);
    expect(hillProfile(h, 35)).toBeCloseTo(3);
    expect(hillProfile(h, 55)).toBeCloseTo(1.5);
    expect(hillProfile(h, 100)).toBe(0);
  });
});

describe('finding your place on the network', () => {
  it('locates the spawn point on its lane', () => {
    const at = net.locate(town.spawn, town.spawn.headingDeg)!;
    expect(at.lane.id).toBe('av1:f0');
    expect(Math.abs(at.lateral)).toBeLessThan(0.01);
    expect(at.s).toBeCloseTo(12, 1);
  });

  it('tells left of the lane centre from right', () => {
    const p = { x: town.spawn.x, z: town.spawn.z + 1 }; // heading east, south is right
    expect(net.locate(p, 90)!.lateral).toBeCloseTo(1, 2);
    expect(net.locate({ x: p.x, z: p.z - 2 }, 90)!.lateral).toBeCloseTo(-1, 2);
  });

  it('uses heading to tell overlapping and opposing lanes apart', () => {
    // On the oncoming side of the avenue, facing east (the wrong way).
    const wrongSide = { x: -100, z: -2.75 };
    expect(net.locate(wrongSide, 270)!.lane.id).toBe('av1:b1');
    // Asking with our own heading does not hand back the oncoming lane as a good match.
    expect(net.locate(wrongSide)!.lane.id).toBe('av1:b1');
    // Inside a junction, where turning lanes fan out from one point.
    const turnRight = net.lane('C2:W0>S0');
    const mid = turnRight.path.pointAt(turnRight.path.length * 0.6);
    const heading = headingOf(turnRight.path.directionAt(turnRight.path.length * 0.6));
    expect(net.locate(mid, heading)!.lane.id).toBe('C2:W0>S0');
  });

  it('returns nothing out in the desert', () => {
    expect(net.locate({ x: 300, z: 300 })).toBeNull();
    expect(net.locate({ x: -70, z: -70 })).toBeNull();
  });

  it('finds routes, including one that needs a lane change', () => {
    const toParking = net.route('av1:f0', 'pk:f0')!;
    expect(toParking[0]).toBe('av1:f0');
    expect(toParking[toParking.length - 1]).toBe('pk:f0');
    expect(toParking.some((id) => id.startsWith('B2:ring'))).toBe(true);
    expect(toParking.some((id) => id.startsWith('C2:'))).toBe(true);
    // Each step is a real connection.
    for (let i = 0; i < toParking.length - 1; i++) {
      const l = net.lane(toParking[i]!);
      expect([...l.next, l.left, l.right]).toContain(toParking[i + 1]);
    }
    // Back the other way along the same road needs a trip round the block or roundabout.
    expect(net.route('av1:f0', 'av1:b0')).not.toBeNull();
    // Left at C2 is only allowed from the left-hand lane.
    const north = net.route('av2:f0', 'e1:b0')!;
    expect(north).toContain('av2:f1');
  });
});

describe('traffic signals', () => {
  const plan = net.signals.get('C2')!;

  it('never shows green to two approaches at once', () => {
    for (const p of net.signals.values()) {
      for (let t = 0; t < cycleLength(p) * 2; t += 0.25) {
        const going = p.groups.filter((g) => signalState(p, g, t) !== 'red');
        expect(going.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('gives every approach its turn: green, then amber, then red', () => {
    for (const g of plan.groups) {
      const seen: string[] = [];
      for (let t = 0; t < cycleLength(plan); t += 0.5) {
        const s = signalState(plan, g, t - plan.offset);
        if (seen[seen.length - 1] !== s) seen.push(s);
      }
      const joined = seen.join(',');
      expect(joined).toContain('green,amber,red');
    }
  });

  it('holds everyone on red between phases', () => {
    const t = plan.green + plan.amber + 0.5 - plan.offset;
    expect(plan.groups.every((g) => signalState(plan, g, t) === 'red')).toBe(true);
  });

  it('counts down to the next green', () => {
    const [first, second] = plan.groups as [string, string];
    const t0 = -plan.offset;
    expect(timeToGreen(plan, first, t0 + 1)).toBe(0);
    expect(timeToGreen(plan, second, t0 + 1)).toBeCloseTo(plan.green + plan.amber + plan.allRed - 1, 5);
    expect(timeToGreen(plan, first, t0 + plan.green + 1)).toBeCloseTo(cycleLength(plan) - plan.green - 1, 5);
  });

  it('repeats and is the same for the same time', () => {
    for (const g of plan.groups) {
      expect(signalState(plan, g, 12.3)).toBe(signalState(plan, g, 12.3 + cycleLength(plan) * 3));
    }
  });

  it('reports the signal a lane faces', () => {
    const lane = net.lane('av2:f0');
    expect(['green', 'amber', 'red']).toContain(net.signalFor(lane, 5));
    expect(net.signalFor(net.lane('n1:f0'), 5)).toBeNull();
  });

  it('puts the two junctions out of step', () => {
    expect(net.signals.get('A2')!.offset).not.toBe(net.signals.get('C2')!.offset);
  });
});

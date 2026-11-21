/** The free-drive city: big, but built by the same rules as the town. */
import { describe, expect, it } from 'vitest';
import cityJson from '../../../data/maps/city.json';
import { generateTown, type TownDef } from '../generate';
import { dist, headingDiff, headingOf, type P2 } from '../geometry';
import type { Lane } from '../network';

const city = generateTown(cityJson as TownDef);
const net = city.network;
const lanes = [...net.lanes.values()];
const start = (l: Lane) => l.path.points[0]!;
const end = (l: Lane) => l.path.points[l.path.points.length - 1]!;

function inside(p: P2): boolean {
  return city.surfaces.some((s) => {
    if (s.type === 'disc') return dist(p, s.center) <= s.radius;
    const dx = s.to.x - s.from.x;
    const dz = s.to.z - s.from.z;
    const len = Math.hypot(dx, dz);
    const along = ((p.x - s.from.x) * dx + (p.z - s.from.z) * dz) / len;
    const across = Math.abs(((p.x - s.from.x) * -dz + (p.z - s.from.z) * dx) / len);
    return along >= 0 && along <= len && across <= s.width / 2;
  });
}

describe('free-drive city', () => {
  it('is a city of wide streets and junctions, with an industrial estate: no motorway', () => {
    expect(lanes.filter((l) => l.kind === 'road').length).toBeGreaterThan(100);
    expect(net.signals.size).toBeGreaterThanOrEqual(6);
    // City streets have two lanes each way.
    expect(net.lane('r2a:f1').speedLimit).toBe(60);
    // Nothing faster than 60 here: the motorway is a map of its own.
    expect(Math.max(...lanes.map((l) => l.speedLimit))).toBeLessThanOrEqual(60);
  });

  it('joins every lane, end to start, without gaps or kinks', () => {
    for (const l of lanes) {
      expect(l.next.length, `${l.id} next`).toBeGreaterThan(0);
      expect(l.previous.length, `${l.id} previous`).toBeGreaterThan(0);
      for (const id of l.next) {
        const n = net.lane(id);
        expect(dist(end(l), start(n)), `${l.id} -> ${id} gap`).toBeLessThan(0.05);
        const turn = headingDiff(headingOf(n.path.directionAt(0)), headingOf(l.path.directionAt(l.path.length)));
        expect(Math.abs(turn), `${l.id} -> ${id} kink`).toBeLessThan(16);
      }
    }
  });

  it('lets you drive from anywhere to anywhere (changing lanes where needed)', () => {
    const reach = (from: string, step: (l: Lane) => string[]) => {
      const seen = new Set([from]);
      const queue = [from];
      while (queue.length) for (const n of step(net.lane(queue.pop()!))) if (!seen.has(n)) (seen.add(n), queue.push(n));
      return seen;
    };
    const side = (l: Lane) => [l.left, l.right].filter((x): x is string => x !== null);
    expect(reach(cityJson.spawn.lane, (l) => [...l.next, ...side(l)]).size).toBe(lanes.length);
    expect(reach(cityJson.spawn.lane, (l) => [...l.previous, ...side(l)]).size).toBe(lanes.length);
  });

  it('paves under every lane and keeps everything raised clear of them', () => {
    for (const l of lanes) {
      for (let s = 0; s <= l.path.length; s += 4) {
        const p = l.path.pointAt(s);
        const d = l.path.directionAt(s);
        for (const side of [-1.5, 0, 1.5]) {
          const q = { x: p.x - d.z * side, z: p.z + d.x * side };
          expect(inside(q), `${l.id} at ${s.toFixed(0)} m, ${side} m aside`).toBe(true);
        }
        for (const r of city.raised) {
          if (Math.abs(r.center.x - p.x) > 30 || Math.abs(r.center.z - p.z) > 30) continue;
          // In the box's own frame (the median pieces round a curve are turned).
          const th = r.type === 'box' ? ((r.yawDeg ?? 0) * Math.PI) / 180 : 0;
          const dx = p.x - r.center.x;
          const dz = p.z - r.center.z;
          const lx = dx * Math.cos(th) - dz * Math.sin(th);
          const lz = dx * Math.sin(th) + dz * Math.cos(th);
          const gap = r.type === 'cylinder' ? dist(p, r.center) - r.radius : Math.max(Math.abs(lx) - r.size[0] / 2, Math.abs(lz) - r.size[2] / 2);
          expect(gap, `${l.id} at ${s.toFixed(0)} m vs ${r.kind} at (${r.center.x.toFixed(0)}, ${r.center.z.toFixed(0)})`).toBeGreaterThan(1.6);
        }
      }
    }
  });

  it('stays on its ground', () => {
    const half = cityJson.groundSize / 2;
    for (const l of lanes) for (const p of l.path.points) expect(Math.max(Math.abs(p.x), Math.abs(p.z))).toBeLessThan(half - 100);
  });
});

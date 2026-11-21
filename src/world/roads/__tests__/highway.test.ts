/** The motorway map: built by the same rules as the town. */
import { describe, expect, it } from 'vitest';
import cityJson from '../../../data/maps/highway.json';
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

describe('motorway map', () => {
  it('is a great loop of three-lane motorway at 120 km/h with sweeping curves', () => {
    for (const id of ['mN', 'mS', 'mE', 'mW']) {
      expect(net.lane(`${id}:f2`).speedLimit).toBe(120);
      expect(net.lane(`${id}:f0`).path.length).toBeGreaterThan(1000);
    }
    // Nothing to stop for: no junctions, no roundabouts, no signals.
    expect(lanes.some((l) => l.kind === 'roundabout')).toBe(false);
    expect(net.signals.size).toBe(0);
    const curves = lanes.filter((l) => l.owner === 'cNE');
    expect(curves.length).toBe(6);
    for (const l of curves) {
      expect(l.path.length).toBeGreaterThan(700);
      expect(l.speedLimit).toBeGreaterThanOrEqual(120);
    }
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

  it('goes round and round: each carriageway is a closed loop, all of it reachable', () => {
    const reach = (from: string) => {
      const seen = new Set([from]);
      const queue = [from];
      while (queue.length) {
        const l = net.lane(queue.pop()!);
        for (const n of [...l.next, ...[l.left, l.right].filter((x): x is string => x !== null)]) if (!seen.has(n)) (seen.add(n), queue.push(n));
      }
      return seen;
    };
    const one = reach(cityJson.spawn.lane);
    // Half the lanes: one direction round, in every lane; the other direction is the other half.
    expect(one.size).toBe(lanes.length / 2);
    const other = lanes.find((l) => !one.has(l.id))!;
    expect(reach(other.id).size).toBe(lanes.length / 2);
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

import { describe, expect, it } from 'vitest';
import { GearLeverModel, gearSlots } from '../gearLever';

/** Drag the knob through a list of points, in small steps. */
function dragThrough(lever: GearLeverModel, points: [number, number][]): void {
  lever.grab();
  let [px, py] = [lever.x, lever.y];
  for (const [x, y] of points) {
    for (let i = 1; i <= 10; i++) lever.drag(px + ((x - px) * i) / 10, py + ((y - py) * i) / 10);
    [px, py] = [x, y];
  }
}

describe('gear lever in an H gate', () => {
  it('starts in neutral, in the middle', () => {
    const l = new GearLeverModel();
    expect(l.gear).toBe(0);
    expect([l.x, l.y]).toEqual([0, 0]);
  });

  it('selects each gear by pushing along the gate', () => {
    const cases: [number, [number, number][]][] = [
      [1, [[-1, 0], [-1, -1]]],
      [2, [[-1, 0], [-1, 1]]],
      [3, [[0, -1]]],
      [4, [[0, 1]]],
      [5, [[1, 0], [1, -1]]],
      [-1, [[1, 0], [1, 1]]],
    ];
    for (const [gear, path] of cases) {
      const l = new GearLeverModel();
      dragThrough(l, path);
      l.release();
      expect(l.gear, `gear ${gear}`).toBe(gear);
    }
  });

  it('cannot cut straight across from one gear to another', () => {
    const l = new GearLeverModel();
    dragThrough(l, [[-1, 0], [-1, -1]]); // first
    // Finger slides straight right along the top: the knob may not travel along the top edge.
    for (let x = -1; x <= 1; x += 0.05) {
      l.drag(x, -1);
      // Whenever it is up in a slot, it is in a column, never between them.
      if (Math.abs(l.y) > 0.05) expect([-1, 0, 1]).toContain(l.x);
    }
  });

  it('goes from first to second straight down through neutral', () => {
    const l = new GearLeverModel();
    dragThrough(l, [[-1, 0], [-1, -1]]);
    const seen: number[] = [];
    l.grab();
    for (let y = -1; y <= 1.001; y += 0.05) {
      l.drag(-1, y);
      if (seen[seen.length - 1] !== l.gear) seen.push(l.gear);
    }
    expect(seen).toEqual([1, 0, 2]);
  });

  it('springs back to neutral if let go half way into a slot', () => {
    const l = new GearLeverModel();
    dragThrough(l, [[0, -0.4]]);
    expect(l.gear).toBe(0);
    l.release();
    expect([l.x, l.y]).toEqual([0, 0]);
  });

  it('stays in gear if let go near the end of the slot', () => {
    const l = new GearLeverModel();
    dragThrough(l, [[0, 0.7]]);
    l.release();
    expect(l.gear).toBe(4);
    expect(l.y).toBe(1);
  });

  it('springs to the middle of the rail when let go in neutral', () => {
    const l = new GearLeverModel();
    dragThrough(l, [[1, 0]]);
    l.release();
    expect([l.x, l.y]).toEqual([0, 0]);
  });

  it('follows gear changes made elsewhere (keyboard, reset)', () => {
    const l = new GearLeverModel();
    l.setGear(5);
    expect([l.x, l.y, l.gear]).toEqual([1, -1, 5]);
    l.setGear(-1);
    expect([l.x, l.y, l.gear]).toEqual([1, 1, -1]);
    l.setGear(0);
    expect([l.x, l.y, l.gear]).toEqual([0, 0, 0]);
    // ...but not while the driver is holding it.
    l.grab();
    l.setGear(3);
    expect(l.gear).toBe(0);
  });

  it('labels all six gear positions', () => {
    expect(gearSlots().map((s) => s.gear).sort()).toEqual([-1, 1, 2, 3, 4, 5]);
  });
});

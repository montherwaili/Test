/**
 * An on-screen gear lever in an H gate, as in a manual car:
 *
 *     1   3   5
 *     |   |   |
 *     +---N---+
 *     |   |   |
 *     2   4   R
 *
 * The knob moves only along the gate. Let go part way into a gear slot and it
 * springs back to neutral; let go near the end and it stays in gear. In
 * neutral it springs to the middle, as a real lever does. Pure logic, no DOM.
 *
 * Coordinates: x from -1 (left column) to 1 (right column); y from -1 (top
 * row) to 1 (bottom row); the neutral rail is y = 0.
 */
import { GEAR_NEUTRAL, GEAR_REVERSE, type Gear } from '../sim/gearbox';

/** Gear at the top (-1) and bottom (+1) of each column, left to right. */
const SLOTS: [Gear, Gear][] = [
  [1, 2],
  [3, 4],
  [5, GEAR_REVERSE],
];
const COLUMNS = [-1, 0, 1];

/** How far into a slot (0..1) the knob must be for the gear to count. */
export const ENGAGE_AT = 0.6;
/** Pulling further from the rail than this snaps the knob into a column. */
const LEAVE_RAIL = 0.2;

export class GearLeverModel {
  x = 0;
  y = 0;
  held = false;

  /** Gear the lever is in (neutral unless far enough into a slot). */
  get gear(): Gear {
    if (Math.abs(this.y) < ENGAGE_AT) return GEAR_NEUTRAL;
    const col = COLUMNS.indexOf(this.x);
    if (col < 0) return GEAR_NEUTRAL;
    return SLOTS[col]![this.y < 0 ? 0 : 1];
  }

  /** Put the knob where `gear` is (for a change made by keyboard or reset). */
  setGear(gear: Gear): void {
    if (this.held) return;
    for (let c = 0; c < SLOTS.length; c++) {
      const [top, bottom] = SLOTS[c]!;
      if (gear === top || gear === bottom) {
        this.x = COLUMNS[c]!;
        this.y = gear === top ? -1 : 1;
        return;
      }
    }
    this.x = 0;
    this.y = 0;
  }

  grab(): void {
    this.held = true;
  }

  /**
   * Move towards a point in gate coordinates. The knob only travels along the
   * gate: from a slot it must come back to the rail before crossing over.
   */
  drag(tx: number, ty: number): void {
    if (!this.held) return;
    tx = Math.max(-1, Math.min(1, tx));
    ty = Math.max(-1, Math.min(1, ty));
    const inColumn = Math.abs(this.y) > 0.05;
    if (inColumn) {
      // Up or down the column we are in; only at the rail can it go sideways.
      const wantOtherColumn = Math.abs(tx - this.x) > 0.5;
      if (wantOtherColumn && Math.abs(ty) < LEAVE_RAIL) {
        this.y = 0;
        this.x = tx;
      } else if (wantOtherColumn) {
        // Asked for another column while away from the rail: come back to it first.
        this.y = 0;
        this.x = tx;
        this.enterColumn(ty);
      } else {
        this.y = ty;
        if (Math.abs(this.y) < 0.05) this.y = 0;
      }
    } else {
      this.x = tx;
      this.y = 0;
      if (Math.abs(ty) >= LEAVE_RAIL) this.enterColumn(ty);
    }
  }

  /** Let go: the knob settles in gear, or springs back to neutral in the middle. */
  release(): void {
    this.held = false;
    if (Math.abs(this.y) >= ENGAGE_AT && COLUMNS.includes(this.x)) {
      this.y = this.y < 0 ? -1 : 1;
    } else {
      this.x = 0;
      this.y = 0;
    }
  }

  private enterColumn(ty: number): void {
    // Snap to the nearest column and follow the finger up or down it.
    let best = COLUMNS[0]!;
    for (const c of COLUMNS) if (Math.abs(c - this.x) < Math.abs(best - this.x)) best = c;
    this.x = best;
    this.y = ty;
  }
}

/** Where each gear's label sits on the gate, for drawing. */
export function gearSlots(): { gear: Gear; x: number; y: number }[] {
  const out: { gear: Gear; x: number; y: number }[] = [];
  SLOTS.forEach(([top, bottom], c) => {
    out.push({ gear: top, x: COLUMNS[c]!, y: -1 }, { gear: bottom, x: COLUMNS[c]!, y: 1 });
  });
  return out;
}

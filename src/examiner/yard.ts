/**
 * Test-yard manoeuvres: reverse parking into a bay, parallel parking, a hill
 * start at a line, and stopping exactly at a line. Each one watches the car
 * while it is in its zone and judges the result. Layouts come from the yard
 * data file. Pure logic.
 */
import type { CarGeometry, Observation } from './observation';
import type { RuleId, Text } from './rules';

/** A rectangle on the ground: `size` is [across, along], `headingDeg` the direction of "along". */
export interface Rect {
  center: [number, number];
  size: [number, number];
  headingDeg: number;
}

export type ManoeuvreDef =
  | {
      id: string;
      type: 'bay';
      title: Text;
      /** The bay; the car must end inside it facing `bay.headingDeg`. */
      bay: Rect;
      zone: Rect;
      timeLimitS: number;
    }
  | {
      id: string;
      type: 'hillStart';
      title: Text;
      /** A point on the stop line, and the direction of travel up the hill. */
      line: [number, number];
      headingDeg: number;
      zone: Rect;
      /** Distance past the line that counts as having pulled away, m. */
      passM: number;
    }
  | {
      id: string;
      type: 'stopLine';
      title: Text;
      line: [number, number];
      headingDeg: number;
      zone: Rect;
    };

export interface ManoeuvreResult {
  id: string;
  /** Finished without a fault of its own. */
  ok: boolean;
  time: number;
}

export interface ManoeuvreFault {
  rule: RuleId;
  detail: string;
}

interface Axes {
  fx: number;
  fz: number;
  rx: number;
  rz: number;
}

function axes(headingDeg: number): Axes {
  const a = (headingDeg * Math.PI) / 180;
  const fx = Math.sin(a);
  const fz = -Math.cos(a);
  return { fx, fz, rx: -fz, rz: fx };
}

/** Point in the rectangle's own frame: `along` its heading and `across` to its right. */
export function inRect(r: Rect, x: number, z: number, margin = 0): boolean {
  const { fx, fz, rx, rz } = axes(r.headingDeg);
  const dx = x - r.center[0];
  const dz = z - r.center[1];
  return Math.abs(dx * rx + dz * rz) <= r.size[0] / 2 + margin && Math.abs(dx * fx + dz * fz) <= r.size[1] / 2 + margin;
}

/** The four corners of the car's footprint. */
export function footprint(o: Pick<Observation, 'x' | 'z' | 'headingDeg'>, car: CarGeometry): [number, number][] {
  const { fx, fz, rx, rz } = axes(o.headingDeg);
  const out: [number, number][] = [];
  for (const along of [car.front, -car.rear]) {
    for (const across of [-car.width / 2, car.width / 2]) {
      out.push([o.x + fx * along + rx * across, o.z + fz * along + rz * across]);
    }
  }
  return out;
}

/** How far the car's front bumper is past a line (negative = short of it). */
function frontPast(o: Observation, car: CarGeometry, line: [number, number], headingDeg: number): number {
  const { fx, fz } = axes(headingDeg);
  const c = axes(o.headingDeg);
  const frontX = o.x + c.fx * car.front;
  const frontZ = o.z + c.fz * car.front;
  return (frontX - line[0]) * fx + (frontZ - line[1]) * fz;
}

function angleOff(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return Math.abs(d);
}

const STILL = 0.05;
const SETTLE_S = 1.2;

export class Manoeuvre {
  state: 'idle' | 'active' | 'done' = 'idle';
  private startedAt = 0;
  private stillFor = 0;
  /** Bay: the car has been in or right by the bay. Hill / line: the car has stopped. */
  private committed = false;
  /** Hill / line: the car has driven up to the line (not just been parked in the zone). */
  private approached = false;
  result: ManoeuvreResult | null = null;

  constructor(
    readonly def: ManoeuvreDef,
    private readonly car: CarGeometry,
    private readonly params: (rule: RuleId) => Record<string, number>,
  ) {}

  /** Watch one step. Returns any faults of this manoeuvre's own. */
  step(o: Observation): ManoeuvreFault[] {
    if (this.state === 'done') return [];
    const d = this.def;
    const inZone = inRect(d.zone, o.x, o.z);
    const faults: ManoeuvreFault[] = [];
    this.stillFor = Math.abs(o.speed) < STILL ? this.stillFor + o.dt : 0;

    if (this.state === 'idle') {
      if (!inZone) return faults;
      this.state = 'active';
      this.startedAt = o.time;
      this.committed = false;
      this.approached = false;
    }
    if (!inZone) {
      if (this.committed) {
        faults.push({ rule: 'manoeuvreAbandoned', detail: d.id });
        this.finish(o, false);
      } else {
        this.state = 'idle';
      }
      return faults;
    }

    if (d.type !== 'bay' && o.speed > 1 && angleOff(o.headingDeg, d.headingDeg) < 45) this.approached = true;

    if (d.type === 'bay') {
      if (inRect(d.bay, o.x, o.z, 1)) this.committed = true;
      const parked = this.stillFor >= SETTLE_S && (o.handbrake || o.gear === 0);
      if (this.committed && parked) {
        const inside = footprint(o, this.car).every(([x, z]) => inRect(d.bay, x, z));
        const square = angleOff(o.headingDeg, d.bay.headingDeg) <= (this.params('bayNotInside')['maxAngleDeg'] ?? 10);
        let ok = inside && square;
        if (!ok) faults.push({ rule: 'bayNotInside', detail: d.id });
        if (o.time - this.startedAt > d.timeLimitS) {
          faults.push({ rule: 'manoeuvreTime', detail: d.id });
          ok = false;
        }
        this.finish(o, ok);
      }
    } else if (d.type === 'hillStart') {
      const past = frontPast(o, this.car, d.line, d.headingDeg);
      if (!this.committed && this.approached && this.stillFor >= SETTLE_S && angleOff(o.headingDeg, d.headingDeg) < 45) {
        this.committed = true;
        const windowM = this.params('hillStartLine')['windowM'] ?? 1;
        if (past > 0.3 || past < -windowM) faults.push({ rule: 'hillStartLine', detail: `${past.toFixed(2)} m` });
      }
      if (this.committed && past > d.passM) this.finish(o, faults.length === 0);
    } else {
      if (!this.committed && this.approached && this.stillFor >= SETTLE_S && angleOff(o.headingDeg, d.headingDeg) < 45) {
        this.committed = true;
        const past = frontPast(o, this.car, d.line, d.headingDeg);
        const tol = this.params('stopLineAccuracy')['toleranceM'] ?? 0.5;
        const over = this.params('stopLineOvershoot')['overM'] ?? 1;
        let ok = true;
        if (past > over) {
          faults.push({ rule: 'stopLineOvershoot', detail: `${past.toFixed(2)} m` });
          ok = false;
        } else if (Math.abs(past) > tol) {
          faults.push({ rule: 'stopLineAccuracy', detail: `${past.toFixed(2)} m` });
          ok = false;
        }
        this.finish(o, ok);
      }
    }
    return faults;
  }

  private finish(o: Observation, ok: boolean): void {
    this.state = 'done';
    this.result = { id: this.def.id, ok, time: o.time };
  }
}

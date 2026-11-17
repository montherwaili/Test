/**
 * Scripted drives for examiner tests: a point that moves along lanes of the
 * real town network, with the car's controls set by the script, turned into
 * the observations the examiner sees.
 */
import townJson from '../../data/maps/town.json';
import { generateTown, type TownDef } from '../../world/roads/generate';
import { headingOf } from '../../world/roads/geometry';
import type { RoadNetwork } from '../../world/roads/network';
import { Examiner } from '../examiner';
import type { CarGeometry, Observation } from '../observation';
import { loadRuleBook } from '../rules';
import type { ManoeuvreDef } from '../yard';

export const net: RoadNetwork = generateTown(townJson as TownDef).network;
export const CAR: CarGeometry = { front: 1.87, rear: 2.23, width: 1.7 };
export const DT = 1 / 30;

/** Every rule any test has seen raised (checked against the full rule list at the end). */
export const raisedRules = new Set<string>();

export type Patch = Partial<Observation> & { lateral?: number };

export class Drive {
  readonly ex: Examiner;
  route: string[];
  s: number;
  /** m/s along the route; negative = reversing. */
  speed = 0;
  lateral = 0;
  /** Move backwards along the lanes but face (and report speed) forwards: driving the wrong way. */
  wrongWay = false;
  o: Observation;
  private indicatorSince = 0;

  constructor(route: string[], s = 5, yard: ManoeuvreDef[] = [], network: RoadNetwork | null = net) {
    this.ex = new Examiner(loadRuleBook(), network, CAR, yard);
    this.route = route;
    this.s = s;
    this.o = {
      time: 0,
      dt: DT,
      signalTime: 0,
      x: 0,
      z: 0,
      headingDeg: 0,
      speed: 0,
      gear: 1,
      handbrake: false,
      seatbelt: true,
      indicator: 'off',
      indicatorFor: 0,
      mirrorLeftAt: -Infinity,
      mirrorCentreAt: -Infinity,
      mirrorRightAt: -Infinity,
      wheelsOnKerb: 0,
      contacts: [],
      events: [],
      others: [],
      crossings: net.crossings.map(() => 0),
    };
    this.place();
  }

  get lane(): string {
    return this.route[0]!;
  }

  /** Run for `seconds`; `patch` is applied before every step (a function gets the time since this call). */
  run(seconds: number, patch: Patch | ((t: number, d: Drive) => Patch) = {}): void {
    for (let i = 0; i < Math.round(seconds / DT); i++) this.tick(typeof patch === 'function' ? patch(i * DT, this) : patch);
  }

  /** Drive on until the car's centre reaches lane `id` (or `maxSeconds`). */
  until(id: string, patch: Patch | ((t: number, d: Drive) => Patch) = {}, maxSeconds = 60): void {
    for (let i = 0; i < maxSeconds / DT && this.lane !== id; i++) this.tick(typeof patch === 'function' ? patch(i * DT, this) : patch);
    if (this.lane !== id) throw new Error(`never reached ${id}`);
  }

  /** Distance from the front bumper to the line at the end of the current lane. */
  get toLine(): number {
    return net.lane(this.lane).path.length - 0.5 - this.s - CAR.front;
  }

  /** Look in a mirror now. */
  glance(m: 'left' | 'centre' | 'right'): void {
    if (m === 'left') this.o.mirrorLeftAt = this.o.time;
    else if (m === 'right') this.o.mirrorRightAt = this.o.time;
    else this.o.mirrorCentreAt = this.o.time;
  }

  faults(): string[] {
    return this.ex.faults.map((f) => f.rule);
  }

  private tick(patch: Patch): void {
    const { lateral, ...rest } = patch;
    if (lateral !== undefined) this.lateral = lateral;
    if (rest.speed !== undefined) this.speed = rest.speed;
    const wasIndicator = this.o.indicator;
    Object.assign(this.o, rest);
    this.o.speed = this.speed;
    if (this.o.indicator !== wasIndicator) this.indicatorSince = this.o.time;
    this.o.indicatorFor = this.o.time - this.indicatorSince;

    const move = (this.wrongWay ? -1 : 1) * this.speed * DT;
    this.s += move;
    while (this.route.length > 1 && this.s > net.lane(this.lane).path.length) {
      this.s -= net.lane(this.lane).path.length;
      this.route.shift();
    }
    this.place();
    for (const f of this.ex.step(this.o)) raisedRules.add(f.rule);
    this.o.time += DT;
    if (rest.signalTime === undefined) this.o.signalTime += DT;
    this.o.contacts = [];
    this.o.events = [];
  }

  private place(): void {
    const lane = net.lane(this.lane);
    const s = Math.max(0, Math.min(lane.path.length, this.s));
    const p = lane.path.pointAt(s);
    const d = lane.path.directionAt(s);
    this.o.x = p.x - d.z * this.lateral;
    this.o.z = p.z + d.x * this.lateral;
    this.o.headingDeg = (headingOf(d) + (this.wrongWay ? 180 : 0)) % 360;
  }
}

/** A clock time at which `group` at `junction` has just turned the given colour. */
export function signalTimeWhen(junction: string, group: string, colour: 'green' | 'amber' | 'red', into = 1): number {
  const plan = net.signals.get(junction)!;
  const slot = plan.green + plan.amber + plan.allRed;
  const start = plan.groups.indexOf(group) * slot - plan.offset;
  if (colour === 'green') return start + into;
  if (colour === 'amber') return start + plan.green + into;
  return start + slot + into;
}

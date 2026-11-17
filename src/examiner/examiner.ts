/**
 * The examiner: watches every simulation step and records faults against the
 * rule book, with the time and place each one happened. Pure TypeScript: it
 * reads the road network (also pure) and the observations the game gives it,
 * and nothing else.
 */
import { headingDiff, headingOf, type P2 } from '../world/roads/geometry';
import type { Lane, LanePosition, RoadNetwork } from '../world/roads/network';
import { signalState } from '../world/roads/signals';
import type { CarGeometry, ContactKind, Observation, OtherVehicle } from './observation';
import type { Rule, RuleBook, RuleId, Severity } from './rules';
import { Manoeuvre, type ManoeuvreDef, type ManoeuvreResult } from './yard';

export interface Fault {
  rule: RuleId;
  severity: Severity;
  /** Seconds since the drive began. */
  time: number;
  x: number;
  z: number;
  /** Extra detail for the record (what was hit, by how much). */
  detail?: string;
}

export interface ExamResult {
  passed: boolean;
  minor: number;
  serious: number;
  fail: number;
  faults: Fault[];
  manoeuvres: ManoeuvreResult[];
}

/** How long the same rule stays quiet after it has fired, s. */
const DEFAULT_COOLDOWN = 2;
/** Turns under this many degrees count as going straight on. */
const STRAIGHT_DEG = 35;

const COLLISION_KINDS: ContactKind[] = ['trafficCar', 'pedestrian', 'wall', 'building', 'palm'];

/** What the car was doing as its front crossed the line at the end of a lane. */
interface Entry {
  from: Lane;
  time: number;
  x: number;
  z: number;
  indicator: string;
  indicatorFor: number;
  mirrorLeftAt: number;
  mirrorCentreAt: number;
  mirrorRightAt: number;
  /** Lane heading at the line, degrees. */
  headingDeg: number;
  roundabout: boolean;
  /** More than one way to go from here (so a signal is needed for a turn). */
  choice: boolean;
  /** Traffic as it was at the line, for the give-way check. */
  others: OtherVehicle[];
  /** Hardest braking seen per traffic car (and its lane) while we pulled out. */
  braking: Map<number, { accel: number; lane: string | null }>;
  /** The junction lane taken, once known. */
  taken: Lane | null;
  giveWayChecked: boolean;
}

export class Examiner {
  readonly faults: Fault[] = [];
  readonly manoeuvres: Manoeuvre[];

  private last = new Map<RuleId, number>();

  // Moving off, seatbelt, rollback.
  private stillFor = 0;
  private seatbeltFaulted = false;
  private rolledBack = 0;
  private rollbackFaulted = false;

  // Kerbs.
  private onKerb = false;
  private kerbTravel = 0;
  private mountFaulted = false;

  // Lanes.
  private prevRoad: { lane: Lane; s: number; frontLeft: number } | null = null;
  private prevLaneKind: string | null = null;
  private entry: Entry | null = null;
  private stopZoneMin = Infinity;
  private lastLimit: number | null = null;
  private overFor = 0;
  private wellOverFor = 0;
  private straddleFor = 0;
  private wrongFor = 0;
  private followFor = 0;
  private roundaboutExitChecked = false;

  constructor(
    readonly book: RuleBook,
    readonly network: RoadNetwork | null,
    readonly car: CarGeometry,
    yard: ManoeuvreDef[] = [],
  ) {
    this.manoeuvres = yard.map((d) => new Manoeuvre(d, car, (id) => this.rule(id).params));
  }

  rule(id: RuleId): Rule {
    return this.book.rules.get(id)!;
  }

  /** Watch one step; returns the faults recorded on it. */
  step(o: Observation): Fault[] {
    const before = this.faults.length;

    this.carChecks(o);
    if (this.network) this.roadChecks(o, this.network);
    for (const m of this.manoeuvres) {
      for (const f of m.step(o)) this.raise(f.rule, o, f.detail, 0);
    }
    return this.faults.slice(before);
  }

  result(): ExamResult {
    const count = (s: Severity) => this.faults.filter((f) => f.severity === s).length;
    const minor = count('minor');
    const serious = count('serious');
    const fail = count('fail');
    const { maxMinor, maxSerious } = this.book.scoring;
    return {
      passed: fail === 0 && serious <= maxSerious && minor <= maxMinor,
      minor,
      serious,
      fail,
      faults: [...this.faults],
      manoeuvres: this.manoeuvres.map((m) => m.result).filter((r): r is ManoeuvreResult => r !== null),
    };
  }

  private raise(id: RuleId, o: Pick<Observation, 'time' | 'x' | 'z'>, detail?: string, cooldown = DEFAULT_COOLDOWN): void {
    const last = this.last.get(id);
    if (last !== undefined && o.time - last < cooldown) return;
    this.last.set(id, o.time);
    const f: Fault = { rule: id, severity: this.rule(id).severity, time: o.time, x: o.x, z: o.z };
    if (detail !== undefined) f.detail = detail;
    this.faults.push(f);
  }

  // --- things that apply anywhere ------------------------------------------------

  private carChecks(o: Observation): void {
    const p = (id: RuleId) => this.rule(id).params;

    // Moving off: after standing still a while, the first real movement.
    const wasStill = this.stillFor;
    this.stillFor = Math.abs(o.speed) < 0.05 ? this.stillFor + o.dt : 0;
    if (Math.abs(o.speed) > 0.5 && wasStill >= (p('mirrorsMoveOff')['stoppedForS'] ?? 2)) {
      const lookback = p('mirrorsMoveOff')['lookbackS'] ?? 6;
      if (Math.max(o.mirrorLeftAt, o.mirrorCentreAt, o.mirrorRightAt) < o.time - lookback) this.raise('mirrorsMoveOff', o);
    }
    if (Math.abs(o.speed) > 0.5 && !o.seatbelt && !this.seatbeltFaulted) {
      this.raise('seatbelt', o, undefined, 0);
      this.seatbeltFaulted = true;
    }
    if (o.seatbelt) this.seatbeltFaulted = false;

    // Rolling back without reverse selected.
    if (o.gear !== -1 && o.speed < -0.02) {
      this.rolledBack += -o.speed * o.dt;
      if (this.rolledBack > (p('rollback')['maxM'] ?? 0.3) && !this.rollbackFaulted) {
        this.raise('rollback', o, `${this.rolledBack.toFixed(2)} m`, 0);
        this.rollbackFaulted = true;
      }
    } else if (o.speed > 0.05 || o.gear === -1) {
      this.rolledBack = 0;
      this.rollbackFaulted = false;
    }

    for (const e of o.events) if (e === 'stall') this.raise('stall', o, undefined, 0.5);

    for (const c of o.contacts) {
      if (c === 'pole' || c === 'cone') this.raise('touchPole', o, c, 1.5);
      else if (c === 'kerb' || c === 'island') this.raise('touchKerb', o, c, 3);
      else if (COLLISION_KINDS.includes(c)) this.raise('collision', o, c, 1.5);
    }

    // Tyres on the kerb: touching is minor; driving along on it is serious.
    if (o.wheelsOnKerb > 0) {
      if (!this.onKerb) this.raise('touchKerb', o, 'wheel', 3);
      this.onKerb = true;
      this.kerbTravel += Math.abs(o.speed) * o.dt;
      if (this.kerbTravel > (p('mountKerb')['maxM'] ?? 1) && !this.mountFaulted) {
        this.raise('mountKerb', o, undefined, 0);
        this.mountFaulted = true;
      }
    } else {
      this.onKerb = false;
      this.kerbTravel = 0;
      this.mountFaulted = false;
    }
  }

  // --- things that need the road network ------------------------------------------

  private roadChecks(o: Observation, net: RoadNetwork): void {
    const here = net.locate(o, o.headingDeg, 6);
    // On a lane, and going its way (a car reversing faces the other way).
    const facing = o.speed < -0.05 ? (o.headingDeg + 180) % 360 : o.headingDeg;
    const along = here ? Math.abs(headingDiff(headingOf(here.lane.path.directionAt(here.s)), facing)) < 90 : false;
    const onLane = here && along && here.distance <= here.lane.width / 2 + 0.6 ? here : null;
    const road = onLane && onLane.lane.kind === 'road' ? onLane : null;

    this.speedCheck(o, road);
    this.wrongSideCheck(o, net, onLane);
    if (road) this.laneCheck(o, road);
    if (onLane) this.followCheck(o, onLane);
    this.lineCheck(o, net, road);
    this.junctionCheck(o, net, onLane, road);
  }

  private speedCheck(o: Observation, road: LanePosition | null): void {
    if (road) this.lastLimit = road.lane.speedLimit;
    if (this.lastLimit === null) return;
    const kmh = Math.abs(o.speed) * 3.6;
    const minor = this.rule('speeding').params;
    const serious = this.rule('speedingSerious').params;
    this.overFor = kmh > this.lastLimit + (minor['overKmh'] ?? 3) ? this.overFor + o.dt : 0;
    this.wellOverFor = kmh > this.lastLimit + (serious['overKmh'] ?? 10) ? this.wellOverFor + o.dt : 0;
    if (this.wellOverFor > (serious['forS'] ?? 2)) {
      this.raise('speedingSerious', o, `${Math.round(kmh)}/${this.lastLimit}`, 15);
      this.overFor = 0;
    } else if (this.overFor > (minor['forS'] ?? 3)) {
      this.raise('speeding', o, `${Math.round(kmh)}/${this.lastLimit}`, 15);
    }
  }

  private wrongSideCheck(o: Observation, net: RoadNetwork, onLane: LanePosition | null): void {
    // Not on a lane going our way, but on one going the other way.
    let wrong = false;
    if (!onLane && Math.abs(o.speed) > 1) {
      const nearest = net.locate(o, undefined, 3);
      if (nearest && nearest.lane.kind === 'road' && nearest.distance < nearest.lane.width / 2) {
        const off = Math.abs(headingDiff(headingOf(nearest.lane.path.directionAt(nearest.s)), o.headingDeg));
        // Reversing along a lane is not driving on the wrong side.
        wrong = off > 135 && o.speed > 0;
      }
    }
    this.wrongFor = wrong ? this.wrongFor + o.dt : 0;
    if (this.wrongFor > (this.rule('wrongSide').params['forS'] ?? 1)) this.raise('wrongSide', o, undefined, 10);
  }

  private laneCheck(o: Observation, road: LanePosition): void {
    const p = this.rule('laneStraddle').params;
    const over = Math.abs(road.lateral) + this.car.width / 2 - road.lane.width / 2;
    const straddling = over > (p['overM'] ?? 0.3) && o.speed > (p['minSpeed'] ?? 2) && o.indicator === 'off';
    this.straddleFor = straddling ? this.straddleFor + o.dt : 0;
    if (this.straddleFor > (p['forS'] ?? 3)) {
      this.raise('laneStraddle', o, undefined, 10);
      this.straddleFor = 0;
    }

    // Lane change: from a lane to the one beside it.
    const prev = this.prevRoad?.lane;
    if (prev && prev.id !== road.lane.id && (prev.left === road.lane.id || prev.right === road.lane.id) && o.speed > 1) {
      const side = prev.left === road.lane.id ? 'left' : 'right';
      const minOn = this.rule('indicatorLaneChange').params['minOnS'] ?? 1;
      if (o.indicator !== side || o.indicatorFor < minOn) this.raise('indicatorLaneChange', o, side, 4);
      if (!this.mirrorChecked(o, side, o.time)) this.raise('mirrorsTurn', o, side, 4);
    }
  }

  private followCheck(o: Observation, here: LanePosition): void {
    const p = this.rule('followingDistance').params;
    if (o.speed < (p['minSpeed'] ?? 5)) {
      this.followFor = 0;
      return;
    }
    let gap = Infinity;
    for (const v of o.others) {
      if (!v.lane) continue;
      let along: number;
      if (v.lane === here.lane.id && v.s > here.s) along = v.s - here.s;
      else if (here.lane.next.includes(v.lane)) along = here.lane.path.length - here.s + v.s;
      else continue;
      gap = Math.min(gap, along - this.car.front - v.length / 2);
    }
    const close = gap / o.speed < (p['minGapS'] ?? 1);
    this.followFor = close ? this.followFor + o.dt : 0;
    if (this.followFor > (p['forS'] ?? 3)) {
      this.raise('followingDistance', o, `${(gap / o.speed).toFixed(1)} s`, 10);
      this.followFor = 0;
    }
  }

  /** The line at the end of a lane: stop signs, signals, crossings on the way to it. */
  private lineCheck(o: Observation, net: RoadNetwork, road: LanePosition | null): void {
    if (!road) {
      this.prevRoad = null;
      return;
    }
    const lane = road.lane;
    // Stripes and stop lines are painted half a metre before the lane ends.
    const frontLeft = lane.path.length - 0.5 - (road.s + this.car.front);
    const prev = this.prevRoad && this.prevRoad.lane.id === lane.id ? this.prevRoad : null;

    if (lane.end.type === 'stop') {
      const zone = this.rule('stopSign').params['zoneM'] ?? 6;
      if (frontLeft < zone && frontLeft > -1) this.stopZoneMin = Math.min(this.stopZoneMin, Math.abs(o.speed));
      else if (frontLeft >= zone) this.stopZoneMin = Infinity;
    }

    // Pedestrian crossings on this lane.
    if (prev && o.speed > 0) {
      const frontNow = road.s + this.car.front;
      const frontThen = prev.s + this.car.front;
      net.crossings.forEach((c, i) => {
        const on = c.lanes.find((l) => l.lane === lane.id);
        if (!on) return;
        const stripes = on.s - c.width / 2;
        if (frontThen < stripes && frontNow >= stripes && o.crossings[i] === 2) this.raise('giveWayPedestrians', o, undefined, 5);
      });
    }

    if (prev && prev.frontLeft > 0 && frontLeft <= 0 && o.speed > 0) this.crossedLine(o, net, lane);
    this.prevRoad = { lane, s: road.s, frontLeft };
  }

  private crossedLine(o: Observation, net: RoadNetwork, lane: Lane): void {
    const end = lane.end;
    if (end.type === 'stop' && this.stopZoneMin > (this.rule('stopSign').params['stoppedBelow'] ?? 0.1)) {
      this.raise('stopSign', o, `${(this.stopZoneMin * 3.6).toFixed(1)} km/h`, 0);
    }
    if (end.type === 'signal') {
      const plan = net.signals.get(end.junction);
      if (plan) {
        const now = signalState(plan, end.group, o.signalTime);
        const earlier = signalState(plan, end.group, o.signalTime - (this.rule('amberLight').params['amberForS'] ?? 1.5));
        if (now === 'red') this.raise('redLight', o, undefined, 0);
        else if (now === 'amber' && earlier === 'amber') this.raise('amberLight', o, undefined, 0);
      }
    }
    this.stopZoneMin = Infinity;

    const roundabout = lane.next.some((id) => net.lane(id).next.some((n) => net.lane(n).kind === 'roundabout'));
    this.entry = {
      from: lane,
      time: o.time,
      x: o.x,
      z: o.z,
      indicator: o.indicator,
      indicatorFor: o.indicatorFor,
      mirrorLeftAt: o.mirrorLeftAt,
      mirrorCentreAt: o.mirrorCentreAt,
      mirrorRightAt: o.mirrorRightAt,
      headingDeg: headingOf(lane.path.directionAt(lane.path.length)),
      roundabout,
      choice: lane.next.length > 1,
      others: o.others.map((v) => ({ ...v })),
      braking: new Map(),
      taken: lane.next.length === 1 ? net.lane(lane.next[0]!) : null,
      giveWayChecked: false,
    };
    this.roundaboutExitChecked = false;
    if (this.entry.taken) this.giveWayCheck(o, net, this.entry);
  }

  private junctionCheck(o: Observation, net: RoadNetwork, onLane: LanePosition | null, road: LanePosition | null): void {
    const e = this.entry;
    const kind = onLane ? onLane.lane.kind : null;

    // Leaving a roundabout: signal right.
    if (e?.roundabout && this.prevLaneKind === 'roundabout' && onLane && kind !== 'roundabout' && !this.roundaboutExitChecked) {
      this.roundaboutExitChecked = true;
      if (o.indicator !== 'right') this.raise('indicatorRoundaboutExit', o, undefined, 0);
    }
    if (onLane) this.prevLaneKind = kind;

    if (!e) return;
    // Keep an eye on traffic we may have cut up.
    const watch = Math.max(this.rule('giveWayJunction').params['watchS'] ?? 3, this.rule('giveWayRoundabout').params['watchS'] ?? 3);
    if (o.time - e.time <= watch) {
      for (const v of o.others) {
        const seen = e.braking.get(v.id);
        if (!seen || v.accel < seen.accel) e.braking.set(v.id, { accel: v.accel, lane: v.lane });
      }
    } else if (e.taken && !e.giveWayChecked) {
      this.giveWayCheck(o, net, e);
    }

    // Out of the junction onto another road: judge the turn.
    if (!road || road.lane.id === e.from.id || e.from.left === road.lane.id || e.from.right === road.lane.id) return;
    if (!e.taken) {
      e.taken = net.lane(e.from.next.find((id) => net.lane(id).next.includes(road.lane.id)) ?? e.from.next[0]!);
    }
    if (!e.giveWayChecked) this.giveWayCheck(o, net, e);
    if (!e.roundabout && e.choice) {
      const turn = headingDiff(headingOf(road.lane.path.directionAt(road.s)), e.headingDeg);
      const abs = Math.abs(turn);
      if (abs > STRAIGHT_DEG && abs < 145) {
        const side = turn > 0 ? 'right' : 'left';
        const minOn = this.rule('indicatorTurn').params['minOnS'] ?? 2;
        if (e.indicator !== side || e.indicatorFor < minOn) this.raise('indicatorTurn', e, side, 0);
        if (!this.mirrorChecked(e, side, e.time)) this.raise('mirrorsTurn', e, side, 0);
      }
    }
    this.entry = null;
  }

  /** Did the car pull out in front of traffic it had to give way to? */
  private giveWayCheck(o: Observation, net: RoadNetwork, e: Entry): void {
    if (!e.taken || e.giveWayChecked) return;
    if (o.time - e.time < (this.rule('giveWayJunction').params['watchS'] ?? 3) && this.entry === e) {
      // Wait until the braking window has passed, unless we are leaving the junction already.
      const leaving = net.locate(o, o.headingDeg, 3)?.lane.kind === 'road';
      if (!leaving) return;
    }
    e.giveWayChecked = true;
    const yieldTo = new Set(e.taken.yieldTo);
    if (yieldTo.size === 0) return;
    const rule: RuleId = e.roundabout ? 'giveWayRoundabout' : 'giveWayJunction';
    const p = this.rule(rule).params;
    // Where we join their path: on a roundabout, where the entry meets the ring.
    const merge: P2 = e.roundabout ? e.taken.path.pointAt(e.taken.path.length) : e.taken.path.pointAt(0);
    let conflict = false;
    for (const v of e.others) {
      if (!v.lane || !yieldTo.has(v.lane)) continue;
      const dx = merge.x - v.x;
      const dz = merge.z - v.z;
      const d = Math.hypot(dx, dz);
      const a = (v.headingDeg * Math.PI) / 180;
      const approaching = dx * Math.sin(a) - dz * Math.cos(a) > 0;
      if (d < (p['nearM'] ?? 8) || (approaching && v.speed > 0.5 && d / v.speed < (p['gapS'] ?? 2.5))) conflict = true;
    }
    for (const b of e.braking.values()) {
      if (b.lane && yieldTo.has(b.lane) && b.accel <= (p['brakeHard'] ?? -3.5)) conflict = true;
    }
    if (conflict) this.raise(rule, e, undefined, 0);
  }

  private mirrorChecked(m: Pick<Observation, 'mirrorLeftAt' | 'mirrorCentreAt' | 'mirrorRightAt'>, side: 'left' | 'right', at: number): boolean {
    const lookback = this.rule('mirrorsTurn').params['lookbackS'] ?? 6;
    const sideAt = side === 'left' ? m.mirrorLeftAt : m.mirrorRightAt;
    return Math.max(sideAt, m.mirrorCentreAt) >= at - lookback;
  }
}

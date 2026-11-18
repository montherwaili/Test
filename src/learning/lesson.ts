/**
 * Lessons: a short list of goals done in order, with a hint for each, and
 * one to three stars at the end. Pure TypeScript; the game feeds it the same
 * observations the examiner sees, plus the engine's state.
 */
import raw from '../data/lessons.json';
import type { ExamResult } from '../examiner/examiner';
import type { Observation } from '../examiner/observation';
import type { RouteGuide } from '../examiner/route';
import type { Text } from '../examiner/rules';
import type { Manoeuvre } from '../examiner/yard';

export type Goal =
  | { type: 'seatbelt' }
  | { type: 'engineStart'; belt?: boolean }
  | { type: 'mirrors' }
  | { type: 'indicators' }
  | { type: 'gear'; gear: number }
  | { type: 'handbrake'; on: boolean }
  | { type: 'reachSpeed'; kmh: number }
  | { type: 'gearsUsed'; gears: number[] }
  | { type: 'stop' }
  | { type: 'manoeuvre'; id: string }
  | { type: 'route' };

export type GoalDef = Goal & { text: Text; hint: Text };

export interface LessonDef {
  id: string;
  /** The skill this lesson trains (for adaptive practice). */
  skill: string;
  title: Text;
  intro: Text;
  map: 'town' | 'yard';
  traffic?: number;
  start: { lane: string; at: number } | { x: number; z: number; headingDeg: number };
  route?: { checkpoints: string[]; finish: { lane: string; at: number } };
  goals: GoalDef[];
  /** Finish within this for three stars, s. */
  targetS?: number;
  twoStarMaxMinor?: number;
}

export function loadLessons(): LessonDef[] {
  return (raw as { lessons: LessonDef[] }).lessons;
}

/** What a lesson watches each step: the examiner's observation and the engine. */
export interface LessonObservation extends Observation {
  running: boolean;
}

export type LessonEvent = { type: 'goal'; index: number } | { type: 'complete' };

/** Moving faster than this counts as driving in a gear, km/h. */
const MOVING_KMH = 5;
/** Stationary this long counts as stopped, s. */
const STOP_S = 1;

export class LessonRunner {
  /** Index of the goal being worked on; equal to goals.length when all are done. */
  current = 0;
  complete = false;
  completedAt = 0;
  startedAt: number | null = null;
  private seenLeft = false;
  private seenRight = false;
  private gearsSeen = new Set<number>();
  private moved = false;
  private stillFor = 0;

  constructor(
    readonly def: LessonDef,
    private readonly manoeuvres: Manoeuvre[] = [],
    private readonly route: RouteGuide | null = null,
  ) {}

  get goal(): GoalDef | null {
    return this.def.goals[this.current] ?? null;
  }

  step(o: LessonObservation): LessonEvent[] {
    if (this.complete) return [];
    this.startedAt ??= o.time;
    const events: LessonEvent[] = [];
    const kmh = Math.abs(o.speed) * 3.6;
    if (o.indicator === 'left') this.seenLeft = true;
    if (o.indicator === 'right') this.seenRight = true;
    if (kmh > MOVING_KMH && o.gear > 0) this.gearsSeen.add(o.gear);
    if (kmh > MOVING_KMH) this.moved = true;
    this.stillFor = Math.abs(o.speed) < 0.05 ? this.stillFor + o.dt : 0;

    // Several goals can be met on the same step (belt already on, engine already running).
    for (let guard = 0; guard < this.def.goals.length; guard++) {
      const g = this.goal;
      if (!g || !this.met(g, o, kmh)) break;
      events.push({ type: 'goal', index: this.current });
      this.current++;
      // Goals that need movement start afresh after the one before.
      this.moved = false;
    }
    if (this.current >= this.def.goals.length) {
      this.complete = true;
      this.completedAt = o.time;
      events.push({ type: 'complete' });
    }
    return events;
  }

  private met(g: GoalDef, o: LessonObservation, kmh: number): boolean {
    switch (g.type) {
      case 'seatbelt':
        return o.seatbelt;
      case 'engineStart':
        return o.running && (!g.belt || o.seatbelt);
      case 'mirrors':
        return [o.mirrorLeftAt, o.mirrorCentreAt, o.mirrorRightAt].every((t) => t >= (this.startedAt ?? 0));
      case 'indicators':
        return this.seenLeft && this.seenRight;
      case 'gear':
        return o.gear === g.gear;
      case 'handbrake':
        return o.handbrake === g.on;
      case 'reachSpeed':
        return kmh >= g.kmh;
      case 'gearsUsed':
        return g.gears.every((n) => this.gearsSeen.has(n));
      case 'stop':
        return this.moved && this.stillFor >= STOP_S;
      case 'manoeuvre': {
        const m = this.manoeuvres.find((x) => x.def.id === g.id);
        return m?.state === 'done';
      }
      case 'route':
        return this.route?.finished ?? false;
    }
  }

  /** Stars for a finished lesson, from the faults made during it. 0 if not finished. */
  stars(result: Pick<ExamResult, 'minor' | 'serious' | 'fail'>): number {
    if (!this.complete) return 0;
    const time = this.completedAt - (this.startedAt ?? this.completedAt);
    const clean = result.minor + result.serious + result.fail === 0;
    const manoeuvresClean = this.manoeuvres.every((m) => m.result === null || m.result.ok);
    if (clean && manoeuvresClean && (this.def.targetS === undefined || time <= this.def.targetS)) return 3;
    if (result.serious === 0 && result.fail === 0 && result.minor <= (this.def.twoStarMaxMinor ?? 2)) return 2;
    return 1;
  }
}

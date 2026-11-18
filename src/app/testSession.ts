/**
 * A test in progress: the road test follows a route with the examiner's
 * instructions; the yard test waits for the four exercises. Either way it
 * ends with the result screen.
 */
import routesJson from '../data/routes.json';
import type { Fault } from '../examiner/examiner';
import { RouteGuide, type Instruction, type RouteDef } from '../examiner/route';
import { verdict } from '../examiner/verdict';
import type { RoadNetwork } from '../world/roads/network';
import type { Hud } from '../ui/hud';
import { t, type StringKey } from '../ui/i18n';
import type { ResultData } from '../ui/results';
import type { ExamSession } from './examining';

export const ROAD_ROUTE = routesJson.routes[0] as RouteDef;
const YARD_TIME_LIMIT = 900;
/** The car's track is sampled this often for the result map, s. */
const PATH_EVERY = 0.5;

const ORDINALS: StringKey[] = ['ord1', 'ord2', 'ord3', 'ord4'];

/** The arrow and words for an instruction (words as a function, so they follow the language). */
export function instructionText(i: Instruction): { icon: string; text: () => string } {
  switch (i.kind) {
    case 'start':
      return { icon: '▶', text: () => t('instrStart') };
    case 'finish':
      return { icon: 'P', text: () => t('instrFinish') };
    case 'roundabout':
      return { icon: '⟲', text: () => t('instrRoundabout', { n: t(ORDINALS[Math.min(i.exit, 4) - 1] ?? 'ord1') }) };
    case 'turn':
      return i.turn === 'left'
        ? { icon: '↰', text: () => t('instrLeft') }
        : i.turn === 'right'
          ? { icon: '↱', text: () => t('instrRight') }
          : { icon: '↑', text: () => t('instrStraight') };
  }
}

export class TestSession {
  readonly guide: RouteGuide | null;
  ended = false;
  private startedAt: number | null = null;
  private distance = 0;
  private path: { x: number; z: number }[] = [];
  private pathIn = 0;
  private last: { x: number; z: number } | null = null;
  private yardDoneFor = 0;

  constructor(
    readonly kind: 'road' | 'yard',
    private readonly exam: ExamSession,
    network: RoadNetwork | null,
    private readonly hud: Hud,
    private readonly lines: { x: number; z: number }[][],
    private readonly onEnd: (result: ResultData) => void,
  ) {
    this.guide = kind === 'road' && network ? new RouteGuide(network, ROAD_ROUTE) : null;
    if (kind === 'yard') hud.instruct('▶', () => t('instrYard'), 14);
  }

  get timeLimit(): number {
    return this.guide ? this.guide.def.timeLimitS : YARD_TIME_LIMIT;
  }

  /** Call every simulation step with the car's state. */
  step(o: { time: number; dt: number; x: number; z: number; headingDeg: number; speed: number; handbrake: boolean }): void {
    if (this.ended) return;
    this.startedAt ??= o.time;
    if (this.last) this.distance += Math.hypot(o.x - this.last.x, o.z - this.last.z);
    this.last = { x: o.x, z: o.z };
    this.pathIn -= o.dt;
    if (this.pathIn <= 0) {
      this.pathIn = PATH_EVERY;
      this.path.push({ x: o.x, z: o.z });
    }

    if (this.guide) {
      for (const e of this.guide.step(o)) {
        if (e.type === 'instruction') {
          const { icon, text } = instructionText(e.instruction);
          this.hud.instruct(icon, text, e.instruction.kind === 'finish' ? 30 : 9);
        } else if (e.type === 'offRoute') {
          this.hud.instruct('↺', () => t('instrOffRoute'), 5);
        } else {
          this.end(true);
          return;
        }
      }
    } else {
      // Yard: over once every exercise has been done (a moment's pause to see the last result).
      const all = this.exam.examiner.manoeuvres.every((m) => m.state === 'done');
      this.yardDoneFor = all ? this.yardDoneFor + o.dt : 0;
      if (this.yardDoneFor > 2.5) {
        this.end(true);
        return;
      }
    }

    if (o.time - this.startedAt > this.timeLimit) {
      this.hud.say('msgTimeUp', 4);
      this.end(false);
    }
  }

  /** Faults that end a test on the spot (a collision). */
  onFault(f: Fault): void {
    if (!this.ended && f.rule === 'collision') {
      this.hud.say('msgTestEnded', 4);
      this.end(false);
    }
  }

  end(completed: boolean): void {
    if (this.ended) return;
    this.ended = true;
    const ex = this.exam.examiner;
    const r = ex.result();
    const start = this.startedAt ?? 0;
    if (this.last) this.path.push({ ...this.last });
    this.onEnd({
      kind: this.kind,
      verdict: verdict(r, completed, ex.book.scoring),
      durationS: this.lastTime() - start,
      distanceM: this.distance,
      counts: { minor: r.minor, serious: r.serious, fail: r.fail },
      faults: r.faults.map((f, i) => {
        const rule = ex.rule(f.rule);
        return { n: i + 1, severity: f.severity, time: f.time - start, x: f.x, z: f.z, title: rule.title, tip: rule.tip };
      }),
      manoeuvres: ex.manoeuvres.map((m) => ({ title: m.def.title, ok: m.result ? m.result.ok : null })),
      path: this.path,
      lines: this.lines,
    });
  }

  private lastTime(): number {
    return this.exam.lastTime;
  }
}

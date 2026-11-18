/**
 * A lesson in progress: shows the current goal, gives hints, passes on route
 * directions, shows faults with their tips as they happen, and ends with the
 * stars earned.
 */
import type { Fault } from '../examiner/examiner';
import type { LessonObservation } from '../learning/lesson';
import { LessonRunner, type LessonDef } from '../learning/lesson';
import { RouteGuide } from '../examiner/route';
import type { RoadNetwork } from '../world/roads/network';
import type { Hud } from '../ui/hud';
import { getLang, t } from '../ui/i18n';
import type { ResultData } from '../ui/results';
import type { ExamSession } from './examining';
import { instructionText } from './testSession';

/** With no progress for this long, the hint for the current goal is shown, s. */
const HINT_AFTER = 25;
const PATH_EVERY = 0.5;

export class LessonSession {
  readonly runner: LessonRunner;
  readonly guide: RouteGuide | null;
  ended = false;
  private sinceProgress = 0;
  private hinted = false;
  private path: { x: number; z: number }[] = [];
  private pathIn = 0;
  private distance = 0;
  private last: { x: number; z: number } | null = null;

  constructor(
    readonly def: LessonDef,
    private readonly exam: ExamSession,
    network: RoadNetwork | null,
    private readonly hud: Hud,
    private readonly lines: { x: number; z: number }[][],
    private readonly onEnd: (result: ResultData, stars: number) => void,
  ) {
    this.guide =
      def.route && network && 'lane' in def.start
        ? new RouteGuide(network, {
            id: def.id,
            title: def.title,
            start: def.start,
            checkpoints: def.route.checkpoints,
            finish: def.route.finish,
            timeLimitS: 3600,
          })
        : null;
    this.runner = new LessonRunner(def, exam.examiner.manoeuvres, this.guide);
    hud.instruct('🎓', () => def.intro[getLang()], 10);
    this.showGoal();
  }

  step(o: LessonObservation): void {
    if (this.ended) return;
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
        }
      }
    }

    this.sinceProgress += o.dt;
    for (const e of this.runner.step(o)) {
      if (e.type === 'goal') {
        this.sinceProgress = 0;
        this.hinted = false;
        this.hud.sayText(t('lessonWellDone'), 'good', 2);
        this.showGoal();
      } else {
        this.end(true);
        return;
      }
    }
    if (!this.hinted && this.sinceProgress > HINT_AFTER) {
      this.hinted = true;
      this.hud.showHint();
    }
  }

  /** In a lesson every fault is shown at once, with the tip for it. */
  onFault(f: Fault): void {
    const rule = this.exam.examiner.rule(f.rule);
    const lang = getLang();
    this.hud.fault(f.severity, `${rule.title[lang]}. ${rule.tip[lang]}`);
  }

  end(completed: boolean): void {
    if (this.ended) return;
    this.ended = true;
    this.hud.setGoal(null);
    const ex = this.exam.examiner;
    const r = ex.result();
    const stars = this.runner.stars(r);
    const start = this.runner.startedAt ?? 0;
    if (this.last) this.path.push({ ...this.last });
    this.onEnd(
      {
        kind: 'lesson',
        lesson: { title: this.def.title, stars, completed },
        verdict: { passed: completed, reasons: completed ? [] : ['incomplete'] },
        durationS: (completed ? this.runner.completedAt : this.exam.lastTime) - start,
        distanceM: this.distance,
        counts: { minor: r.minor, serious: r.serious, fail: r.fail },
        faults: r.faults.map((f, i) => {
          const rule = ex.rule(f.rule);
          return { n: i + 1, severity: f.severity, time: f.time - start, at: f.time, x: f.x, z: f.z, title: rule.title, tip: rule.tip };
        }),
        manoeuvres: [],
        path: this.path,
        lines: this.lines,
      },
      stars,
    );
  }

  private showGoal(): void {
    const g = this.runner.goal;
    if (!g) {
      this.hud.setGoal(null);
      return;
    }
    this.hud.setGoal({
      step: this.runner.current + 1,
      total: this.def.goals.length,
      text: () => g.text[getLang()],
      hint: () => g.hint[getLang()],
    });
  }
}

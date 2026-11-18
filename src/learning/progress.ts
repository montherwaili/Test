/**
 * The learner's progress: best stars per lesson, and which skills they get
 * wrong most, to suggest what to practise next. Pure; saving is done by the
 * caller (it is plain JSON).
 */
import type { Severity } from '../examiner/rules';

/** Which skill each examiner rule belongs to. */
export const RULE_SKILL: Record<string, string> = {
  seatbelt: 'observation',
  mirrorsMoveOff: 'observation',
  mirrorsTurn: 'observation',
  collision: 'observation',
  giveWayPedestrians: 'observation',
  stall: 'movingOff',
  stopLineAccuracy: 'movingOff',
  stopLineOvershoot: 'movingOff',
  rollback: 'hillStart',
  hillStartLine: 'hillStart',
  bayNotInside: 'parking',
  touchPole: 'parking',
  manoeuvreTime: 'parking',
  manoeuvreAbandoned: 'parking',
  touchKerb: 'parking',
  mountKerb: 'parking',
  giveWayRoundabout: 'roundabouts',
  indicatorRoundaboutExit: 'roundabouts',
  giveWayJunction: 'junctions',
  stopSign: 'junctions',
  redLight: 'junctions',
  amberLight: 'junctions',
  indicatorTurn: 'junctions',
  speeding: 'junctions',
  speedingSerious: 'junctions',
  laneStraddle: 'junctions',
  wrongSide: 'junctions',
  followingDistance: 'junctions',
  indicatorLaneChange: 'junctions',
};

const WEIGHT: Record<Severity, number> = { minor: 1, serious: 3, fail: 5 };
/** Older mistakes count for less each time new ones are recorded. */
const DECAY = 0.85;
/** A three-star lesson takes this much off its skill's score. */
const MASTERED = 0.4;

export interface ProgressData {
  version: 1;
  /** Best stars per lesson id (0..3). */
  stars: Record<string, number>;
  /** Weighted count of recent faults per skill. */
  skills: Record<string, number>;
  /** Tests taken and passed. */
  tests: { taken: number; passed: number };
}

export function emptyProgress(): ProgressData {
  return { version: 1, stars: {}, skills: {}, tests: { taken: 0, passed: 0 } };
}

/** Accept saved data only if it has the right shape; anything else starts afresh. */
export function parseProgress(input: unknown): ProgressData {
  const p = emptyProgress();
  if (typeof input !== 'object' || input === null) return p;
  const r = input as Record<string, unknown>;
  const numbers = (v: unknown, max: number): Record<string, number> => {
    const out: Record<string, number> = {};
    if (typeof v === 'object' && v !== null) {
      for (const [k, n] of Object.entries(v)) if (typeof n === 'number' && Number.isFinite(n) && n >= 0) out[k] = Math.min(n, max);
    }
    return out;
  };
  p.stars = numbers(r['stars'], 3);
  p.skills = numbers(r['skills'], 1e6);
  const tests = r['tests'] as Record<string, unknown> | undefined;
  if (tests && typeof tests['taken'] === 'number' && typeof tests['passed'] === 'number') {
    p.tests = { taken: Math.max(0, tests['taken']), passed: Math.max(0, Math.min(tests['passed'], tests['taken'])) };
  }
  return p;
}

/** Record the faults of a lesson or test. */
export function recordFaults(p: ProgressData, faults: { rule: string; severity: Severity }[]): void {
  for (const k of Object.keys(p.skills)) p.skills[k] = p.skills[k]! * DECAY;
  for (const f of faults) {
    const skill = RULE_SKILL[f.rule];
    if (skill) p.skills[skill] = (p.skills[skill] ?? 0) + WEIGHT[f.severity];
  }
}

export function recordLesson(p: ProgressData, lessonId: string, skill: string, stars: number): void {
  p.stars[lessonId] = Math.max(p.stars[lessonId] ?? 0, stars);
  if (stars === 3 && p.skills[skill] !== undefined) p.skills[skill] = p.skills[skill]! * MASTERED;
}

export function recordTest(p: ProgressData, passed: boolean): void {
  p.tests.taken++;
  if (passed) p.tests.passed++;
}

/**
 * The lesson to practise next: the one for the skill with the most recent
 * faults; failing that, the first lesson not yet done with three stars.
 */
export function recommend(p: ProgressData, lessons: { id: string; skill: string }[]): string | null {
  let worst: string | null = null;
  let score = 0.5;
  for (const [skill, s] of Object.entries(p.skills)) {
    if (s > score && lessons.some((l) => l.skill === skill)) {
      worst = skill;
      score = s;
    }
  }
  if (worst) return lessons.find((l) => l.skill === worst)!.id;
  return lessons.find((l) => (p.stars[l.id] ?? 0) < 3)?.id ?? null;
}

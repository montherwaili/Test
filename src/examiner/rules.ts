/**
 * The examiner's rule book: what counts as a fault, how serious it is, and
 * what to tell the learner. All of it lives in src/data/rules.json so it can
 * be matched to the real Royal Oman Police test without touching code.
 */
import raw from '../data/rules.json';

export type Severity = 'minor' | 'serious' | 'fail';

export interface Text {
  ar: string;
  en: string;
}

export interface Rule {
  id: string;
  severity: Severity;
  /** False until checked against the real test (see the note in rules.json). */
  verified: boolean;
  params: Record<string, number>;
  title: Text;
  tip: Text;
}

export interface Scoring {
  /** More minor faults than this fails the test. */
  maxMinor: number;
  /** More serious faults than this fails the test. */
  maxSerious: number;
  verified: boolean;
}

export interface RuleBook {
  scoring: Scoring;
  rules: Map<string, Rule>;
}

/** Every rule the examiner code raises; the rule book must define all of them. */
export const RULE_IDS = [
  'seatbelt',
  'mirrorsMoveOff',
  'mirrorsTurn',
  'indicatorTurn',
  'indicatorRoundaboutExit',
  'indicatorLaneChange',
  'speeding',
  'speedingSerious',
  'stopSign',
  'redLight',
  'amberLight',
  'giveWayRoundabout',
  'giveWayJunction',
  'giveWayPedestrians',
  'stall',
  'rollback',
  'touchPole',
  'touchKerb',
  'mountKerb',
  'laneStraddle',
  'wrongSide',
  'followingDistance',
  'collision',
  'bayNotInside',
  'manoeuvreTime',
  'manoeuvreAbandoned',
  'hillStartLine',
  'stopLineAccuracy',
  'stopLineOvershoot',
] as const;

export type RuleId = (typeof RULE_IDS)[number];

const SEVERITIES: Severity[] = ['minor', 'serious', 'fail'];

export class RuleBookError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid rule book:\n- ${problems.join('\n- ')}`);
    this.name = 'RuleBookError';
  }
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is Text => isRec(v) && typeof v['ar'] === 'string' && v['ar'] !== '' && typeof v['en'] === 'string' && v['en'] !== '';

export function validateRuleBook(input: unknown): RuleBook {
  const problems: string[] = [];
  const root = isRec(input) ? input : {};
  const sc = isRec(root['scoring']) ? root['scoring'] : {};
  const num = (v: unknown, name: string): number => {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
    problems.push(`${name} must be a number >= 0`);
    return 0;
  };
  const scoring: Scoring = {
    maxMinor: num(sc['maxMinor'], 'scoring.maxMinor'),
    maxSerious: num(sc['maxSerious'], 'scoring.maxSerious'),
    verified: sc['verified'] === true,
  };
  const rulesRaw = isRec(root['rules']) ? root['rules'] : {};
  const rules = new Map<string, Rule>();
  for (const id of RULE_IDS) {
    const r = rulesRaw[id];
    if (!isRec(r)) {
      problems.push(`rule "${id}" is missing`);
      continue;
    }
    const severity = r['severity'] as Severity;
    if (!SEVERITIES.includes(severity)) problems.push(`${id}.severity must be minor, serious or fail`);
    if (!isText(r['title'])) problems.push(`${id}.title needs Arabic and English text`);
    if (!isText(r['tip'])) problems.push(`${id}.tip needs Arabic and English text`);
    const params: Record<string, number> = {};
    if (isRec(r['params'])) {
      for (const [k, v] of Object.entries(r['params'])) {
        if (typeof v === 'number' && Number.isFinite(v)) params[k] = v;
        else problems.push(`${id}.params.${k} must be a number`);
      }
    }
    rules.set(id, {
      id,
      severity,
      verified: r['verified'] === true,
      params,
      title: r['title'] as Text,
      tip: r['tip'] as Text,
    });
  }
  for (const id of Object.keys(rulesRaw)) {
    if (!(RULE_IDS as readonly string[]).includes(id)) problems.push(`rule "${id}" is not one the examiner knows`);
  }
  if (problems.length) throw new RuleBookError(problems);
  return { scoring, rules };
}

export function loadRuleBook(): RuleBook {
  return validateRuleBook(structuredClone(raw));
}

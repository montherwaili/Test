/** Pass or fail, and why, from the examiner's record. Pure. */
import type { ExamResult } from './examiner';
import type { Scoring } from './rules';

export type VerdictReason = 'failFault' | 'tooManySerious' | 'tooManyMinor' | 'incomplete';

export interface Verdict {
  passed: boolean;
  reasons: VerdictReason[];
}

/**
 * A test is passed when it was completed, with no fail-level fault, no more
 * serious faults than allowed and no more minor faults than allowed.
 */
export function verdict(result: ExamResult, completed: boolean, scoring: Scoring): Verdict {
  const reasons: VerdictReason[] = [];
  if (!completed) reasons.push('incomplete');
  if (result.fail > 0) reasons.push('failFault');
  if (result.serious > scoring.maxSerious) reasons.push('tooManySerious');
  if (result.minor > scoring.maxMinor) reasons.push('tooManyMinor');
  return { passed: reasons.length === 0, reasons };
}

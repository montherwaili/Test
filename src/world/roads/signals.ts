/**
 * Traffic signal timing. A junction's approaches take turns: each gets green,
 * then amber, then everyone waits on red for a moment before the next. The
 * state is a pure function of time, so traffic, the examiner and the lamps on
 * screen always agree, and replays are exact.
 *
 * TODO(verify with ROP / Oman practice): the phase order, the timings below
 * and whether Oman shows a flashing green before amber.
 */
export type SignalState = 'green' | 'amber' | 'red';

export interface SignalPlan {
  /** Junction id. */
  id: string;
  /** Approaches in the order they get green. */
  groups: string[];
  /** Seconds. */
  green: number;
  amber: number;
  allRed: number;
  /** Shifts this junction's cycle so neighbouring junctions are out of step, s. */
  offset: number;
}

export function cycleLength(plan: SignalPlan): number {
  return plan.groups.length * (plan.green + plan.amber + plan.allRed);
}

export function signalState(plan: SignalPlan, group: string, time: number): SignalState {
  const index = plan.groups.indexOf(group);
  if (index < 0) return 'red';
  const slot = plan.green + plan.amber + plan.allRed;
  const cycle = plan.groups.length * slot;
  let t = (time + plan.offset) % cycle;
  if (t < 0) t += cycle;
  const into = t - index * slot;
  if (into < 0 || into >= slot) return 'red';
  if (into < plan.green) return 'green';
  if (into < plan.green + plan.amber) return 'amber';
  return 'red';
}

/** Seconds until `group` next turns green (0 if it is green now). */
export function timeToGreen(plan: SignalPlan, group: string, time: number): number {
  const index = plan.groups.indexOf(group);
  if (index < 0) return Infinity;
  const slot = plan.green + plan.amber + plan.allRed;
  const cycle = plan.groups.length * slot;
  let t = (time + plan.offset) % cycle;
  if (t < 0) t += cycle;
  const start = index * slot;
  if (t >= start && t < start + plan.green) return 0;
  return t < start ? start - t : cycle - t + start;
}

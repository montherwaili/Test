/**
 * The car's secondary controls: indicators, headlights, horn, seatbelt and
 * mirror checks. Pure state with timestamps and events, so the examiner can
 * later ask "was the indicator on for 3 seconds before that turn?" or "did the
 * driver check the mirror before moving off?".
 */
export type IndicatorMode = 'off' | 'left' | 'right' | 'hazard';
export type HeadlightMode = 'off' | 'low' | 'high';
export type Mirror = 'left' | 'centre' | 'right';

export type AncillaryEvent =
  | { type: 'indicator'; mode: IndicatorMode; time: number; auto: boolean }
  | { type: 'headlights'; mode: HeadlightMode; time: number }
  | { type: 'horn'; on: boolean; time: number }
  | { type: 'seatbelt'; fastened: boolean; time: number }
  | { type: 'mirror'; mirror: Mirror; time: number };

/** Indicator flashes per second (a car's is between 1 and 2). */
const BLINK_HZ = 1.5;
/** Steering beyond this (of full lock) counts as "the turn has started". */
const CANCEL_ARM = 0.25;
/** Steering back within this after a turn cancels the indicator, as the stalk does. */
const CANCEL_RELEASE = 0.08;

export interface AncillaryState {
  time: number;
  indicator: IndicatorMode;
  /** Seconds since the indicator was switched on. */
  indicatorFor: number;
  /** The steering has swung into the indicated turn (self-cancel is armed). */
  indicatorArmed: boolean;
  headlights: HeadlightMode;
  horn: boolean;
  seatbelt: boolean;
  /** Time of the last glance at each mirror, -Infinity if never. */
  mirrorLeftAt: number;
  mirrorCentreAt: number;
  mirrorRightAt: number;
}

export class Ancillaries {
  state: AncillaryState = {
    time: 0,
    indicator: 'off',
    indicatorFor: 0,
    indicatorArmed: false,
    headlights: 'off',
    horn: false,
    seatbelt: false,
    mirrorLeftAt: -Infinity,
    mirrorCentreAt: -Infinity,
    mirrorRightAt: -Infinity,
  };
  private pending: AncillaryEvent[] = [];

  /** Stalk: asking for the mode already on switches it off. */
  toggleIndicator(mode: Exclude<IndicatorMode, 'off'>): void {
    this.setIndicator(this.state.indicator === mode ? 'off' : mode, false);
  }

  setIndicator(mode: IndicatorMode, auto = false): void {
    const s = this.state;
    if (s.indicator === mode) return;
    s.indicator = mode;
    s.indicatorFor = 0;
    s.indicatorArmed = false;
    this.pending.push({ type: 'indicator', mode, time: s.time, auto });
  }

  /** off -> low -> high -> off */
  cycleHeadlights(): void {
    const s = this.state;
    s.headlights = s.headlights === 'off' ? 'low' : s.headlights === 'low' ? 'high' : 'off';
    this.pending.push({ type: 'headlights', mode: s.headlights, time: s.time });
  }

  setHorn(on: boolean): void {
    if (this.state.horn === on) return;
    this.state.horn = on;
    this.pending.push({ type: 'horn', on, time: this.state.time });
  }

  toggleSeatbelt(): void {
    this.state.seatbelt = !this.state.seatbelt;
    this.pending.push({ type: 'seatbelt', fastened: this.state.seatbelt, time: this.state.time });
  }

  glance(mirror: Mirror): void {
    const s = this.state;
    if (mirror === 'left') s.mirrorLeftAt = s.time;
    else if (mirror === 'right') s.mirrorRightAt = s.time;
    else s.mirrorCentreAt = s.time;
    this.pending.push({ type: 'mirror', mirror, time: s.time });
  }

  /** Is the left / right indicator lamp lit right now (they flash)? */
  get lamps(): { left: boolean; right: boolean } {
    const s = this.state;
    if (s.indicator === 'off') return { left: false, right: false };
    const lit = (s.indicatorFor * BLINK_HZ) % 1 < 0.5;
    return {
      left: lit && (s.indicator === 'left' || s.indicator === 'hazard'),
      right: lit && (s.indicator === 'right' || s.indicator === 'hazard'),
    };
  }

  /**
   * Advance one step. `steer` is the steering wheel position (-1 left .. +1
   * right), used to cancel the indicator after a turn. Returns the events
   * raised since the last step.
   */
  step(dt: number, steer: number): AncillaryEvent[] {
    const s = this.state;
    s.time += dt;
    if (s.indicator !== 'off') {
      s.indicatorFor += dt;
      if (s.indicator === 'left' || s.indicator === 'right') {
        const into = s.indicator === 'left' ? -steer : steer;
        if (into > CANCEL_ARM) s.indicatorArmed = true;
        else if (s.indicatorArmed && Math.abs(steer) < CANCEL_RELEASE) this.setIndicator('off', true);
      }
    }
    const events = this.pending;
    this.pending = [];
    return events;
  }
}

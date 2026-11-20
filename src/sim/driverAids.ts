/**
 * Gearbox help for players who do not want to work the clutch: it sits
 * between the player's controls and the car and works the clutch pedal (and,
 * in automatic, the gear lever) the way a smooth driver would. The car
 * underneath is the same manual car: nothing is faked in the physics.
 *
 *  - 'manual': no help; the player's clutch and gear go straight through.
 *  - 'autoClutch': the player picks gears (E/Q, 1-5, R); the clutch dips for
 *    each change, the throttle is lifted through it, and the clutch takes up
 *    the drive when moving off and lets go before the engine would stall.
 *  - 'automatic': as autoClutch, and it also changes gear itself; the player
 *    picks D (any forward gear), N or R.
 *
 * Pure: state in, controls out; no rendering, no timers.
 */
import { GEAR_NEUTRAL, GEAR_REVERSE, type Gear } from './gearbox';

export type GearboxMode = 'manual' | 'autoClutch' | 'automatic';

export interface AidInput {
  /** The gear the player has chosen (in automatic: >= 1 means D). */
  selected: Gear;
  /** The player's own clutch pedal, 0..1 (used in manual only). */
  clutch: number;
  throttle: number;
  /** Engine speed, rpm. */
  rpm: number;
  /** The gear actually engaged in the car. */
  engaged: Gear;
  running: boolean;
  /** Road speed, m/s, forwards positive. */
  speed: number;
}

export interface AidOutput {
  gear: Gear;
  clutch: number;
  throttle: number;
}

export interface AidTuning {
  idleRpm: number;
  redlineRpm: number;
  forwardGears: number;
}

/** Seconds to push the clutch down for a change, and to let it up again. */
const DIP_TIME = 0.12;
const RELEASE_TIME = 0.3;
/** Least time between two automatic changes, s. */
const SHIFT_GAP = 0.9;

type Phase = { kind: 'drive' } | { kind: 'dip'; t: number; target: Gear } | { kind: 'release'; t: number };

export class GearboxAssist {
  private phase: Phase = { kind: 'drive' };
  /** The clutch the take-up control wants, eased (0 = engaged). */
  private takeUp = 1;
  private sinceShift = 10;
  /** Automatic: the forward gear it has chosen. */
  private autoGear = 1;

  constructor(
    public mode: GearboxMode,
    private readonly t: AidTuning,
  ) {}

  /** What the box is in, for the display: 'D3' in automatic, else the gear. */
  label(selected: Gear, engaged: Gear): string {
    if (this.mode === 'automatic' && selected >= 1) return `D${Math.max(1, engaged)}`;
    return selected === GEAR_REVERSE ? 'R' : selected === GEAR_NEUTRAL ? 'N' : String(selected);
  }

  step(dt: number, i: AidInput): AidOutput {
    if (this.mode === 'manual') {
      this.phase = { kind: 'drive' };
      return { gear: i.selected, clutch: i.clutch, throttle: i.throttle };
    }
    this.sinceShift += dt;

    // Which gear should be in.
    let want = i.selected;
    if (this.mode === 'automatic' && i.selected >= 1) want = this.chooseGear(i);
    else if (i.selected >= 1) this.autoGear = i.selected;

    // A change under way: clutch down, change, clutch up.
    let throttle = i.throttle;
    let clutch: number;
    const p = this.phase;
    if (p.kind === 'drive' && want !== i.engaged) {
      this.phase = { kind: 'dip', t: 0, target: want };
    }
    const q = this.phase;
    if (q.kind === 'dip') {
      q.t += dt;
      clutch = Math.min(1, q.t / DIP_TIME);
      throttle = 0;
      if (q.target !== want) q.target = want;
      const gear = clutch >= 1 ? q.target : i.engaged;
      if (clutch >= 1) {
        this.phase = { kind: 'release', t: 0 };
        this.sinceShift = 0;
      }
      return { gear, clutch, throttle };
    }

    // Taking up the drive: the clutch bites as the engine gets above idle and
    // lets go as it sinks towards a stall, like a centrifugal clutch.
    const idle = this.t.idleRpm;
    const bite = smoothstep(idle + 30, idle + 550, i.rpm);
    // Once fully in, it stays in until the engine is close to stalling: a diesel pulls from low revs.
    const locked = this.takeUp < 0.05 && i.rpm > idle + 60;
    const needed = want === GEAR_NEUTRAL || !i.running ? 1 : locked ? 0 : 1 - bite;
    // Down quickly (to save a stall), up gently.
    const rate = needed > this.takeUp ? 12 : 3;
    this.takeUp += (needed - this.takeUp) * Math.min(1, dt * rate);
    clutch = this.takeUp;

    if (q.kind === 'release') {
      q.t += dt;
      const k = Math.min(1, q.t / RELEASE_TIME);
      // Let the pedal up and bring the throttle back with it.
      clutch = Math.max(clutch, 1 - k);
      throttle *= k;
      if (k >= 1) this.phase = { kind: 'drive' };
    }
    return { gear: want === i.engaged || clutch > 0.6 ? want : i.engaged, clutch, throttle };
  }

  /** Automatic: change up as the revs rise (later the harder the pedal), down as they fall. */
  private chooseGear(i: AidInput): Gear {
    const top = this.t.forwardGears;
    let g = Math.min(Math.max(1, this.autoGear), top);
    if (i.engaged === GEAR_NEUTRAL || i.engaged === GEAR_REVERSE) g = 1;
    if (this.sinceShift >= SHIFT_GAP && i.engaged >= 1) {
      const up = Math.min(this.t.redlineRpm - 400, 2100 + 1600 * i.throttle);
      const down = 1100 + 600 * i.throttle;
      if (i.rpm > up && g < top && i.speed > 2) g++;
      else if (i.rpm < down && g > 1) g--;
      // Moving slowly: first gear.
      if (i.speed < 1.5) g = 1;
    }
    this.autoGear = g;
    return g;
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

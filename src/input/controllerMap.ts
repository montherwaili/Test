/**
 * Game controllers through the Gamepad API: a standard gamepad works out of
 * the box; a steering wheel with pedals (and an H-shifter, if it has one) is
 * set up once by "learning" which axis and button does what. Pure logic: it
 * reads raw axis and button values and returns pedal positions and actions.
 */

export interface AxisBinding {
  source: 'axis' | 'button';
  index: number;
  /** Raw value at rest (pedal up, wheel centred). */
  rest: number;
  /** Raw value fully pressed (or the wheel turned fully right). */
  full: number;
}

export type ButtonAction =
  | 'clutch'
  | 'gearUp'
  | 'gearDown'
  | 'handbrake'
  | 'starter'
  | 'horn'
  | 'indicatorLeft'
  | 'indicatorRight'
  | 'camera'
  | 'help'
  | 'seatbelt'
  | 'mirrorLeft'
  | 'mirrorCentre'
  | 'mirrorRight';

export interface ControllerMapping {
  kind: 'gamepad' | 'wheel';
  steer: AxisBinding | null;
  throttle: AxisBinding | null;
  brake: AxisBinding | null;
  clutch: AxisBinding | null;
  buttons: Partial<Record<ButtonAction, number>>;
  /** H-shifter: the button held for each gear ('1'..'5', 'R'). Neutral is no button. */
  shifter: Partial<Record<string, number>>;
}

/** The layout of a "standard" gamepad (Xbox / PlayStation style). */
export function standardGamepad(): ControllerMapping {
  return {
    kind: 'gamepad',
    steer: { source: 'axis', index: 0, rest: 0, full: 1 },
    throttle: { source: 'button', index: 7, rest: 0, full: 1 },
    brake: { source: 'button', index: 6, rest: 0, full: 1 },
    clutch: null,
    buttons: {
      clutch: 4,
      gearUp: 12,
      gearDown: 13,
      indicatorLeft: 14,
      indicatorRight: 15,
      starter: 0,
      handbrake: 1,
      horn: 2,
      camera: 3,
      help: 9,
      seatbelt: 8,
      mirrorLeft: 10,
      mirrorCentre: 5,
      mirrorRight: 11,
    },
    shifter: {},
  };
}

export interface RawPad {
  axes: readonly number[];
  buttons: readonly number[];
}

export interface ControllerOutput {
  steer?: number;
  throttle?: number;
  brake?: number;
  clutch?: number;
  /** Buttons held down now. */
  held: Set<ButtonAction>;
  /** Gear the shifter is in (null: no shifter mapped). */
  shifterGear: number | null;
}

/** Steering dead zone for thumb sticks. */
const STICK_DEADZONE = 0.08;

function read(raw: RawPad, b: AxisBinding): number {
  return (b.source === 'axis' ? raw.axes[b.index] : raw.buttons[b.index]) ?? b.rest;
}

/** A pedal's travel, 0 (up) .. 1 (floored), whichever way the axis runs. */
export function pedal(raw: RawPad, b: AxisBinding): number {
  const span = b.full - b.rest;
  if (Math.abs(span) < 1e-6) return 0;
  return Math.min(1, Math.max(0, (read(raw, b) - b.rest) / span));
}

/** Steering, -1 (full left) .. 1 (full right). */
export function steering(raw: RawPad, b: AxisBinding, deadzone: number): number {
  const span = b.full - b.rest;
  if (Math.abs(span) < 1e-6) return 0;
  const v = Math.min(1, Math.max(-1, (read(raw, b) - b.rest) / span));
  if (Math.abs(v) < deadzone) return 0;
  return Math.sign(v) * ((Math.abs(v) - deadzone) / (1 - deadzone));
}

/**
 * A thumb stick has a short throw, so it gets the same help as the keyboard:
 * a gentle curve for small corrections, and less lock the faster the car goes
 * (full lock is for car parks).
 */
export function stickSteer(v: number, speed: number): number {
  const curved = Math.sign(v) * Math.abs(v) ** 1.6;
  const ratio = speed / 12;
  return curved / (1 + ratio * ratio);
}

const GEAR_OF: Record<string, number> = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, R: -1 };

export function readController(raw: RawPad, m: ControllerMapping): ControllerOutput {
  const out: ControllerOutput = { held: new Set(), shifterGear: null };
  if (m.steer) out.steer = steering(raw, m.steer, m.kind === 'gamepad' ? STICK_DEADZONE : 0.01);
  if (m.throttle) out.throttle = pedal(raw, m.throttle);
  if (m.brake) out.brake = pedal(raw, m.brake);
  if (m.clutch) out.clutch = pedal(raw, m.clutch);
  for (const [action, index] of Object.entries(m.buttons) as [ButtonAction, number][]) {
    if ((raw.buttons[index] ?? 0) > 0.5) out.held.add(action);
  }
  const gears = Object.entries(m.shifter);
  if (gears.length) {
    out.shifterGear = 0;
    for (const [gear, index] of gears) if (index !== undefined && (raw.buttons[index] ?? 0) > 0.5) out.shifterGear = GEAR_OF[gear] ?? 0;
  }
  return out;
}

// --- learning a wheel ---------------------------------------------------------

export type LearnStep = 'steer' | 'throttle' | 'brake' | 'clutch' | '1' | '2' | '3' | '4' | '5' | 'R';
export const LEARN_STEPS: LearnStep[] = ['steer', 'throttle', 'brake', 'clutch', '1', '2', '3', '4', '5', 'R'];

/** An axis has to move this far to count as the one being used. */
const LEARN_THRESHOLD = 0.45;

/**
 * Walks through the controls one at a time: "turn the wheel fully right",
 * "press the gas pedal", ... For each, it watches which axis moves furthest
 * from where it rested (or which button is pressed, for the gears).
 */
export class WheelLearner {
  step = 0;
  readonly mapping: ControllerMapping = {
    kind: 'wheel',
    steer: null,
    throttle: null,
    brake: null,
    clutch: null,
    buttons: {},
    shifter: {},
  };
  private baseline: RawPad | null = null;
  private best: { index: number; delta: number; value: number } | null = null;

  get current(): LearnStep | null {
    return LEARN_STEPS[this.step] ?? null;
  }

  get done(): boolean {
    return this.step >= LEARN_STEPS.length;
  }

  /** Feed the controller's state. Returns true when the current step has been learned. */
  update(raw: RawPad): boolean {
    const step = this.current;
    if (!step) return false;
    if (!this.baseline) {
      this.baseline = { axes: [...raw.axes], buttons: [...raw.buttons] };
      return false;
    }
    if (step === 'steer' || step === 'throttle' || step === 'brake' || step === 'clutch') {
      raw.axes.forEach((v, i) => {
        const delta = Math.abs(v - (this.baseline!.axes[i] ?? 0));
        if (delta > LEARN_THRESHOLD && (!this.best || delta > this.best.delta)) this.best = { index: i, delta, value: v };
      });
      // Learned once the control has been moved fully and let go again.
      if (this.best) {
        const back = Math.abs((raw.axes[this.best.index] ?? 0) - (this.baseline.axes[this.best.index] ?? 0)) < 0.15;
        if (back) {
          this.mapping[step] = { source: 'axis', index: this.best.index, rest: this.baseline.axes[this.best.index] ?? 0, full: this.best.value };
          this.next();
          return true;
        }
      }
      return false;
    }
    // A gear: the first button that goes down that was not down before.
    const pressed = raw.buttons.findIndex((v, i) => v > 0.5 && (this.baseline!.buttons[i] ?? 0) <= 0.5);
    if (pressed >= 0) {
      this.mapping.shifter[step] = pressed;
      this.next();
      return true;
    }
    return false;
  }

  /** Skip the current step (no clutch pedal, no shifter). */
  skip(): void {
    this.next();
  }

  private next(): void {
    this.step++;
    this.baseline = null;
    this.best = null;
  }
}

/** Steering wheels mirror the gamepad's buttons for everything except the pedals and shifter. */
export function finishWheel(learned: ControllerMapping): ControllerMapping {
  const pad = standardGamepad();
  const used = new Set(Object.values(learned.shifter));
  const buttons: ControllerMapping['buttons'] = {};
  for (const [action, index] of Object.entries(pad.buttons) as [ButtonAction, number][]) {
    if (!used.has(index) && !(action === 'clutch' && learned.clutch)) buttons[action] = index;
  }
  return { ...learned, buttons };
}

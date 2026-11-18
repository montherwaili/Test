/**
 * Gamepads and steering wheels through the browser's Gamepad API. Polled
 * once per frame. A standard gamepad works straight away; a wheel is taught
 * once (see WheelLearner) and remembered by its name.
 */
import type { AnalogInput } from './inputFilter';
import type { Action } from './keyboard';
import {
  WheelLearner,
  finishWheel,
  readController,
  standardGamepad,
  stickSteer,
  type ButtonAction,
  type ControllerMapping,
  type RawPad,
} from './controllerMap';

const KEY = 'odts.controllers';

function loadMappings(): Record<string, ControllerMapping> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, ControllerMapping>) : {};
  } catch {
    return {};
  }
}

/** Buttons that act once when pressed. */
const PRESS: Partial<Record<ButtonAction, Action>> = {
  gearUp: { type: 'gearUp' },
  gearDown: { type: 'gearDown' },
  handbrake: { type: 'handbrake' },
  starter: { type: 'starterTap' },
  indicatorLeft: { type: 'indicator', mode: 'left' },
  indicatorRight: { type: 'indicator', mode: 'right' },
  camera: { type: 'camera' },
  help: { type: 'help' },
  seatbelt: { type: 'seatbelt' },
  mirrorLeft: { type: 'mirror', mirror: 'left' },
  mirrorCentre: { type: 'mirror', mirror: 'centre' },
  mirrorRight: { type: 'mirror', mirror: 'right' },
};

const LOOK: Partial<Record<ButtonAction, 'left' | 'centre' | 'right'>> = {
  mirrorLeft: 'left',
  mirrorCentre: 'centre',
  mirrorRight: 'right',
};

export class GamepadControls {
  analog: AnalogInput = {};
  clutchButton = false;
  horn = false;
  look: 'left' | 'centre' | 'right' | null = null;
  /** Name of the controller in use, if one is connected. */
  device: string | null = null;
  /** True when this controller has been taught (a wheel), false when using the standard layout. */
  learned = false;
  learner: WheelLearner | null = null;
  private mappings = loadMappings();
  private prevHeld = new Set<ButtonAction>();
  private prevGear: number | null = null;
  private lookSince = 0;
  private readonly raw: { axes: number[]; buttons: number[] } = { axes: [], buttons: [] };

  constructor(private readonly onAction: (a: Action) => void) {}

  get available(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
  }

  private pad(): Gamepad | null {
    if (!this.available) return null;
    for (const p of navigator.getGamepads()) if (p && p.connected) return p;
    return null;
  }

  /** Read the controller. `speed` (m/s) tames thumb-stick steering. */
  poll(speed: number, now: number): void {
    const p = this.pad();
    this.device = p ? p.id : null;
    if (!p) {
      this.clear();
      return;
    }
    const raw = this.raw;
    raw.axes.length = 0;
    raw.buttons.length = 0;
    for (const a of p.axes) raw.axes.push(a);
    for (const b of p.buttons) raw.buttons.push(b.value || (b.pressed ? 1 : 0));

    if (this.learner) {
      this.learner.update(raw);
      if (this.learner.done) this.finishLearning(p.id);
      this.clear();
      return;
    }

    const saved = this.mappings[p.id];
    this.learned = !!saved;
    const m = saved ?? standardGamepad();
    const out = readController(raw as RawPad, m);
    this.analog = {};
    if (out.steer !== undefined) this.analog.steer = m.kind === 'gamepad' ? stickSteer(out.steer, speed) : out.steer;
    // Triggers and pedals only take over once touched, so the keyboard still works with a pad plugged in.
    if (out.throttle !== undefined && (out.throttle > 0.01 || m.kind === 'wheel')) this.analog.throttle = out.throttle;
    if (out.brake !== undefined && (out.brake > 0.01 || m.kind === 'wheel')) this.analog.brake = out.brake;
    if (out.clutch !== undefined) this.analog.clutch = out.clutch;
    if (m.kind === 'gamepad' && this.analog.steer === 0) delete this.analog.steer;

    for (const action of out.held) {
      if (this.prevHeld.has(action)) continue;
      const a = PRESS[action];
      if (a) this.onAction(a);
      if (LOOK[action]) this.lookSince = now;
    }
    this.clutchButton = out.held.has('clutch');
    this.horn = out.held.has('horn');
    // A tap glances in a mirror; holding the button keeps looking.
    this.look = null;
    for (const action of out.held) {
      const l = LOOK[action];
      if (l && now - this.lookSince > 0.25) this.look = l;
    }
    this.prevHeld = out.held;

    if (out.shifterGear !== null && out.shifterGear !== this.prevGear) {
      if (this.prevGear !== null) this.onAction({ type: 'gear', gear: out.shifterGear });
      this.prevGear = out.shifterGear;
    }
  }

  private clear(): void {
    this.analog = {};
    this.clutchButton = false;
    this.horn = false;
    this.look = null;
  }

  /** Start teaching the connected controller (a steering wheel). */
  startLearning(): void {
    this.learner = new WheelLearner();
  }

  cancelLearning(): void {
    this.learner = null;
  }

  /** Forget what was taught for the connected controller. */
  forget(): void {
    if (!this.device) return;
    delete this.mappings[this.device];
    this.save();
  }

  private finishLearning(id: string): void {
    this.mappings[id] = finishWheel(this.learner!.mapping);
    this.learner = null;
    this.prevGear = null;
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.mappings));
    } catch {
      // Not saved; it still works until the page is closed.
    }
  }
}

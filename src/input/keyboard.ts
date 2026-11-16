/** Keyboard bindings: held keys for pedals and steering, single presses for everything else. */
import type { DigitalInput } from './inputFilter';

export type Action =
  | { type: 'gearUp' }
  | { type: 'gearDown' }
  | { type: 'gear'; gear: number }
  | { type: 'handbrake' }
  | { type: 'ignition' }
  | { type: 'indicator'; mode: 'left' | 'right' | 'hazard' }
  | { type: 'lights' }
  | { type: 'seatbelt' }
  | { type: 'mirror'; mirror: 'left' | 'centre' | 'right' }
  | { type: 'camera' }
  | { type: 'reset' }
  | { type: 'help' }
  | { type: 'starterTap' };

/** Inputs that matter for as long as they are held. */
export interface HeldInput extends DigitalInput {
  starter: boolean;
  horn: boolean;
  /** Mirror being looked at, if any. */
  look: 'left' | 'centre' | 'right' | null;
}

export function emptyHeld(): HeldInput {
  return {
    throttle: false,
    brake: false,
    clutch: false,
    left: false,
    right: false,
    starter: false,
    horn: false,
    look: null,
  };
}

const HOLD: Record<string, keyof DigitalInput | 'starter' | 'horn'> = {
  KeyW: 'throttle',
  ArrowUp: 'throttle',
  KeyS: 'brake',
  ArrowDown: 'brake',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'clutch',
  ShiftRight: 'clutch',
  Enter: 'starter',
  KeyH: 'horn',
};

const PRESS: Record<string, Action> = {
  KeyE: { type: 'gearUp' },
  KeyQ: { type: 'gearDown' },
  Digit1: { type: 'gear', gear: 1 },
  Digit2: { type: 'gear', gear: 2 },
  Digit3: { type: 'gear', gear: 3 },
  Digit4: { type: 'gear', gear: 4 },
  Digit5: { type: 'gear', gear: 5 },
  KeyR: { type: 'gear', gear: -1 },
  KeyN: { type: 'gear', gear: 0 },
  Space: { type: 'handbrake' },
  KeyI: { type: 'ignition' },
  KeyZ: { type: 'indicator', mode: 'left' },
  KeyX: { type: 'indicator', mode: 'hazard' },
  KeyC: { type: 'indicator', mode: 'right' },
  KeyL: { type: 'lights' },
  KeyB: { type: 'seatbelt' },
  KeyV: { type: 'camera' },
  Backspace: { type: 'reset' },
  F1: { type: 'help' },
};

const MIRROR: Record<string, 'left' | 'centre' | 'right'> = {
  Digit7: 'left',
  Digit8: 'centre',
  Digit9: 'right',
};

/** Human-readable key names for the help panel, in the order they are listed there. */
export const KEY_HELP: [string, string][] = [
  ['kSteer', 'A D  /  ← →'],
  ['kGas', 'W  /  ↑'],
  ['kBrake', 'S  /  ↓'],
  ['kClutch', 'Shift'],
  ['kGearUpDown', 'E  /  Q'],
  ['kGearDirect', '1 – 5,  R,  N'],
  ['kHandbrake', 'Space'],
  ['kStart', 'Enter'],
  ['kIgnition', 'I'],
  ['kIndicators', 'Z  /  X  /  C'],
  ['kLights', 'L'],
  ['kHorn', 'H'],
  ['kSeatbelt', 'B'],
  ['kMirrors', '7  /  8  /  9'],
  ['kCamera', 'V'],
  ['kReset', 'Backspace'],
];

export class Keyboard {
  readonly held: HeldInput = emptyHeld();
  private readonly down = new Set<string>();

  constructor(
    target: Window,
    private readonly onAction: (a: Action) => void,
  ) {
    target.addEventListener('keydown', (e) => this.keyDown(e));
    target.addEventListener('keyup', (e) => this.keyUp(e));
    target.addEventListener('blur', () => this.releaseAll());
  }

  private keyDown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const code = e.code;
    const known = code in HOLD || code in PRESS || code in MIRROR;
    if (!known) return;
    e.preventDefault();
    if (this.down.has(code)) return; // auto-repeat
    this.down.add(code);
    if (code in HOLD) this.refreshHeld();
    const mirror = MIRROR[code];
    if (mirror) {
      this.onAction({ type: 'mirror', mirror });
      this.refreshHeld();
    }
    const action = PRESS[code];
    if (action) this.onAction(action);
  }

  private keyUp(e: KeyboardEvent): void {
    if (this.down.delete(e.code)) this.refreshHeld();
  }

  private releaseAll(): void {
    this.down.clear();
    this.refreshHeld();
  }

  private refreshHeld(): void {
    const h = this.held;
    h.throttle = h.brake = h.clutch = h.left = h.right = h.starter = h.horn = false;
    h.look = null;
    for (const code of this.down) {
      const hold = HOLD[code];
      if (hold) h[hold] = true;
      const mirror = MIRROR[code];
      if (mirror) h.look = mirror;
    }
  }
}

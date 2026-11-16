/**
 * On-screen driving controls: a steering pad, three pedals, a gear selector
 * and buttons. Every control captures its own pointer, so several fingers can
 * work at once (clutch and gas together is the whole point).
 *
 * On a mouse-and-keyboard device the same pedals are shown small, as gauges.
 */
import type { ClutchTuning } from '../sim/tuning';
import type { AnalogInput } from './inputFilter';
import type { Action } from './keyboard';
import { onLangChange, t, type StringKey } from '../ui/i18n';

export interface TouchState {
  analog: AnalogInput;
  starter: boolean;
  horn: boolean;
}

export interface TouchDisplay {
  throttle: number;
  brake: number;
  clutch: number;
  steer: number;
  /** Gear the lever is asking for. */
  lever: number;
  handbrake: boolean;
  seatbelt: boolean;
  indicator: 'off' | 'left' | 'right' | 'hazard';
  lampLeft: boolean;
  lampRight: boolean;
}

type PedalName = 'clutch' | 'brake' | 'throttle';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  parent?.append(e);
  return e;
}

export class TouchControls {
  readonly state: TouchState = { analog: {}, starter: false, horn: false };
  readonly root: HTMLElement;
  private readonly fills = {} as Record<PedalName, HTMLElement>;
  private readonly knob: HTMLElement;
  private readonly gearButtons = new Map<number, HTMLButtonElement>();
  private readonly toggles: Partial<Record<'handbrake' | 'seatbelt' | 'left' | 'right' | 'hazard', HTMLButtonElement>> = {};
  private readonly labelled: [HTMLElement, StringKey][] = [];

  constructor(parent: HTMLElement, clutch: ClutchTuning, private readonly onAction: (a: Action) => void) {
    // Physical layout (steering left, pedals right, clutch-brake-gas) does not mirror in Arabic.
    this.root = el('div', 'controls', parent);
    this.root.dir = 'ltr';

    // --- steering ---------------------------------------------------------
    const pad = el('div', 'steer-pad', this.root);
    this.label(el('span', 'ctl-label', pad), 'steering');
    this.knob = el('div', 'steer-knob', pad);
    let startX = 0;
    const steerFrom = (e: PointerEvent) => {
      const half = pad.clientWidth * 0.42;
      this.state.analog.steer = Math.max(-1, Math.min(1, (e.clientX - startX) / half));
    };
    this.drag(pad, {
      down: (e) => {
        startX = e.clientX;
        steerFrom(e);
      },
      move: steerFrom,
      up: () => delete this.state.analog.steer,
    });

    // --- pedals -------------------------------------------------------------
    const pedals = el('div', 'pedals', this.root);
    const pedal = (name: PedalName, key: StringKey) => {
      const p = el('div', `pedal pedal-${name}`, pedals);
      const track = el('div', 'pedal-track', p);
      if (name === 'clutch') {
        // Where the clutch bites, so the learner can see what they are feeling for.
        const bite = el('div', 'pedal-bite', track);
        bite.style.bottom = `${clutch.biteEnd * 100}%`;
        bite.style.height = `${(clutch.biteStart - clutch.biteEnd) * 100}%`;
      }
      this.fills[name] = el('div', 'pedal-fill', track);
      this.label(el('span', 'ctl-label', p), key);
      const set = (e: PointerEvent) => {
        const r = track.getBoundingClientRect();
        this.state.analog[name] = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
      };
      this.drag(p, { down: set, move: set, up: () => delete this.state.analog[name] });
    };
    pedal('clutch', 'clutch');
    pedal('brake', 'brake');
    pedal('throttle', 'gas');

    // --- gear selector ---------------------------------------------------------
    const gears = el('div', 'gears', this.root);
    for (const g of [1, 3, 5, 2, 4, -1]) {
      const b = el('button', 'gear-btn', gears);
      b.type = 'button';
      b.textContent = g === -1 ? 'R' : String(g);
      b.addEventListener('click', () => this.onAction({ type: 'gear', gear: g }));
      this.gearButtons.set(g, b);
    }
    const neutral = el('button', 'gear-btn gear-n', gears);
    neutral.type = 'button';
    neutral.textContent = 'N';
    neutral.addEventListener('click', () => this.onAction({ type: 'gear', gear: 0 }));
    this.gearButtons.set(0, neutral);

    // --- buttons ---------------------------------------------------------------
    const bar = el('div', 'buttons', this.root);
    const button = (className: string, text: string | StringKey, isKey: boolean, action: () => void) => {
      const b = el('button', `ctl-btn ${className}`, bar);
      b.type = 'button';
      if (isKey) this.label(b, text as StringKey);
      else b.textContent = text;
      b.addEventListener('click', action);
      return b;
    };
    this.toggles.left = button('btn-ind', '◀', false, () => this.onAction({ type: 'indicator', mode: 'left' }));
    const start = button('btn-start', 'start', true, () => this.onAction({ type: 'starterTap' }));
    this.hold(start, (on) => (this.state.starter = on));
    this.toggles.handbrake = button('btn-hb', 'handbrake', true, () => this.onAction({ type: 'handbrake' }));
    this.toggles.seatbelt = button('btn-belt', 'seatbelt', true, () => this.onAction({ type: 'seatbelt' }));
    this.toggles.hazard = button('btn-ind', '▲', false, () => this.onAction({ type: 'indicator', mode: 'hazard' }));
    const horn = button('btn-horn', 'horn', true, () => undefined);
    this.hold(horn, (on) => (this.state.horn = on));
    button('btn-lights', 'lights', true, () => this.onAction({ type: 'lights' }));
    this.toggles.right = button('btn-ind', '▶', false, () => this.onAction({ type: 'indicator', mode: 'right' }));

    onLangChange(() => this.relabel());
    this.relabel();
  }

  /** Reflect the car's state on the controls. */
  update(d: TouchDisplay): void {
    this.fills.throttle.style.height = `${d.throttle * 100}%`;
    this.fills.brake.style.height = `${d.brake * 100}%`;
    this.fills.clutch.style.height = `${d.clutch * 100}%`;
    this.knob.style.transform = `translateX(${d.steer * 100}%)`;
    for (const [g, b] of this.gearButtons) b.classList.toggle('on', g === d.lever);
    this.toggles.handbrake!.classList.toggle('on', d.handbrake);
    this.toggles.seatbelt!.classList.toggle('on', d.seatbelt);
    this.toggles.left!.classList.toggle('on', d.indicator === 'left');
    this.toggles.right!.classList.toggle('on', d.indicator === 'right');
    this.toggles.hazard!.classList.toggle('on', d.indicator === 'hazard');
    this.toggles.left!.classList.toggle('lit', d.lampLeft);
    this.toggles.right!.classList.toggle('lit', d.lampRight);
  }

  private label(node: HTMLElement, key: StringKey): void {
    this.labelled.push([node, key]);
  }

  private relabel(): void {
    for (const [node, key] of this.labelled) node.textContent = t(key);
  }

  private drag(
    target: HTMLElement,
    h: { down: (e: PointerEvent) => void; move: (e: PointerEvent) => void; up: () => void },
  ): void {
    let active: number | null = null;
    target.addEventListener('pointerdown', (e) => {
      if (active !== null) return;
      active = e.pointerId;
      target.setPointerCapture(e.pointerId);
      target.classList.add('active');
      h.down(e);
      e.preventDefault();
    });
    target.addEventListener('pointermove', (e) => {
      if (e.pointerId === active) h.move(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== active) return;
      active = null;
      target.classList.remove('active');
      h.up();
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    target.addEventListener('lostpointercapture', end);
  }

  private hold(button: HTMLElement, set: (on: boolean) => void): void {
    button.addEventListener('pointerdown', () => set(true));
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      button.addEventListener(type, () => set(false));
    }
  }
}

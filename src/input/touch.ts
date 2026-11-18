/**
 * On-screen driving controls, laid out for two thumbs:
 *
 *   left thumb  - clutch pedal, steering wheel, indicators
 *   right thumb - brake and gas (one foot does both, as in a car), gear lever
 *
 * The steering wheel turns by dragging around it, stays put when the car is
 * stopped and straightens as it rolls. All three pedals spring back when the
 * finger lifts (the clutch comes up quickly to the bite point, then eases
 * through it, as a driver's foot would). The gear lever is dragged through an
 * H gate. Every control captures its own pointer, so fingers do not interfere
 * with each other.
 *
 * On a mouse-and-keyboard device the pedals are shown small, as gauges.
 */
import type { ClutchTuning } from '../sim/tuning';
import type { AnalogInput } from './inputFilter';
import type { Action } from './keyboard';
import { GearLeverModel, gearSlots } from './gearLever';
import { SteeringWheelModel, WHEEL_LOCK } from './steeringWheel';
import { onLangChange, t, type StringKey } from '../ui/i18n';
import { onPress } from '../ui/press';

export interface TouchState {
  analog: AnalogInput;
  starter: boolean;
  horn: boolean;
  /** Mirror being looked at while its button is held. */
  look: 'left' | 'centre' | 'right' | null;
}

export interface TouchDisplay {
  throttle: number;
  brake: number;
  clutch: number;
  steer: number;
  /** Gear the lever is asking for. */
  lever: number;
  /** Gear actually engaged in the gearbox. */
  engaged: number;
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
  readonly state: TouchState = { analog: {}, starter: false, horn: false, look: null };
  readonly root: HTMLElement;
  private readonly fills = {} as Record<PedalName, HTMLElement>;
  private readonly wheel = new SteeringWheelModel();
  private readonly wheelFace: HTMLElement;
  private readonly lever = new GearLeverModel();
  private readonly knob: HTMLElement;
  private readonly gearLabels = new Map<number, HTMLElement>();
  private readonly toggles: Partial<Record<'handbrake' | 'seatbelt' | 'left' | 'right' | 'hazard', HTMLButtonElement>> = {};
  private readonly labelled: [HTMLElement, StringKey][] = [];

  constructor(parent: HTMLElement, clutch: ClutchTuning, private readonly onAction: (a: Action) => void) {
    // Physical layout (steering left, pedals right, clutch-brake-gas) does not mirror in Arabic.
    this.root = el('div', 'controls', parent);
    this.root.dir = 'ltr';

    // --- left thumb: clutch, steering wheel, indicators ------------------------
    const pedal = (parent: HTMLElement, name: PedalName, key: StringKey) => {
      const p = el('div', `pedal pedal-${name}`, parent);
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
        // A little overshoot at each end so "all the way" is easy to reach.
        const v = 1 - (e.clientY - r.top) / r.height;
        this.state.analog[name] = Math.max(0, Math.min(1, (v - 0.04) / 0.92));
      };
      this.drag(p, {
        down: set,
        move: set,
        // Lift the finger and the pedal springs back (the input filter eases the clutch through its bite).
        up: () => delete this.state.analog[name],
      });
    };

    const left = el('div', 'pedals pedals-left', this.root);
    pedal(left, 'clutch', 'clutch');

    const wheelBox = el('div', 'wheel-box', this.root);
    const indicators = el('div', 'indicators', wheelBox);
    const indicator = (text: string, mode: 'left' | 'right' | 'hazard') => {
      const b = el('button', 'ctl-btn btn-ind', indicators);
      b.type = 'button';
      b.textContent = text;
      onPress(b, () => this.onAction({ type: 'indicator', mode }));
      this.toggles[mode] = b;
    };
    indicator('◀', 'left');
    indicator('▲', 'hazard');
    indicator('▶', 'right');
    const wheelEl = el('div', 'wheel', wheelBox);
    this.wheelFace = el('div', 'wheel-face', wheelEl);
    el('div', 'wheel-spoke wheel-spoke-h', this.wheelFace);
    el('div', 'wheel-spoke wheel-spoke-v', this.wheelFace);
    el('div', 'wheel-hub', this.wheelFace);
    el('div', 'wheel-mark', this.wheelFace);
    const offset = (e: PointerEvent): [number, number] => {
      const r = wheelEl.getBoundingClientRect();
      return [e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)];
    };
    this.drag(wheelEl, {
      down: (e) => this.wheel.grab(...offset(e)),
      move: (e) => this.wheel.drag(...offset(e)),
      up: () => this.wheel.release(),
    });

    // --- right thumb: brake, gas, gear lever ---------------------------------------
    const right = el('div', 'pedals pedals-right', this.root);
    pedal(right, 'brake', 'brake');
    pedal(right, 'throttle', 'gas');

    // Gear lever in an H gate: drag the knob along the gate.
    const gate = el('div', 'shifter', this.root);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'shifter-gate');
    // Gate slots: three columns joined by the neutral rail.
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M20 25 V75 M50 25 V75 M80 25 V75 M20 50 H80');
    svg.append(path);
    gate.append(svg);
    // Slots run from 25% to 75% of the height; the numbers sit beyond their ends.
    const toPct = (gx: number, gy: number) => ({ left: 50 + gx * 30, top: 50 + gy * 25 });
    for (const slot of gearSlots()) {
      const label = el('span', 'shifter-label', gate);
      label.textContent = slot.gear === -1 ? 'R' : String(slot.gear);
      const p = toPct(slot.x, slot.y);
      label.style.left = `${p.left}%`;
      label.style.top = `${slot.y < 0 ? p.top - 13 : p.top + 13}%`;
      this.gearLabels.set(slot.gear, label);
    }
    const nLabel = el('span', 'shifter-label shifter-n', gate);
    nLabel.textContent = 'N';
    this.gearLabels.set(0, nLabel);
    this.knob = el('div', 'shifter-knob', gate);
    const gateXY = (e: PointerEvent): [number, number] => {
      const r = gate.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width - 0.5) / 0.3, ((e.clientY - r.top) / r.height - 0.5) / 0.25];
    };
    let sent = this.lever.gear;
    const send = () => {
      if (this.lever.gear !== sent) {
        sent = this.lever.gear;
        this.onAction({ type: 'gear', gear: sent });
      }
    };
    this.drag(gate, {
      down: (e) => {
        sent = this.lever.gear;
        this.lever.grab();
        this.lever.drag(...gateXY(e));
        send();
      },
      move: (e) => {
        this.lever.drag(...gateXY(e));
        send();
      },
      up: () => {
        this.lever.release();
        send();
      },
    });

    // --- the rest ------------------------------------------------------------------
    // Needed for every move-off: between the thumbs. Needed now and then: out of the way, top left.
    const main = el('div', 'buttons buttons-main', this.root);
    const extra = el('div', 'buttons buttons-extra', this.root);
    const button = (parent: HTMLElement, className: string, key: StringKey | null, action: () => void) => {
      const b = el('button', `ctl-btn ${className}`, parent);
      b.type = 'button';
      if (key) this.label(b, key);
      onPress(b, action);
      return b;
    };
    const start = button(main, 'btn-start', 'start', () => this.onAction({ type: 'starterTap' }));
    this.hold(start, (on) => (this.state.starter = on));
    // The handbrake button says which way it is, in words (set in update()).
    this.toggles.handbrake = button(main, 'btn-hb', null, () => this.onAction({ type: 'handbrake' }));
    this.toggles.seatbelt = button(extra, 'btn-belt', 'seatbelt', () => this.onAction({ type: 'seatbelt' }));
    button(extra, 'btn-lights', 'lights', () => this.onAction({ type: 'lights' }));
    const horn = button(extra, 'btn-horn', 'horn', () => undefined);
    this.hold(horn, (on) => (this.state.horn = on));
    // Mirror checks: a tap is a glance; holding turns the driver's head.
    const mirrors: [StringKey, 'left' | 'centre' | 'right'][] = [
      ['mirrorLeft', 'left'],
      ['mirrorCentre', 'centre'],
      ['mirrorRight', 'right'],
    ];
    for (const [key, mirror] of mirrors) {
      const b = button(extra, 'btn-mirror', key, () => undefined);
      b.addEventListener('pointerdown', () => {
        this.onAction({ type: 'mirror', mirror });
        this.state.look = mirror;
      });
      for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
        b.addEventListener(type, () => {
          if (this.state.look === mirror) this.state.look = null;
        });
      }
    }

    onLangChange(() => this.relabel());
    this.relabel();
  }

  /**
   * Advance the steering wheel (it straightens itself as the car rolls) and
   * publish its position. Call once per simulation step.
   */
  tick(dt: number, speed: number): void {
    this.wheel.update(dt, speed);
    if (this.wheel.active) this.state.analog.steer = this.wheel.steer;
    else delete this.state.analog.steer;
  }

  /** Let go of the clutch pedal's hold (the keyboard has taken over). */
  releaseClutch(): void {
    delete this.state.analog.clutch;
  }

  /** Centre the wheel and lift every pedal (the car has been reset). */
  reset(): void {
    this.wheel.reset();
    this.lever.release();
    this.lever.setGear(0);
    this.state.analog = {};
  }

  /** Reflect the car's state on the controls. */
  update(d: TouchDisplay): void {
    this.fills.throttle.style.height = `${d.throttle * 100}%`;
    this.fills.brake.style.height = `${d.brake * 100}%`;
    this.fills.clutch.style.height = `${d.clutch * 100}%`;
    this.wheelFace.style.transform = `rotate(${d.steer * WHEEL_LOCK}rad)`;
    this.lever.setGear(d.lever);
    this.knob.style.left = `${50 + this.lever.x * 30}%`;
    this.knob.style.top = `${50 + this.lever.y * 25}%`;
    // The knob carries the number of the gear it is in.
    const g = this.lever.gear;
    const text = g === 0 ? 'N' : g === -1 ? 'R' : String(g);
    if (this.knob.textContent !== text) this.knob.textContent = text;
    // Lever in a gear that the gearbox refused (clutch not pressed): show it as not engaged.
    this.knob.classList.toggle('pending', d.lever !== d.engaged);
    for (const [g, label] of this.gearLabels) label.classList.toggle('on', g === d.engaged);
    this.toggles.handbrake!.classList.toggle('on', d.handbrake);
    const hbText = t(d.handbrake ? 'hbOn' : 'hbOff');
    if (this.toggles.handbrake!.textContent !== hbText) this.toggles.handbrake!.textContent = hbText;
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
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // Capture can be refused (pointer already gone); the control still works without it.
      }
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

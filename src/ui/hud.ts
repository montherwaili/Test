/** Heads-up display: instruments, warning lamps, messages and the help panel. */
import { KEY_HELP } from '../input/keyboard';
import { getLang, onLangChange, setLang, t, type StringKey } from './i18n';

export interface HudState {
  speedKmh: number;
  rpm: number;
  redlineRpm: number;
  gear: string;
  /** Lever is asking for a gear that has not gone in. */
  gearPending: boolean;
  engineRunning: boolean;
  ignition: boolean;
  handbrake: boolean;
  seatbelt: boolean;
  headlights: 'off' | 'low' | 'high';
  lampLeft: boolean;
  lampRight: boolean;
  camera: StringKey;
}

export interface HudCallbacks {
  onCamera: () => void;
  onReset: () => void;
}

const MAX_RPM = 7000;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  parent?.append(e);
  return e;
}

export class Hud {
  readonly root: HTMLElement;
  private readonly speed: HTMLElement;
  private readonly rpmFill: HTMLElement;
  private readonly rpmRed: HTMLElement;
  private readonly rpmText: HTMLElement;
  private readonly gear: HTMLElement;
  private readonly arrowLeft: HTMLElement;
  private readonly arrowRight: HTMLElement;
  private readonly lamps: Record<'engine' | 'handbrake' | 'seatbelt' | 'lights', HTMLElement>;
  private readonly toast: HTMLElement;
  private readonly cameraButton: HTMLButtonElement;
  private readonly helpPanel: HTMLElement;
  private readonly labelled: [HTMLElement, StringKey][] = [];
  private toastTimer = 0;
  private last = { speed: '', rpm: -1, gear: '', camera: '' as string };

  constructor(parent: HTMLElement, callbacks: HudCallbacks) {
    this.root = el('div', 'hud', parent);

    // --- top bar ---------------------------------------------------------------
    const top = el('div', 'topbar', this.root);
    const helpButton = this.button(top, 'help', () => this.toggleHelp());
    helpButton.classList.add('btn-help');
    this.cameraButton = el('button', 'hud-btn', top);
    this.cameraButton.type = 'button';
    this.cameraButton.addEventListener('click', callbacks.onCamera);
    this.button(top, 'reset', callbacks.onReset);
    this.button(top, 'language', () => setLang(getLang() === 'ar' ? 'en' : 'ar'));

    // --- instrument cluster ------------------------------------------------------
    const cluster = el('div', 'cluster', this.root);
    cluster.dir = 'ltr';
    this.arrowLeft = el('div', 'arrow arrow-left', cluster);
    this.arrowLeft.textContent = '◀';
    const dials = el('div', 'dials', cluster);
    const rpm = el('div', 'rpm', dials);
    const bar = el('div', 'rpm-bar', rpm);
    this.rpmRed = el('div', 'rpm-red', bar);
    this.rpmFill = el('div', 'rpm-fill', bar);
    this.rpmText = el('div', 'rpm-text', rpm);
    const row = el('div', 'speed-row', dials);
    this.gear = el('div', 'gear', row);
    this.speed = el('div', 'speed', row);
    this.label(el('div', 'unit', row), 'kmh');
    const lamps = el('div', 'lamps', dials);
    const lamp = (key: StringKey, className: string) => {
      const l = el('span', `lamp ${className}`, lamps);
      this.label(l, key);
      return l;
    };
    this.lamps = {
      engine: lamp('lampEngine', 'lamp-red'),
      handbrake: lamp('lampHandbrake', 'lamp-red'),
      seatbelt: lamp('lampSeatbelt', 'lamp-red'),
      lights: lamp('lampLights', 'lamp-green'),
    };
    this.arrowRight = el('div', 'arrow arrow-right', cluster);
    this.arrowRight.textContent = '▶';

    this.toast = el('div', 'toast', this.root);
    this.toast.setAttribute('role', 'status');
    this.toast.hidden = true;

    this.label(el('div', 'rotate-hint', this.root), 'msgRotate');

    this.helpPanel = this.buildHelp();
    onLangChange(() => this.relabel());
    this.relabel();
  }

  update(s: HudState): void {
    const speed = String(Math.round(Math.abs(s.speedKmh)));
    if (speed !== this.last.speed) {
      this.speed.textContent = speed;
      this.last.speed = speed;
    }
    const rpm = Math.round(s.rpm / 50) * 50;
    if (rpm !== this.last.rpm) {
      this.rpmFill.style.width = `${Math.min(100, (Math.abs(s.rpm) / MAX_RPM) * 100)}%`;
      this.rpmFill.classList.toggle('high', s.rpm > s.redlineRpm - 500);
      this.rpmText.textContent = `${rpm} ${t('rpm')}`;
      this.rpmRed.style.left = `${(s.redlineRpm / MAX_RPM) * 100}%`;
      this.last.rpm = rpm;
    }
    if (s.gear !== this.last.gear) {
      this.gear.textContent = s.gear;
      this.last.gear = s.gear;
    }
    this.gear.classList.toggle('pending', s.gearPending);
    this.arrowLeft.classList.toggle('on', s.lampLeft);
    this.arrowRight.classList.toggle('on', s.lampRight);
    this.lamps.engine.classList.toggle('on', s.ignition && !s.engineRunning);
    this.lamps.handbrake.classList.toggle('on', s.handbrake);
    this.lamps.seatbelt.classList.toggle('on', !s.seatbelt);
    this.lamps.lights.classList.toggle('on', s.headlights !== 'off');
    const lightsKey: StringKey = s.headlights === 'high' ? 'lampHighBeam' : 'lampLights';
    if (this.lamps.lights.dataset['key'] !== lightsKey) {
      this.lamps.lights.dataset['key'] = lightsKey;
      this.lamps.lights.textContent = t(lightsKey);
    }
    if (s.camera !== this.last.camera) {
      this.last.camera = s.camera;
      this.cameraButton.textContent = `${t('camera')}: ${t(s.camera)}`;
    }
  }

  /** Show a message for a few seconds. */
  say(key: StringKey, seconds = 4): void {
    this.toast.textContent = t(key);
    this.toast.dataset['key'] = key;
    this.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), seconds * 1000);
  }

  toggleHelp(force?: boolean): void {
    this.helpPanel.hidden = force === undefined ? !this.helpPanel.hidden : !force;
  }

  get helpOpen(): boolean {
    return !this.helpPanel.hidden;
  }

  private buildHelp(): HTMLElement {
    const panel = el('div', 'help-panel', this.root);
    panel.hidden = true;
    const card = el('div', 'help-card', panel);
    this.label(el('h2', '', card), 'helpTitle');

    this.label(el('h3', '', card), 'helpMoveOff');
    const steps = el('ol', 'help-steps', card);
    for (const key of ['helpStep1', 'helpStep2', 'helpStep3', 'helpStep4'] as const) {
      this.label(el('li', '', steps), key);
    }

    this.label(el('h3', 'keys-title', card), 'helpKeys');
    const table = el('dl', 'help-keys', card);
    for (const [key, keys] of KEY_HELP) {
      const rowEl = el('div', '', table);
      this.label(el('dt', '', rowEl), key as StringKey);
      const dd = el('dd', '', rowEl);
      dd.dir = 'ltr';
      dd.textContent = keys;
    }

    const foot = el('div', 'help-foot', card);
    const link = el('a', '', foot);
    link.href = './debug.html';
    this.label(link, 'debugLink');
    const close = this.button(foot, 'close', () => this.toggleHelp(false));
    close.classList.add('primary');
    panel.addEventListener('click', (e) => {
      if (e.target === panel) this.toggleHelp(false);
    });
    return panel;
  }

  private button(parent: HTMLElement, key: StringKey, onClick: () => void): HTMLButtonElement {
    const b = el('button', 'hud-btn', parent);
    b.type = 'button';
    this.label(b, key);
    b.addEventListener('click', onClick);
    return b;
  }

  private label(node: HTMLElement, key: StringKey): void {
    this.labelled.push([node, key]);
  }

  private relabel(): void {
    for (const [node, key] of this.labelled) node.textContent = t(key);
    // Text that is composed from state is rebuilt on the next update.
    this.last.rpm = -1;
    this.last.camera = '';
    delete this.lamps.lights.dataset['key'];
    const toastKey = this.toast.dataset['key'] as StringKey | undefined;
    if (toastKey && !this.toast.hidden) this.toast.textContent = t(toastKey);
  }
}

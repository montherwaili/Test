/** Heads-up display: instruments, warning lamps, messages and the help panel. */
import { KEY_HELP } from '../input/keyboard';
import { getLang, onLangChange, setLang, t, type StringKey } from './i18n';
import { onPress } from './press';

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
  /** Speed limit where the car is, km/h; null off the road network. */
  speedLimit: number | null;
}

/** Free drive in the town or yard, the two tests, or the bare test track. */
export type GameMode = 'town' | 'yard' | 'roadTest' | 'yardTest' | 'track' | 'lesson';

export interface HudCallbacks {
  /** Switch to another mode (each starts afresh). */
  onMode: (mode: GameMode) => void;
  /** The mode now running. */
  mode: GameMode;
  onRightCar: () => void;
  /** Open the list of lessons. */
  onLessons: () => void;
  onCamera: () => void;
  onReset: () => void;
  onNight: () => void;
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
  private readonly limit: HTMLElement;
  private readonly arrowLeft: HTMLElement;
  private readonly arrowRight: HTMLElement;
  private readonly lamps: Record<'engine' | 'handbrake' | 'seatbelt' | 'lights', HTMLElement>;
  private readonly toast: HTMLElement;
  private readonly faultCount: HTMLElement;
  private readonly instruction: HTMLElement;
  private readonly instructionText: HTMLElement;
  private readonly instructionIcon: HTMLElement;
  private readonly goal: HTMLElement;
  private readonly goalStep: HTMLElement;
  private readonly goalText: HTMLElement;
  private goalSource: (() => string) | null = null;
  private goalHint: (() => string) | null = null;
  private instructionTimer = 0;
  private instructionSource: () => string = () => '';
  private counts = { minor: 0, serious: 0, fail: 0 };
  private readonly rightButton: HTMLButtonElement;
  private readonly cameraButton: HTMLButtonElement;
  private readonly cameraName: HTMLElement;
  private readonly switchLang: () => void;
  private readonly onReset: () => void;
  private readonly helpPanel: HTMLElement;
  private readonly labelled: [HTMLElement, StringKey][] = [];
  private toastTimer = 0;
  private last = { speed: '', rpm: -1, gear: '', camera: '' as string, limit: '' };

  constructor(parent: HTMLElement, callbacks: HudCallbacks) {
    this.root = el('div', 'hud', parent);

    // --- top bar ---------------------------------------------------------------
    const top = el('div', 'topbar', this.root);
    const helpButton = this.button(top, 'help', () => this.toggleHelp());
    helpButton.classList.add('btn-help');
    this.cameraButton = el('button', 'hud-btn', top);
    this.cameraButton.type = 'button';
    onPress(this.cameraButton, callbacks.onCamera);
    // "Camera: " is dropped on small screens, leaving just the view's name.
    const cameraPrefix = el('span', 'cam-prefix', this.cameraButton);
    this.label(cameraPrefix, 'camera');
    this.cameraName = el('span', '', this.cameraButton);
    this.button(top, 'reset', callbacks.onReset).classList.add('btn-reset');
    this.onReset = callbacks.onReset;
    const switchLang = () => setLang(getLang() === 'ar' ? 'en' : 'ar');
    this.button(top, 'language', switchLang).classList.add('btn-lang');
    this.switchLang = switchLang;

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
    // The limit in force, drawn like the sign.
    this.limit = el('div', 'limit', row);
    this.limit.hidden = true;
    this.speed = el('div', 'speed', row);
    this.label(el('div', 'unit', row), 'kmh');
    const lamps = el('div', 'lamps', dials);
    const lamp = (key: StringKey, className: string) => {
      const l = el('span', `lamp ${className}`, lamps);
      this.label(l, key);
      return l;
    };
    // Faults so far, by severity.
    this.faultCount = el('div', 'fault-count', dials);
    this.faultCount.hidden = true;
    this.lamps = {
      engine: lamp('lampEngine', 'lamp-red'),
      handbrake: lamp('lampHandbrake', 'lamp-red'),
      seatbelt: lamp('lampSeatbelt', 'lamp-red'),
      lights: lamp('lampLights', 'lamp-green'),
    };
    this.arrowRight = el('div', 'arrow arrow-right', cluster);
    this.arrowRight.textContent = '▶';

    // Shown only while the car is on its side or roof.
    this.rightButton = el('button', 'hud-btn primary right-car', this.root);
    this.rightButton.type = 'button';
    this.rightButton.hidden = true;
    this.label(this.rightButton, 'rightCar');
    onPress(this.rightButton, callbacks.onRightCar);

    this.instruction = el('div', 'instruction', this.root);
    this.instruction.hidden = true;
    this.instruction.setAttribute('role', 'status');
    this.instructionIcon = el('span', 'icon', this.instruction);
    this.instructionText = el('span', '', this.instruction);

    // A lesson's current goal, with a button for a hint.
    this.goal = el('div', 'goal', this.root);
    this.goal.hidden = true;
    this.goalStep = el('span', 'step', this.goal);
    this.goalText = el('span', 'text', this.goal);
    const hint = this.button(this.goal, 'lessonHint', () => {
      if (this.goalHint) this.sayText(this.goalHint(), 'info', 7);
    });
    hint.classList.add('hint-btn');

    this.toast = el('div', 'toast', this.root);
    this.toast.setAttribute('role', 'status');
    this.toast.hidden = true;

    this.label(el('div', 'rotate-hint', this.root), 'msgRotate');

    this.helpPanel = this.buildHelp(callbacks);
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
    const limit = s.speedLimit === null ? '' : String(s.speedLimit);
    if (limit !== this.last.limit) {
      this.last.limit = limit;
      this.limit.hidden = limit === '';
      this.limit.textContent = limit;
    }
    this.limit.classList.toggle('over', s.speedLimit !== null && Math.abs(s.speedKmh) > s.speedLimit + 0.5);
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
      this.cameraName.textContent = t(s.camera);
    }
  }

  /** Offer (or stop offering) to put a flipped car back on its wheels. */
  showRightCar(show: boolean): void {
    if (this.rightButton.hidden === show) this.rightButton.hidden = !show;
  }

  /** Show what the examiner asks, with an arrow; it stays up for a while. */
  instruct(icon: string, text: string | (() => string), seconds = 9): void {
    this.instructionIcon.textContent = icon;
    // Text given as a function is redrawn when the language changes.
    this.instructionSource = typeof text === 'function' ? text : () => text;
    this.instructionText.textContent = this.instructionSource();
    if (this.goalSource) this.goalText.textContent = this.goalSource();
    this.instruction.hidden = false;
    window.clearTimeout(this.instructionTimer);
    this.instructionTimer = window.setTimeout(() => (this.instruction.hidden = true), seconds * 1000);
  }

  /** Show a lesson goal (null hides it). Text as functions, so they follow the language. */
  setGoal(goal: { step: number; total: number; text: () => string; hint: () => string } | null): void {
    if (!goal) {
      this.goal.hidden = true;
      this.goalSource = null;
      this.goalHint = null;
      return;
    }
    this.goalStep.textContent = `${t('lessonGoal')} ${goal.step}/${goal.total}`;
    this.goalSource = goal.text;
    this.goalHint = goal.hint;
    this.goalText.textContent = goal.text();
    this.goal.hidden = false;
  }

  /** Show the current goal's hint (after a while with no progress, say). */
  showHint(): void {
    if (this.goalHint) this.sayText(this.goalHint(), 'info', 7);
  }

  /** Show a fault the examiner has just recorded, and count it. */
  fault(severity: 'minor' | 'serious' | 'fail', title: string): void {
    this.counts[severity]++;
    const key: StringKey = severity === 'minor' ? 'sevMinor' : severity === 'serious' ? 'sevSerious' : 'sevFail';
    this.sayText(`${t(key)}: ${title}`, severity, 5);
    this.renderCounts();
  }

  /** Show any text for a few seconds; `tone` colours it. */
  sayText(text: string, tone: 'info' | 'good' | 'minor' | 'serious' | 'fail' = 'info', seconds = 4): void {
    this.toast.textContent = text;
    delete this.toast.dataset['key'];
    this.toast.dataset['tone'] = tone;
    this.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), seconds * 1000);
  }

  private renderCounts(): void {
    const c = this.counts;
    this.faultCount.hidden = c.minor + c.serious + c.fail === 0;
    this.faultCount.textContent = `${t('faultsCount')}: ${c.minor} · ${c.serious} · ${c.fail}`;
  }

  /** Show a message for a few seconds. */
  say(key: StringKey, seconds = 4): void {
    this.toast.textContent = t(key);
    this.toast.dataset['key'] = key;
    this.toast.dataset['tone'] = 'info';
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

  private buildHelp(callbacks: HudCallbacks): HTMLElement {
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
    const modes = el('div', 'help-modes', card);
    const lessonsButton = this.button(modes, 'lessons', () => {
      this.toggleHelp(false);
      callbacks.onLessons();
    });
    if (callbacks.mode === 'lesson') lessonsButton.classList.add('primary');
    const modeButtons: [GameMode, StringKey][] = [
      ['roadTest', 'testRoad'],
      ['yardTest', 'testYard'],
      ['town', 'freeDrive'],
      ['yard', 'practiseYard'],
    ];
    for (const [mode, key] of modeButtons) {
      const b = this.button(modes, key, () => callbacks.onMode(mode));
      if (mode === callbacks.mode) b.classList.add('primary');
    }
    // Keep the mode buttons above the rest of the footer.
    card.insertBefore(modes, foot);
    this.button(foot, 'night', callbacks.onNight);
    this.button(foot, 'reset', () => {
      this.toggleHelp(false);
      this.onReset();
    });
    this.button(foot, 'language', this.switchLang);
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
    this.renderCounts();
    this.instructionText.textContent = this.instructionSource();
    const toastKey = this.toast.dataset['key'] as StringKey | undefined;
    if (toastKey && !this.toast.hidden) this.toast.textContent = t(toastKey);
  }
}

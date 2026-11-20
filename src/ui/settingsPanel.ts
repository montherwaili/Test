/** The settings screen: sound, vibration, steering, picture quality and game controllers. */
import { getLang, onLangChange, t, type StringKey } from './i18n';
import type { Quality, Settings } from './settingsStore';
import type { GamepadControls } from '../input/gamepad';
import type { LearnStep } from '../input/controllerMap';

export interface SettingsHooks {
  /** A setting changed (already applied to the object passed in). */
  onChange: (s: Settings, key: keyof Settings) => void;
  /** The player chose tilt steering: switch the sensor on (inside the tap). Resolves false if refused. */
  enableTilt: () => Promise<boolean>;
  calibrateTilt: () => void;
  gamepad: GamepadControls;
  /** Whether this is a touch screen (tilt steering is offered only there). */
  touch: () => boolean;
}

const LEARN_KEYS: Record<LearnStep, StringKey> = {
  steer: 'learnSteer',
  throttle: 'learnGas',
  brake: 'learnBrake',
  clutch: 'learnClutch',
  '1': 'learnGear',
  '2': 'learnGear',
  '3': 'learnGear',
  '4': 'learnGear',
  '5': 'learnGear',
  R: 'learnReverse',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  parent?.append(e);
  return e;
}

export class SettingsPanel {
  readonly root: HTMLElement;
  private body!: HTMLElement;
  private padStatus: HTMLElement | null = null;
  private padButtons: HTMLButtonElement[] = [];
  private learnBox: HTMLElement | null = null;
  private lastPad = '';
  private reloadNeeded = false;
  private shownAt = 0;

  constructor(
    parent: HTMLElement,
    private readonly settings: Settings,
    private readonly hooks: SettingsHooks,
  ) {
    this.root = el('div', 'settings-panel', parent);
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.addEventListener('click', (e) => {
      // The click that follows the tap which opened the panel must not close it again.
      if (e.target === this.root && performance.now() - this.shownAt > 400) this.hide();
    });
    onLangChange(() => this.render());
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.render();
    this.root.hidden = false;
    this.shownAt = performance.now();
  }

  hide(): void {
    this.hooks.gamepad.cancelLearning();
    this.root.hidden = true;
  }

  private change<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.settings[key] = value;
    this.hooks.onChange(this.settings, key);
  }

  private render(): void {
    const s = this.settings;
    this.root.replaceChildren();
    const card = el('div', 'settings-card', this.root);
    el('h2', '', card, t('settings'));
    this.body = el('div', 'settings-body', card);

    // --- sound and feel ---
    this.section('setSound');
    this.toggle('setSoundOn', s.sound, (v) => this.change('sound', v));
    this.slider('setVolume', s.volume, 0, 1, 0.05, (v) => this.change('volume', v), (v) => `${Math.round(v * 100)}%`);
    if ('vibrate' in navigator) this.toggle('setVibration', s.vibration, (v) => this.change('vibration', v));

    // --- steering on a touch screen ---
    if (this.hooks.touch()) {
      this.section('setSteering');
      const note = el('p', 'settings-note', undefined, '');
      this.choice<Settings['steering']>(
        [
          ['wheel', 'setSteerWheel'],
          ['tilt', 'setSteerTilt'],
        ],
        s.steering,
        async (v, select) => {
          if (v === 'tilt') {
            const ok = await this.hooks.enableTilt();
            if (!ok) {
              note.textContent = t('setTiltRefused');
              select('wheel');
              return;
            }
          }
          note.textContent = v === 'tilt' ? t('setTiltHow') : '';
          this.change('steering', v);
        },
      );
      if (s.steering === 'tilt') note.textContent = t('setTiltHow');
      this.body.append(note);
      this.slider('setTiltRange', s.tiltRange, 15, 60, 1, (v) => this.change('tiltRange', v), (v) => `${Math.round(v)}°`);
      const row = el('div', 'settings-row', this.body);
      const centre = el('button', 'hud-btn', row, t('setTiltCentre'));
      centre.type = 'button';
      centre.addEventListener('click', () => this.hooks.calibrateTilt());
    }

    // --- gearbox ---
    this.section('setGearbox');
    const gbNote = el('p', 'settings-note', undefined, t(`gbNote_${s.gearbox}`));
    this.choice<Settings['gearbox']>(
      [
        ['manual', 'gbManual'],
        ['autoClutch', 'gbAutoClutch'],
        ['automatic', 'gbAutomatic'],
      ],
      s.gearbox,
      (v) => {
        this.change('gearbox', v);
        gbNote.textContent = t(`gbNote_${v}`);
      },
    );
    this.body.append(gbNote);

    // --- picture ---
    this.section('setPicture');
    const reload = el('div', 'settings-row', undefined);
    const showReload = () => {
      reload.replaceChildren();
      if (!this.reloadNeeded) return;
      el('span', 'settings-note', reload, t('setReloadNote'));
      const b = el('button', 'hud-btn primary', reload, t('setReload'));
      b.type = 'button';
      b.addEventListener('click', () => location.reload());
    };
    this.choice<Quality>(
      [
        ['auto', 'qAuto'],
        ['low', 'qLow'],
        ['medium', 'qMedium'],
        ['high', 'qHigh'],
      ],
      s.quality,
      (v) => {
        this.change('quality', v);
        this.reloadNeeded = true;
        showReload();
      },
    );
    this.body.append(reload);
    showReload();
    this.toggle('setShowFps', s.showFps, (v) => this.change('showFps', v));

    // --- controllers ---
    this.section('setController');
    this.padStatus = el('p', 'settings-note', this.body);
    const row = el('div', 'settings-row', this.body);
    const learn = el('button', 'hud-btn', row, t('setLearn'));
    learn.type = 'button';
    learn.addEventListener('click', () => {
      this.hooks.gamepad.startLearning();
      this.update();
    });
    const forget = el('button', 'hud-btn', row, t('setForget'));
    forget.type = 'button';
    forget.addEventListener('click', () => {
      this.hooks.gamepad.forget();
      this.lastPad = '';
      this.update();
    });
    this.padButtons = [learn, forget];
    this.learnBox = el('div', 'settings-learn', this.body);
    this.lastPad = '';
    this.update();

    const foot = el('div', 'settings-foot', card);
    const close = el('button', 'hud-btn primary', foot, t('close'));
    close.type = 'button';
    close.addEventListener('click', () => this.hide());
  }

  /** Refresh the controller status and the teaching prompts (call every frame while open). */
  update(): void {
    if (!this.padStatus || !this.learnBox) return;
    const pad = this.hooks.gamepad;
    const learner = pad.learner;
    const key = `${pad.device}|${pad.learned}|${learner ? learner.step : -1}|${getLang()}`;
    if (key === this.lastPad) return;
    this.lastPad = key;
    this.padStatus.textContent = pad.device
      ? `${t('setPadFound')}: ${pad.device.replace(/\s*\(.*$/, '')} — ${t(pad.learned ? 'setPadLearned' : 'setPadStandard')}`
      : t(pad.available ? 'setPadNone' : 'setPadUnsupported');
    for (const b of this.padButtons) b.disabled = !pad.device || !!learner;
    this.learnBox.replaceChildren();
    if (!learner || !learner.current) return;
    const step = learner.current;
    const prompt = t(LEARN_KEYS[step], { gear: step });
    el('p', 'learn-step', this.learnBox, `${learner.step + 1}/10 — ${prompt}`);
    const row = el('div', 'settings-row', this.learnBox);
    if (step !== 'steer' && step !== 'throttle' && step !== 'brake') {
      const skip = el('button', 'hud-btn', row, t(step === 'clutch' ? 'learnNoClutch' : 'learnNoShifter'));
      skip.type = 'button';
      skip.addEventListener('click', () => {
        // No shifter: skip every gear at once.
        if (step === 'clutch') learner.skip();
        else while (!learner.done) learner.skip();
        if (learner.done) {
          // Let the poller save it on its next read.
          learner.update({ axes: [], buttons: [] });
        }
        this.update();
      });
    }
    const cancel = el('button', 'hud-btn', row, t('learnCancel'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      pad.cancelLearning();
      this.update();
    });
  }

  private section(key: StringKey): void {
    el('h3', '', this.body, t(key));
  }

  private toggle(key: StringKey, value: boolean, set: (v: boolean) => void): void {
    const label = el('label', 'settings-toggle', this.body);
    const box = el('input', '', label);
    box.type = 'checkbox';
    box.checked = value;
    el('span', '', label, t(key));
    box.addEventListener('change', () => set(box.checked));
  }

  private slider(key: StringKey, value: number, min: number, max: number, step: number, set: (v: number) => void, show: (v: number) => string): void {
    const label = el('label', 'settings-slider', this.body);
    el('span', '', label, t(key));
    const input = el('input', '', label);
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const out = el('output', '', label, show(value));
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = show(v);
      set(v);
    });
  }

  private choice<T extends string>(options: [T, StringKey][], value: T, set: (v: T, select: (v: T) => void) => void): void {
    const group = el('div', 'settings-choice', this.body);
    group.setAttribute('role', 'radiogroup');
    const buttons = new Map<T, HTMLButtonElement>();
    const select = (v: T) => {
      for (const [k, b] of buttons) {
        b.classList.toggle('primary', k === v);
        b.setAttribute('aria-checked', String(k === v));
      }
    };
    for (const [v, key] of options) {
      const b = el('button', 'hud-btn', group, t(key));
      b.type = 'button';
      b.setAttribute('role', 'radio');
      buttons.set(v, b);
      b.addEventListener('click', () => {
        select(v);
        set(v, select);
      });
    }
    select(value);
  }
}

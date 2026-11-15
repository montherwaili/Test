/**
 * Phase 1 debug page: drive the sim core with sliders or keys and watch what
 * the engine, clutch and gearbox do. A developer tool, English only; the game
 * UI (Arabic first) comes later and lives in src/ui.
 */
import './debug.css';
import {
  FixedStepper,
  GEAR_NEUTRAL,
  GEAR_REVERSE,
  LongitudinalCar,
  TuningError,
  cloneTuning,
  createDefaultTuning,
  gearLabel,
  neutralControls,
  validateTuning,
  type CarControls,
  type CarEvent,
  type VehicleTuning,
} from '../sim';
import { readTheme } from './canvas';
import { History, drawStrip, stripTimeAt, type StripOptions } from './charts';
import { drawDial } from './gauges';
import { drawRoad } from './roadView';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// --- simulation ------------------------------------------------------------

const tuning: VehicleTuning = createDefaultTuning();
const stepper = new FixedStepper(tuning.sim.stepHz, tuning.sim.maxSubSteps);
let car = new LongitudinalCar(tuning);
const controls: CarControls = { ...neutralControls(), handbrake: 1 };
let gradePercent = 0;
let paused = false;

/** Starter: held by button/key, or latched briefly by a tap so touch users can start. */
let starterHeld = false;
let starterAssistUntil = -1;

const HISTORY_HZ = 30;
const WINDOW_S = 20;
const history = new History(HISTORY_HZ * (WINDOW_S + 2), ['rpm', 'speed', 'throttle', 'brake', 'clutch']);
let stepsSinceSample = 0;

function resetCar(): void {
  car = new LongitudinalCar(tuning);
  car.setGradePercent(gradePercent);
  Object.assign(controls, neutralControls(), { handbrake: 1 });
  starterAssistUntil = -1;
  history.clear();
  stepper.reset();
  $('log').replaceChildren();
  for (const axis of Object.values(keyAxes)) axis.owned = false;
}

function simStep(dt: number): void {
  const running = car.powertrain.state.running;
  controls.starter = starterHeld || (!running && car.time < starterAssistUntil);
  const events = car.step(dt, controls);
  for (const e of events) logEvent(e);
  if (++stepsSinceSample >= tuning.sim.stepHz / HISTORY_HZ) {
    stepsSinceSample = 0;
    const t = car.telemetry;
    history.push(car.time, {
      rpm: t.rpm,
      speed: t.speedKmh,
      throttle: controls.throttle * 100,
      brake: controls.brake * 100,
      clutch: controls.clutch * 100,
    });
  }
}

// --- sliders ---------------------------------------------------------------

interface SliderSpec {
  id: string;
  label: string;
  keys?: string[];
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (v: number) => void;
  format: (v: number) => string;
}

interface Slider {
  refresh: () => void;
  track: HTMLElement;
}

function addSlider(parent: HTMLElement, spec: SliderSpec): Slider {
  const wrap = document.createElement('div');
  wrap.className = 'slider';
  const label = document.createElement('label');
  label.htmlFor = spec.id;
  label.append(spec.label);
  for (const k of spec.keys ?? []) {
    const kbd = document.createElement('kbd');
    kbd.textContent = k;
    label.append(' ', kbd);
  }
  const out = document.createElement('output');
  out.htmlFor = spec.id;
  const track = document.createElement('div');
  track.className = 'track';
  const input = document.createElement('input');
  input.type = 'range';
  input.id = spec.id;
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  track.append(input);
  wrap.append(label, out, track);
  parent.append(wrap);

  let dragging = false;
  input.addEventListener('pointerdown', () => (dragging = true));
  window.addEventListener('pointerup', () => (dragging = false));
  window.addEventListener('pointercancel', () => (dragging = false));
  input.addEventListener('input', () => {
    spec.set(Number(input.value));
    out.textContent = spec.format(spec.get());
  });

  const refresh = () => {
    const v = spec.get();
    if (!dragging) input.value = String(v);
    out.textContent = spec.format(v);
  };
  refresh();
  return { refresh, track };
}

const percent = (v: number) => `${Math.round(v)}%`;

/** toFixed without the "-0" that rounding a tiny negative number gives. */
const fixed = (v: number, digits = 0) => {
  const text = v.toFixed(digits);
  return Number(text) === 0 ? text.replace('-', '') : text;
};

type Axis = 'throttle' | 'brake' | 'clutch';

/** Keyboard pedals ramp instead of jumping; `owned` means a key is driving that pedal. */
const keyAxes: Record<Axis, { held: boolean; owned: boolean; press: number; release: () => number }> = {
  throttle: { held: false, owned: false, press: 1.6, release: () => 4 },
  brake: { held: false, owned: false, press: 3, release: () => 6 },
  clutch: { held: false, owned: false, press: 8, release: () => 1 / clutchReleaseSeconds },
};
let clutchReleaseSeconds = 2;

function pedalSlider(axis: Axis, label: string, keys: string[]): Slider {
  return addSlider($('pedals'), {
    id: axis,
    label,
    keys,
    min: 0,
    max: 100,
    step: 1,
    get: () => controls[axis] * 100,
    set: (v) => {
      controls[axis] = v / 100;
      keyAxes[axis].owned = false;
    },
    format: percent,
  });
}

const sliders: Slider[] = [];
sliders.push(pedalSlider('throttle', 'Throttle', ['W']));
sliders.push(pedalSlider('brake', 'Brake', ['S']));
const clutchSlider = pedalSlider('clutch', 'Clutch pedal', ['Shift']);
sliders.push(clutchSlider);
sliders.push(
  addSlider($('pedals'), {
    id: 'handbrake',
    label: 'Handbrake',
    keys: ['H'],
    min: 0,
    max: 100,
    step: 5,
    get: () => controls.handbrake * 100,
    set: (v) => (controls.handbrake = v / 100),
    format: (v) => (v === 0 ? 'off' : v >= 100 ? 'on' : percent(v)),
  }),
);
sliders.push(
  addSlider($('road-controls'), {
    id: 'grade',
    label: 'Road gradient',
    min: -20,
    max: 20,
    step: 0.5,
    get: () => gradePercent,
    set: (v) => {
      gradePercent = v;
      car.setGradePercent(v);
    },
    format: (v) => (v === 0 ? 'flat' : `${Math.abs(v).toFixed(1)}% ${v > 0 ? 'up' : 'down'}`),
  }),
);
sliders.push(
  addSlider($('road-controls'), {
    id: 'clutch-release',
    label: 'Keyboard clutch release time',
    min: 0.3,
    max: 5,
    step: 0.1,
    get: () => clutchReleaseSeconds,
    set: (v) => (clutchReleaseSeconds = v),
    format: (v) => `${v.toFixed(1)} s`,
  }),
);

// Bite range marker under the clutch slider.
const biteBand = document.createElement('span');
const biteWrap = document.createElement('div');
biteWrap.className = 'bite';
biteWrap.title = 'Clutch bite range';
biteWrap.append(biteBand);
clutchSlider.track.append(biteWrap);

function updateBiteBand(): void {
  biteBand.style.left = `${tuning.clutch.biteEnd * 100}%`;
  biteBand.style.width = `${(tuning.clutch.biteStart - tuning.clutch.biteEnd) * 100}%`;
}
updateBiteBand();

// --- gears, key, top buttons ------------------------------------------------

const gearButtons = new Map<number, HTMLButtonElement>();
for (let g = GEAR_REVERSE; g <= tuning.gearbox.forward.length; g++) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = gearLabel(g);
  b.addEventListener('click', () => (controls.gear = g));
  $('gears').append(b);
  gearButtons.set(g, b);
}

const ignition = $<HTMLInputElement>('ignition');
ignition.addEventListener('change', () => (controls.ignition = ignition.checked));

const starterButton = $<HTMLButtonElement>('starter');
starterButton.addEventListener('pointerdown', () => (starterHeld = true));
for (const type of ['pointerup', 'pointerleave', 'pointercancel'] as const) {
  starterButton.addEventListener(type, () => (starterHeld = false));
}
// A tap (or keyboard activation) cranks until the engine catches, 1.5 s at most.
starterButton.addEventListener('click', () => (starterAssistUntil = car.time + 1.5));

const pauseButton = $<HTMLButtonElement>('pause');
function setPaused(p: boolean): void {
  paused = p;
  pauseButton.textContent = p ? 'Resume' : 'Pause';
  pauseButton.setAttribute('aria-pressed', String(p));
}
pauseButton.addEventListener('click', () => setPaused(!paused));
$('reset').addEventListener('click', resetCar);

// --- keyboard ----------------------------------------------------------------

const KEY_AXIS: Record<string, Axis> = {
  KeyW: 'throttle',
  ArrowUp: 'throttle',
  KeyS: 'brake',
  ArrowDown: 'brake',
  ShiftLeft: 'clutch',
  ShiftRight: 'clutch',
  KeyC: 'clutch',
};

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const target = e.target as HTMLElement | null;
  const onSlider = target instanceof HTMLInputElement && target.type === 'range';
  const axis = KEY_AXIS[e.code];
  if (axis) {
    // Leave arrow keys to a focused slider.
    if (onSlider && e.code.startsWith('Arrow')) return;
    keyAxes[axis].held = true;
    keyAxes[axis].owned = true;
    e.preventDefault();
    return;
  }
  if (e.repeat) return;
  if (e.code.startsWith('Digit')) {
    const g = Number(e.code.slice(5));
    if (g >= 1 && g <= tuning.gearbox.forward.length) controls.gear = g;
  } else if (e.code === 'KeyR') controls.gear = GEAR_REVERSE;
  else if (e.code === 'KeyN') controls.gear = GEAR_NEUTRAL;
  else if (e.code === 'KeyH') controls.handbrake = controls.handbrake > 0 ? 0 : 1;
  else if (e.code === 'KeyI') controls.ignition = !controls.ignition;
  else if (e.code === 'KeyE') starterHeld = true;
  else if (e.code === 'KeyP') setPaused(!paused);
});

window.addEventListener('keyup', (e) => {
  const axis = KEY_AXIS[e.code];
  if (axis) keyAxes[axis].held = false;
  if (e.code === 'KeyE') starterHeld = false;
});

window.addEventListener('blur', () => {
  for (const axis of Object.values(keyAxes)) axis.held = false;
  starterHeld = false;
});

function updateKeyboard(dt: number): void {
  for (const name of Object.keys(keyAxes) as Axis[]) {
    const a = keyAxes[name];
    if (a.held) {
      controls[name] = Math.min(1, controls[name] + a.press * dt);
    } else if (a.owned) {
      controls[name] = Math.max(0, controls[name] - a.release() * dt);
      if (controls[name] === 0) a.owned = false;
    }
  }
}

// --- event log ---------------------------------------------------------------

function describe(e: CarEvent): { text: string; bad: boolean } {
  switch (e.type) {
    case 'engineStart':
      return { text: 'Engine started', bad: false };
    case 'engineOff':
      return { text: 'Engine switched off', bad: false };
    case 'stall':
      return { text: `Stalled in ${gearLabel(e.gear)} at ${Math.round(e.rpm)} rpm`, bad: true };
    case 'shift':
      return { text: `Gear ${gearLabel(e.from)} to ${gearLabel(e.to)}`, bad: false };
    case 'gearGrind':
      return {
        text: `Grind: ${gearLabel(e.wanted)} refused, ${
          e.reason === 'clutch' ? 'clutch not pressed' : 'still rolling forwards'
        }`,
        bad: true,
      };
    case 'overRev':
      return { text: `Over-rev: ${Math.round(e.rpm)} rpm`, bad: true };
  }
}

function logEvent(e: CarEvent): void {
  const { text, bad } = describe(e);
  const li = document.createElement('li');
  const time = document.createElement('time');
  time.textContent = `${e.time.toFixed(2)} s`;
  const span = document.createElement('span');
  span.textContent = text;
  if (bad) span.className = 'bad';
  li.append(time, span);
  const log = $('log');
  log.prepend(li);
  while (log.childElementCount > 60) log.lastElementChild?.remove();
}

// --- lamps, readouts, legend -------------------------------------------------

interface Lamp {
  label: string;
  color: string;
  on: () => boolean;
  el?: HTMLLIElement;
}

const lamps: Lamp[] = [
  { label: 'ENGINE ON', color: 'var(--good)', on: () => car.telemetry.running },
  {
    label: 'ENGINE STOPPED',
    color: 'var(--critical)',
    on: () => controls.ignition && !car.powertrain.state.running,
  },
  { label: 'HANDBRAKE', color: 'var(--warning)', on: () => controls.handbrake > 0 },
  {
    label: 'CLUTCH SLIP',
    color: 'var(--serious)',
    on: () => car.telemetry.clutchCapacity > 0 && Math.abs(car.telemetry.clutchSlipRpm) > 30,
  },
  { label: 'REV LIMIT', color: 'var(--critical)', on: () => car.telemetry.limiterCut },
];
for (const lamp of lamps) {
  const li = document.createElement('li');
  li.className = 'lamp';
  li.textContent = lamp.label;
  li.style.setProperty('--lamp', lamp.color);
  $('lamps').append(li);
  lamp.el = li;
}

const readoutSpecs: [string, () => string][] = [
  ['Sim time', () => `${car.time.toFixed(1)} s`],
  ['Engine speed', () => `${Math.round(car.telemetry.rpm)} rpm`],
  ['Road speed', () => `${fixed(car.telemetry.speedKmh, 1)} km/h`],
  ['Acceleration', () => `${fixed(car.telemetry.acceleration, 2)} m/s²`],
  ['Engine torque', () => `${fixed(car.telemetry.engineTorque)} N·m`],
  ['Engine load', () => percent(car.telemetry.engineLoad * 100)],
  ['Clutch torque', () => `${fixed(car.telemetry.clutchTorque)} N·m`],
  ['Clutch capacity', () => `${fixed(car.telemetry.clutchCapacity)} N·m`],
  ['Clutch slip', () => `${fixed(car.telemetry.clutchSlipRpm)} rpm`],
  ['Drive force', () => `${fixed(car.telemetry.driveForce)} N`],
  ['Brake + rolling', () => `${fixed(car.telemetry.frictionForce)} N`],
  ['Position', () => `${fixed(car.position, 2)} m`],
];
const readoutEls = readoutSpecs.map(([label]) => {
  const row = document.createElement('div');
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  row.append(dt, dd);
  $('readouts').append(row);
  return dd;
});

const pedalSeries = [
  { channel: 'throttle', label: 'Throttle', color: 0 },
  { channel: 'brake', label: 'Brake', color: 1 },
  { channel: 'clutch', label: 'Clutch', color: 2 },
] as const;

const legendValues = pedalSeries.map((s) => {
  const item = document.createElement('span');
  item.className = 'legend-item';
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.setProperty('--swatch', `var(--series-${s.color + 1})`);
  const value = document.createElement('span');
  item.append(swatch, `${s.label} `, value);
  $('pedal-legend').append(item);
  return value;
});

// --- charts ------------------------------------------------------------------

const chartCanvas = (name: string) =>
  document.querySelector<HTMLCanvasElement>(`[data-chart="${name}"] canvas`)!;

const strips: { canvas: HTMLCanvasElement; options: StripOptions }[] = [
  {
    canvas: chartCanvas('rpm'),
    options: {
      series: [{ channel: 'rpm', label: 'Engine speed', color: 0 }],
      range: [0, 7000],
      ticks: 2,
      window: WINDOW_S,
      timeAxis: false,
      format: (v) => String(Math.round(v)),
    },
  },
  {
    canvas: chartCanvas('speed'),
    options: {
      series: [{ channel: 'speed', label: 'Road speed', color: 0 }],
      // Grows in steps of 40 km/h; shows negative speeds only when rolling back.
      range: (min, max) => {
        const hi = Math.max(40, Math.ceil(max / 40) * 40);
        return [min < -0.5 ? -hi : 0, hi];
      },
      ticks: 2,
      window: WINDOW_S,
      timeAxis: false,
      format: (v) => String(Math.round(v)),
    },
  },
  {
    canvas: chartCanvas('pedals'),
    options: {
      series: [...pedalSeries],
      range: [0, 100],
      ticks: 2,
      window: WINDOW_S,
      timeAxis: true,
      format: (v) => String(Math.round(v)),
    },
  },
];

const tooltip = $('tooltip');
let hover: { canvas: HTMLCanvasElement; clientX: number; clientY: number } | null = null;
for (const { canvas } of strips) {
  canvas.style.touchAction = 'pan-y';
  canvas.addEventListener('pointermove', (e) => (hover = { canvas, clientX: e.clientX, clientY: e.clientY }));
  canvas.addEventListener('pointerdown', (e) => (hover = { canvas, clientX: e.clientX, clientY: e.clientY }));
  canvas.addEventListener('pointerleave', () => (hover = null));
  canvas.addEventListener('pointercancel', () => (hover = null));
}

function tooltipRow(label: string, value: string, swatch?: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 't-row';
  if (swatch) {
    const s = document.createElement('span');
    s.className = 'swatch';
    s.style.setProperty('--swatch', swatch);
    row.append(s);
  }
  const b = document.createElement('b');
  b.textContent = value;
  row.append(label, b);
  return row;
}

function updateTooltip(hoverTime: number | null): void {
  const i = hoverTime === null ? -1 : history.nearest(hoverTime);
  if (!hover || i < 0) {
    tooltip.hidden = true;
    return;
  }
  const k = history.index(i);
  const ch = history.channels;
  const t = history.time[k]!;
  const head = document.createElement('div');
  head.className = 't-time';
  head.textContent = `${t.toFixed(1)} s  (${(t - car.time).toFixed(1)} s)`;
  tooltip.replaceChildren(
    head,
    tooltipRow('Engine speed', `${Math.round(ch['rpm']![k]!)} rpm`),
    tooltipRow('Road speed', `${fixed(ch['speed']![k]!, 1)} km/h`),
    ...pedalSeries.map((s) =>
      tooltipRow(s.label, percent(ch[s.channel]![k]!), `var(--series-${s.color + 1})`),
    ),
  );
  tooltip.hidden = false;
  const panel = tooltip.parentElement!.getBoundingClientRect();
  const tw = tooltip.offsetWidth;
  let left = hover.clientX - panel.left + 14;
  if (left + tw > panel.width - 4) left = hover.clientX - panel.left - tw - 14;
  tooltip.style.left = `${Math.max(4, left)}px`;
  tooltip.style.top = `${hover.clientY - panel.top + 14}px`;
}

// --- tuning panel ------------------------------------------------------------

type Section = keyof VehicleTuning;
const tuningSpecs: [Section, string, string, number, number, number][] = [
  ['engine', 'idleRpm', 'Idle speed (rpm)', 500, 1200, 10],
  ['engine', 'stallRpm', 'Stall speed (rpm)', 200, 700, 10],
  ['engine', 'inertia', 'Engine inertia (kg·m²)', 0.05, 0.6, 0.01],
  ['engine', 'idleAuthority', 'Idle control authority', 0.15, 0.9, 0.01],
  ['engine', 'frictionBase', 'Engine friction (N·m)', 4, 30, 0.5],
  ['engine', 'pedalExponent', 'Throttle pedal curve', 1, 3, 0.05],
  ['clutch', 'maxTorque', 'Clutch capacity (N·m)', 100, 500, 5],
  ['clutch', 'biteStart', 'Bite starts at pedal', 0.3, 0.8, 0.01],
  ['clutch', 'biteEnd', 'Fully engaged at pedal', 0.05, 0.6, 0.01],
  ['clutch', 'curveExponent', 'Bite curve shape', 0.5, 4, 0.1],
  ['gearbox', 'finalDrive', 'Final drive ratio', 2.5, 5.5, 0.01],
  ['body', 'mass', 'Car mass (kg)', 700, 2000, 10],
  ['brakes', 'maxForce', 'Foot brake force (N)', 3000, 16000, 100],
  ['brakes', 'handbrakeForce', 'Handbrake force (N)', 1000, 8000, 100],
];

const tuningError = $('tuning-error');

/** Apply a whole validated tuning to the live object the car already points at. */
function applyTuning(next: VehicleTuning): void {
  for (const section of Object.keys(next) as Section[]) {
    Object.assign(tuning[section], next[section]);
  }
  updateBiteBand();
}

const tuningSliders = tuningSpecs.map(([section, key, label, min, max, step]) => {
  const read = () => (tuning[section] as unknown as Record<string, number>)[key]!;
  return addSlider($('tuning'), {
    id: `tuning-${section}-${key}`,
    label,
    min,
    max,
    step,
    get: read,
    set: (v) => {
      const candidate = cloneTuning(tuning);
      (candidate[section] as unknown as Record<string, number>)[key] = v;
      try {
        applyTuning(validateTuning(candidate));
        tuningError.hidden = true;
      } catch (err) {
        // Keep the last good value; say why the new one was refused.
        tuningError.textContent =
          err instanceof TuningError ? `Not applied: ${err.problems.join('; ')}` : String(err);
        tuningError.hidden = false;
      }
    },
    format: (v) => String(Number(v.toFixed(3))),
  });
});

$('tuning-reset').addEventListener('click', () => {
  applyTuning(createDefaultTuning());
  tuningError.hidden = true;
  for (const s of tuningSliders) s.refresh();
});

const copyButton = $<HTMLButtonElement>('tuning-copy');
copyButton.addEventListener('click', async () => {
  const json = JSON.stringify(tuning, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    copyButton.textContent = 'Copied';
  } catch {
    // Clipboard unavailable (insecure context or denied): show it for manual copy.
    window.prompt('Tuning JSON', json);
  }
  setTimeout(() => (copyButton.textContent = 'Copy JSON'), 1500);
});

// --- frame loop --------------------------------------------------------------

let theme = readTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => (theme = readTheme()));

const tach = $<HTMLCanvasElement>('tach');
const speedo = $<HTMLCanvasElement>('speedo');
const road = $<HTMLCanvasElement>('road');
const gearEl = $('gear');
const foot = $('foot');

let lastFrame = performance.now();
let fps = 60;
let lastSteps = 0;

function draw(): void {
  const t = car.telemetry;

  drawDial(tach, theme, {
    value: Math.abs(t.rpm),
    min: 0,
    max: 7000,
    majorStep: 1000,
    minorStep: 250,
    labelDivisor: 1000,
    redFrom: tuning.engine.redlineRpm,
    readout: String(Math.round(t.rpm / 10) * 10),
    caption: 'rpm  (×1000)',
  });
  drawDial(speedo, theme, {
    value: Math.abs(t.speedKmh),
    min: 0,
    max: 220,
    majorStep: 20,
    minorStep: 10,
    readout: Math.abs(t.speedKmh).toFixed(Math.abs(t.speedKmh) < 20 ? 1 : 0),
    caption: t.speedKmh < -0.05 ? 'km/h  backwards' : 'km/h',
  });
  drawRoad(road, theme, {
    position: car.position,
    slope: car.slope,
    wheelRadius: tuning.body.wheelRadius,
    brakeLights: controls.brake > 0.02,
    handbrake: controls.handbrake > 0,
  });

  const hoverTime = hover ? stripTimeAt(hover.canvas, hover.clientX, car.time, WINDOW_S) : null;
  for (const s of strips) drawStrip(s.canvas, theme, history, car.time, hoverTime, s.options);
  updateTooltip(hoverTime);

  gearEl.textContent = gearLabel(t.gear);
  for (const [g, b] of gearButtons) {
    b.setAttribute('aria-pressed', String(g === car.powertrain.state.gear));
    b.classList.toggle('wanted', g === controls.gear);
  }
  for (const lamp of lamps) lamp.el!.classList.toggle('on', lamp.on());
  readoutSpecs.forEach(([, value], i) => (readoutEls[i]!.textContent = value()));
  pedalSeries.forEach((s, i) => (legendValues[i]!.textContent = percent(controls[s.channel] * 100)));
  for (const s of sliders) s.refresh();
  ignition.checked = controls.ignition;
  starterButton.setAttribute('aria-pressed', String(controls.starter));

  foot.textContent = `Simulation ${tuning.sim.stepHz} Hz fixed step · ${lastSteps} steps this frame · ${Math.round(fps)} fps${paused ? ' · paused' : ''}`;
}

function frame(now: number): void {
  const elapsed = Math.min((now - lastFrame) / 1000, 0.25);
  lastFrame = now;
  if (elapsed > 0) fps += (1 / elapsed - fps) * 0.05;
  updateKeyboard(elapsed);
  lastSteps = paused ? 0 : stepper.advance(elapsed, simStep);
  draw();
  requestAnimationFrame(frame);
}

resetCar();
requestAnimationFrame(frame);

// Handy in the browser console, and for automated page checks.
Object.assign(window, { __sim: { car: () => car, controls, tuning, history } });

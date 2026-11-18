/**
 * Replay controls: a timeline with the faults marked on it, play / pause,
 * skip and speed, the camera, and graphs of engine speed, road speed and the
 * three pedals around the moment being watched.
 */
import type { Severity } from '../examiner/rules';
import { SPEEDS, type ReplayClock } from '../replay/clock';
import type { Recording } from '../replay/recording';
import { onLangChange, t, type StringKey } from './i18n';
import { onPress } from './press';

export interface ReplayMarker {
  /** Simulation time of the fault. */
  at: number;
  n: number;
  severity: Severity;
}

export interface ReplayViewActions {
  onClose: () => void;
  /** Next camera; returns the label of the one now in use. */
  onCamera: () => StringKey;
  /** Free camera: drag by (dx, dy) pixels, or zoom by a factor. */
  onOrbit: (dx: number, dy: number) => void;
  onZoom: (factor: number) => void;
}

const SEVERITY_COLOUR: Record<Severity, string> = { minor: '#f0a51c', serious: '#ef6a3a', fail: '#e5383b' };
/** Categorical series on the dark panel (validated set: blue, orange, aqua). */
const SERIES = ['#3987e5', '#d95926', '#199e70'] as const;
const GRID = '#2c2c2a';
const MUTED = '#898781';
const INK = '#f0efec';
/** Seconds of data either side of the playhead in the graphs. */
const GRAPH_HALF_WINDOW = 10;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  parent?.append(e);
  return e;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function sizeCanvas(c: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = c.clientWidth;
  const h = c.clientHeight;
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  if (c.width !== bw || c.height !== bh) {
    c.width = bw;
    c.height = bh;
  }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

export class ReplayView {
  readonly root: HTMLElement;
  private readonly orbitLayer: HTMLElement;
  private readonly cameraButton: HTMLButtonElement;
  private readonly playButton: HTMLButtonElement;
  private readonly speedButton: HTMLButtonElement;
  private readonly timeText: HTMLElement;
  private readonly timeline: HTMLCanvasElement;
  private readonly graphs: HTMLCanvasElement;
  private readonly graphPanel: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly labelled: [HTMLElement, StringKey][] = [];
  private cameraKey: StringKey = 'camChase';
  private clockRef: ReplayClock | null = null;

  constructor(
    parent: HTMLElement,
    private readonly recording: Recording,
    private readonly markers: ReplayMarker[],
    private readonly actions: ReplayViewActions,
  ) {
    this.root = el('div', 'replay', parent);
    this.root.hidden = true;

    // Drag anywhere on the picture to turn the free camera.
    this.orbitLayer = el('div', 'replay-orbit', this.root);
    this.bindOrbit();

    const top = el('div', 'replay-top', this.root);
    const back = el('button', 'hud-btn', top);
    back.type = 'button';
    this.label(back, 'replayBack');
    onPress(back, () => actions.onClose());
    this.cameraButton = el('button', 'hud-btn', top);
    this.cameraButton.type = 'button';
    onPress(this.cameraButton, () => {
      this.cameraKey = actions.onCamera();
      this.relabel();
    });
    const graphsButton = el('button', 'hud-btn', top);
    graphsButton.type = 'button';
    this.label(graphsButton, 'replayGraphs');
    onPress(graphsButton, () => {
      this.graphPanel.hidden = !this.graphPanel.hidden;
      graphsButton.classList.toggle('primary', !this.graphPanel.hidden);
    });
    // Graphs start open where there is room for them beside the picture.
    const roomy = window.innerHeight >= 500;
    graphsButton.classList.toggle('primary', roomy);

    this.hint = el('div', 'replay-hint', this.root);
    this.label(this.hint, 'freeHint');
    this.hint.hidden = true;

    this.graphPanel = el('div', 'replay-graphs', this.root);
    this.graphs = el('canvas', '', this.graphPanel);
    this.graphPanel.hidden = window.innerHeight < 500;

    const bottom = el('div', 'replay-bottom', this.root);
    const row = el('div', 'replay-row', bottom);
    const back5 = el('button', 'hud-btn', row);
    back5.type = 'button';
    back5.textContent = '−5';
    onPress(back5, () => this.clockRef?.skip(-5));
    this.playButton = el('button', 'hud-btn primary replay-play', row);
    this.playButton.type = 'button';
    onPress(this.playButton, () => this.clockRef?.toggle());
    const fwd5 = el('button', 'hud-btn', row);
    fwd5.type = 'button';
    fwd5.textContent = '+5';
    onPress(fwd5, () => this.clockRef?.skip(5));
    this.speedButton = el('button', 'hud-btn', row);
    this.speedButton.type = 'button';
    onPress(this.speedButton, () => this.clockRef?.cycleSpeed());
    this.timeText = el('span', 'replay-time', row);
    this.timeText.dir = 'ltr';

    this.timeline = el('canvas', 'replay-timeline', bottom);
    this.bindTimeline();

    onLangChange(() => this.relabel());
    this.relabel();
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(c: ReplayClock, cameraKey: StringKey): void {
    this.clockRef = c;
    this.cameraKey = cameraKey;
    this.relabel();
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** Redraw for the current moment. */
  update(c: ReplayClock): void {
    this.playButton.textContent = c.playing ? '❚❚' : '▶';
    this.playButton.setAttribute('aria-label', t(c.playing ? 'replayPause' : 'replayPlay'));
    this.speedButton.textContent = `${c.speed}×`;
    this.timeText.textContent = `${clock(c.time - c.start)} / ${clock(c.end - c.start)}`;
    const free = this.cameraKey === 'camFree';
    this.orbitLayer.classList.toggle('active', free);
    this.hint.hidden = !free;
    this.drawTimeline(c);
    if (!this.graphPanel.hidden) this.drawGraphs(c);
  }

  private label(node: HTMLElement, key: StringKey): void {
    this.labelled.push([node, key]);
  }

  private relabel(): void {
    for (const [node, key] of this.labelled) node.textContent = t(key);
    this.cameraButton.textContent = `${t('camera')}: ${t(this.cameraKey)}`;
  }

  private bindTimeline(): void {
    let active: number | null = null;
    const seek = (e: PointerEvent) => {
      const r = this.timeline.getBoundingClientRect();
      // The timeline runs left to right whatever the language: time is not text.
      const p = Math.min(1, Math.max(0, (e.clientX - r.left - 8) / (r.width - 16)));
      const c = this.clockRef;
      if (c) c.seek(c.start + p * (c.end - c.start));
    };
    this.timeline.addEventListener('pointerdown', (e) => {
      active = e.pointerId;
      this.timeline.setPointerCapture(e.pointerId);
      seek(e);
      e.preventDefault();
    });
    this.timeline.addEventListener('pointermove', (e) => {
      if (e.pointerId === active) seek(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === active) active = null;
    };
    this.timeline.addEventListener('pointerup', end);
    this.timeline.addEventListener('pointercancel', end);
  }

  private bindOrbit(): void {
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const layer = this.orbitLayer;
    layer.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      layer.setPointerCapture(e.pointerId);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    layer.addEventListener('pointermove', (e) => {
      const last = pointers.get(e.pointerId);
      if (!last) return;
      if (pointers.size === 1) this.actions.onOrbit(e.clientX - last.x, e.clientY - last.y);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && d > 0) this.actions.onZoom(pinch / d);
        pinch = d;
      }
    });
    const end = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinch = 0;
    };
    layer.addEventListener('pointerup', end);
    layer.addEventListener('pointercancel', end);
    layer.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.actions.onZoom(Math.exp(e.deltaY * 0.001));
      },
      { passive: false },
    );
  }

  private drawTimeline(c: ReplayClock): void {
    const { ctx, w, h } = sizeCanvas(this.timeline);
    const x0 = 8;
    const x1 = w - 8;
    const X = (time: number) => x0 + ((time - c.start) / Math.max(c.end - c.start, 1e-6)) * (x1 - x0);
    const mid = h / 2 + 4;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x0, mid);
    ctx.lineTo(x1, mid);
    ctx.stroke();
    ctx.strokeStyle = SERIES[0];
    ctx.beginPath();
    ctx.moveTo(x0, mid);
    ctx.lineTo(X(c.time), mid);
    ctx.stroke();
    // Faults: a tick with its number above the track.
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const m of this.markers) {
      const x = X(m.at);
      ctx.fillStyle = SEVERITY_COLOUR[m.severity];
      ctx.fillRect(x - 1.5, mid - 9, 3, 18);
      ctx.fillText(String(m.n), x, mid - 10);
    }
    // Playhead.
    ctx.fillStyle = INK;
    ctx.strokeStyle = '#16181d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(X(c.time), mid, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  /** Three small multiples on one time axis: engine speed, road speed, pedals. */
  private drawGraphs(c: ReplayClock): void {
    const { ctx, w, h } = sizeCanvas(this.graphs);
    const r = this.recording;
    const from = Math.max(c.start, c.time - GRAPH_HALF_WINDOW);
    const to = Math.min(c.end, Math.max(from + 2 * GRAPH_HALF_WINDOW, c.time + GRAPH_HALF_WINDOW));
    const i0 = r.frameAt(from);
    const i1 = r.frameAt(to);
    const left = 34;
    const right = w - 8;
    const X = (time: number) => left + ((time - from) / Math.max(to - from, 1e-6)) * (right - left);
    const now = r.sample(c.time);

    let maxSpeed = 40;
    for (let i = i0; i <= i1; i++) maxSpeed = Math.max(maxSpeed, Math.abs(r.value(i, 'speed')) * 3.6);
    maxSpeed = Math.ceil(maxSpeed / 20) * 20;

    const strips: { key: StringKey; unit: string; max: number; lines: { get: (i: number) => number; colour: string; label?: StringKey; now: number }[] }[] = [
      { key: 'graphRpm', unit: 'rpm', max: 7000, lines: [{ get: (i) => r.value(i, 'rpm'), colour: SERIES[0], now: now.car.rpm }] },
      { key: 'graphSpeed', unit: 'km/h', max: maxSpeed, lines: [{ get: (i) => Math.abs(r.value(i, 'speed')) * 3.6, colour: SERIES[0], now: Math.abs(now.car.speed) * 3.6 }] },
      {
        key: 'graphPedals',
        unit: '%',
        max: 100,
        lines: [
          { get: (i) => r.value(i, 'throttle') * 100, colour: SERIES[0], label: 'pedThrottle', now: now.car.throttle * 100 },
          { get: (i) => r.value(i, 'brake') * 100, colour: SERIES[1], label: 'pedBrake', now: now.car.brake * 100 },
          { get: (i) => r.value(i, 'clutch') * 100, colour: SERIES[2], label: 'pedClutch', now: now.car.clutch * 100 },
        ],
      },
    ];

    const gap = 6;
    const stripH = (h - gap * (strips.length - 1)) / strips.length;
    ctx.font = '11px system-ui, sans-serif';
    // The graph reads left to right in either language (time runs that way); words keep their own direction.
    ctx.direction = 'ltr';
    strips.forEach((s, k) => {
      const top = k * (stripH + gap);
      const titleH = 14;
      const y0 = top + titleH;
      const y1 = top + stripH - 2;
      const Y = (v: number) => y1 - (Math.min(Math.max(v, 0), s.max) / s.max) * (y1 - y0);

      // Title and the values at the playhead (text in ink colours; the swatch carries the series colour).
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillStyle = INK;
      ctx.fillText(t(s.key), left, top);
      let x = left + ctx.measureText(t(s.key)).width + 10;
      for (const line of s.lines) {
        const text = `${line.label ? `${t(line.label)} ` : ''}${Math.round(line.now)}${s.unit === '%' ? '%' : ` ${s.unit}`}`;
        ctx.fillStyle = line.colour;
        ctx.fillRect(x, top + 5, 10, 3);
        ctx.fillStyle = MUTED;
        ctx.fillText(text, x + 13, top);
        x += 13 + ctx.measureText(text).width + 10;
      }

      // Recessive grid: zero and the top of the scale.
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      for (const v of [0, s.max]) {
        ctx.beginPath();
        ctx.moveTo(left, Math.round(Y(v)) + 0.5);
        ctx.lineTo(right, Math.round(Y(v)) + 0.5);
        ctx.stroke();
      }
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(s.max), left - 4, Y(s.max));
      ctx.fillText('0', left - 4, Y(0));

      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      for (const line of s.lines) {
        ctx.strokeStyle = line.colour;
        ctx.beginPath();
        for (let i = i0; i <= i1; i++) {
          const px = X(r.frameTime(i));
          const py = Y(line.get(i));
          if (i === i0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      // Faults in view, and the playhead.
      for (const m of this.markers) {
        if (m.at < from || m.at > to) continue;
        ctx.strokeStyle = SEVERITY_COLOUR[m.severity];
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(X(m.at), y0);
        ctx.lineTo(X(m.at), y1);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(X(c.time)) + 0.5, y0);
      ctx.lineTo(Math.round(X(c.time)) + 0.5, y1);
      ctx.stroke();
    });
  }
}

export { SPEEDS };

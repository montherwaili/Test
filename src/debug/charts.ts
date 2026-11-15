import { FONT, prepare, type Theme } from './canvas';

/** Fixed-length rolling record of telemetry samples. */
export class History {
  readonly time: Float64Array;
  readonly channels: Record<string, Float32Array> = {};
  private head = 0;
  count = 0;

  constructor(
    readonly capacity: number,
    names: string[],
  ) {
    this.time = new Float64Array(capacity);
    for (const n of names) this.channels[n] = new Float32Array(capacity);
  }

  push(time: number, values: Record<string, number>): void {
    this.time[this.head] = time;
    for (const n in this.channels) this.channels[n]![this.head] = values[n] ?? 0;
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  /** Index of the i-th oldest stored sample. */
  index(i: number): number {
    return (this.head - this.count + i + this.capacity * 2) % this.capacity;
  }

  /** Stored-order index of the sample nearest to `time`; -1 if none within `maxGap` seconds. */
  nearest(time: number, maxGap = 0.25): number {
    let best = -1;
    let bestD = maxGap;
    for (let i = 0; i < this.count; i++) {
      const d = Math.abs(this.time[this.index(i)]! - time);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}

export interface StripSeries {
  channel: string;
  label: string;
  /** Index into the theme's categorical series colours. */
  color: 0 | 1 | 2;
}

export interface StripOptions {
  series: StripSeries[];
  /** Fixed range, or a function for a range that follows the data. */
  range: [number, number] | ((min: number, max: number) => [number, number]);
  ticks: number;
  /** Seconds shown. */
  window: number;
  /** Draw the time axis labels (bottom chart only). */
  timeAxis: boolean;
  format: (v: number) => string;
}

const PAD_LEFT = 38;
const PAD_RIGHT = 6;
const PAD_TOP = 6;

/** One small-multiple strip: a few lines over a shared, scrolling time axis. */
export function drawStrip(
  canvas: HTMLCanvasElement,
  theme: Theme,
  history: History,
  now: number,
  hoverTime: number | null,
  o: StripOptions,
): void {
  const { ctx, w, h } = prepare(canvas);
  const padBottom = o.timeAxis ? 18 : 6;
  const plotW = w - PAD_LEFT - PAD_RIGHT;
  const plotH = h - PAD_TOP - padBottom;
  if (plotW <= 0 || plotH <= 0) return;

  let lo: number;
  let hi: number;
  if (typeof o.range === 'function') {
    let dMin = Infinity;
    let dMax = -Infinity;
    for (const s of o.series) {
      const data = history.channels[s.channel]!;
      for (let i = 0; i < history.count; i++) {
        const v = data[history.index(i)]!;
        if (v < dMin) dMin = v;
        if (v > dMax) dMax = v;
      }
    }
    if (dMin > dMax) dMin = dMax = 0;
    [lo, hi] = o.range(dMin, dMax);
  } else {
    [lo, hi] = o.range;
  }

  const x = (t: number) => PAD_LEFT + plotW - ((now - t) / o.window) * plotW;
  const y = (v: number) => PAD_TOP + plotH - ((v - lo) / (hi - lo)) * plotH;

  // Grid and y labels.
  ctx.font = `10px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;
  for (let i = 0; i <= o.ticks; i++) {
    const v = lo + ((hi - lo) * i) / o.ticks;
    const yy = Math.round(y(v)) + 0.5;
    ctx.strokeStyle = Math.abs(v) < 1e-9 ? theme.axis : theme.grid;
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, yy);
    ctx.lineTo(w - PAD_RIGHT, yy);
    ctx.stroke();
    ctx.fillStyle = theme.muted;
    ctx.fillText(o.format(v), PAD_LEFT - 6, yy);
  }

  if (o.timeAxis) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let s = 0; s <= o.window; s += 5) {
      const xx = PAD_LEFT + plotW - (s / o.window) * plotW;
      ctx.textAlign = s === 0 ? 'right' : s === o.window ? 'left' : 'center';
      ctx.fillText(s === 0 ? 'now' : `-${s} s`, xx, h - 13);
    }
  }

  // Lines.
  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD_LEFT, 0, plotW, h);
  ctx.clip();
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const s of o.series) {
    const data = history.channels[s.channel]!;
    ctx.strokeStyle = theme.series[s.color];
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < history.count; i++) {
      const k = history.index(i);
      const t = history.time[k]!;
      if (now - t > o.window + 0.5) continue;
      const px = x(t);
      const py = y(Math.min(Math.max(data[k]!, lo), hi));
      if (started) ctx.lineTo(px, py);
      else {
        ctx.moveTo(px, py);
        started = true;
      }
    }
    ctx.stroke();
  }

  // Hover crosshair with a ringed marker on each line.
  if (hoverTime !== null) {
    const i = history.nearest(hoverTime);
    if (i >= 0) {
      const k = history.index(i);
      const px = x(history.time[k]!);
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(px) + 0.5, PAD_TOP);
      ctx.lineTo(Math.round(px) + 0.5, PAD_TOP + plotH);
      ctx.stroke();
      for (const s of o.series) {
        const v = history.channels[s.channel]![k]!;
        const py = y(Math.min(Math.max(v, lo), hi));
        ctx.fillStyle = theme.series[s.color];
        ctx.strokeStyle = theme.surface;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** Convert a pointer x position over a strip canvas to a time, or null if outside the plot. */
export function stripTimeAt(canvas: HTMLCanvasElement, clientX: number, now: number, window: number): number | null {
  const rect = canvas.getBoundingClientRect();
  const plotW = rect.width - PAD_LEFT - PAD_RIGHT;
  const px = clientX - rect.left - PAD_LEFT;
  if (plotW <= 0 || px < 0 || px > plotW) return null;
  return now - (1 - px / plotW) * window;
}

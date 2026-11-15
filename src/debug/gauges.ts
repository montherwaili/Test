import { FONT, prepare, type Theme } from './canvas';

export interface DialOptions {
  value: number;
  min: number;
  max: number;
  majorStep: number;
  minorStep: number;
  /** Divide tick labels by this (1000 for "x1000 rpm"). */
  labelDivisor?: number;
  /** Values from here up are drawn as the red zone. */
  redFrom?: number;
  /** Big number under the needle. */
  readout: string;
  caption: string;
}

const START = Math.PI * 0.75;
const SWEEP = Math.PI * 1.5;

export function drawDial(canvas: HTMLCanvasElement, theme: Theme, o: DialOptions): void {
  const { ctx, w, h } = prepare(canvas);
  const size = Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2;
  const r = size / 2 - 4;
  const angle = (v: number) =>
    START + (Math.min(Math.max(v, o.min), o.max) - o.min) / (o.max - o.min) * SWEEP;

  // Track.
  ctx.lineCap = 'butt';
  ctx.lineWidth = 3;
  ctx.strokeStyle = theme.axis;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 2, START, START + SWEEP);
  ctx.stroke();

  if (o.redFrom !== undefined) {
    ctx.strokeStyle = theme.critical;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 3, angle(o.redFrom), START + SWEEP);
    ctx.stroke();
  }

  // Ticks and numbers.
  const fontSize = Math.max(9, size * 0.062);
  ctx.font = `600 ${fontSize}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const steps = Math.round((o.max - o.min) / o.minorStep);
  for (let i = 0; i <= steps; i++) {
    const v = o.min + i * o.minorStep;
    const major = Math.abs(v / o.majorStep - Math.round(v / o.majorStep)) < 1e-6;
    const a = angle(v);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const outer = r - 6;
    const inner = outer - (major ? size * 0.06 : size * 0.03);
    ctx.strokeStyle = major ? theme.text2 : theme.axis;
    ctx.lineWidth = major ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + cos * outer, cy + sin * outer);
    ctx.lineTo(cx + cos * inner, cy + sin * inner);
    ctx.stroke();
    if (major) {
      const lr = inner - fontSize * 0.95;
      ctx.fillStyle = o.redFrom !== undefined && v >= o.redFrom ? theme.critical : theme.text2;
      ctx.fillText(String(Math.round(v / (o.labelDivisor ?? 1))), cx + cos * lr, cy + sin * lr);
    }
  }

  // Needle.
  const a = angle(o.value);
  ctx.strokeStyle = theme.series[1];
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(a) * size * 0.06, cy - Math.sin(a) * size * 0.06);
  ctx.lineTo(cx + Math.cos(a) * (r - size * 0.11), cy + Math.sin(a) * (r - size * 0.11));
  ctx.stroke();
  ctx.fillStyle = theme.text2;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.035, 0, Math.PI * 2);
  ctx.fill();

  // Readout.
  ctx.fillStyle = theme.text;
  ctx.font = `700 ${size * 0.13}px ${FONT}`;
  ctx.fillText(o.readout, cx, cy + r * 0.52);
  ctx.fillStyle = theme.muted;
  ctx.font = `${Math.max(9, size * 0.055)}px ${FONT}`;
  ctx.fillText(o.caption, cx, cy + r * 0.76);
}

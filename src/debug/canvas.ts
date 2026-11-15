/** Colours read from the page's CSS custom properties, for canvas drawing. */
export interface Theme {
  surface: string;
  page: string;
  text: string;
  text2: string;
  muted: string;
  grid: string;
  axis: string;
  series: [string, string, string];
  good: string;
  warning: string;
  critical: string;
  car: string;
  tyre: string;
}

export function readTheme(): Theme {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    surface: v('--surface'),
    page: v('--page'),
    text: v('--text'),
    text2: v('--text-2'),
    muted: v('--muted'),
    grid: v('--grid'),
    axis: v('--axis'),
    series: [v('--series-1'), v('--series-2'), v('--series-3')],
    good: v('--good'),
    warning: v('--warning'),
    critical: v('--critical'),
    car: v('--car'),
    tyre: v('--tyre'),
  };
}

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/**
 * Match the canvas backing store to its CSS size and the device pixel ratio.
 * Returns a context scaled so drawing is in CSS pixels, plus that size.
 */
export function prepare(canvas: HTMLCanvasElement): {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
} {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

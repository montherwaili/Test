/**
 * Road sign faces, drawn on canvases at load time (no image files).
 *
 * TODO(verify with ROP / Oman standards): shapes and colours follow the
 * common international patterns; the exact Omani designs, wording and
 * numerals have not been checked.
 */
import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import type { SignDef } from '../world/roads/generate';

const SIZE = 128;
const RED = '#c8102e';
const BLUE = '#1456a8';
const WHITE = '#ffffff';
const BLACK = '#111111';
const ARABIC_FONT = '"Noto Sans Arabic", "Segoe UI", Tahoma, Arial, sans-serif';

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function arabicNumber(n: number): string {
  return String(n).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]!);
}

/** One texture per distinct face: "stop", "limit:40", ... */
export function signTextureKey(s: SignDef): string {
  return s.kind === 'limit' ? `limit:${s.value ?? 0}` : s.kind;
}

function polygon(ctx: CanvasRenderingContext2D, points: [number, number][]): void {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

function triangle(ctx: CanvasRenderingContext2D, pointDown: boolean): void {
  const m = 6;
  const top = pointDown ? m + 6 : SIZE - m - 6;
  const tip = pointDown ? SIZE - m : m;
  polygon(ctx, [
    [m, top],
    [SIZE - m, top],
    [SIZE / 2, tip],
  ]);
  ctx.fillStyle = WHITE;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 12;
  ctx.strokeStyle = RED;
  ctx.stroke();
}

function draw(key: string, ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const c = SIZE / 2;
  const [kind, value] = key.split(':') as [string, string | undefined];

  if (kind === 'stop') {
    const r = 60;
    const pts: [number, number][] = [];
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) / 8) * Math.PI * 2;
      pts.push([c + r * Math.cos(a), c + r * Math.sin(a)]);
    }
    polygon(ctx, pts);
    ctx.fillStyle = RED;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = WHITE;
    ctx.stroke();
    ctx.fillStyle = WHITE;
    ctx.font = `bold 44px ${ARABIC_FONT}`;
    ctx.fillText('قف', c, c - 16);
    ctx.font = 'bold 26px Arial, sans-serif';
    ctx.fillText('STOP', c, c + 26);
  } else if (kind === 'giveWay') {
    triangle(ctx, true);
  } else if (kind === 'limit') {
    ctx.beginPath();
    ctx.arc(c, c, 56, 0, Math.PI * 2);
    ctx.fillStyle = WHITE;
    ctx.fill();
    ctx.lineWidth = 13;
    ctx.strokeStyle = RED;
    ctx.stroke();
    ctx.fillStyle = BLACK;
    const n = Number(value);
    ctx.font = `bold 34px ${ARABIC_FONT}`;
    ctx.fillText(arabicNumber(n), c, c - 18);
    ctx.font = 'bold 40px Arial, sans-serif';
    ctx.fillText(String(n), c, c + 20);
  } else if (kind === 'roundabout') {
    ctx.beginPath();
    ctx.arc(c, c, 60, 0, Math.PI * 2);
    ctx.fillStyle = BLUE;
    ctx.fill();
    // Three arrows chasing each other anticlockwise.
    ctx.strokeStyle = WHITE;
    ctx.fillStyle = WHITE;
    ctx.lineWidth = 10;
    for (let i = 0; i < 3; i++) {
      const a0 = (i / 3) * Math.PI * 2;
      const a1 = a0 - 1.35; // canvas angles run clockwise, so decreasing = anticlockwise
      ctx.beginPath();
      ctx.arc(c, c, 32, a0, a1, true);
      ctx.stroke();
      const hx = c + 32 * Math.cos(a1);
      const hy = c + 32 * Math.sin(a1);
      const t = a1 - Math.PI / 2; // direction of travel at the arrow's tip
      polygon(ctx, [
        [hx + 15 * Math.cos(t), hy + 15 * Math.sin(t)],
        [hx + 12 * Math.cos(t + 2.3), hy + 12 * Math.sin(t + 2.3)],
        [hx + 12 * Math.cos(t - 2.3), hy + 12 * Math.sin(t - 2.3)],
      ]);
      ctx.fill();
    }
  } else if (kind === 'crossing') {
    ctx.fillStyle = BLUE;
    ctx.fillRect(4, 4, SIZE - 8, SIZE - 8);
    polygon(ctx, [
      [c, 16],
      [SIZE - 16, SIZE - 18],
      [16, SIZE - 18],
    ]);
    ctx.fillStyle = WHITE;
    ctx.fill();
    // A walking figure on a striped crossing.
    ctx.fillStyle = BLACK;
    ctx.strokeStyle = BLACK;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(c + 3, 50, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(c + 2, 60);
    ctx.lineTo(c - 2, 82);
    ctx.lineTo(c - 14, 100);
    ctx.moveTo(c - 2, 82);
    ctx.lineTo(c + 12, 100);
    ctx.moveTo(c, 66);
    ctx.lineTo(c - 14, 76);
    ctx.moveTo(c, 66);
    ctx.lineTo(c + 14, 74);
    ctx.stroke();
  } else if (kind === 'bump') {
    triangle(ctx, false);
    ctx.fillStyle = BLACK;
    ctx.beginPath();
    ctx.moveTo(34, 96);
    ctx.quadraticCurveTo(c, 56, SIZE - 34, 96);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(28, 94, SIZE - 56, 6);
  } else {
    // parking
    ctx.fillStyle = BLUE;
    ctx.fillRect(4, 4, SIZE - 8, SIZE - 8);
    ctx.fillStyle = WHITE;
    ctx.font = 'bold 64px Arial, sans-serif';
    ctx.fillText('P', c, c - 14);
    ctx.font = `bold 24px ${ARABIC_FONT}`;
    ctx.fillText('مواقف', c, c + 36);
  }
}

const cache = new Map<string, Texture>();

export function signTexture(key: string): Texture {
  let t = cache.get(key);
  if (!t) {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    draw(key, canvas.getContext('2d')!);
    t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    cache.set(key, t);
  }
  return t;
}

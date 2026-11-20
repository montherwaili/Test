/**
 * The map in the corner: the roads round the car, turning with it (heading
 * up), the fast roads picked out in amber. The whole map is drawn once onto
 * a canvas; each frame only a turned window of it is copied.
 */
export interface MapRoad {
  points: { x: number; z: number }[];
  /** km/h */
  limit: number;
  lanes: number;
}

/** Pixels per metre on the stored picture. */
const SCALE = 0.25;

export class Minimap {
  readonly root: HTMLElement;
  private readonly view: HTMLCanvasElement;
  private readonly sheet: HTMLCanvasElement;
  private readonly minX: number;
  private readonly minZ: number;
  private last = 0;

  constructor(parent: HTMLElement, roads: MapRoad[], size = 168) {
    this.root = document.createElement('div');
    this.root.className = 'minimap';
    parent.append(this.root);
    this.view = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.view.width = this.view.height = Math.round(size * dpr);
    this.view.style.width = this.view.style.height = `${size}px`;
    this.root.append(this.view);

    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const r of roads) {
      for (const p of r.points) {
        minX = Math.min(minX, p.x);
        minZ = Math.min(minZ, p.z);
        maxX = Math.max(maxX, p.x);
        maxZ = Math.max(maxZ, p.z);
      }
    }
    const pad = 200;
    this.minX = minX - pad;
    this.minZ = minZ - pad;
    this.sheet = document.createElement('canvas');
    this.sheet.width = Math.ceil((maxX - minX + 2 * pad) * SCALE);
    this.sheet.height = Math.ceil((maxZ - minZ + 2 * pad) * SCALE);
    const g = this.sheet.getContext('2d')!;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // Slow roads first, so the fast ones are drawn over them where they meet.
    const sorted = [...roads].sort((a, b) => a.limit - b.limit);
    for (const pass of ['edge', 'fill'] as const) {
      for (const r of sorted) {
        const fast = r.limit >= 100;
        const width = Math.max(2, r.lanes * 3.65 * SCALE * 1.6) + (pass === 'edge' ? 2 : 0);
        g.strokeStyle = pass === 'edge' ? 'rgba(0,0,0,0.55)' : fast ? '#e9a23b' : r.limit >= 60 ? '#d9dcdf' : '#a9adb3';
        g.lineWidth = width;
        g.beginPath();
        r.points.forEach((p, i) => {
          const x = (p.x - this.minX) * SCALE;
          const y = (p.z - this.minZ) * SCALE;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        });
        g.stroke();
      }
    }
  }

  /** Draw the map round the car. `heading` in radians, 0 = north (-z), clockwise. */
  update(x: number, z: number, heading: number, now: number): void {
    if (now - this.last < 0.05) return;
    this.last = now;
    const c = this.view.getContext('2d')!;
    const s = this.view.width;
    // 600 m across the window.
    const zoom = s / (600 * SCALE);
    c.clearRect(0, 0, s, s);
    c.save();
    c.beginPath();
    c.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = 'rgba(16, 17, 20, 0.82)';
    c.fillRect(0, 0, s, s);
    c.translate(s / 2, s * 0.6);
    c.rotate(-heading);
    c.scale(zoom, zoom);
    c.drawImage(this.sheet, -(x - this.minX) * SCALE, -(z - this.minZ) * SCALE);
    c.restore();
    // The car: an arrow pointing up the screen.
    const k = s / 168;
    c.save();
    c.translate(s / 2, s * 0.6);
    c.fillStyle = '#ffffff';
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.lineWidth = 2 * k;
    c.beginPath();
    c.moveTo(0, -9 * k);
    c.lineTo(6.5 * k, 7 * k);
    c.lineTo(0, 3.5 * k);
    c.lineTo(-6.5 * k, 7 * k);
    c.closePath();
    c.stroke();
    c.fill();
    c.restore();
    // North.
    c.save();
    c.translate(s / 2, s / 2);
    c.rotate(-heading);
    c.fillStyle = 'rgba(255,255,255,0.75)';
    c.font = `600 ${11 * k}px 'Plex Arabic', sans-serif`;
    c.textAlign = 'center';
    c.fillText('N', 0, -s / 2 + 14 * k);
    c.restore();
  }
}

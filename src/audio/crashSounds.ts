/**
 * Collisions and tyres from real recordings (see public/sounds/crash/CREDITS.md):
 * a car door slammed, heard from inside, for the body's thump; sheet steel
 * falling, for bent metal; breaking glass; and four tyres squealing, looped.
 * A crash is layered from them by `impactLayers` (soundModel.ts), each
 * layer a different take each time, so no two knocks sound the same.
 */
import { decodeBank, fetchBank, type BankMeta, type Fetched } from './soundBank';
import { impactLayers, impactMaterial } from './soundModel';

interface Meta extends BankMeta {
  thump: number;
  metal: number;
  glass: number;
}

const names = (m: Meta) => [
  ...Array.from({ length: m.thump }, (_, i) => `thump-${i + 1}`),
  ...Array.from({ length: m.metal }, (_, i) => `metal-${i + 1}`),
  ...Array.from({ length: m.glass }, (_, i) => `glass-${i + 1}`),
  'squeal',
];

/** Start downloading (no audio context needed): called as the page loads. */
export function prefetchCrashSounds(): Promise<Fetched<Meta>> {
  return fetchBank<Meta>('crash', names);
}

export class CrashSounds {
  private takes: Record<'thump' | 'metal' | 'glass', AudioBuffer[]> = { thump: [], metal: [], glass: [] };
  private last: Record<string, number> = {};
  private squeal: { source: AudioBufferSourceNode; gain: GainNode } | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
  ) {}

  get ready(): boolean {
    return this.squeal !== null;
  }

  async load(): Promise<boolean> {
    try {
      const bank = await prefetchCrashSounds();
      const buffers = await decodeBank(this.ctx, bank);
      for (const layer of ['thump', 'metal', 'glass'] as const) {
        this.takes[layer] = [...buffers].filter(([n]) => n.startsWith(`${layer}-`)).map(([, b]) => b);
      }
      const source = this.ctx.createBufferSource();
      source.buffer = buffers.get('squeal')!;
      source.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(this.out);
      source.start(0, Math.random() * source.buffer.duration);
      this.squeal = { source, gain };
      return true;
    } catch {
      return false;
    }
  }

  /** A different take from last time. */
  private pick(layer: 'thump' | 'metal' | 'glass'): AudioBuffer | null {
    const list = this.takes[layer];
    if (list.length === 0) return null;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === this.last[layer]) i = (i + 1) % list.length;
    this.last[layer] = i;
    return list[i]!;
  }

  /** The car hit something (`kind` as the examiner names it) at `speed`, m/s. */
  impact(kind: string, speed: number): void {
    const now = this.ctx.currentTime;
    for (const l of impactLayers(impactMaterial(kind), speed)) {
      const buf = this.pick(l.layer);
      if (!buf) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = l.rate * (0.92 + Math.random() * 0.16);
      const g = this.ctx.createGain();
      g.gain.value = l.level;
      src.connect(g).connect(this.out);
      // The glass follows the first blow by a moment.
      src.start(now + (l.layer === 'glass' ? 0.03 : 0));
    }
  }

  /** Tyres squealing, 0..1. */
  setSqueal(amount: number): void {
    const s = this.squeal;
    if (!s) return;
    const now = this.ctx.currentTime;
    s.gain.gain.setTargetAtTime(0.55 * amount, now, 0.06);
    s.source.playbackRate.setTargetAtTime(0.9 + 0.2 * amount, now, 0.1);
  }

  quiet(): void {
    this.squeal?.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }
}

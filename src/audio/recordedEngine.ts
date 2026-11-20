/**
 * The engine from a real recording of a four-cylinder diesel car (see
 * public/sounds/engine/CREDITS.md): the real starter, the real first
 * firings and flare, the real idle, loops of its real combustion strokes
 * laid down at other speeds (light and under load), and the real
 * switch-off. Loaded after the first touch; until then (or if loading
 * fails) the synthesized engine plays instead.
 */
import { recordedMix } from './soundModel';

interface Meta {
  idleRpm: number;
  points: number[];
  /** Seconds into crank.wav looped while the starter keeps turning. */
  crankLoop: [number, number];
  /** Seconds after catch.wav starts over which the loops fade in under it. */
  catchHandover: [number, number];
}

/**
 * Loudness of the one-shots (starter, catch, switch-off). They are cut from
 * the recording at its own levels relative to the idle loop, so they play
 * at the level the game gives the idling engine.
 */
const SHOT_LEVEL = 0.34;

type Layer = { source: AudioBufferSourceNode; gain: GainNode };

const BASE = 'sounds/engine/';

export class RecordedEngine {
  private layers = new Map<string, Layer>();
  private crankBuf: AudioBuffer | null = null;
  private crank: Layer | null = null;
  private shots: Record<string, AudioBuffer> = {};
  private meta: Meta | null = null;
  /** Everything the running engine makes passes through here (faded in after the catch, cut at switch-off). */
  private bus: GainNode;
  private wasRunning = false;

  constructor(
    private readonly ctx: AudioContext,
    out: AudioNode,
  ) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(out);
    this.out = out;
  }

  private readonly out: AudioNode;

  get ready(): boolean {
    return this.meta !== null;
  }

  /** Fetch and decode everything; resolves false if anything is missing. */
  async load(): Promise<boolean> {
    try {
      const url = (name: string) => new URL(BASE + name, document.baseURI).href;
      const meta = (await (await fetch(url('meta.json'))).json()) as Meta;
      const decode = async (name: string) => {
        const res = await fetch(url(`${name}.wav`));
        if (!res.ok) throw new Error(`${name}: ${res.status}`);
        return this.ctx.decodeAudioData(await res.arrayBuffer());
      };
      const names = ['idle', ...meta.points.map((p) => `light-${p}`), 'heavy-idle', ...meta.points.map((p) => `heavy-${p}`)];
      const buffers = await Promise.all(names.map(decode));
      const [crank, catchBuf, stop] = await Promise.all(['crank', 'catch', 'stop'].map(decode));
      names.forEach((name, i) => this.layers.set(name, this.loop(buffers[i]!, this.bus)));
      this.crankBuf = crank!;
      this.shots = { catch: catchBuf!, stop: stop! };
      this.meta = meta;
      return true;
    } catch {
      return false;
    }
  }

  private loop(buffer: AudioBuffer, out: AudioNode): Layer {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain).connect(out);
    // Each loop starts at a different point, so they never line up into a beat.
    source.start(0, Math.random() * buffer.duration);
    return { source, gain };
  }

  private play(name: string, level: number): void {
    const buf = this.shots[name];
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = level;
    src.connect(g).connect(this.out);
    src.start();
  }

  /** The starter from its first turn; if it keeps cranking, it goes on round the compression strokes. */
  private startCranking(): void {
    const buf = this.crankBuf;
    const meta = this.meta;
    if (!buf || !meta) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    source.loop = true;
    [source.loopStart, source.loopEnd] = meta.crankLoop;
    const gain = this.ctx.createGain();
    gain.gain.value = SHOT_LEVEL;
    source.connect(gain).connect(this.out);
    source.start();
    this.crank = { source, gain };
  }

  private stopCranking(): void {
    const c = this.crank;
    if (!c) return;
    const now = this.ctx.currentTime;
    c.gain.gain.cancelScheduledValues(now);
    c.gain.gain.setTargetAtTime(0, now, 0.012);
    c.source.stop(now + 0.1);
    this.crank = null;
  }

  /**
   * Follow the engine.
   * @param level overall loudness of the running engine, 0..1 (it grows with revs and load)
   */
  update(rpm: number, load: number, running: boolean, cranking: boolean, level: number): void {
    const meta = this.meta;
    if (!meta) return;
    const now = this.ctx.currentTime;
    if (running && !this.wasRunning) {
      // It fires: the recording of this very moment (first firings, the flare,
      // settling), with the loops fading in under its tail.
      this.stopCranking();
      this.play('catch', SHOT_LEVEL);
      const [from, to] = meta.catchHandover;
      this.bus.gain.cancelScheduledValues(now);
      this.bus.gain.setValueAtTime(0, now);
      this.bus.gain.setValueAtTime(0, now + from);
      this.bus.gain.linearRampToValueAtTime(1, now + to);
    } else if (!running && this.wasRunning) {
      // Switched off or stalled: the strokes slow to a stop.
      this.play('stop', SHOT_LEVEL);
      this.bus.gain.cancelScheduledValues(now);
      this.bus.gain.setTargetAtTime(0, now, 0.03);
    }
    this.wasRunning = running;

    for (const l of recordedMix(rpm, load, meta.idleRpm, meta.points)) {
      const layer = this.layers.get(l.name);
      if (!layer) continue;
      layer.source.playbackRate.setTargetAtTime(Math.max(0.05, l.rate), now, 0.02);
      layer.gain.gain.setTargetAtTime(running ? l.gain * level : 0, now, 0.04);
    }
    const turning = cranking && !running;
    if (turning && !this.crank) this.startCranking();
    else if (!turning && this.crank) this.stopCranking();
  }

  quiet(): void {
    const now = this.ctx.currentTime;
    for (const l of this.layers.values()) l.gain.gain.setTargetAtTime(0, now, 0.05);
    this.stopCranking();
  }
}

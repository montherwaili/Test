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
  /** Fingerprint of the sound files, so a browser never plays old copies of them. */
  version: string;
  idleRpm: number;
  points: number[];
  /** Seconds into crank.wav looped while the starter keeps turning. */
  crankLoop: [number, number];
  /** Seconds after catch.wav starts over which the loops fade in under it. */
  catchHandover: [number, number];
  /** Seconds into crank.wav where the engine fires. */
  crankFires: number;
}

const BASE = 'sounds/engine/';

interface Fetched {
  meta: Meta;
  files: Map<string, ArrayBuffer>;
}

let fetched: Promise<Fetched> | null = null;

/**
 * Start downloading the recordings (no audio context needed): called as the
 * page loads, so they are usually in hand by the time the engine is started.
 */
export function prefetchEngineSounds(): Promise<Fetched> {
  fetched ??= (async () => {
    const url = (name: string) => new URL(BASE + name, document.baseURI).href;
    const res = await fetch(url('meta.json'), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`meta.json: ${res.status}`);
    const meta = (await res.json()) as Meta;
    const names = [...layerNames(meta), 'crank', 'catch', 'stop'];
    const files = new Map<string, ArrayBuffer>();
    await Promise.all(
      names.map(async (name) => {
        const r = await fetch(url(`${name}.wav?v=${meta.version}`));
        if (!r.ok) throw new Error(`${name}: ${r.status}`);
        files.set(name, await r.arrayBuffer());
      }),
    );
    return { meta, files };
  })();
  return fetched;
}

function layerNames(meta: Meta): string[] {
  return ['idle', ...meta.points.map((p) => `light-${p}`), 'heavy-idle', ...meta.points.map((p) => `heavy-${p}`)];
}

/**
 * Loudness of the one-shots (starter, catch, switch-off). They are cut from
 * the recording at its own levels relative to the idle loop, so they play
 * at the level the game gives the idling engine.
 */
const SHOT_LEVEL = 0.34;

type Layer = { source: AudioBufferSourceNode; gain: GainNode };

export class RecordedEngine {
  private layers = new Map<string, Layer>();
  private crankBuf: AudioBuffer | null = null;
  private crank: Layer | null = null;
  private crankStarted = 0;
  /** Load as heard: it eases between light and heavy, so a gear change does not jump between them. */
  private heardLoad = 0;
  private lastUpdate = 0;
  private shots: Record<string, AudioBuffer> = {};
  private meta: Meta | null = null;
  /** Everything the running engine makes passes through here (faded in after the catch, cut at switch-off). */
  private bus: GainNode;
  private wasRunning = false;
  /** Not yet followed the engine: if it is already running when the recordings arrive, it just fades in. */
  private first = true;

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

  /** Fetch (if not already under way) and decode everything; resolves false if anything is missing. */
  async load(): Promise<boolean> {
    try {
      const { meta, files } = await prefetchEngineSounds();
      // decodeAudioData takes the buffer over: decode copies, so a second car can use them too.
      const decode = (name: string) => this.ctx.decodeAudioData(files.get(name)!.slice(0));
      const names = layerNames(meta);
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

  private play(name: string, level: number, at = this.ctx.currentTime): void {
    const buf = this.shots[name];
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = level;
    src.connect(g).connect(this.out);
    src.start(at);
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
    this.crankStarted = this.ctx.currentTime;
  }

  private stopCranking(at = this.ctx.currentTime): void {
    const c = this.crank;
    if (!c) return;
    c.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    c.gain.gain.setValueAtTime(SHOT_LEVEL, at);
    c.gain.gain.setTargetAtTime(0, at, 0.008);
    c.source.stop(at + 0.1);
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
    if (this.first) {
      this.first = false;
      this.lastUpdate = now;
      this.heardLoad = load;
      if (running) {
        this.wasRunning = true;
        this.bus.gain.setTargetAtTime(1, now, 0.15);
      }
    }
    if (running && !this.wasRunning) {
      // It fires: the recording of this very moment (first firings, the flare,
      // settling), with the loops fading in under its tail. The starter is
      // always heard up to where it fires in the recording (a fraction of a
      // second at most), so its compression strokes are never cut short.
      const at = this.crank ? Math.max(now, this.crankStarted + meta.crankFires) : now;
      this.stopCranking(at);
      this.play('catch', SHOT_LEVEL, at);
      const [from, to] = meta.catchHandover;
      this.bus.gain.cancelScheduledValues(now);
      this.bus.gain.setValueAtTime(0, now);
      this.bus.gain.setValueAtTime(0, at + from);
      this.bus.gain.linearRampToValueAtTime(1, at + to);
    } else if (!running && this.wasRunning) {
      // Switched off or stalled: the strokes slow to a stop.
      this.play('stop', SHOT_LEVEL);
      this.bus.gain.cancelScheduledValues(now);
      this.bus.gain.setTargetAtTime(0, now, 0.03);
    }
    this.wasRunning = running;

    const dt = Math.min(0.1, Math.max(0, now - this.lastUpdate));
    this.lastUpdate = now;
    this.heardLoad += (load - this.heardLoad) * Math.min(1, dt / (load > this.heardLoad ? 0.12 : 0.25));
    for (const l of recordedMix(rpm, this.heardLoad, meta.idleRpm, meta.points)) {
      const layer = this.layers.get(l.name);
      if (!layer) continue;
      layer.source.playbackRate.setTargetAtTime(Math.max(0.05, l.rate), now, 0.02);
      layer.gain.gain.setTargetAtTime(running ? l.gain * level : 0, now, 0.04);
    }
    const turning = cranking && !running;
    if (turning && !this.crank) this.startCranking();
    else if (!turning && !running && this.crank) this.stopCranking();
  }

  quiet(): void {
    const now = this.ctx.currentTime;
    for (const l of this.layers.values()) l.gain.gain.setTargetAtTime(0, now, 0.05);
    this.stopCranking();
  }
}

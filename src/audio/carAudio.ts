/**
 * The car's sounds, made live with the Web Audio API (no sound files):
 * engine, intake roar, tyre squeal, road noise, horn, indicator ticks,
 * and one-shot sounds for impacts, gear grinds and other cars' horns.
 *
 * Browsers only allow sound after the user has touched the page, so the
 * audio graph is built on the first touch, click or key press.
 */
import { engineVoice, impactLoudness, roadNoise, tyreSqueal } from './soundModel';

export interface CarSoundState {
  rpm: number;
  /** Cylinder fill 0..1 (how hard the engine is working). */
  load: number;
  running: boolean;
  cranking: boolean;
  /** m/s */
  speed: number;
  slipAngleDeg: number;
  wheelspinRatio: number;
  /** Deceleration under braking, m/s². */
  brakeDecel: number;
  horn: boolean;
  /** Either indicator lamp lit (the relay clicks as it changes). */
  indicatorLit: boolean;
}

/** How quickly levels follow their targets, s. */
const SMOOTH = 0.05;

export class CarAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = 0.7;
  private enabled = true;
  private noise: AudioBuffer | null = null;

  private engineOsc: OscillatorNode[] = [];
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private roarGain: GainNode | null = null;
  private tyreGain: GainNode | null = null;
  private roadGain: GainNode | null = null;
  private hornGain: GainNode | null = null;
  private lastLit = false;

  constructor(target: Window) {
    // The first gesture unlocks audio.
    const unlock = () => {
      this.start();
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
    };
    for (const type of ['pointerdown', 'keydown', 'touchstart'] as const) {
      target.addEventListener(type, unlock, { passive: true });
    }
    // Hush when the page is hidden (another app, a locked phone).
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  get started(): boolean {
    return this.ctx !== null;
  }

  /** The engine's main note right now, Hz (for checks). */
  get engineFrequency(): number {
    return this.engineOsc[0]?.frequency.value ?? 0;
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyMaster();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.applyMaster();
  }

  private applyMaster(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.05);
  }

  private start(): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    // A gentle limiter so layered sounds never clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 8;
    this.master.connect(limiter).connect(ctx.destination);

    // Two seconds of white noise, shared by every noisy sound.
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = seed / 0x80000000 - 1;
    }
    this.noise = buf;

    // Engine: the firing note and two harmonics through a low-pass filter.
    // Phone speakers cannot play 27 Hz, so the harmonics carry the idle.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 1.2;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain).connect(this.master);
    const parts: [OscillatorType, number, number][] = [
      ['sawtooth', 1, 0.6],
      ['square', 2, 0.25],
      ['sawtooth', 4, 0.15],
    ];
    for (const [type, , level] of parts) {
      const osc = ctx.createOscillator();
      osc.type = type;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(this.engineFilter);
      osc.start();
      this.engineOsc.push(osc);
    }

    this.roarGain = this.noiseLayer('bandpass', 900, 0.8);
    this.tyreGain = this.noiseLayer('bandpass', 1400, 6);
    this.roadGain = this.noiseLayer('lowpass', 500, 0.7);

    // Horn: two notes a third apart.
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    const hornFilter = ctx.createBiquadFilter();
    hornFilter.type = 'lowpass';
    hornFilter.frequency.value = 2200;
    hornFilter.connect(this.hornGain).connect(this.master);
    for (const f of [415, 523]) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.18;
      osc.connect(g).connect(hornFilter);
      osc.start();
    }
  }

  private noiseLayer(type: BiquadFilterType, freq: number, q: number): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master!);
    src.start();
    return gain;
  }

  /** Follow the car (call every frame). */
  update(s: CarSoundState): void {
    const ctx = this.ctx;
    if (!ctx || !this.engineFilter) return;
    const now = ctx.currentTime;
    const v = engineVoice(s.rpm, s.load, s.running, s.cranking);
    [1, 2, 4].forEach((mult, i) => this.engineOsc[i]!.frequency.setTargetAtTime(Math.max(1, v.freq * mult), now, SMOOTH));
    this.engineFilter.frequency.setTargetAtTime(v.cutoff, now, SMOOTH);
    this.engineGain!.gain.setTargetAtTime(v.gain * 0.5, now, SMOOTH);
    this.roarGain!.gain.setTargetAtTime(v.roar * 0.25, now, SMOOTH);
    this.tyreGain!.gain.setTargetAtTime(tyreSqueal(s.slipAngleDeg, s.wheelspinRatio, s.brakeDecel, s.speed) * 0.35, now, SMOOTH);
    this.roadGain!.gain.setTargetAtTime(roadNoise(s.speed) * 0.18, now, 0.2);
    this.hornGain!.gain.setTargetAtTime(s.horn ? 0.55 : 0, now, 0.01);
    if (s.indicatorLit !== this.lastLit) {
      this.lastLit = s.indicatorLit;
      this.click(s.indicatorLit ? 3200 : 2400, 0.12);
    }
  }

  /** Silence the continuous sounds (paused, in a menu). */
  quiet(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const g of [this.engineGain, this.roarGain, this.tyreGain, this.roadGain, this.hornGain]) g?.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
  }

  /** A short burst of filtered noise. */
  private burst(type: BiquadFilterType, freq: number, seconds: number, level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + seconds);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(now, Math.random() * 1.5);
    src.stop(now + seconds + 0.05);
  }

  /** The indicator relay. */
  private click(freq: number, level: number): void {
    this.burst('highpass', freq, 0.025, level);
  }

  impact(speed: number): void {
    this.burst('lowpass', 260, 0.45, impactLoudness(speed));
  }

  grind(): void {
    this.burst('bandpass', 2600, 0.35, 0.35);
  }

  /** Another car's horn, a little way off. */
  distantHorn(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
    gain.gain.setValueAtTime(0.12, now + 0.45);
    gain.gain.linearRampToValueAtTime(0, now + 0.5);
    gain.connect(this.master!);
    for (const f of [440, 554]) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f;
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.55);
    }
  }
}

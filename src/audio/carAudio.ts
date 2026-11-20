/**
 * The car's sounds through the Web Audio API. Everything is rendered at
 * start-up from the diesel model in dieselSynth.ts (no sound files):
 *
 *   engine   four loops - low and high revs, light and heavy load - played at
 *            the engine's speed and mixed by revs and load
 *   starter  the starter motor dragging the engine through its compressions
 *   coast    the engine turning with no fuel, spinning down after switch-off
 *   turbo    the turbocharger's whistle as it spools up under load
 *   tyres, road and wind noise, the horn
 *   one-shots: handbrake ratchet, gear lever, seatbelt, indicator relay,
 *            ignition key, knocks and the shudder as the engine stops
 *
 * Browsers only allow sound after the user has touched the page, so the
 * audio graph is built on the first touch, click or key press.
 */
import { CrashSounds, prefetchCrashSounds } from './crashSounds';
import { prefetchEngineSounds, RecordedEngine } from './recordedEngine';
import {
  renderBuckle,
  renderCrankLoop,
  renderCrunch,
  renderEngineLoop,
  renderGearClunk,
  renderHandbrake,
  renderKey,
  renderRelay,
  renderShudder,
} from './dieselSynth';
import { CRANK_REF_RPM, HIGH_REF_RPM, LOW_REF_RPM, dieselMix, impactLoudness, roadNoise, turboTarget, tyreSqueal } from './soundModel';

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

/**
 * Sample rate the sounds are made at. The highest thing in them is the
 * injector tick at about 5.6 kHz, well inside 24 kHz audio; the browser
 * converts on playback. Half the work of rendering at 48 kHz.
 */
const SYNTH_RATE = 24000;

/** How quickly levels follow their targets, s. */
const SMOOTH = 0.04;

type Layer = { source: AudioBufferSourceNode; gain: GainNode };

export class CarAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = 0.7;
  private enabled = true;
  private noise: AudioBuffer | null = null;

  /** Engine layers; built one at a time after the first touch, so each may still be missing. */
  private engine: Partial<Record<'lowLight' | 'lowHeavy' | 'highLight' | 'highHeavy', Layer>> = {};
  private crank: Layer | null = null;
  private coast: Layer | null = null;
  private turboOsc: OscillatorNode | null = null;
  private turboGain: GainNode | null = null;
  private tyreGain: GainNode | null = null;
  private roadGain: GainNode | null = null;
  private hornGain: GainNode | null = null;
  private shots: Record<string, AudioBuffer> = {};
  /** The engine from real recordings, once loaded (the synthesized one stands in until then). */
  private recorded: RecordedEngine | null = null;
  /** The recordings are still loading: the synthesized engine stays silent rather than be heard first. */
  private recordedPending = false;
  /** Collisions and tyre squeal from real recordings, once loaded (synthesized until then). */
  private crashes: CrashSounds | null = null;

  private lastLit = false;
  private wasTurning = false;
  private boost = 0;
  private lastTime = 0;

  constructor(target: Window) {
    // Download the engine recordings now, before the first touch.
    prefetchEngineSounds().catch(() => undefined);
    prefetchCrashSounds().catch(() => undefined);
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

  /** Whether the engine from real recordings is playing (for checks). */
  get recordedEngine(): boolean {
    return this.recorded !== null;
  }

  /** The engine's firing frequency as being played, Hz (for checks). */
  get engineFrequency(): number {
    const rate = this.engine.lowLight?.source.playbackRate.value ?? 0;
    return (rate * LOW_REF_RPM) / 30;
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

  private buffer(data: Float32Array): AudioBuffer {
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, data.length, SYNTH_RATE);
    b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    return b;
  }

  private loop(data: Float32Array, out: AudioNode): Layer {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = this.buffer(data);
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain).connect(out);
    source.start();
    return { source, gain };
  }

  private start(): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const sr = SYNTH_RATE;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    // A gentle limiter so layered sounds never clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 6;
    this.master.connect(limiter).connect(ctx.destination);

    // Two seconds of white noise for the tyres, road and turbo.
    const buf = ctx.createBuffer(1, sr * 2, sr);
    const data = buf.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = seed / 0x80000000 - 1;
    }
    this.noise = buf;

    // Engine: the cabin hears the low end fuller and the clatter a little softened.
    const body = ctx.createBiquadFilter();
    body.type = 'lowshelf';
    body.frequency.value = 180;
    body.gain.value = 4;
    const tame = ctx.createBiquadFilter();
    tame.type = 'lowpass';
    tame.frequency.value = 7000;
    const rumbleCut = ctx.createBiquadFilter();
    rumbleCut.type = 'highpass';
    rumbleCut.frequency.value = 28;
    body.connect(tame).connect(rumbleCut).connect(this.master);
    // The sounds needed first (idle, starter) are made now; the rest a piece at a
    // time over the next frames, so the first touch does not stall the game.
    const later: (() => void)[] = [];
    this.engine.lowLight = this.loop(renderEngineLoop({ rpm: LOW_REF_RPM, load: 0.12, cycles: 8, seed: 101 }, sr), body);
    this.crank = this.loop(renderCrankLoop({ rpm: CRANK_REF_RPM, cycles: 2, starter: true, seed: 105 }, sr), body);
    later.push(
      () => (this.engine.lowHeavy = this.loop(renderEngineLoop({ rpm: LOW_REF_RPM, load: 0.9, cycles: 8, seed: 102 }, sr), body)),
      () => (this.engine.highLight = this.loop(renderEngineLoop({ rpm: HIGH_REF_RPM, load: 0.12, cycles: 16, seed: 103 }, sr), body)),
      () => (this.engine.highHeavy = this.loop(renderEngineLoop({ rpm: HIGH_REF_RPM, load: 0.9, cycles: 16, seed: 104 }, sr), body)),
      () => (this.coast = this.loop(renderCrankLoop({ rpm: CRANK_REF_RPM, cycles: 2, starter: false, seed: 106 }, sr), body)),
    );

    // Turbo: a thin whistle with a breath of air through it.
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turboGain.connect(this.master);
    this.turboOsc = ctx.createOscillator();
    this.turboOsc.type = 'sine';
    this.turboOsc.frequency.value = 2000;
    this.turboOsc.connect(this.turboGain);
    this.turboOsc.start();
    const air = this.noiseLayer('bandpass', 3800, 3);
    air.disconnect();
    air.gain.value = 0.5;
    air.connect(this.turboGain);

    this.tyreGain = this.noiseLayer('bandpass', 1400, 6);
    this.roadGain = this.noiseLayer('lowpass', 500, 0.7);

    // Horn: a pair of disc horns a third apart, buzzy and bright.
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    const hornFilter = ctx.createBiquadFilter();
    hornFilter.type = 'peaking';
    hornFilter.frequency.value = 2500;
    hornFilter.gain.value = 6;
    const hornTop = ctx.createBiquadFilter();
    hornTop.type = 'lowpass';
    hornTop.frequency.value = 4500;
    hornFilter.connect(hornTop).connect(this.hornGain).connect(this.master);
    for (const f of [420, 510]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.12;
      osc.connect(g).connect(hornFilter);
      osc.start();
    }

    // One-shots: small, so they go first.
    later.unshift(() => {
      this.shots.pull = this.buffer(renderHandbrake(true, sr));
      this.shots.release = this.buffer(renderHandbrake(false, sr));
      this.shots.clunk = this.buffer(renderGearClunk(sr));
      this.shots.buckle = this.buffer(renderBuckle(sr));
      this.shots.tick = this.buffer(renderRelay(true, sr));
      this.shots.tock = this.buffer(renderRelay(false, sr));
      this.shots.crunch = this.buffer(renderCrunch(sr));
      this.shots.shudder = this.buffer(renderShudder(sr));
      this.shots.key = this.buffer(renderKey(sr));
    });
    const next = () => {
      const job = later.shift();
      if (!job) return;
      job();
      setTimeout(next, 30);
    };
    setTimeout(next, 30);
    this.lastTime = ctx.currentTime;

    const recorded = new RecordedEngine(ctx, body);
    this.recordedPending = true;
    void recorded.load().then((ok) => {
      if (ok) this.recorded = recorded;
      this.recordedPending = false;
    });
    const crashes = new CrashSounds(ctx, this.master!);
    void crashes.load().then((ok) => {
      if (ok) this.crashes = crashes;
    });
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
    if (!ctx || !this.crank) return;
    const now = ctx.currentTime;
    const dt = Math.min(0.1, Math.max(0, now - this.lastTime));
    this.lastTime = now;

    const m = dieselMix(s.rpm, s.load, s.running, s.cranking);
    const e = this.engine;
    const set = (layer: Layer | null | undefined, rate: number, level: number, smooth: number) => {
      if (!layer) return;
      layer.source.playbackRate.setTargetAtTime(rate, now, 0.02);
      layer.gain.gain.setTargetAtTime(level, now, smooth);
    };
    // Until the other layers are ready, the idle loop stands in for all of them.
    const full = !!(e.lowHeavy && e.highLight && e.highHeavy);
    // The recorded engine, when it is ready, takes over from the synthesized one.
    const rec = this.recorded;
    const synth = !rec && !this.recordedPending;
    const level = synth ? 0.55 * m.engine : 0;
    if (!synth) {
      m.crank = 0;
      m.coast = 0;
    }
    if (rec) {
      const running = dieselMix(s.rpm, s.load, true, false);
      rec.update(s.rpm, s.load, s.running, s.cranking, 0.75 * running.engine);
    }
    set(e.lowLight, m.lowRate, full ? level * m.low * m.light : level, SMOOTH);
    set(e.lowHeavy, m.lowRate, level * m.low * m.heavy, SMOOTH);
    set(e.highLight, m.highRate, level * m.high * m.light, SMOOTH);
    set(e.highHeavy, m.highRate, level * m.high * m.heavy, SMOOTH);
    set(this.crank, m.crankRate, 0.45 * m.crank, 0.02);
    set(this.coast, m.crankRate, 0.4 * m.coast, 0.05);

    // The engine coming to rest: one last rock on its mounts.
    const turning = s.running || s.cranking || s.rpm > 150;
    if (this.wasTurning && !turning && synth) this.play('shudder', 0.5);
    this.wasTurning = turning;

    // Turbo: spools up slowly, drops quickly, and sighs when the pedal comes up at boost.
    // (The recorded engine has no turbo whistle of its own; none is added to it.)
    const target = s.running && synth ? turboTarget(s.rpm, s.load) : 0;
    const before = this.boost;
    this.boost += (target - this.boost) * Math.min(1, dt * (target > this.boost ? 1.4 : 4));
    if (before > 0.55 && target < 0.1 && this.boost < before - 0.05 && dt > 0) {
      this.whoosh(before);
    }
    this.turboOsc!.frequency.setTargetAtTime(1800 + 3200 * this.boost, now, 0.05);
    this.turboGain!.gain.setTargetAtTime(0.035 * this.boost * this.boost, now, 0.05);

    const squeal = tyreSqueal(s.slipAngleDeg, s.wheelspinRatio, s.brakeDecel, s.speed);
    // The recorded tyres, when they are ready, take over from the synthesized squeal.
    this.tyreGain!.gain.setTargetAtTime(this.crashes ? 0 : squeal * 0.35, now, SMOOTH);
    this.crashes?.setSqueal(squeal);
    this.roadGain!.gain.setTargetAtTime(roadNoise(s.speed) * 0.18, now, 0.2);
    this.hornGain!.gain.setTargetAtTime(s.horn ? 0.6 : 0, now, 0.008);
    if (s.indicatorLit !== this.lastLit) {
      this.lastLit = s.indicatorLit;
      this.play(s.indicatorLit ? 'tick' : 'tock', 0.35);
    }
  }

  /** Silence the continuous sounds (paused, in a menu). */
  quiet(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const gains = [...Object.values(this.engine).map((l) => l.gain), this.crank?.gain, this.coast?.gain, this.turboGain, this.tyreGain, this.roadGain, this.hornGain];
    for (const g of gains) g?.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    this.recorded?.quiet();
    this.crashes?.quiet();
  }

  private play(name: string, level: number, rate = 1): void {
    const ctx = this.ctx;
    const buf = this.shots[name];
    if (!ctx || !buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = level;
    src.connect(gain).connect(this.master!);
    src.start();
  }

  /** Air let out of the intake when the pedal lifts at boost. */
  private whoosh(boost: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.5;
    const now = ctx.currentTime;
    filter.frequency.setValueAtTime(2600, now);
    filter.frequency.exponentialRampToValueAtTime(900, now + 0.4);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06 * boost, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(now, Math.random() * 1.5);
    src.stop(now + 0.5);
  }

  /** The car hit something: `kind` as the examiner names it ('wall', 'cone', 'trafficCar', ...), at `speed` m/s. */
  impact(kind: string, speed: number): void {
    if (this.crashes) {
      this.crashes.impact(kind, speed);
      return;
    }
    const loud = impactLoudness(speed);
    // A gentle nudge is a duller, lower thud.
    this.play('crunch', loud, 0.75 + 0.35 * loud);
  }

  /** Gears forced in without the clutch. */
  grind(): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2400;
    filter.Q.value = 4;
    // The teeth chattering against each other.
    const chatter = ctx.createGain();
    chatter.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 38;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(chatter.gain);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    src.connect(filter).connect(chatter).connect(gain).connect(this.master!);
    src.start(now, Math.random() * 1.5);
    lfo.start(now);
    src.stop(now + 0.45);
    lfo.stop(now + 0.45);
  }

  handbrake(pulled: boolean): void {
    this.play(pulled ? 'pull' : 'release', 0.45);
  }

  gearIn(): void {
    this.play('clunk', 0.4, 0.95 + Math.random() * 0.1);
  }

  seatbelt(): void {
    this.play('buckle', 0.4);
  }

  key(): void {
    this.play('key', 0.35);
  }

  /** Another car's horn, a little way off. */
  distantHorn(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 0.02);
    gain.gain.setValueAtTime(0.1, now + 0.45);
    gain.gain.linearRampToValueAtTime(0, now + 0.5);
    const far = ctx.createBiquadFilter();
    far.type = 'lowpass';
    far.frequency.value = 1800;
    far.connect(gain).connect(this.master!);
    for (const f of [440, 554]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.connect(far);
      osc.start(now);
      osc.stop(now + 0.55);
    }
  }
}

/**
 * A recording of a drive, for replay and analysis. Pure TypeScript.
 *
 * Two streams are kept:
 *  - frames: what the world looked like (the car, traffic, pedestrians, the
 *    instruments) a few times a second. Replays play these back, so seeking
 *    to any moment is instant.
 *  - inputs: the driver's controls on every simulation step. The simulation
 *    is deterministic, so feeding these back into a fresh world reproduces
 *    the drive exactly (see the determinism tests).
 *
 * Frames are packed into a growing Float32Array (plenty for drawing) and
 * inputs into a Float64Array (exact, so a re-run matches bit for bit), which
 * keeps a 15-minute test within about 20 MB.
 */

/** Car fields in each frame, in order. */
export const CAR_FIELDS = [
  'x', 'y', 'z', 'qx', 'qy', 'qz', 'qw',
  'w0y', 'w0steer', 'w0spin', 'w1y', 'w1steer', 'w1spin', 'w2y', 'w2steer', 'w2spin', 'w3y', 'w3steer', 'w3spin',
  'steer', 'throttle', 'brake', 'clutch', 'gear', 'handbrake', 'rpm', 'speed', 'lights', 'signalTime', 'lookYaw',
] as const;
export type CarField = (typeof CAR_FIELDS)[number];

/** Per traffic car: position, heading, pitch, and flags (bit 0 braking, 1 left, 2 right). */
export const TRAFFIC_STRIDE = 6;
/** Per pedestrian: x, z, heading, distance walked, state (0 idle, 1 waiting, 2 crossing). */
export const PEDESTRIAN_STRIDE = 5;
/** Per loose object (cone): position and rotation. */
export const LOOSE_STRIDE = 7;

/** Fields that jump rather than glide between frames. */
const DISCRETE = new Set<CarField>(['gear', 'handbrake', 'lights']);
/** Wheel spin angles keep growing; interpolate them as plain numbers. Headings wrap. */
const ROTATION_SETS: [CarField, CarField, CarField, CarField][] = [['qx', 'qy', 'qz', 'qw']];

/** Light bits in the `lights` field. */
export const LIGHT = { brake: 1, reverse: 2, left: 4, right: 8, head: 16 } as const;

/** Controls recorded every simulation step. */
export const INPUT_FIELDS = ['throttle', 'brake', 'clutch', 'steer', 'handbrake', 'gear', 'ignition', 'starter'] as const;
export type InputField = (typeof INPUT_FIELDS)[number];

export interface Layout {
  traffic: number;
  pedestrians: number;
  loose: number;
}

const CAR = CAR_FIELDS.length;

/** A typed array that doubles when full. */
class Growing<T extends Float32Array | Float64Array> {
  length = 0;
  constructor(
    public data: T,
    private readonly make: (n: number) => T,
  ) {}
  reserve(n: number): number {
    if (this.length + n > this.data.length) {
      const bigger = this.make(Math.max(this.data.length * 2, this.length + n));
      bigger.set(this.data.subarray(0, this.length));
      this.data = bigger;
    }
    const at = this.length;
    this.length += n;
    return at;
  }
}

/** A frame being written: set what you know, the rest stays zero. */
export interface FrameWriter {
  car(field: CarField, value: number): void;
  traffic(i: number, x: number, y: number, z: number, headingDeg: number, pitch: number, flags: number): void;
  pedestrian(i: number, x: number, z: number, headingDeg: number, walked: number, state: number): void;
  loose(i: number, x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number): void;
}

/** One moment of the replay, read back (interpolated between frames). */
export interface Frame {
  time: number;
  car: Record<CarField, number>;
  traffic: Float32Array;
  pedestrians: Float32Array;
  loose: Float32Array;
}

export class Recording {
  readonly stride: number;
  private readonly frames: Growing<Float32Array>;
  private times: Float64Array = new Float64Array(1024);
  // Inputs are kept at full precision: replaying them must reproduce the drive bit for bit.
  private readonly inputs = new Growing(new Float64Array(8 * 4096), (n) => new Float64Array(n));
  /** Simulation time of the first recorded input step. */
  inputStart = 0;
  /** Fixed simulation step, s. */
  inputDt = 0;
  private readonly carIndex: Record<CarField, number>;

  constructor(
    readonly layout: Layout,
    /** Recording stops growing after this many seconds (memory guard). */
    readonly maxSeconds = 1800,
  ) {
    this.stride = CAR + layout.traffic * TRAFFIC_STRIDE + layout.pedestrians * PEDESTRIAN_STRIDE + layout.loose * LOOSE_STRIDE;
    this.frames = new Growing(new Float32Array(this.stride * 512), (n) => new Float32Array(n));
    this.carIndex = Object.fromEntries(CAR_FIELDS.map((f, i) => [f, i])) as Record<CarField, number>;
  }

  get frameCount(): number {
    return this.frames.length / this.stride;
  }

  get start(): number {
    return this.frameCount ? this.times[0]! : 0;
  }

  get end(): number {
    return this.frameCount ? this.times[this.frameCount - 1]! : 0;
  }

  get duration(): number {
    return this.end - this.start;
  }

  /** Bytes actually filled with data. */
  get usedBytes(): number {
    return this.frames.length * 4 + this.inputs.length * 8 + this.frameCount * 8;
  }

  /** Bytes held (including room to grow), for the memory budget. */
  get bytes(): number {
    return this.frames.data.byteLength + this.times.byteLength + this.inputs.data.byteLength;
  }

  get full(): boolean {
    return this.frameCount > 0 && this.duration >= this.maxSeconds;
  }

  /** Add a frame at `time` (must not go backwards); `fill` writes its contents. */
  addFrame(time: number, fill: (w: FrameWriter) => void): void {
    if (this.full) return;
    if (this.frameCount && time < this.end) throw new Error('frames must be added in time order');
    const at = this.frames.reserve(this.stride);
    const n = this.frameCount - 1;
    if (n >= this.times.length) {
      const t = new Float64Array(this.times.length * 2);
      t.set(this.times);
      this.times = t;
    }
    this.times[n] = time;
    const d = this.frames.data;
    d.fill(0, at, at + this.stride);
    const { traffic, pedestrians } = this.layout;
    const trafficAt = at + CAR;
    const pedAt = trafficAt + traffic * TRAFFIC_STRIDE;
    const looseAt = pedAt + pedestrians * PEDESTRIAN_STRIDE;
    fill({
      car: (f, v) => (d[at + this.carIndex[f]] = v),
      traffic: (i, x, y, z, h, p, flags) => d.set([x, y, z, h, p, flags], trafficAt + i * TRAFFIC_STRIDE),
      pedestrian: (i, x, z, h, walked, state) => d.set([x, z, h, walked, state], pedAt + i * PEDESTRIAN_STRIDE),
      loose: (i, x, y, z, qx, qy, qz, qw) => d.set([x, y, z, qx, qy, qz, qw], looseAt + i * LOOSE_STRIDE),
    });
  }

  /** Record the controls used on one simulation step. */
  addInput(time: number, dt: number, values: Record<InputField, number>): void {
    if (this.full) return;
    if (this.inputs.length === 0) {
      this.inputStart = time;
      this.inputDt = dt;
    }
    const at = this.inputs.reserve(INPUT_FIELDS.length);
    INPUT_FIELDS.forEach((f, i) => (this.inputs.data[at + i] = values[f]));
  }

  get inputCount(): number {
    return this.inputs.length / INPUT_FIELDS.length;
  }

  /** The controls of simulation step `i`. */
  input(i: number): Record<InputField, number> {
    const at = i * INPUT_FIELDS.length;
    return Object.fromEntries(INPUT_FIELDS.map((f, k) => [f, this.inputs.data[at + k]!])) as Record<InputField, number>;
  }

  /** Index of the last frame at or before `time`. */
  frameAt(time: number): number {
    const n = this.frameCount;
    if (n === 0) return -1;
    if (time <= this.times[0]!) return 0;
    if (time >= this.times[n - 1]!) return n - 1;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid]! <= time) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  frameTime(i: number): number {
    return this.times[i]!;
  }

  /** A single car value of frame `i` (for graphs). */
  value(i: number, field: CarField): number {
    return this.frames.data[i * this.stride + this.carIndex[field]]!;
  }

  /** The world at `time`, interpolated between the frames either side. Reuses `out` if given. */
  sample(time: number, out?: Frame): Frame {
    const { traffic, pedestrians, loose } = this.layout;
    const frame: Frame = out ?? {
      time: 0,
      car: Object.fromEntries(CAR_FIELDS.map((f) => [f, 0])) as Record<CarField, number>,
      traffic: new Float32Array(traffic * TRAFFIC_STRIDE),
      pedestrians: new Float32Array(pedestrians * PEDESTRIAN_STRIDE),
      loose: new Float32Array(loose * LOOSE_STRIDE),
    };
    const i = this.frameAt(time);
    if (i < 0) return frame;
    const j = Math.min(i + 1, this.frameCount - 1);
    const t0 = this.times[i]!;
    const t1 = this.times[j]!;
    const a = j === i || t1 <= t0 ? 0 : Math.min(1, Math.max(0, (time - t0) / (t1 - t0)));
    frame.time = j === i ? t0 : t0 + (t1 - t0) * a;
    const d = this.frames.data;
    const A = i * this.stride;
    const B = j * this.stride;
    CAR_FIELDS.forEach((f, k) => {
      frame.car[f] = DISCRETE.has(f) ? d[A + k]! : d[A + k]! + (d[B + k]! - d[A + k]!) * a;
    });
    for (const [x, y, z, w] of ROTATION_SETS) {
      nlerpInto(frame.car, [x, y, z, w], d, A + this.carIndex[x], B + this.carIndex[x], a);
    }
    // Traffic: positions glide, headings take the short way round, flags jump.
    const ta = A + CAR;
    const tb = B + CAR;
    for (let c = 0; c < traffic; c++) {
      const p = c * TRAFFIC_STRIDE;
      for (let k = 0; k < 3; k++) frame.traffic[p + k] = lerp(d[ta + p + k]!, d[tb + p + k]!, a);
      frame.traffic[p + 3] = lerpAngle(d[ta + p + 3]!, d[tb + p + 3]!, a);
      frame.traffic[p + 4] = lerp(d[ta + p + 4]!, d[tb + p + 4]!, a);
      frame.traffic[p + 5] = d[ta + p + 5]!;
    }
    const pa = ta + traffic * TRAFFIC_STRIDE;
    const pb = tb + traffic * TRAFFIC_STRIDE;
    for (let c = 0; c < pedestrians; c++) {
      const p = c * PEDESTRIAN_STRIDE;
      // A pedestrian who has just reached the far kerb jumps to the pavement: do not glide across.
      const jump = d[pa + p + 4]! !== d[pb + p + 4]!;
      const s = jump ? 0 : a;
      frame.pedestrians[p] = lerp(d[pa + p]!, d[pb + p]!, s);
      frame.pedestrians[p + 1] = lerp(d[pa + p + 1]!, d[pb + p + 1]!, s);
      frame.pedestrians[p + 2] = lerpAngle(d[pa + p + 2]!, d[pb + p + 2]!, s);
      frame.pedestrians[p + 3] = lerp(d[pa + p + 3]!, d[pb + p + 3]!, s);
      frame.pedestrians[p + 4] = d[pa + p + 4]!;
    }
    const la = pa + pedestrians * PEDESTRIAN_STRIDE;
    const lb = pb + pedestrians * PEDESTRIAN_STRIDE;
    for (let c = 0; c < loose; c++) {
      const p = c * LOOSE_STRIDE;
      for (let k = 0; k < 3; k++) frame.loose[p + k] = lerp(d[la + p + k]!, d[lb + p + k]!, a);
      nlerpArray(frame.loose, p + 3, d, la + p + 3, lb + p + 3, a);
    }
    return frame;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Degrees, the short way round. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return a + d * t;
}

function nlerpArray(out: Float32Array, o: number, d: Float32Array, a: number, b: number, t: number): void {
  const dot = d[a]! * d[b]! + d[a + 1]! * d[b + 1]! + d[a + 2]! * d[b + 2]! + d[a + 3]! * d[b + 3]!;
  const s = dot < 0 ? -1 : 1;
  let n = 0;
  for (let k = 0; k < 4; k++) {
    out[o + k] = d[a + k]! + (d[b + k]! * s - d[a + k]!) * t;
    n += out[o + k]! * out[o + k]!;
  }
  n = Math.sqrt(n) || 1;
  for (let k = 0; k < 4; k++) out[o + k] = out[o + k]! / n;
}

function nlerpInto(out: Record<CarField, number>, keys: CarField[], d: Float32Array, a: number, b: number, t: number): void {
  const tmp = new Float32Array(4);
  nlerpArray(tmp, 0, d, a, b, t);
  keys.forEach((k, i) => (out[k] = tmp[i]!));
}

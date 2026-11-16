/**
 * Vehicle tuning: types, validation and the default values.
 *
 * Every number the simulation uses lives in `src/data/tuning.json`; nothing in
 * `src/sim` hard-codes a physical constant. `validateTuning` rejects files that
 * would make the simulation misbehave (negative inertia, bite point range
 * inverted, ...), so a bad edit fails loudly instead of producing a strange car.
 */
import rawDefault from '../data/tuning.json';
import type { CurvePoint } from './curve';

export interface SimTuning {
  /** Fixed simulation rate in Hz. */
  stepHz: number;
  /** Maximum fixed steps run per rendered frame before time is dropped. */
  maxSubSteps: number;
  /** Gauss-Seidel iterations of the driveline friction solver. */
  drivelineIterations: number;
  /** Gauss-Seidel iterations of the full vehicle's tyre + driveline solver. */
  vehicleIterations: number;
}

export interface EngineTuning {
  idleRpm: number;
  redlineRpm: number;
  /** Below this the engine dies (unless the starter is turning it). */
  stallRpm: number;
  /** Crankshaft + flywheel inertia, kg·m². */
  inertia: number;
  /** Full-throttle net torque, [rpm, N·m] points, rpm ascending. */
  torqueCurve: CurvePoint[];
  /** Friction and pumping torque at 0 rpm, N·m. */
  frictionBase: number;
  /** Extra friction per rpm, N·m/rpm. */
  frictionPerRpm: number;
  /** Extra holding torque of a dead engine (compression), N·m. */
  stalledHoldTorque: number;
  /** Accelerator pedal travel -> throttle opening area, as a power (1 = linear). */
  pedalExponent: number;
  /** Rpm at which the engine needs the throttle fully open to make full torque. */
  throttleFullFlowRpm: number;
  /** Idle controller: cylinder fill added per rpm below idle. */
  idleGain: number;
  /** Idle controller authority: the most cylinder fill it can command, 0..1. */
  idleAuthority: number;
  /** Intake response time constant, seconds. */
  throttleLag: number;
  /** Fuel comes back this far below the redline. */
  revLimiterHysteresisRpm: number;
  /** Starter motor torque at low speed, N·m. */
  starterTorque: number;
  /** Starter stops helping at this rpm. */
  starterMaxRpm: number;
  /** Engine fires once the starter has spun it to this rpm. */
  catchRpm: number;
}

export interface ClutchTuning {
  /** Torque capacity when fully engaged, N·m. */
  maxTorque: number;
  /** Pedal position (0 released .. 1 floored) where the clutch starts to bite. */
  biteStart: number;
  /** Pedal position at and below which the clutch is fully clamped. */
  biteEnd: number;
  /** Shape of the capacity curve through the bite range (1 = linear). */
  curveExponent: number;
  /** Pedal must be pressed past this to select a gear without grinding. */
  shiftThreshold: number;
}

export interface GearboxTuning {
  /** Forward gear ratios, 1st first. */
  forward: number[];
  /** Reverse gear ratio (positive number). */
  reverse: number;
  finalDrive: number;
  /** Fraction of clutch torque that reaches the wheels. */
  efficiency: number;
  /** Reverse can only be selected below this forward speed, m/s. */
  reverseMaxSpeed: number;
}

export interface BodyTuning {
  /** kg */
  mass: number;
  /** m */
  wheelRadius: number;
  /** Inertia of one wheel, kg·m². */
  wheelInertia: number;
  /** Drag coefficient × frontal area, m². */
  dragArea: number;
  /** kg/m³ */
  airDensity: number;
  rollingResistance: number;
  /** m/s² */
  gravity: number;
}

export interface BrakeTuning {
  /** Foot brake force at full pedal, N. */
  maxForce: number;
  /** Handbrake force fully applied, N. */
  handbrakeForce: number;
  /** Tyre friction coefficient limiting brake force (straight-line test car only). */
  tyreGrip: number;
  /** Share of foot brake force that goes to the front axle, 0..1. */
  frontBias: number;
}

export interface ChassisTuning {
  /** Front to rear axle, m. */
  wheelbase: number;
  /** Left to right wheel centres, m. */
  track: number;
  /** Share of the weight on the front axle at rest, 0..1. */
  frontWeightFraction: number;
  /** Centre of mass above the ground at rest, m. */
  comHeight: number;
  /** Moments of inertia about the right (pitch), up (yaw) and forward (roll) axes, kg·m². */
  inertia: [number, number, number];
  /** Body shell size for collisions, m. */
  bodyWidth: number;
  bodyHeight: number;
  /** Body ahead of the front axle / behind the rear axle, m. */
  frontOverhang: number;
  rearOverhang: number;
  /** Underside of the body above the ground at rest, m. */
  groundClearance: number;
}

export interface AxleSuspensionTuning {
  /** Per wheel, N/m. */
  springRate: number;
  /** Per wheel, N·s/m. */
  damping: number;
  /** Anti-roll bar: force per metre of left/right compression difference, N/m. */
  antiRollRate: number;
}

export interface SuspensionTuning {
  /** Strut length at full droop, m. */
  maxLength: number;
  /** Compression available before the bump stop, m. */
  travel: number;
  /** Extra spring rate once on the bump stop, N/m. */
  bumpStopRate: number;
  front: AxleSuspensionTuning;
  rear: AxleSuspensionTuning;
}

export interface TyreTuning {
  /** Peak friction coefficient. */
  grip: number;
  /** Slip angle at which cornering force peaks, degrees. */
  peakSlipAngleDeg: number;
  /** Slip ratio at which drive force peaks. */
  peakSlipRatio: number;
  /** Grip left when fully sliding or spinning, as a fraction of peak. */
  slideGrip: number;
  /** Speed scale below which tyres act as plain static friction, m/s. */
  restSpeed: number;
}

export interface SteeringTuning {
  /** Front wheel angle at full lock, degrees. */
  maxAngleDeg: number;
  /** 0 = both front wheels parallel, 1 = true Ackermann geometry. */
  ackermann: number;
}

export interface VehicleTuning {
  sim: SimTuning;
  engine: EngineTuning;
  clutch: ClutchTuning;
  gearbox: GearboxTuning;
  body: BodyTuning;
  brakes: BrakeTuning;
  chassis: ChassisTuning;
  suspension: SuspensionTuning;
  tyres: TyreTuning;
  steering: SteeringTuning;
}

export class TuningError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid vehicle tuning:\n- ${problems.join('\n- ')}`);
    this.name = 'TuningError';
  }
}

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Check a parsed tuning object and return it typed.
 * Throws `TuningError` listing every problem found.
 */
export function validateTuning(raw: unknown): VehicleTuning {
  const problems: string[] = [];

  const section = (name: string): Rec => {
    if (isRecord(raw) && isRecord(raw[name])) return raw[name] as Rec;
    problems.push(`missing section "${name}"`);
    return {};
  };

  const num = (sec: Rec, secName: string, key: string, min: number, max = Infinity): number => {
    const v = sec[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      problems.push(`${secName}.${key} must be a number`);
      return NaN;
    }
    if (v < min || v > max) {
      problems.push(`${secName}.${key} = ${v} is outside ${min}..${max}`);
    }
    return v;
  };

  const tiny = 1e-6;

  const simRaw = section('sim');
  const sim: SimTuning = {
    stepHz: num(simRaw, 'sim', 'stepHz', 30, 1000),
    maxSubSteps: num(simRaw, 'sim', 'maxSubSteps', 1, 64),
    drivelineIterations: num(simRaw, 'sim', 'drivelineIterations', 1, 64),
    vehicleIterations: num(simRaw, 'sim', 'vehicleIterations', 1, 64),
  };

  const engRaw = section('engine');
  const curve: CurvePoint[] = [];
  const rawCurve = engRaw['torqueCurve'];
  if (!Array.isArray(rawCurve) || rawCurve.length < 2) {
    problems.push('engine.torqueCurve must be a list of at least two [rpm, torque] points');
  } else {
    let lastRpm = -Infinity;
    rawCurve.forEach((p, i) => {
      if (
        !Array.isArray(p) ||
        p.length !== 2 ||
        typeof p[0] !== 'number' ||
        typeof p[1] !== 'number' ||
        !Number.isFinite(p[0]) ||
        !Number.isFinite(p[1])
      ) {
        problems.push(`engine.torqueCurve[${i}] must be [rpm, torque]`);
        return;
      }
      if (p[0] <= lastRpm) problems.push(`engine.torqueCurve[${i}] rpm must be ascending`);
      if (p[1] < 0) problems.push(`engine.torqueCurve[${i}] torque must not be negative`);
      lastRpm = p[0];
      curve.push([p[0], p[1]]);
    });
  }
  const engine: EngineTuning = {
    idleRpm: num(engRaw, 'engine', 'idleRpm', 300, 2000),
    redlineRpm: num(engRaw, 'engine', 'redlineRpm', 2000, 20000),
    stallRpm: num(engRaw, 'engine', 'stallRpm', 50, 2000),
    inertia: num(engRaw, 'engine', 'inertia', 0.01, 5),
    torqueCurve: curve,
    frictionBase: num(engRaw, 'engine', 'frictionBase', 0, 200),
    frictionPerRpm: num(engRaw, 'engine', 'frictionPerRpm', 0, 1),
    stalledHoldTorque: num(engRaw, 'engine', 'stalledHoldTorque', 0, 500),
    idleGain: num(engRaw, 'engine', 'idleGain', 0, 1),
    pedalExponent: num(engRaw, 'engine', 'pedalExponent', 0.2, 5),
    throttleFullFlowRpm: num(engRaw, 'engine', 'throttleFullFlowRpm', 500, 30000),
    idleAuthority: num(engRaw, 'engine', 'idleAuthority', 0, 1),
    throttleLag: num(engRaw, 'engine', 'throttleLag', 0, 2),
    revLimiterHysteresisRpm: num(engRaw, 'engine', 'revLimiterHysteresisRpm', 0, 2000),
    starterTorque: num(engRaw, 'engine', 'starterTorque', 0, 500),
    starterMaxRpm: num(engRaw, 'engine', 'starterMaxRpm', 50, 2000),
    catchRpm: num(engRaw, 'engine', 'catchRpm', 50, 2000),
  };
  if (engine.stallRpm >= engine.idleRpm) problems.push('engine.stallRpm must be below engine.idleRpm');
  if (engine.idleRpm >= engine.redlineRpm) problems.push('engine.idleRpm must be below engine.redlineRpm');
  if (engine.catchRpm >= engine.starterMaxRpm) {
    problems.push('engine.catchRpm must be below engine.starterMaxRpm');
  }
  if (engine.starterMaxRpm <= engine.stallRpm) {
    problems.push('engine.starterMaxRpm must be above engine.stallRpm or the engine can never start');
  }

  const cluRaw = section('clutch');
  const clutch: ClutchTuning = {
    maxTorque: num(cluRaw, 'clutch', 'maxTorque', 1, 5000),
    biteStart: num(cluRaw, 'clutch', 'biteStart', 0, 1),
    biteEnd: num(cluRaw, 'clutch', 'biteEnd', 0, 1),
    curveExponent: num(cluRaw, 'clutch', 'curveExponent', 0.2, 6),
    shiftThreshold: num(cluRaw, 'clutch', 'shiftThreshold', 0, 1),
  };
  if (clutch.biteEnd >= clutch.biteStart) {
    problems.push('clutch.biteEnd must be below clutch.biteStart (pedal 1 = floored)');
  }
  if (clutch.shiftThreshold < clutch.biteStart) {
    problems.push('clutch.shiftThreshold must be at or above clutch.biteStart');
  }

  const gbRaw = section('gearbox');
  const forward: number[] = [];
  const rawForward = gbRaw['forward'];
  if (!Array.isArray(rawForward) || rawForward.length < 1) {
    problems.push('gearbox.forward must list at least one gear ratio');
  } else {
    rawForward.forEach((r, i) => {
      if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0) {
        problems.push(`gearbox.forward[${i}] must be a positive number`);
      } else {
        forward.push(r);
      }
    });
  }
  const gearbox: GearboxTuning = {
    forward,
    reverse: num(gbRaw, 'gearbox', 'reverse', tiny, 20),
    finalDrive: num(gbRaw, 'gearbox', 'finalDrive', tiny, 20),
    efficiency: num(gbRaw, 'gearbox', 'efficiency', 0.1, 1),
    reverseMaxSpeed: num(gbRaw, 'gearbox', 'reverseMaxSpeed', 0, 50),
  };

  const bodyRaw = section('body');
  const body: BodyTuning = {
    mass: num(bodyRaw, 'body', 'mass', 100, 10000),
    wheelRadius: num(bodyRaw, 'body', 'wheelRadius', 0.1, 1),
    wheelInertia: num(bodyRaw, 'body', 'wheelInertia', 0, 50),
    dragArea: num(bodyRaw, 'body', 'dragArea', 0, 10),
    airDensity: num(bodyRaw, 'body', 'airDensity', 0, 5),
    rollingResistance: num(bodyRaw, 'body', 'rollingResistance', 0, 1),
    gravity: num(bodyRaw, 'body', 'gravity', 0, 50),
  };

  const brRaw = section('brakes');
  const brakes: BrakeTuning = {
    maxForce: num(brRaw, 'brakes', 'maxForce', 0, 1e6),
    handbrakeForce: num(brRaw, 'brakes', 'handbrakeForce', 0, 1e6),
    tyreGrip: num(brRaw, 'brakes', 'tyreGrip', 0.05, 3),
    frontBias: num(brRaw, 'brakes', 'frontBias', 0, 1),
  };

  const chRaw = section('chassis');
  const inertia: [number, number, number] = [NaN, NaN, NaN];
  const rawInertia = chRaw['inertia'];
  if (
    !Array.isArray(rawInertia) ||
    rawInertia.length !== 3 ||
    rawInertia.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v <= 0)
  ) {
    problems.push('chassis.inertia must be three positive numbers [pitch, yaw, roll]');
  } else {
    inertia[0] = rawInertia[0] as number;
    inertia[1] = rawInertia[1] as number;
    inertia[2] = rawInertia[2] as number;
  }
  const chassis: ChassisTuning = {
    wheelbase: num(chRaw, 'chassis', 'wheelbase', 1, 6),
    track: num(chRaw, 'chassis', 'track', 0.8, 3),
    frontWeightFraction: num(chRaw, 'chassis', 'frontWeightFraction', 0.2, 0.8),
    comHeight: num(chRaw, 'chassis', 'comHeight', 0.2, 1.5),
    inertia,
    bodyWidth: num(chRaw, 'chassis', 'bodyWidth', 0.8, 3),
    bodyHeight: num(chRaw, 'chassis', 'bodyHeight', 0.8, 3),
    frontOverhang: num(chRaw, 'chassis', 'frontOverhang', 0, 2),
    rearOverhang: num(chRaw, 'chassis', 'rearOverhang', 0, 2),
    groundClearance: num(chRaw, 'chassis', 'groundClearance', 0.05, 0.6),
  };
  if (chassis.comHeight <= body.wheelRadius) {
    problems.push('chassis.comHeight must be above the wheel centre (body.wheelRadius)');
  }
  if (chassis.groundClearance >= chassis.comHeight) {
    problems.push('chassis.groundClearance must be below chassis.comHeight');
  }

  const susRaw = section('suspension');
  const axle = (name: 'front' | 'rear'): AxleSuspensionTuning => {
    const a = isRecord(susRaw[name]) ? (susRaw[name] as Rec) : {};
    if (!isRecord(susRaw[name])) problems.push(`missing section "suspension.${name}"`);
    return {
      springRate: num(a, `suspension.${name}`, 'springRate', 1000, 500000),
      damping: num(a, `suspension.${name}`, 'damping', 0, 50000),
      antiRollRate: num(a, `suspension.${name}`, 'antiRollRate', 0, 200000),
    };
  };
  const suspension: SuspensionTuning = {
    maxLength: num(susRaw, 'suspension', 'maxLength', 0.05, 1),
    travel: num(susRaw, 'suspension', 'travel', 0.02, 1),
    bumpStopRate: num(susRaw, 'suspension', 'bumpStopRate', 0, 5e6),
    front: axle('front'),
    rear: axle('rear'),
  };
  if (suspension.travel > suspension.maxLength) {
    problems.push('suspension.travel must not exceed suspension.maxLength');
  }
  // The car must sit within its suspension travel at rest.
  const staticFront = (body.mass * body.gravity * chassis.frontWeightFraction) / 2 / suspension.front.springRate;
  const staticRear = (body.mass * body.gravity * (1 - chassis.frontWeightFraction)) / 2 / suspension.rear.springRate;
  if (staticFront >= suspension.travel) {
    problems.push('suspension.front.springRate is too soft: the car rests on its front bump stops');
  }
  if (staticRear >= suspension.travel) {
    problems.push('suspension.rear.springRate is too soft: the car rests on its rear bump stops');
  }

  const tyRaw = section('tyres');
  const tyres: TyreTuning = {
    grip: num(tyRaw, 'tyres', 'grip', 0.05, 3),
    peakSlipAngleDeg: num(tyRaw, 'tyres', 'peakSlipAngleDeg', 1, 30),
    peakSlipRatio: num(tyRaw, 'tyres', 'peakSlipRatio', 0.02, 0.8),
    slideGrip: num(tyRaw, 'tyres', 'slideGrip', 0.2, 1),
    restSpeed: num(tyRaw, 'tyres', 'restSpeed', 0.05, 0.6),
  };

  const stRaw = section('steering');
  const steering: SteeringTuning = {
    maxAngleDeg: num(stRaw, 'steering', 'maxAngleDeg', 5, 60),
    ackermann: num(stRaw, 'steering', 'ackermann', 0, 1),
  };

  if (problems.length > 0) throw new TuningError(problems);
  return { sim, engine, clutch, gearbox, body, brakes, chassis, suspension, tyres, steering };
}

/** A fresh, independent copy of the shipped tuning (safe to mutate). */
export function createDefaultTuning(): VehicleTuning {
  return validateTuning(structuredClone(rawDefault));
}

export function cloneTuning(t: VehicleTuning): VehicleTuning {
  return structuredClone(t);
}

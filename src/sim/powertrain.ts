/**
 * Powertrain: engine + clutch + manual gearbox.
 *
 * It owns the engine's state and is stepped with a description of whatever is
 * on the other side of the gearbox (the "load"). In phase 1 that load is the
 * simple straight-line car in `longitudinalCar.ts`; later it is the Rapier
 * chassis. The powertrain neither knows nor cares which.
 */
import { clutchCapacity } from './clutch';
import { RAD_S_PER_RPM, RPM_PER_RAD_S } from './curve';
import { solveDriveline } from './driveline';
import {
  engineFriction,
  idleFill,
  indicatedTorque,
  starterTorque,
  throttleFill,
} from './engine';
import { GEAR_NEUTRAL, checkShift, totalRatio, type Gear } from './gearbox';
import type { VehicleTuning } from './tuning';

export interface PowertrainControls {
  /** Accelerator pedal, 0..1. */
  throttle: number;
  /** Clutch pedal, 0 = foot off, 1 = floored. */
  clutch: number;
  /** Gear lever position the driver wants. */
  gear: Gear;
  /** Key in the "on" position. */
  ignition: boolean;
  /** Key held in the "start" position. */
  starter: boolean;
}

/** What the gearbox output is connected to, reduced to the driven wheels. */
export interface PowertrainLoad {
  /** Wheel speed, rad/s, positive = forward. */
  wheelOmega: number;
  /** kg·m² */
  wheelInertia: number;
  /** Non-friction torque on the wheels (slope, drag), N·m. */
  wheelTorque: number;
  /** Brake + rolling resistance capacity at the wheels, N·m. */
  wheelFriction: number;
  /** Forward speed of the car, m/s (for the reverse lock-out). */
  forwardSpeed: number;
}

export type PowertrainEvent =
  | { type: 'engineStart' }
  | { type: 'stall'; rpm: number; gear: Gear }
  | { type: 'engineOff' }
  | { type: 'shift'; from: Gear; to: Gear }
  | { type: 'gearGrind'; wanted: Gear; reason: 'clutch' | 'reverse' }
  | { type: 'overRev'; rpm: number };

/** Plain, serialisable state - everything needed to resume or replay. */
export interface PowertrainState {
  /** Engine speed, rad/s. */
  engineOmega: number;
  running: boolean;
  /**
   * The engine has been above stall speed since it last fired. Until then it
   * is still picking up from cranking speed and is allowed to be slow.
   */
  settled: boolean;
  /** Cylinder fill after intake lag, 0..1 of full throttle. */
  intake: number;
  gear: Gear;
  /** Rev limiter is currently cutting fuel. */
  limiterCut: boolean;
  /** Lever request that last failed, so one bad shift logs one grind. */
  refusedGear: Gear | null;
  /** Engine is above the over-rev threshold (edge detection for the event). */
  overRev: boolean;
}

export interface PowertrainOutput {
  /** Predicted wheel speed after this step, rad/s. */
  wheelOmega: number;
  /** Mean drive torque at the wheels this step, N·m (signed). */
  driveTorque: number;
  /** Mean torque through the clutch, N·m. */
  clutchTorque: number;
  /** Clutch capacity at the current pedal, N·m. */
  clutchCapacity: number;
  /** Engine minus gearbox-input speed, rad/s. */
  clutchSlip: number;
  /** Net torque the engine made this step (combustion + starter - friction), N·m. */
  engineTorque: number;
  /** Mean wheel friction torque that actually acted, N·m (signed). */
  wheelFrictionTorque: number;
  /** Cylinder fill in effect (driver or idle controller, after lag), 0..1. */
  engineLoad: number;
  events: PowertrainEvent[];
}

/** The engine side of the driveline for one step, from `Powertrain.begin`. */
export interface PowertrainDemand {
  /** rad/s */
  engineOmega: number;
  /** kg·m² */
  engineInertia: number;
  /** Combustion + starter torque, N·m (friction excluded). */
  engineTorque: number;
  /** Engine friction torque capacity, N·m. */
  engineFriction: number;
  /** Engine revs per wheel rev, signed; 0 in neutral. */
  ratio: number;
  /** Clutch torque capacity at the current pedal position, N·m. */
  clutchCapacity: number;
  efficiency: number;
  /** Cylinder fill in effect, 0..1. */
  engineLoad: number;
  events: PowertrainEvent[];
}

/** Revs this far past the redline count as a mechanical over-rev (bad downshift). */
const OVER_REV_MARGIN_RPM = 400;

/** A just-fired engine dies if dragged below this fraction of its catch speed. */
const FRESH_START_DIE_FRACTION = 0.5;

export function createPowertrainState(): PowertrainState {
  return {
    engineOmega: 0,
    running: false,
    settled: false,
    intake: 0,
    gear: GEAR_NEUTRAL,
    limiterCut: false,
    refusedGear: null,
    overRev: false,
  };
}

export class Powertrain {
  state: PowertrainState = createPowertrainState();

  constructor(public tuning: VehicleTuning) {}

  get rpm(): number {
    return this.state.engineOmega * RPM_PER_RAD_S;
  }

  /** Put the engine straight into a warm idle (skips cranking). */
  startInstantly(): void {
    this.state.running = true;
    this.state.settled = true;
    this.state.engineOmega = this.tuning.engine.idleRpm * RAD_S_PER_RPM;
    this.state.intake = idleFill(this.tuning.engine.idleRpm, this.tuning.engine);
    this.state.limiterCut = false;
  }

  /**
   * First half of a step: gear lever, stall / start logic, rev limiter and
   * throttle. Returns what the driveline solver needs to know about the
   * engine side. The caller solves the driveline (the simple two-body solver
   * here, or the full vehicle's own) and reports back with `finish`.
   */
  begin(dt: number, controls: PowertrainControls, forwardSpeed: number): PowertrainDemand {
    const { engine, clutch, gearbox } = this.tuning;
    const s = this.state;
    const events: PowertrainEvent[] = [];

    this.updateGear(controls, forwardSpeed, events);

    const rpm = s.engineOmega * RPM_PER_RAD_S;
    const cranking = controls.ignition && controls.starter;

    // --- running / stalled -------------------------------------------------
    // A freshly fired engine is still climbing from cranking speed: it only
    // dies if it is dragged well below the speed it caught at. Once it has
    // been above stall speed, dropping below it again is a stall.
    if (s.running && rpm >= engine.stallRpm) s.settled = true;
    const dieBelow = s.settled ? engine.stallRpm : engine.catchRpm * FRESH_START_DIE_FRACTION;
    if (s.running && !controls.ignition) {
      s.running = false;
      events.push({ type: 'engineOff' });
    } else if (s.running && !cranking && rpm < dieBelow) {
      s.running = false;
      events.push({ type: 'stall', rpm, gear: s.gear });
    } else if (!s.running && cranking && rpm >= engine.catchRpm) {
      s.running = true;
      events.push({ type: 'engineStart' });
    }
    if (!s.running) s.settled = false;

    // --- rev limiter ---------------------------------------------------------
    if (rpm > engine.redlineRpm) s.limiterCut = true;
    else if (rpm < engine.redlineRpm - engine.revLimiterHysteresisRpm) s.limiterCut = false;

    const overRev = rpm > engine.redlineRpm + OVER_REV_MARGIN_RPM;
    if (overRev && !s.overRev) events.push({ type: 'overRev', rpm });
    s.overRev = overRev;

    // --- throttle (driver or idle controller) with intake lag ---------------
    const wanted = s.running
      ? Math.max(throttleFill(controls.throttle, rpm, engine), idleFill(rpm, engine))
      : 0;
    if (engine.throttleLag > 0) {
      s.intake += (wanted - s.intake) * (1 - Math.exp(-dt / engine.throttleLag));
    } else {
      s.intake = wanted;
    }

    // --- torques on the engine ---------------------------------------------
    let drive = 0;
    if (s.running && !s.limiterCut) drive += indicatedTorque(rpm, s.intake, engine);
    if (cranking) drive += starterTorque(rpm, engine);
    let friction = engineFriction(rpm, engine);
    // A dead engine left in gear resists turning (compression): this is what
    // holds a parked car on a slope.
    if (!s.running && !cranking) friction += engine.stalledHoldTorque;

    const capacity = clutchCapacity(controls.clutch, clutch);
    const ratio = totalRatio(s.gear, gearbox);

    return {
      engineOmega: s.engineOmega,
      engineInertia: engine.inertia,
      engineTorque: drive,
      engineFriction: friction,
      ratio,
      clutchCapacity: capacity,
      efficiency: gearbox.efficiency,
      engineLoad: s.intake,
      events,
    };
  }

  /** Second half of a step: store the engine speed the driveline solve produced. */
  finish(engineOmega: number): void {
    this.state.engineOmega = engineOmega;
  }

  /** One whole step against a simple load (used by the straight-line test car). */
  step(dt: number, controls: PowertrainControls, load: PowertrainLoad): PowertrainOutput {
    const d = this.begin(dt, controls, load.forwardSpeed);

    const r = solveDriveline({
      dt,
      iterations: this.tuning.sim.drivelineIterations,
      engineOmega: d.engineOmega,
      engineInertia: d.engineInertia,
      engineTorque: d.engineTorque,
      engineFriction: d.engineFriction,
      wheelOmega: load.wheelOmega,
      wheelInertia: load.wheelInertia,
      wheelTorque: load.wheelTorque,
      wheelFriction: load.wheelFriction,
      ratio: d.ratio,
      clutchCapacity: d.clutchCapacity,
      efficiency: d.efficiency,
    });

    this.finish(r.engineOmega);

    return {
      wheelOmega: r.wheelOmega,
      driveTorque: r.driveTorque,
      clutchTorque: r.clutchTorque,
      clutchCapacity: d.clutchCapacity,
      clutchSlip: r.clutchSlip,
      engineTorque: d.engineTorque + r.engineFrictionTorque,
      wheelFrictionTorque: r.wheelFrictionTorque,
      engineLoad: d.engineLoad,
      events: d.events,
    };
  }

  private updateGear(controls: PowertrainControls, forwardSpeed: number, events: PowertrainEvent[]): void {
    const s = this.state;
    const wanted = controls.gear;
    if (wanted === s.gear) {
      s.refusedGear = null;
      return;
    }
    const result = checkShift(
      s.gear,
      wanted,
      controls.clutch,
      forwardSpeed,
      this.tuning.gearbox,
      this.tuning.clutch,
    );
    if (result === 'ok') {
      events.push({ type: 'shift', from: s.gear, to: wanted });
      s.gear = wanted;
      s.refusedGear = null;
      return;
    }
    if (result === 'invalid') return;
    // The lever is being pushed at a gear that will not go in. The gearbox
    // drops to neutral (you cannot stay in the old gear while reaching for a
    // new one) and one grind is logged per attempt.
    if (s.gear !== GEAR_NEUTRAL) {
      events.push({ type: 'shift', from: s.gear, to: GEAR_NEUTRAL });
      s.gear = GEAR_NEUTRAL;
    }
    if (s.refusedGear !== wanted) {
      s.refusedGear = wanted;
      events.push({ type: 'gearGrind', wanted, reason: result === 'grind-clutch' ? 'clutch' : 'reverse' });
    }
  }
}

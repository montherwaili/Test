/**
 * A car that can only drive in a straight line along a road of given slope.
 *
 * This is the phase 1 test bed for the powertrain: a point mass with brakes,
 * drag, rolling resistance and gravity. It has no steering, tyres or
 * suspension - those arrive with the Rapier vehicle - but it is enough to
 * exercise moving off, gear changes, stalling, rollback and hill starts, and
 * to do so deterministically in unit tests.
 */
import { RPM_PER_RAD_S, clamp } from './curve';
import { GEAR_NEUTRAL, type Gear } from './gearbox';
import {
  Powertrain,
  type PowertrainControls,
  type PowertrainEvent,
  type PowertrainState,
} from './powertrain';
import type { VehicleTuning } from './tuning';

export interface CarControls extends PowertrainControls {
  /** Foot brake pedal, 0..1. */
  brake: number;
  /** Handbrake lever, 0 = released, 1 = fully on. */
  handbrake: number;
}

export function neutralControls(): CarControls {
  return {
    throttle: 0,
    brake: 0,
    clutch: 0,
    handbrake: 0,
    gear: GEAR_NEUTRAL,
    ignition: true,
    starter: false,
  };
}

export type CarEvent = PowertrainEvent & { time: number };

export interface LongitudinalCarState {
  /** Simulated time, s. */
  time: number;
  /** Distance along the road, m. */
  position: number;
  /** Speed along the road, m/s (negative = rolling backwards). */
  speed: number;
  /** Road slope, radians. Positive = uphill in the forward direction. */
  slope: number;
  powertrain: PowertrainState;
}

/** Read-only numbers for gauges, graphs and (later) the examiner. */
export interface Telemetry {
  time: number;
  position: number;
  speed: number;
  speedKmh: number;
  /** Acceleration along the road over the last step, m/s². */
  acceleration: number;
  rpm: number;
  gear: Gear;
  running: boolean;
  limiterCut: boolean;
  /** Cylinder fill in effect (driver or idle control), 0..1 of full throttle. */
  engineLoad: number;
  /** Net engine torque, N·m. */
  engineTorque: number;
  /** Torque through the clutch, N·m. */
  clutchTorque: number;
  /** Clutch capacity at the current pedal position, N·m. */
  clutchCapacity: number;
  /** Engine minus gearbox-input speed, rpm. */
  clutchSlipRpm: number;
  /** Drive force at the tyres, N. */
  driveForce: number;
  /** Brake + rolling resistance force actually acting, N (signed). */
  frictionForce: number;
  slope: number;
}

export class LongitudinalCar {
  readonly powertrain: Powertrain;
  time = 0;
  position = 0;
  speed = 0;
  slope = 0;
  private lastTelemetry: Telemetry;

  constructor(public tuning: VehicleTuning) {
    this.powertrain = new Powertrain(tuning);
    this.lastTelemetry = this.blankTelemetry();
  }

  get telemetry(): Telemetry {
    return this.lastTelemetry;
  }

  /** Advance one fixed step. Returns the events raised during it. */
  step(dt: number, controls: CarControls): CarEvent[] {
    const { body, brakes } = this.tuning;
    const r = body.wheelRadius;
    const cos = Math.cos(this.slope);
    const sin = Math.sin(this.slope);
    const weight = body.mass * body.gravity;

    // Forces that do work regardless of direction.
    const gravityForce = -weight * sin;
    const dragForce = -0.5 * body.airDensity * body.dragArea * this.speed * Math.abs(this.speed);

    // Forces that only ever oppose motion (and can hold the car still).
    const grip = brakes.tyreGrip * weight * cos;
    const brakeForce = Math.min(clamp(controls.brake, 0, 1) * brakes.maxForce, grip);
    const handbrakeForce = clamp(controls.handbrake, 0, 1) * brakes.handbrakeForce;
    const rollingForce = body.rollingResistance * weight * cos;
    const frictionCapacity = Math.min(brakeForce + handbrakeForce, grip) + rollingForce;

    const wheelInertia = body.mass * r * r + 4 * body.wheelInertia;

    const out = this.powertrain.step(dt, controls, {
      wheelOmega: this.speed / r,
      wheelInertia,
      wheelTorque: (gravityForce + dragForce) * r,
      wheelFriction: frictionCapacity * r,
      forwardSpeed: this.speed,
    });

    const newSpeed = out.wheelOmega * r;
    const acceleration = (newSpeed - this.speed) / dt;
    // Semi-implicit Euler: position uses the new speed.
    this.speed = newSpeed;
    this.position += newSpeed * dt;
    this.time += dt;

    const pt = this.powertrain.state;
    this.lastTelemetry = {
      time: this.time,
      position: this.position,
      speed: this.speed,
      speedKmh: this.speed * 3.6,
      acceleration,
      rpm: pt.engineOmega * RPM_PER_RAD_S,
      gear: pt.gear,
      running: pt.running,
      limiterCut: pt.limiterCut,
      engineLoad: out.engineLoad,
      engineTorque: out.engineTorque,
      clutchTorque: out.clutchTorque,
      clutchCapacity: out.clutchCapacity,
      clutchSlipRpm: out.clutchSlip * RPM_PER_RAD_S,
      driveForce: out.driveTorque / r,
      frictionForce: out.wheelFrictionTorque / r,
      slope: this.slope,
    };

    return out.events.map((e) => ({ ...e, time: this.time }));
  }

  /** Set the slope from a gradient in percent (10 = rises 10 m per 100 m). */
  setGradePercent(percent: number): void {
    this.slope = Math.atan(percent / 100);
  }

  getState(): LongitudinalCarState {
    return {
      time: this.time,
      position: this.position,
      speed: this.speed,
      slope: this.slope,
      powertrain: { ...this.powertrain.state },
    };
  }

  setState(s: LongitudinalCarState): void {
    this.time = s.time;
    this.position = s.position;
    this.speed = s.speed;
    this.slope = s.slope;
    this.powertrain.state = { ...s.powertrain };
  }

  private blankTelemetry(): Telemetry {
    return {
      time: 0,
      position: 0,
      speed: 0,
      speedKmh: 0,
      acceleration: 0,
      rpm: 0,
      gear: GEAR_NEUTRAL,
      running: false,
      limiterCut: false,
      engineLoad: 0,
      engineTorque: 0,
      clutchTorque: 0,
      clutchCapacity: 0,
      clutchSlipRpm: 0,
      driveForce: 0,
      frictionForce: 0,
      slope: 0,
    };
  }
}

import { neutralControls } from '../../sim/longitudinalCar';
import { createDefaultTuning, type VehicleTuning } from '../../sim/tuning';
import { Vehicle, type DriveControls, type VehicleEvent } from '../../sim/vehicle';
import { PhysicsWorld, initPhysics, quatFromEulerDeg, type CarBody } from '../physics';

export const HZ = 120;
export const DT = 1 / HZ;

export interface Rig {
  physics: PhysicsWorld;
  car: CarBody;
  vehicle: Vehicle;
  tuning: VehicleTuning;
}

export interface RigOptions {
  /** Whole ground tilted: positive = uphill in the direction the car faces. */
  gradePercent?: number;
  /** Whole ground banked: positive = right side lower. */
  bankPercent?: number;
  tuning?: VehicleTuning;
  /** Start with the engine idling (default) or dead. */
  engineOff?: boolean;
}

/**
 * A car on a very large plane (20 km square) (optionally tilted about the origin, where the
 * car starts). The car is dropped at ride height and given a moment to settle.
 */
export async function makeRig(options: RigOptions = {}): Promise<Rig> {
  await initPhysics();
  const tuning = options.tuning ?? createDefaultTuning();
  const physics = new PhysicsWorld(HZ, tuning.body.gravity);
  const pitch = (Math.atan((options.gradePercent ?? 0) / 100) * 180) / Math.PI;
  const bank = (Math.atan((options.bankPercent ?? 0) / 100) * 180) / Math.PI;
  const rotation = quatFromEulerDeg(pitch, 0, -bank);
  // A 1 m thick slab whose top face passes through the origin.
  const up = rotate(rotation, 0, 1, 0);
  physics.addFixedBox({ x: -up.x * 0.5, y: -up.y * 0.5, z: -up.z * 0.5 }, { x: 20000, y: 1, z: 20000 }, rotation);
  const car = physics.createCar(tuning, { x: 0, y: 0.02, z: 0 }, 0);
  car.body.setRotation(rotation, true);
  const com = tuning.chassis.comHeight + 0.02;
  car.body.setTranslation({ x: up.x * com, y: up.y * com, z: up.z * com }, true);
  const vehicle = new Vehicle(tuning, car.port, physics.ground);
  if (!options.engineOff) vehicle.powertrain.startInstantly();
  return { physics, car, vehicle, tuning };
}

function rotate(q: { x: number; y: number; z: number; w: number }, x: number, y: number, z: number) {
  const cx = q.y * z - q.z * y;
  const cy = q.z * x - q.x * z;
  const cz = q.x * y - q.y * x;
  return {
    x: x + 2 * (q.w * cx + (q.y * cz - q.z * cy)),
    y: y + 2 * (q.w * cy + (q.z * cx - q.x * cz)),
    z: z + 2 * (q.w * cz + (q.x * cy - q.y * cx)),
  };
}

export function controls(patch: Partial<DriveControls> = {}): DriveControls {
  return { ...neutralControls(), steer: 0, ...patch };
}

export type ControlFn = (t: number, rig: Rig) => Partial<DriveControls>;

/** Scripted drive, as in the sim tests: `base` is updated in place. */
export function drive(
  rig: Rig,
  base: DriveControls,
  seconds: number,
  patch: Partial<DriveControls> | ControlFn = {},
): VehicleEvent[] {
  const events: VehicleEvent[] = [];
  const steps = Math.round(seconds * HZ);
  for (let i = 0; i < steps; i++) {
    Object.assign(base, typeof patch === 'function' ? patch(i * DT, rig) : patch);
    events.push(...rig.vehicle.step(DT, base));
    rig.physics.step();
  }
  return events;
}

export function ramp(t: number, from: number, to: number, duration: number): number {
  if (duration <= 0 || t >= duration) return to;
  return from + ((to - from) * t) / duration;
}

/** Position of the car's centre of mass. */
export function position(rig: Rig) {
  const p = rig.car.body.translation();
  return { x: p.x, y: p.y, z: p.z };
}

/** Distance travelled along the car's starting forward direction on a tilted plane. */
export function distanceFromStart(rig: Rig): number {
  const p = rig.car.body.translation();
  return Math.hypot(p.x, p.z, p.y - rig.tuning.chassis.comHeight);
}

export function eventTypes(events: VehicleEvent[]): string[] {
  return events.map((e) => e.type);
}

/** Move off in first and settle at a steady speed in the given gear at a pedal position. */
export function getMoving(rig: Rig, c: DriveControls, throttle = 0.3, seconds = 5): void {
  drive(rig, c, 0.3, { clutch: 1, gear: 1, handbrake: 0 });
  drive(rig, c, seconds, (t) => ({ throttle, clutch: ramp(t, 1, 0, 1.5) }));
}

/** Full-throttle run up through the gears to `targetKmh`. Returns seconds taken, or -1. */
export function accelerateTo(rig: Rig, c: DriveControls, targetKmh: number, maxSeconds = 90): number {
  const top = rig.tuning.gearbox.forward.length;
  drive(rig, c, 0.3, { clutch: 1, gear: Math.max(1, c.gear), handbrake: 0, brake: 0 });
  let shiftStarted = -1;
  let shifted = false;
  for (let i = 0; i < maxSeconds * HZ; i++) {
    const t = i * DT;
    if (shiftStarted < 0) {
      c.throttle = 1;
      c.clutch = Math.max(0, c.clutch - DT / 0.4);
      if (c.clutch === 0 && rig.vehicle.telemetry.rpm > 6200 && c.gear < top) {
        shiftStarted = t;
        shifted = false;
      }
    } else {
      c.throttle = 0;
      c.clutch = 1;
      if (t - shiftStarted > 0.15 && !shifted) {
        c.gear += 1;
        shifted = true;
      }
      if (t - shiftStarted > 0.3) shiftStarted = -1;
    }
    drive(rig, c, DT);
    if (rig.vehicle.telemetry.speedKmh >= targetKmh) return t;
  }
  return -1;
}

/** How far the centre of mass has moved between two positions, m. */
export function moved(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

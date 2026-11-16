/**
 * The full car: a rigid body on four sprung wheels, driven through the
 * powertrain from phase 1.
 *
 * The rigid body itself (integration, collisions with poles, kerbs, walls) is
 * owned by a physics engine behind the small `ChassisPort` / `GroundPort`
 * interfaces, so this file stays pure TypeScript with no engine or rendering
 * imports. Each fixed step, before the engine integrates:
 *
 *   1. gravity and air drag are applied;
 *   2. a ray is cast down from each wheel's strut to find the ground, and the
 *      spring, damper, anti-roll bar and bump stop give that wheel's load;
 *   3. tyre and driveline friction are solved together as velocity
 *      constraints with limits (projected Gauss-Seidel, warm started):
 *        - clutch: engine speed vs the driven wheels' road speed, limited by
 *          the clutch capacity *and* by the driven tyres' grip - whichever is
 *          weaker slips, which gives clutch slip and wheelspin from one row;
 *        - engine friction;
 *        - per wheel, braking + rolling resistance along the wheel;
 *        - per wheel, cornering force across it, limited by what the friction
 *          circle has left and by a slip-angle curve.
 *
 * Solving these as constraints rather than as slip-proportional forces is what
 * lets the car stop exactly on a line, sit still on a hill on the handbrake or
 * in gear, and roll back the moment it is released - the things a driving
 * examiner looks at - without low-speed jitter.
 *
 * Simplifications, on purpose: braking assumes ABS (a braked wheel never
 * locks; its force is capped at the grip available), longitudinal slip is
 * tracked for the driven axle only, and the differential is open.
 *
 * Axes: +X right, +Y up, -Z forward (the Three.js convention).
 */
import { RPM_PER_RAD_S, clamp } from './curve';
import type { Gear } from './gearbox';
import type { CarControls } from './longitudinalCar';
import { Powertrain, type PowertrainEvent } from './powertrain';
import type { VehicleTuning } from './tuning';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** The car body as the physics engine sees it. Origin = centre of mass. */
export interface ChassisPort {
  translation(): Vec3;
  rotation(): Quat;
  linvel(): Vec3;
  angvel(): Vec3;
  setVelocity(linear: Vec3, angular: Vec3): void;
}

export interface GroundHit {
  distance: number;
  nx: number;
  ny: number;
  nz: number;
  /** Identifier of the surface hit (physics collider handle), for the examiner. */
  surface: number;
}

/** Ray casts against the static world. */
export interface GroundPort {
  /** Returns true and fills `hit` if the ray meets the ground within `maxDistance`. */
  castRay(origin: Vec3, direction: Vec3, maxDistance: number, hit: GroundHit): boolean;
}

export interface DriveControls extends CarControls {
  /** Steering wheel, -1 = full left .. +1 = full right. */
  steer: number;
}

export type VehicleEvent = PowertrainEvent & { time: number };

export const WHEEL_FL = 0;
export const WHEEL_FR = 1;
export const WHEEL_RL = 2;
export const WHEEL_RR = 3;

export interface WheelState {
  readonly index: number;
  readonly front: boolean;
  readonly left: boolean;
  readonly driven: boolean;
  /** Strut top in the chassis frame, m. */
  readonly mountX: number;
  readonly mountY: number;
  readonly mountZ: number;

  /** Steering angle, rad, positive = turned right. */
  steerAngle: number;
  /** Rotation of the wheel about its axle, rad (for drawing). */
  spinAngle: number;
  /** rad/s, positive = rolling forwards. */
  spinRate: number;
  /** Strut length now, m (wheel centre below the mount). */
  suspensionLength: number;
  /** Spring compression from full droop, m. */
  compression: number;
  grounded: boolean;
  /** Normal load on the tyre, N. */
  load: number;
  /** rad, at the start of the last step. */
  slipAngle: number;
  /** Surface under the tyre (see GroundHit.surface), -1 in the air. */
  surface: number;
  /** Longitudinal / lateral tyre force over the last step, N. */
  forceLong: number;
  forceLat: number;
}

/** Per-wheel working values for the solver. */
interface WheelSolve {
  compRate: number;
  // Contact point relative to the centre of mass, world axes.
  rx: number;
  ry: number;
  rz: number;
  nx: number;
  ny: number;
  nz: number;
  // Unit vectors along and across the wheel, in the ground plane.
  fx: number;
  fy: number;
  fz: number;
  sx: number;
  sy: number;
  sz: number;
  // Angular response to a unit impulse along f / s at the contact.
  afx: number;
  afy: number;
  afz: number;
  asx: number;
  asy: number;
  asz: number;
  kLong: number;
  kLat: number;
  /** μ·N·dt, the most impulse the tyre can give this step. */
  grip: number;
  latFactor: number;
  capLong: number;
  /** Accumulated impulses, kept between steps for warm starting. */
  pLong: number;
  pLat: number;
}

export interface VehicleTelemetry {
  time: number;
  /** Speed along the car's own forward axis, m/s (negative = backwards). */
  speed: number;
  speedKmh: number;
  /**
   * Mean rolling speed of the four tyres over the road, m/s. Unlike `speed`
   * (the centre of mass, which rocks on the springs) this is zero whenever the
   * wheels are not turning, so it is the one to use for "did it roll back".
   */
  wheelSpeed: number;
  /** Felt acceleration along / across the car, m/s² (positive = forwards / to the right). */
  longitudinalAccel: number;
  lateralAccel: number;
  /** rad/s, positive = turning right. */
  yawRate: number;
  /** rad, positive = nose up. */
  pitch: number;
  /** rad, positive = leaning to the right. */
  roll: number;
  /** rad, 0 = facing -Z, positive = clockwise seen from above. */
  heading: number;
  rpm: number;
  gear: Gear;
  running: boolean;
  limiterCut: boolean;
  engineLoad: number;
  engineTorque: number;
  clutchTorque: number;
  clutchCapacity: number;
  /** Engine speed minus the speed the road asks of it, rpm (clutch slip + wheelspin). */
  drivelineSlipRpm: number;
  /** The driven tyres, not the clutch, are what is slipping. */
  wheelspin: boolean;
  /** Slip ratio of the driven axle (0 unless spinning). */
  slipRatio: number;
}

/** Tyre surface must slide at least this fast over the road to count as wheelspin, m/s. */
const WHEELSPIN_MIN_SLIP_SPEED = 0.5;

/** Fraction of the previous step's impulses used as the starting guess. */
const WARM_START = 0.95;

/** Scratch vector for the helpers below (the solver runs allocation-free). */
const T: Vec3 = { x: 0, y: 0, z: 0 };

function rotate(q: Quat, x: number, y: number, z: number): Vec3 {
  // v' = v + 2w(q × v) + 2(q × (q × v))
  const cx = q.y * z - q.z * y;
  const cy = q.z * x - q.x * z;
  const cz = q.x * y - q.y * x;
  T.x = x + 2 * (q.w * cx + (q.y * cz - q.z * cy));
  T.y = y + 2 * (q.w * cy + (q.z * cx - q.x * cz));
  T.z = z + 2 * (q.w * cz + (q.x * cy - q.y * cx));
  return T;
}

export class Vehicle {
  readonly powertrain: Powertrain;
  readonly wheels: WheelState[] = [];
  time = 0;

  private readonly solve: WheelSolve[] = [];
  private clutchImpulse = 0;
  private engineFrictionImpulse = 0;
  private lastSlipRatio = 0;
  private lastTelemetry: VehicleTelemetry;
  private readonly hit: GroundHit = { distance: 0, nx: 0, ny: 1, nz: 0, surface: -1 };
  private readonly rayOrigin: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly rayDir: Vec3 = { x: 0, y: -1, z: 0 };
  private readonly outLin: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly outAng: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(
    public tuning: VehicleTuning,
    private readonly body: ChassisPort,
    private readonly ground: GroundPort,
  ) {
    this.powertrain = new Powertrain(tuning);
    const { chassis, suspension, body: b } = tuning;
    const toRear = chassis.frontWeightFraction * chassis.wheelbase;
    const toFront = chassis.wheelbase - toRear;
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const left = i % 2 === 0;
      const axle = front ? suspension.front : suspension.rear;
      const share = front ? chassis.frontWeightFraction : 1 - chassis.frontWeightFraction;
      const staticCompression = (b.mass * b.gravity * share) / 2 / axle.springRate;
      this.wheels.push({
        index: i,
        front,
        left,
        driven: front,
        mountX: (left ? -1 : 1) * (chassis.track / 2),
        // Placed so that at rest on level ground the centre of mass sits at comHeight.
        mountY: -(chassis.comHeight - b.wheelRadius) + (suspension.maxLength - staticCompression),
        mountZ: front ? -toFront : toRear,
        steerAngle: 0,
        spinAngle: 0,
        spinRate: 0,
        suspensionLength: suspension.maxLength - staticCompression,
        compression: staticCompression,
        grounded: false,
        load: 0,
        slipAngle: 0,
        surface: -1,
        forceLong: 0,
        forceLat: 0,
      });
      this.solve.push({
        compRate: 0,
        rx: 0, ry: 0, rz: 0,
        nx: 0, ny: 1, nz: 0,
        fx: 0, fy: 0, fz: -1,
        sx: 1, sy: 0, sz: 0,
        afx: 0, afy: 0, afz: 0,
        asx: 0, asy: 0, asz: 0,
        kLong: 1, kLat: 1,
        grip: 0, latFactor: 1, capLong: 0,
        pLong: 0, pLat: 0,
      });
    }
    this.lastTelemetry = this.blankTelemetry();
  }

  get telemetry(): VehicleTelemetry {
    return this.lastTelemetry;
  }

  /** Wheel centre in the chassis frame (for drawing). */
  wheelLocalPosition(i: number, out: Vec3): Vec3 {
    const w = this.wheels[i]!;
    out.x = w.mountX;
    out.y = w.mountY - w.suspensionLength;
    out.z = w.mountZ;
    return out;
  }

  /** Forget solver memory after the body has been teleported. */
  resetSolver(): void {
    this.clutchImpulse = 0;
    this.engineFrictionImpulse = 0;
    this.lastSlipRatio = 0;
    for (const s of this.solve) {
      s.pLong = 0;
      s.pLat = 0;
    }
    for (const w of this.wheels) w.spinRate = 0;
  }

  /**
   * Advance the car's forces by one fixed step. Call this, then step the
   * physics engine, which integrates the body with the velocities set here.
   */
  step(dt: number, controls: DriveControls): VehicleEvent[] {
    const { body: bt, chassis, suspension, tyres, steering, brakes, sim } = this.tuning;
    const mass = bt.mass;
    const invMass = 1 / mass;
    const radius = bt.wheelRadius;
    const [ix, iy, iz] = chassis.inertia;

    const pos = this.body.translation();
    const q = this.body.rotation();
    const lin = this.body.linvel();
    const ang = this.body.angvel();
    const px = pos.x, py = pos.y, pz = pos.z;
    let vx = lin.x, vy = lin.y, vz = lin.z;
    let wx = ang.x, wy = ang.y, wz = ang.z;
    const v0x = vx, v0y = vy, v0z = vz;

    // Body axes in world space.
    let t = rotate(q, 1, 0, 0);
    const rgx = t.x, rgy = t.y, rgz = t.z;
    t = rotate(q, 0, 1, 0);
    const upx = t.x, upy = t.y, upz = t.z;
    t = rotate(q, 0, 0, -1);
    const fwx = t.x, fwy = t.y, fwz = t.z;

    /** World-space inverse inertia applied to a vector (result in T). */
    const applyInvInertia = (ax: number, ay: number, az: number): Vec3 => {
      // To the body frame (rotate by the conjugate), scale, and back.
      const lx = ax * rgx + ay * rgy + az * rgz;
      const ly = ax * upx + ay * upy + az * upz;
      const lz = -(ax * fwx + ay * fwy + az * fwz);
      const sx = lx / ix, sy = ly / iy, sz = lz / iz;
      T.x = sx * rgx + sy * upx - sz * fwx;
      T.y = sx * rgy + sy * upy - sz * fwy;
      T.z = sx * rgz + sy * upz - sz * fwz;
      return T;
    };

    const forwardSpeed = vx * fwx + vy * fwy + vz * fwz;
    const demand = this.powertrain.begin(dt, controls, forwardSpeed);

    // --- gravity and air drag ----------------------------------------------
    vy -= bt.gravity * dt;
    const airSpeed = Math.hypot(vx, vy, vz);
    const dragFactor = Math.min(1, 0.5 * bt.airDensity * bt.dragArea * airSpeed * invMass * dt);
    vx -= vx * dragFactor;
    vy -= vy * dragFactor;
    vz -= vz * dragFactor;

    // --- steering geometry ---------------------------------------------------
    const steer = clamp(controls.steer, -1, 1);
    const centre = steer * steering.maxAngleDeg * (Math.PI / 180);
    let steerLeft = centre;
    let steerRight = centre;
    if (Math.abs(centre) > 1e-4 && steering.ackermann > 0) {
      // Both front wheels aim at one turning centre on the rear axle line.
      const turnRadius = chassis.wheelbase / Math.tan(centre); // signed, + = right
      const ackLeft = Math.atan(chassis.wheelbase / (turnRadius + chassis.track / 2));
      const ackRight = Math.atan(chassis.wheelbase / (turnRadius - chassis.track / 2));
      steerLeft = centre + (ackLeft - centre) * steering.ackermann;
      steerRight = centre + (ackRight - centre) * steering.ackermann;
    }

    // --- wheels: find the ground ---------------------------------------------
    const maxRay = suspension.maxLength + radius;
    this.rayDir.x = -upx;
    this.rayDir.y = -upy;
    this.rayDir.z = -upz;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i]!;
      const s = this.solve[i]!;
      w.steerAngle = w.front ? (w.left ? steerLeft : steerRight) : 0;
      // Mount point in world space (chassis -Z is forward, so +Z is "back").
      const mx = rgx * w.mountX + upx * w.mountY - fwx * w.mountZ;
      const my = rgy * w.mountX + upy * w.mountY - fwy * w.mountZ;
      const mz = rgz * w.mountX + upz * w.mountY - fwz * w.mountZ;
      this.rayOrigin.x = px + mx;
      this.rayOrigin.y = py + my;
      this.rayOrigin.z = pz + mz;
      const found = this.ground.castRay(this.rayOrigin, this.rayDir, maxRay, this.hit);
      if (!found) {
        w.grounded = false;
        w.suspensionLength = suspension.maxLength;
        w.compression = 0;
        w.load = 0;
        w.surface = -1;
        w.forceLong = 0;
        w.forceLat = 0;
        s.pLong = 0;
        s.pLat = 0;
        continue;
      }
      const h = this.hit;
      w.grounded = true;
      w.surface = h.surface;
      w.suspensionLength = Math.max(0, h.distance - radius);
      w.compression = suspension.maxLength - w.suspensionLength;
      s.nx = h.nx;
      s.ny = h.ny;
      s.nz = h.nz;
      s.rx = mx - upx * h.distance;
      s.ry = my - upy * h.distance;
      s.rz = mz - upz * h.distance;
      // How fast the strut is being compressed: the contact point's speed
      // into the ground, measured before this step's gravity is added (so a
      // car at rest reads zero and sits exactly at its static ride height).
      const cvx = v0x + (wy * s.rz - wz * s.ry);
      const cvy = v0y + (wz * s.rx - wx * s.rz);
      const cvz = v0z + (wx * s.ry - wy * s.rx);
      const along = -(this.rayDir.x * h.nx + this.rayDir.y * h.ny + this.rayDir.z * h.nz);
      s.compRate = -(cvx * h.nx + cvy * h.ny + cvz * h.nz) / Math.max(0.2, along);
    }

    // --- suspension forces -----------------------------------------------------
    for (let axle = 0; axle < 2; axle++) {
      const a = axle === 0 ? suspension.front : suspension.rear;
      const wl = this.wheels[axle * 2]!;
      const wr = this.wheels[axle * 2 + 1]!;
      const antiRoll = a.antiRollRate * (wl.compression - wr.compression);
      for (let side = 0; side < 2; side++) {
        const w = side === 0 ? wl : wr;
        if (!w.grounded) continue;
        const s = this.solve[w.index]!;
        let force = a.springRate * w.compression + a.damping * s.compRate;
        force += side === 0 ? antiRoll : -antiRoll;
        if (w.compression > suspension.travel) {
          force += suspension.bumpStopRate * (w.compression - suspension.travel);
        }
        // A tyre can only push; cap the push so a hard landing cannot explode.
        w.load = clamp(force, 0, mass * bt.gravity * 4);
        const j = w.load * dt;
        vx += s.nx * j * invMass;
        vy += s.ny * j * invMass;
        vz += s.nz * j * invMass;
        const a2 = applyInvInertia(
          s.ry * s.nz - s.rz * s.ny,
          s.rz * s.nx - s.rx * s.nz,
          s.rx * s.ny - s.ry * s.nx,
        );
        wx += a2.x * j;
        wy += a2.y * j;
        wz += a2.z * j;
      }
    }

    // --- tyre rows: directions, effective masses, limits -----------------------
    const peakSlipAngle = tyres.peakSlipAngleDeg * (Math.PI / 180);
    const footFront = (clamp(controls.brake, 0, 1) * brakes.maxForce * brakes.frontBias) / 2;
    const footRear = (clamp(controls.brake, 0, 1) * brakes.maxForce * (1 - brakes.frontBias)) / 2;
    const handRear = (clamp(controls.handbrake, 0, 1) * brakes.handbrakeForce) / 2;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i]!;
      if (!w.grounded) continue;
      const s = this.solve[i]!;
      const cos = Math.cos(w.steerAngle);
      const sin = Math.sin(w.steerAngle);
      // Wheel heading, flattened onto the ground plane.
      let fx = fwx * cos + rgx * sin;
      let fy = fwy * cos + rgy * sin;
      let fz = fwz * cos + rgz * sin;
      const fn = fx * s.nx + fy * s.ny + fz * s.nz;
      fx -= fn * s.nx;
      fy -= fn * s.ny;
      fz -= fn * s.nz;
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= fl;
      fy /= fl;
      fz /= fl;
      s.fx = fx;
      s.fy = fy;
      s.fz = fz;
      // Right of the wheel: f × n.
      s.sx = fy * s.nz - fz * s.ny;
      s.sy = fz * s.nx - fx * s.nz;
      s.sz = fx * s.ny - fy * s.nx;

      let a = applyInvInertia(s.ry * fz - s.rz * fy, s.rz * fx - s.rx * fz, s.rx * fy - s.ry * fx);
      s.afx = a.x;
      s.afy = a.y;
      s.afz = a.z;
      s.kLong =
        invMass +
        ((s.afy * s.rz - s.afz * s.ry) * fx + (s.afz * s.rx - s.afx * s.rz) * fy + (s.afx * s.ry - s.afy * s.rx) * fz);
      a = applyInvInertia(
        s.ry * s.sz - s.rz * s.sy,
        s.rz * s.sx - s.rx * s.sz,
        s.rx * s.sy - s.ry * s.sx,
      );
      s.asx = a.x;
      s.asy = a.y;
      s.asz = a.z;
      s.kLat =
        invMass +
        ((s.asy * s.rz - s.asz * s.ry) * s.sx +
          (s.asz * s.rx - s.asx * s.rz) * s.sy +
          (s.asx * s.ry - s.asy * s.rx) * s.sz);

      s.grip = tyres.grip * w.load * dt;

      // Slip angle from the contact patch's velocity before friction acts.
      const cvx = vx + (wy * s.rz - wz * s.ry);
      const cvy = vy + (wz * s.rx - wx * s.rz);
      const cvz = vz + (wx * s.ry - wy * s.rx);
      const along = cvx * fx + cvy * fy + cvz * fz;
      const across = cvx * s.sx + cvy * s.sy + cvz * s.sz;
      w.slipAngle = Math.atan2(Math.abs(across), Math.abs(along) + tyres.restSpeed);
      s.latFactor = lateralGripFactor(w.slipAngle, peakSlipAngle, tyres.slideGrip);

      // ABS: a brake never asks the tyre for more than it has.
      const brakeForce = w.front ? footFront : footRear + handRear;
      s.capLong = (Math.min(brakeForce, tyres.grip * w.load) + bt.rollingResistance * w.load) * dt;

    }

    // Warm start from the last step (after every wheel's slip angle has been
    // measured, so one wheel's guess does not disturb another's reading).
    for (let i = 0; i < 4; i++) {
      if (!this.wheels[i]!.grounded) continue;
      const s = this.solve[i]!;
      s.pLong = clamp(s.pLong * WARM_START, -s.capLong, s.capLong);
      const latCap = s.grip * s.latFactor;
      s.pLat = clamp(s.pLat * WARM_START, -latCap, latCap);
      vx += (s.fx * s.pLong + s.sx * s.pLat) * invMass;
      vy += (s.fy * s.pLong + s.sy * s.pLat) * invMass;
      vz += (s.fz * s.pLong + s.sz * s.pLat) * invMass;
      wx += s.afx * s.pLong + s.asx * s.pLat;
      wy += s.afy * s.pLong + s.asy * s.pLat;
      wz += s.afz * s.pLong + s.asz * s.pLat;
    }

    // --- clutch row: engine <-> driven wheels <-> road -------------------------
    const dl = this.solve[WHEEL_FL]!;
    const dr = this.solve[WHEEL_FR]!;
    const ratio = demand.ratio;
    const bothDown = this.wheels[WHEEL_FL]!.grounded && this.wheels[WHEEL_FR]!.grounded;
    const coupled = ratio !== 0 && demand.clutchCapacity > 0 && bothDown;
    /** Gearbox input speed per unit of summed driven-wheel road speed. */
    const rowGain = ratio / (2 * radius);
    /** Push on the car at each driven wheel per unit of clutch impulse. */
    const pushGain = (ratio * demand.efficiency) / (2 * radius);
    const invEngine = 1 / demand.engineInertia;
    let dvx = 0, dvy = 0, dvz = 0, dwx = 0, dwy = 0, dwz = 0;
    let kClutch = invEngine;
    let capClutch = 0;
    let tractionCap = 0;
    let we = demand.engineOmega + demand.engineTorque * invEngine * dt;
    if (coupled) {
      dvx = (dl.fx + dr.fx) * pushGain * invMass;
      dvy = (dl.fy + dr.fy) * pushGain * invMass;
      dvz = (dl.fz + dr.fz) * pushGain * invMass;
      dwx = (dl.afx + dr.afx) * pushGain;
      dwy = (dl.afy + dr.afy) * pushGain;
      dwz = (dl.afz + dr.afz) * pushGain;
      const respL =
        (dvx + (dwy * dl.rz - dwz * dl.ry)) * dl.fx +
        (dvy + (dwz * dl.rx - dwx * dl.rz)) * dl.fy +
        (dvz + (dwx * dl.ry - dwy * dl.rx)) * dl.fz;
      const respR =
        (dvx + (dwy * dr.rz - dwz * dr.ry)) * dr.fx +
        (dvy + (dwz * dr.rx - dwx * dr.rz)) * dr.fy +
        (dvz + (dwx * dr.ry - dwy * dr.rx)) * dr.fz;
      kClutch = invEngine + rowGain * (respL + respR);
      // An open differential sends equal torque to both wheels, so the tyre
      // with less grip sets the limit. Spinning tyres grip a little less.
      const spinGrip = longitudinalGripFactor(this.lastSlipRatio, tyres.peakSlipRatio, tyres.slideGrip);
      tractionCap = (Math.min(dl.grip, dr.grip) * spinGrip) / Math.abs(pushGain);
      capClutch = Math.min(demand.clutchCapacity * dt, tractionCap);
      this.clutchImpulse = clamp(this.clutchImpulse * WARM_START, -capClutch, capClutch);
      we -= this.clutchImpulse * invEngine;
      vx += dvx * this.clutchImpulse;
      vy += dvy * this.clutchImpulse;
      vz += dvz * this.clutchImpulse;
      wx += dwx * this.clutchImpulse;
      wy += dwy * this.clutchImpulse;
      wz += dwz * this.clutchImpulse;
    } else {
      this.clutchImpulse = 0;
    }

    const capEngine = demand.engineFriction * dt;
    this.engineFrictionImpulse = clamp(this.engineFrictionImpulse * WARM_START, -capEngine, capEngine);
    we += this.engineFrictionImpulse * invEngine;

    const clutchRow = (): void => {
      const uL =
        (vx + (wy * dl.rz - wz * dl.ry)) * dl.fx +
        (vy + (wz * dl.rx - wx * dl.rz)) * dl.fy +
        (vz + (wx * dl.ry - wy * dl.rx)) * dl.fz;
      const uR =
        (vx + (wy * dr.rz - wz * dr.ry)) * dr.fx +
        (vy + (wz * dr.rx - wx * dr.rz)) * dr.fy +
        (vz + (wx * dr.ry - wy * dr.rx)) * dr.fz;
      const slip = we - rowGain * (uL + uR);
      const next = clamp(this.clutchImpulse + slip / kClutch, -capClutch, capClutch);
      const d = next - this.clutchImpulse;
      this.clutchImpulse = next;
      we -= d * invEngine;
      vx += dvx * d;
      vy += dvy * d;
      vz += dvz * d;
      wx += dwx * d;
      wy += dwy * d;
      wz += dwz * d;
    };

    // --- solve -----------------------------------------------------------------
    for (let iter = 0; iter < sim.vehicleIterations; iter++) {
      if (coupled) clutchRow();

      if (capEngine > 0) {
        const next = clamp(this.engineFrictionImpulse - we * demand.engineInertia, -capEngine, capEngine);
        we += (next - this.engineFrictionImpulse) * invEngine;
        this.engineFrictionImpulse = next;
      }

      for (let i = 0; i < 4; i++) {
        if (!this.wheels[i]!.grounded) continue;
        const s = this.solve[i]!;

        // Braking and rolling resistance, along the wheel.
        let cvx = vx + (wy * s.rz - wz * s.ry);
        let cvy = vy + (wz * s.rx - wx * s.rz);
        let cvz = vz + (wx * s.ry - wy * s.rx);
        const along = cvx * s.fx + cvy * s.fy + cvz * s.fz;
        let next = clamp(s.pLong - along / s.kLong, -s.capLong, s.capLong);
        let d = next - s.pLong;
        s.pLong = next;
        vx += s.fx * d * invMass;
        vy += s.fy * d * invMass;
        vz += s.fz * d * invMass;
        wx += s.afx * d;
        wy += s.afy * d;
        wz += s.afz * d;

        // Cornering, across the wheel, with whatever grip braking and drive leave.
        const drive = coupled && i < 2 ? this.clutchImpulse * pushGain : 0;
        const used = s.pLong + drive;
        const latCap = Math.sqrt(Math.max(0, s.grip * s.grip - used * used)) * s.latFactor;
        cvx = vx + (wy * s.rz - wz * s.ry);
        cvy = vy + (wz * s.rx - wx * s.rz);
        cvz = vz + (wx * s.ry - wy * s.rx);
        const across = cvx * s.sx + cvy * s.sy + cvz * s.sz;
        next = clamp(s.pLat - across / s.kLat, -latCap, latCap);
        d = next - s.pLat;
        s.pLat = next;
        vx += s.sx * d * invMass;
        vy += s.sy * d * invMass;
        vz += s.sz * d * invMass;
        wx += s.asx * d;
        wy += s.asy * d;
        wz += s.asz * d;
      }
    }
    // Finish on the clutch so a locked clutch reports matched speeds.
    if (coupled) clutchRow();

    // --- write back --------------------------------------------------------------
    this.powertrain.finish(we);
    this.outLin.x = vx;
    this.outLin.y = vy;
    this.outLin.z = vz;
    this.outAng.x = wx;
    this.outAng.y = wy;
    this.outAng.z = wz;
    this.body.setVelocity(this.outLin, this.outAng);
    this.time += dt;

    // --- what happened: slip, wheel rotation, telemetry ---------------------------
    let roadSum = 0;
    let rollSum = 0;
    let rollCount = 0;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i]!;
      const s = this.solve[i]!;
      if (w.grounded) {
        const cvx = vx + (wy * s.rz - wz * s.ry);
        const cvy = vy + (wz * s.rx - wx * s.rz);
        const cvz = vz + (wx * s.ry - wy * s.rx);
        const along = cvx * s.fx + cvy * s.fy + cvz * s.fz;
        w.spinRate = along / radius;
        rollSum += along;
        rollCount++;
        if (i < 2) roadSum += along;
        const drive = coupled && i < 2 ? this.clutchImpulse * pushGain : 0;
        w.forceLong = (s.pLong + drive) / dt;
        w.forceLat = s.pLat / dt;
      }
    }
    const slip = coupled ? we - rowGain * roadSum : 0;
    const saturated = coupled && Math.abs(this.clutchImpulse) >= capClutch * (1 - 1e-9);
    const tyreLimited = coupled && tractionCap < demand.clutchCapacity * dt;
    // If the tyres are the weak link, the driven wheels turn with the engine
    // and the road is going slower (or the other way). A brief few cm/s as a
    // clutch locks up is tyre flex, not wheelspin.
    const road = roadSum / 2;
    const surfaceSlip = saturated && tyreLimited ? (we / ratio) * radius - road : 0;
    const wheelspin = Math.abs(surfaceSlip) > WHEELSPIN_MIN_SLIP_SPEED;
    let slipRatio = 0;
    if (wheelspin) {
      slipRatio = surfaceSlip / Math.max(Math.abs(road), 1);
      this.wheels[WHEEL_FL]!.spinRate = we / ratio;
      this.wheels[WHEEL_FR]!.spinRate = we / ratio;
    }
    this.lastSlipRatio = slipRatio;
    for (const w of this.wheels) w.spinAngle += w.spinRate * dt;

    const newForward = vx * fwx + vy * fwy + vz * fwz;
    const ax = (vx - v0x) / dt;
    const ay = (vy - v0y) / dt;
    const az = (vz - v0z) / dt;
    const pt = this.powertrain.state;
    this.lastTelemetry = {
      time: this.time,
      speed: newForward,
      speedKmh: newForward * 3.6,
      wheelSpeed: rollCount > 0 ? rollSum / rollCount : newForward,
      longitudinalAccel: ax * fwx + ay * fwy + az * fwz,
      lateralAccel: ax * rgx + ay * rgy + az * rgz,
      yawRate: -(wx * upx + wy * upy + wz * upz),
      pitch: Math.asin(clamp(fwy, -1, 1)),
      roll: Math.asin(clamp(-rgy, -1, 1)),
      heading: Math.atan2(fwx, -fwz),
      rpm: we * RPM_PER_RAD_S,
      gear: pt.gear,
      running: pt.running,
      limiterCut: pt.limiterCut,
      engineLoad: demand.engineLoad,
      engineTorque: demand.engineTorque + this.engineFrictionImpulse / dt,
      clutchTorque: this.clutchImpulse / dt,
      clutchCapacity: demand.clutchCapacity,
      drivelineSlipRpm: slip * RPM_PER_RAD_S,
      wheelspin,
      slipRatio,
    };

    const time = this.time;
    return demand.events.map((e) => ({ ...e, time }));
  }

  private blankTelemetry(): VehicleTelemetry {
    return {
      time: 0,
      speed: 0,
      speedKmh: 0,
      wheelSpeed: 0,
      longitudinalAccel: 0,
      lateralAccel: 0,
      yawRate: 0,
      pitch: 0,
      roll: 0,
      heading: 0,
      rpm: 0,
      gear: 0,
      running: false,
      limiterCut: false,
      engineLoad: 0,
      engineTorque: 0,
      clutchTorque: 0,
      clutchCapacity: 0,
      drivelineSlipRpm: 0,
      wheelspin: false,
      slipRatio: 0,
    };
  }
}

/**
 * Cornering grip available at a slip angle, as a fraction of peak: rises
 * linearly to the peak angle, then eases down to the sliding value.
 */
export function lateralGripFactor(slipAngle: number, peakAngle: number, slideGrip: number): number {
  const a = Math.abs(slipAngle);
  if (a <= peakAngle) return a / peakAngle;
  const beyond = Math.min(1, (a - peakAngle) / (3 * peakAngle));
  return 1 - (1 - slideGrip) * beyond;
}

/**
 * Drive grip available at a slip ratio, as a fraction of peak: full up to the
 * peak ratio, easing down to the sliding value at a slip ratio of 1.
 */
export function longitudinalGripFactor(slipRatio: number, peakRatio: number, slideGrip: number): number {
  const k = Math.abs(slipRatio);
  if (k <= peakRatio) return 1;
  const beyond = Math.min(1, (k - peakRatio) / (1 - peakRatio));
  return 1 - (1 - slideGrip) * beyond;
}

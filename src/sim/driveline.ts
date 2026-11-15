/**
 * Driveline solver: engine <-> clutch <-> wheels, one fixed step.
 *
 * Two rotating bodies (the engine, and everything on the wheel side of the
 * clutch reduced to the driven wheels) joined by three dry-friction elements:
 *
 *   - the clutch, which tries to remove the speed difference between the engine
 *     and the gearbox input, limited by its torque capacity;
 *   - engine friction, which tries to stop the engine;
 *   - wheel friction (brakes, handbrake, rolling resistance), which tries to
 *     stop the wheels.
 *
 * Each is a "bring this relative speed to zero, but with no more than this much
 * torque" constraint, solved with projected Gauss-Seidel on impulses. That one
 * formulation gives every stick/slip combination without special cases:
 * a slipping clutch at the bite point, a locked clutch, a car held on a hill by
 * the handbrake, by the foot brake, or by a dead engine left in gear.
 * It is also unconditionally stable at any step size, which an explicit
 * `torque = k * slip` clutch is not.
 */
export interface DrivelineInput {
  dt: number;
  iterations: number;

  /** Engine speed, rad/s. */
  engineOmega: number;
  /** kg·m² */
  engineInertia: number;
  /** Torque on the engine that is not friction (combustion, starter), N·m. */
  engineTorque: number;
  /** Engine friction torque capacity, N·m (>= 0). */
  engineFriction: number;

  /** Driven wheel speed, rad/s (positive = car moving forward). */
  wheelOmega: number;
  /** Everything on the wheel side, reduced to the wheels, kg·m². */
  wheelInertia: number;
  /** Torque on the wheels that is not friction (gravity on a slope, drag), N·m. */
  wheelTorque: number;
  /** Brake + rolling resistance torque capacity at the wheels, N·m (>= 0). */
  wheelFriction: number;

  /** Engine revs per wheel rev, signed; 0 = neutral. */
  ratio: number;
  /** Clutch torque capacity at the current pedal position, N·m (>= 0). */
  clutchCapacity: number;
  /** Fraction of clutch torque that reaches the wheels. */
  efficiency: number;
}

export interface DrivelineResult {
  engineOmega: number;
  wheelOmega: number;
  /** Mean torque through the clutch this step, N·m. Positive = engine drives the gearbox. */
  clutchTorque: number;
  /** Mean drive torque delivered to the wheels this step, N·m (signed). */
  driveTorque: number;
  /** Mean friction torque that acted on the engine, N·m (signed). */
  engineFrictionTorque: number;
  /** Mean friction torque that acted on the wheels, N·m (signed). */
  wheelFrictionTorque: number;
  /** Engine speed minus gearbox input speed after the step, rad/s. 0 in neutral. */
  clutchSlip: number;
}

/** Below these speeds a body counts as "at rest" for the static check, rad/s. */
const REST_ENGINE_OMEGA = 0.5;
const REST_WHEEL_OMEGA = 0.02;

/**
 * Everything is (almost) at rest and joined through the clutch: can friction
 * hold it there? This is the parked-in-gear / stalled-on-a-hill case, where
 * engine friction, clutch and wheel friction all stick at once. The iterative
 * solver converges slowly there (the car would creep), so it is solved exactly:
 * the car stays put if some clutch torque within capacity keeps both the
 * engine and the wheels inside their friction limits.
 */
function solveAtRest(p: DrivelineInput): DrivelineResult | null {
  const k = p.ratio * p.efficiency;
  let lo = Math.max(-p.clutchCapacity, p.engineTorque - p.engineFriction);
  let hi = Math.min(p.clutchCapacity, p.engineTorque + p.engineFriction);
  const a = (-p.wheelFriction - p.wheelTorque) / k;
  const b = (p.wheelFriction - p.wheelTorque) / k;
  lo = Math.max(lo, Math.min(a, b));
  hi = Math.min(hi, Math.max(a, b));
  if (lo > hi) return null;
  const clutchTorque = lo > 0 ? lo : hi < 0 ? hi : 0;
  return {
    engineOmega: 0,
    wheelOmega: 0,
    clutchTorque,
    driveTorque: clutchTorque * k,
    engineFrictionTorque: clutchTorque - p.engineTorque,
    wheelFrictionTorque: -(p.wheelTorque + clutchTorque * k),
    clutchSlip: 0,
  };
}

export function solveDriveline(p: DrivelineInput): DrivelineResult {
  const { dt, engineInertia: ie, wheelInertia: iw, ratio: g, efficiency: eta } = p;

  const coupled = g !== 0 && p.clutchCapacity > 0;

  if (
    coupled &&
    Math.abs(p.engineOmega) < REST_ENGINE_OMEGA &&
    Math.abs(p.wheelOmega) < REST_WHEEL_OMEGA
  ) {
    const rest = solveAtRest(p);
    if (rest) return rest;
  }

  // Free (non-friction) torques first.
  let we = p.engineOmega + (p.engineTorque / ie) * dt;
  let ww = p.wheelOmega + (p.wheelTorque / iw) * dt;

  const maxClutch = p.clutchCapacity * dt;
  const maxEngine = p.engineFriction * dt;
  const maxWheel = p.wheelFriction * dt;
  // Effective inverse inertia seen by the clutch constraint.
  const kClutch = 1 / ie + (g * g * eta) / iw;

  let accClutch = 0;
  let accEngine = 0;
  let accWheel = 0;

  for (let i = 0; i < p.iterations; i++) {
    if (coupled) {
      const slip = we - g * ww;
      const target = accClutch + slip / kClutch;
      const next = target > maxClutch ? maxClutch : target < -maxClutch ? -maxClutch : target;
      const d = next - accClutch;
      accClutch = next;
      we -= d / ie;
      ww += (d * g * eta) / iw;
    }
    if (maxEngine > 0) {
      const target = accEngine - we * ie;
      const next = target > maxEngine ? maxEngine : target < -maxEngine ? -maxEngine : target;
      we += (next - accEngine) / ie;
      accEngine = next;
    }
    if (maxWheel > 0) {
      const target = accWheel - ww * iw;
      const next = target > maxWheel ? maxWheel : target < -maxWheel ? -maxWheel : target;
      ww += (next - accWheel) / iw;
      accWheel = next;
    }
  }

  // The iteration ends on the friction rows, so a clutch that is meant to be
  // locked can be left with a hair of slip. Finish on the clutch row so a
  // locked clutch reports exactly matched speeds.
  if (coupled) {
    const slip = we - g * ww;
    const target = accClutch + slip / kClutch;
    const next = target > maxClutch ? maxClutch : target < -maxClutch ? -maxClutch : target;
    const d = next - accClutch;
    accClutch = next;
    we -= d / ie;
    ww += (d * g * eta) / iw;
  }

  // Friction that fully arrested a body leaves float dust; snap it to rest so
  // a held car is exactly stationary and does not creep.
  if (Math.abs(accWheel) < maxWheel && Math.abs(ww) < 1e-9) ww = 0;
  if (Math.abs(accEngine) < maxEngine && Math.abs(we) < 1e-9) we = 0;

  return {
    engineOmega: we,
    wheelOmega: ww,
    clutchTorque: accClutch / dt,
    driveTorque: (accClutch * g * eta) / dt,
    engineFrictionTorque: accEngine / dt,
    wheelFrictionTorque: accWheel / dt,
    clutchSlip: g === 0 ? 0 : we - g * ww,
  };
}

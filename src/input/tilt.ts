/**
 * Steering by turning the phone like a wheel. The phone's gravity reading
 * (device motion, "including gravity") is turned into screen coordinates,
 * and the angle of "down" on the screen is the steering. Pure maths.
 */

/** Gravity in screen coordinates (x to the right, y up the screen) from the device's reading. */
export function gravityOnScreen(gx: number, gy: number, screenAngleDeg: number): { x: number; y: number } {
  const a = (screenAngleDeg * Math.PI) / 180;
  return { x: gx * Math.cos(a) - gy * Math.sin(a), y: gx * Math.sin(a) + gy * Math.cos(a) };
}

/** How far the phone is turned clockwise in the plane of its screen, degrees. */
export function screenRoll(gx: number, gy: number, screenAngleDeg: number): number {
  const s = gravityOnScreen(gx, gy, screenAngleDeg);
  return (Math.atan2(-s.x, s.y) * 180) / Math.PI;
}

/**
 * Steering -1..1 from the phone's roll, relative to where it was held when
 * tilt steering was switched on, with `range` degrees for full lock.
 */
export function tiltSteer(rollDeg: number, centreDeg: number, rangeDeg: number, invert = false): number {
  let d = rollDeg - centreDeg;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  const v = Math.min(1, Math.max(-1, d / rangeDeg));
  // A small dead zone so a steady hand drives straight.
  const dz = 0.03;
  const out = Math.abs(v) < dz ? 0 : Math.sign(v) * ((Math.abs(v) - dz) / (1 - dz));
  return invert ? -out : out;
}

/**
 * An on-screen steering wheel you turn by dragging around its centre.
 * Pure logic (no DOM) so it can be tested.
 *
 * Like a real wheel it stays where you leave it when the car is standing
 * still, and straightens itself as the car rolls - faster the faster you go.
 */

/** Wheel rotation at full lock, rad (a bit over half a turn each way). */
export const WHEEL_LOCK = (200 * Math.PI) / 180;

/** Self-centring: steering units per second, per m/s of road speed. */
const CENTRE_PER_SPEED = 0.35;
const CENTRE_MAX = 3;

export class SteeringWheelModel {
  /** Wheel rotation, rad, positive = clockwise (steering right). */
  angle = 0;
  held = false;
  private lastPointerAngle = 0;

  /** Steering value, -1 (full left) .. +1 (full right). */
  get steer(): number {
    return this.angle / WHEEL_LOCK;
  }

  /** True while the wheel has anything to say (held, or resting off-centre). */
  get active(): boolean {
    return this.held || this.angle !== 0;
  }

  /**
   * Start a drag. `dx`, `dy` are the finger's offset from the wheel centre in
   * screen pixels (y down).
   */
  grab(dx: number, dy: number): void {
    this.held = true;
    this.lastPointerAngle = Math.atan2(dy, dx);
  }

  /** Continue a drag: the wheel turns by however far the finger has gone round. */
  drag(dx: number, dy: number): void {
    if (!this.held) return;
    // Too close to the hub the direction is meaningless; wait until the finger moves out.
    if (dx * dx + dy * dy < 64) return;
    const a = Math.atan2(dy, dx);
    let delta = a - this.lastPointerAngle;
    // Shortest way round, so crossing the ±180° seam does not spin the wheel back.
    if (delta > Math.PI) delta -= 2 * Math.PI;
    else if (delta < -Math.PI) delta += 2 * Math.PI;
    this.lastPointerAngle = a;
    this.angle = Math.max(-WHEEL_LOCK, Math.min(WHEEL_LOCK, this.angle + delta));
  }

  release(): void {
    this.held = false;
  }

  /** Let the wheel straighten itself. `speed` is the car's road speed, m/s. */
  update(dt: number, speed: number): void {
    if (this.held || this.angle === 0) return;
    const rate = Math.min(CENTRE_MAX, CENTRE_PER_SPEED * Math.abs(speed)) * WHEEL_LOCK;
    const step = rate * dt;
    if (Math.abs(this.angle) <= step) this.angle = 0;
    else this.angle -= Math.sign(this.angle) * step;
  }

  reset(): void {
    this.angle = 0;
    this.held = false;
  }
}

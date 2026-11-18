/**
 * Steering by turning the phone, read from its motion sensor. iPhones ask
 * permission first, which has to happen inside a tap (see `enable`).
 */
import { screenRoll, tiltSteer } from './tilt';

type PermissionFn = () => Promise<'granted' | 'denied'>;

export class TiltSteering {
  active = false;
  /** Steering -1..1 while active. */
  steer = 0;
  range = 35;
  private centre = 0;
  private roll = 0;
  private flip = 1;
  private haveReading = false;
  private recentre = false;
  private readonly listener = (e: DeviceMotionEvent) => this.onMotion(e);

  static get supported(): boolean {
    return typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
  }

  /** Switch on (call from a tap or click). Resolves false if the sensor is refused or missing. */
  async enable(): Promise<boolean> {
    if (!TiltSteering.supported) return false;
    const ask = (DeviceMotionEvent as unknown as { requestPermission?: PermissionFn }).requestPermission;
    if (ask) {
      try {
        if ((await ask()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    if (!this.active) window.addEventListener('devicemotion', this.listener);
    this.active = true;
    this.recentre = true;
    return true;
  }

  disable(): void {
    window.removeEventListener('devicemotion', this.listener);
    this.active = false;
    this.steer = 0;
    this.haveReading = false;
  }

  /** Make the way the phone is held now "straight ahead". */
  calibrate(): void {
    this.recentre = true;
  }

  /** Whether the sensor has sent anything yet (desktops have the API but no sensor). */
  get reading(): boolean {
    return this.haveReading;
  }

  private onMotion(e: DeviceMotionEvent): void {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x === null || g.y === null) return;
    const angle = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
    if (this.recentre) {
      // Some phones report gravity the other way round: whichever way "up" reads
      // when the player holds the phone to drive is taken as up.
      const a = (angle * Math.PI) / 180;
      const up = g.x * Math.sin(a) + g.y * Math.cos(a);
      this.flip = up < 0 ? -1 : 1;
    }
    this.roll = screenRoll(g.x * this.flip, g.y * this.flip, angle);
    if (this.recentre) {
      this.centre = this.roll;
      this.recentre = false;
    }
    this.haveReading = true;
    this.steer = tiltSteer(this.roll, this.centre, this.range);
  }
}

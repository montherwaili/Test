/**
 * Plays a recorded drive back through the game's own renderer: the car,
 * traffic, pedestrians and signals as they were, with the replay controls on
 * top. The simulation itself is paused meanwhile.
 */
import type { CameraMode, CarView, GameRenderer, LooseView } from '../render/gameRenderer';
import { ReplayClock } from '../replay/clock';
import { LIGHT, LOOSE_STRIDE, PEDESTRIAN_STRIDE, TRAFFIC_STRIDE, type Frame, type Recording } from '../replay/recording';
import type { Pedestrian } from '../traffic/pedestrians';
import type { TrafficCar } from '../traffic/vehicles';
import type { StringKey } from '../ui/i18n';
import { ReplayView, type ReplayMarker } from '../ui/replay';

const CAMERAS: [CameraMode, StringKey][] = [
  ['chase', 'camChase'],
  ['driver', 'camDriver'],
  ['top', 'camTop'],
  ['free', 'camFree'],
];
/** Replays open this long before the moment asked for, s. */
export const LEAD_IN = 3;

export class ReplayPlayer {
  active = false;
  clock: ReplayClock | null = null;
  private viewUi: ReplayView | null = null;
  private frame: Frame | undefined;
  private camera = 0;
  private gameCamera: CameraMode = 'chase';
  /** Stand-ins the traffic meshes draw from. */
  readonly cars: TrafficCar[];
  readonly people: Pedestrian[];
  private readonly carView: CarView = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    wheels: [0, 1, 2, 3].map(() => ({ x: 0, y: 0, z: 0, steer: 0, spin: 0 })),
    steer: 0,
    lights: { brake: false, reverse: false, left: false, right: false, head: false },
    lookYaw: 0,
  };
  private readonly loose: LooseView[];

  constructor(
    private readonly app: HTMLElement,
    readonly recording: Recording,
    private readonly renderer: GameRenderer,
    /** Where each wheel sits across and along the car (fixed), for drawing. */
    private readonly wheelXZ: { x: number; z: number }[],
    liveCars: readonly TrafficCar[],
    livePeople: readonly Pedestrian[],
    private readonly onClose: () => void,
  ) {
    this.cars = liveCars.map((c) => ({ ...c }));
    this.people = livePeople.map((p) => ({ ...p }));
    this.loose = Array.from({ length: recording.layout.loose }, () => ({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } }));
  }

  open(markers: ReplayMarker[], at?: number): void {
    const r = this.recording;
    if (r.frameCount < 2) return;
    this.viewUi ??= new ReplayView(this.app, r, markers, {
      onClose: () => this.close(),
      onCamera: () => this.nextCamera(),
      onOrbit: (dx, dy) => {
        const o = this.renderer.orbit;
        o.yaw -= dx * 0.008;
        o.pitch = Math.min(1.45, Math.max(0.08, o.pitch + dy * 0.006));
      },
      onZoom: (f) => {
        const o = this.renderer.orbit;
        o.distance = Math.min(80, Math.max(4, o.distance * f));
      },
    });
    this.clock = new ReplayClock(r.start, r.end);
    this.clock.seek(at === undefined ? r.start : at - LEAD_IN);
    this.clock.playing = true;
    this.gameCamera = this.renderer.mode;
    this.camera = 0;
    this.renderer.mode = CAMERAS[0]![0];
    this.renderer.snapCamera();
    this.active = true;
    this.app.classList.add('replaying');
    this.viewUi.show(this.clock, CAMERAS[0]![1]);
  }

  close(): void {
    if (!this.active) return;
    this.active = false;
    this.app.classList.remove('replaying');
    this.viewUi?.hide();
    this.renderer.mode = this.gameCamera;
    this.renderer.snapCamera();
    this.onClose();
  }

  /** Space bar: play / pause. */
  togglePlay(): void {
    this.clock?.toggle();
  }

  nextCamera(): StringKey {
    this.camera = (this.camera + 1) % CAMERAS.length;
    const [mode, key] = CAMERAS[this.camera]!;
    this.renderer.mode = mode;
    this.renderer.snapCamera();
    return key;
  }

  /** Advance the replay and say what to draw. */
  tick(elapsed: number): { view: CarView; loose: LooseView[]; signalTime: number } {
    const c = this.clock!;
    c.tick(elapsed);
    const f = (this.frame = this.recording.sample(c.time, this.frame));
    const car = f.car;
    const v = this.carView;
    v.position.x = car.x;
    v.position.y = car.y;
    v.position.z = car.z;
    v.rotation.x = car.qx;
    v.rotation.y = car.qy;
    v.rotation.z = car.qz;
    v.rotation.w = car.qw;
    const wheel = [
      [car.w0y, car.w0steer, car.w0spin],
      [car.w1y, car.w1steer, car.w1spin],
      [car.w2y, car.w2steer, car.w2spin],
      [car.w3y, car.w3steer, car.w3spin],
    ] as const;
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i]!;
      w.x = this.wheelXZ[i]!.x;
      w.z = this.wheelXZ[i]!.z;
      w.y = wheel[i]![0];
      w.steer = wheel[i]![1];
      w.spin = wheel[i]![2];
    }
    v.steer = car.steer;
    v.lookYaw = car.lookYaw;
    const lights = car.lights;
    v.lights.brake = (lights & LIGHT.brake) !== 0;
    v.lights.reverse = (lights & LIGHT.reverse) !== 0;
    v.lights.left = (lights & LIGHT.left) !== 0;
    v.lights.right = (lights & LIGHT.right) !== 0;
    v.lights.head = (lights & LIGHT.head) !== 0;

    for (let i = 0; i < this.cars.length; i++) {
      const p = i * TRAFFIC_STRIDE;
      const t = this.cars[i]!;
      t.x = f.traffic[p]!;
      t.y = f.traffic[p + 1]!;
      t.z = f.traffic[p + 2]!;
      t.headingDeg = f.traffic[p + 3]!;
      t.pitch = f.traffic[p + 4]!;
      const flags = f.traffic[p + 5]!;
      t.braking = (flags & 1) !== 0;
      t.speed = t.braking ? 0 : 1;
      t.indicator = flags & 2 ? 'left' : flags & 4 ? 'right' : 'off';
    }
    for (let i = 0; i < this.people.length; i++) {
      const p = i * PEDESTRIAN_STRIDE;
      const q = this.people[i]!;
      q.x = f.pedestrians[p]!;
      q.z = f.pedestrians[p + 1]!;
      q.headingDeg = f.pedestrians[p + 2]!;
      q.walked = f.pedestrians[p + 3]!;
      const s = f.pedestrians[p + 4]!;
      q.state = s === 2 ? 'crossing' : s === 1 ? 'waiting' : 'idle';
    }
    for (let i = 0; i < this.loose.length; i++) {
      const p = i * LOOSE_STRIDE;
      const l = this.loose[i]!;
      l.position.x = f.loose[p]!;
      l.position.y = f.loose[p + 1]!;
      l.position.z = f.loose[p + 2]!;
      l.rotation.x = f.loose[p + 3]!;
      l.rotation.y = f.loose[p + 4]!;
      l.rotation.z = f.loose[p + 5]!;
      l.rotation.w = f.loose[p + 6]!;
    }
    this.viewUi!.update(c);
    return { view: v, loose: this.loose, signalTime: car.signalTime };
  }
}

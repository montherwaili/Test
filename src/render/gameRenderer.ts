/**
 * Draws the world: map, car, three camera views, and (from the driver's seat)
 * working mirrors. Reads simulation state; never writes it.
 */
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SpotLight,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import type { VehicleTuning } from '../sim/tuning';
import type { Quat, Vec3 } from '../sim/vehicle';
import type { BuiltMap } from '../world/map';
import type { SignalState } from '../world/roads/signals';
import { DRIVER_EYE, createCarModel, type CarLights, type CarModel } from './carModel';
import { buildMapMeshes, type MapMeshes } from './mapMeshes';
import { DAY_SKY, NIGHT_SKY as NIGHT_SKY_COLORS, SkyDome } from './sky';
import { nightUniform } from './surfaceDetail';
import { TrafficMeshes } from './trafficMeshes';
import type { Pedestrian } from '../traffic/pedestrians';
import type { TrafficCar } from '../traffic/vehicles';

/** 'free' orbits the car under the viewer's control (replays only). */
export type CameraMode = 'chase' | 'driver' | 'top' | 'free';
export const CAMERA_MODES: CameraMode[] = ['chase', 'driver', 'top'];

export interface RenderQuality {
  /** Upper limit on device pixel ratio. */
  pixelRatio: number;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  /** Mirror pictures refreshed per frame (0 = mirrors off, 3 = all every frame). */
  mirrorsPerFrame: number;
  mirrorHeight: number;
  /** How far the view reaches at most, m (fog closes in before it). */
  viewDistance: number;
}

export const QUALITY_PRESETS: Record<'low' | 'medium' | 'high', RenderQuality> = {
  low: { pixelRatio: 1, antialias: false, shadows: false, shadowMapSize: 0, mirrorsPerFrame: 1, mirrorHeight: 64, viewDistance: 650 },
  medium: { pixelRatio: 1.5, antialias: true, shadows: true, shadowMapSize: 1024, mirrorsPerFrame: 1, mirrorHeight: 96, viewDistance: 1000 },
  high: { pixelRatio: 2, antialias: true, shadows: true, shadowMapSize: 2048, mirrorsPerFrame: 3, mirrorHeight: 160, viewDistance: 1600 },
};

/** Everything the renderer needs to know about the car this frame. */
export interface CarView {
  position: Vec3;
  rotation: Quat;
  wheels: { x: number; y: number; z: number; steer: number; spin: number }[];
  /** Steering wheel, -1..1. */
  steer: number;
  lights: CarLights;
  /** Where the driver is looking, rad, positive = right (mirror glances). */
  lookYaw: number;
}

export interface LooseView {
  position: Vec3;
  rotation: Quat;
}

const HAZE = DAY_SKY.horizon;
const NIGHT_HAZE = NIGHT_SKY_COLORS.horizon;
/** Where the sun is, relative to what it lights: high, from the south-east. */
const SUN_OFFSET = new Vector3(50, 90, 35);
/** Steering wheel turns per unit of steering input, rad (about 1.4 turns each way). */
const STEERING_WHEEL_LOCK = Math.PI * 2.8;

interface MirrorView {
  camera: PerspectiveCamera;
  target: WebGLRenderTarget;
}

export class GameRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(55, 1, 0.1, 900);
  private readonly skyDome: SkyDome;
  mode: CameraMode = 'chase';
  /** Free camera: angle round the car (rad), height angle (rad) and distance (m). */
  readonly orbit = { yaw: 0.6, pitch: 0.45, distance: 14 };

  private readonly car: CarModel;
  private readonly map: MapMeshes;
  private readonly sun: DirectionalLight;
  private readonly sky: HemisphereLight;
  private readonly headlamps: SpotLight[] = [];
  private night = false;
  /** Camera shake, metres; it dies away by itself. */
  private shakeLevel = 0;
  private traffic: TrafficMeshes | null = null;
  private readonly mirrors: MirrorView[] = [];
  private mirrorCursor = 0;
  private chaseYaw = 0;
  private chaseReady = false;
  private lookYaw = 0;
  private readonly quality: RenderQuality;

  // Scratch objects (no per-frame allocation).
  private readonly carPos = new Vector3();
  private readonly carQuat = new Quaternion();
  private readonly forward = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmpQuat = new Quaternion();

  constructor(canvas: HTMLCanvasElement, builtMap: BuiltMap, tuning: VehicleTuning, quality: RenderQuality) {
    this.quality = quality;
    this.renderer = new WebGLRenderer({ canvas, antialias: quality.antialias, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = PCFShadowMap;
    // Film-like response to light: bright sun without white-out, rich shade.
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // How far you can see grows with the map: the city's highway runs out into the desert.
    const size = builtMap.def.groundSize;
    const fogEnd = Math.min(Math.max(520, size * 0.46), quality.viewDistance);
    this.camera.far = fogEnd * 1.15;
    this.scene.background = new Color(HAZE);
    this.scene.fog = new Fog(HAZE, Math.max(140, fogEnd * 0.22), fogEnd);
    this.skyDome = new SkyDome(fogEnd);
    this.skyDome.setSunDirection(SUN_OFFSET);
    this.scene.add(this.skyDome.mesh);

    this.sky = new HemisphereLight(0xcfe4ff, 0xcdb58a, 1.35);
    this.scene.add(this.sky);
    this.sun = new DirectionalLight(0xfff1d8, 2.9);
    this.sun.castShadow = quality.shadows;
    if (quality.shadows) {
      this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      const c = this.sun.shadow.camera;
      c.left = -32;
      c.right = 32;
      c.top = 32;
      c.bottom = -32;
      c.near = 1;
      c.far = 220;
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.03;
    }
    this.scene.add(this.sun, this.sun.target);

    this.map = buildMapMeshes(builtMap);
    this.scene.add(this.map.root);

    this.car = createCarModel(tuning);
    this.scene.add(this.car.root);

    // Headlamp beams, switched on with the car's lights at night.
    const toFront = tuning.chassis.wheelbase * (1 - tuning.chassis.frontWeightFraction) + tuning.chassis.frontOverhang;
    for (const side of [-1, 1]) {
      const lamp = new SpotLight(0xfff2d0, 0, 70, 0.5, 0.5, 1.2);
      lamp.position.set(side * 0.55, 0.15, -toFront);
      const aim = new Object3D();
      aim.position.set(side * 0.8, -0.9, -toFront - 25);
      this.car.root.add(lamp, aim);
      lamp.target = aim;
      this.headlamps.push(lamp);
    }

    if (quality.mirrorsPerFrame > 0) {
      const w = tuning.chassis.bodyWidth;
      const doorY = this.car.mirrors.left.position.y;
      const doorZ = this.car.mirrors.left.position.z;
      const make = (x: number, y: number, z: number, yaw: number, fov: number, aspect: number): MirrorView => {
        const camera = new PerspectiveCamera(fov, aspect, 0.3, 400);
        camera.position.set(x, y, z);
        camera.rotation.y = yaw; // π = straight back
        this.car.root.add(camera);
        const h = quality.mirrorHeight;
        const target = new WebGLRenderTarget(Math.round(h * aspect), h);
        return { camera, target };
      };
      const outward = 0.1;
      this.mirrors.push(
        make(-(w / 2 + 0.12), doorY, doorZ + 0.1, Math.PI - outward, 17, 1.7),
        make(0, this.car.mirrors.centre.position.y, tuning.chassis.wheelbase * 0.35, Math.PI, 12, 3.4),
        make(w / 2 + 0.12, doorY, doorZ + 0.1, Math.PI + outward, 17, 1.7),
      );
      this.car.setMirrorTextures(this.mirrors[0]!.target.texture, this.mirrors[1]!.target.texture, this.mirrors[2]!.target.texture);
    }

    this.resize();
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Draw at a fraction of the preset's resolution (the frame-rate governor's lever). */
  setResolutionScale(scale: number): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio) * scale);
    this.resize();
  }

  /** Pixels drawn per CSS pixel right now. */
  get pixelRatio(): number {
    return this.renderer.getPixelRatio();
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Create the meshes for traffic cars and pedestrians (once, after the traffic exists). */
  addTraffic(cars: readonly TrafficCar[], people: readonly Pedestrian[]): void {
    this.traffic = new TrafficMeshes(cars, people);
    this.scene.add(this.traffic.root);
  }

  /** Move traffic meshes to match the traffic logic. */
  updateTraffic(cars: readonly TrafficCar[], people: readonly Pedestrian[], time: number): void {
    this.traffic?.update(cars, people, time);
  }

  /** Jolt the camera (a collision, a speed bump). */
  shake(amount: number): void {
    this.shakeLevel = Math.max(this.shakeLevel, amount);
  }

  /** Switch between day and night lighting. */
  setNight(night: boolean): void {
    this.night = night;
    (this.scene.background as Color).set(night ? NIGHT_HAZE : HAZE);
    (this.scene.fog as Fog).color.set(night ? NIGHT_HAZE : HAZE);
    this.skyDome.setColors(night ? NIGHT_SKY_COLORS : DAY_SKY, night);
    nightUniform.value = night ? 1 : 0;
    this.sky.intensity = night ? 0.22 : 1.35;
    // The same light plays the sun by day and the moon by night.
    this.sun.intensity = night ? 0.25 : 2.9;
    this.sun.color.set(night ? 0x9fb4ff : 0xfff1d8);
    this.map.setNight(night);
  }

  get isNight(): boolean {
    return this.night;
  }

  /** Light the traffic signal lamps. */
  setSignals(stateOf: (junction: string, group: string) => SignalState): void {
    this.map.setSignals(stateOf);
  }

  /** What the last frame cost, for the performance report. */
  get drawStats(): { calls: number; triangles: number; meshes: number } {
    const r = this.renderer.info.render;
    return { calls: r.calls, triangles: r.triangles, meshes: this.map.stats.meshes };
  }

  /** Next frame, put the chase camera straight behind the car (after a reset). */
  snapCamera(): void {
    this.chaseReady = false;
  }

  render(view: CarView, loose: LooseView[], dt: number): void {
    const { car } = this;
    this.carPos.set(view.position.x, view.position.y, view.position.z);
    this.carQuat.set(view.rotation.x, view.rotation.y, view.rotation.z, view.rotation.w);
    car.root.position.copy(this.carPos);
    car.root.quaternion.copy(this.carQuat);

    for (let i = 0; i < 4; i++) {
      const w = view.wheels[i]!;
      const g = car.wheels[i]!;
      g.steer.position.set(w.x, w.y, w.z);
      g.steer.rotation.y = -w.steer;
      g.spin.rotation.x = -w.spin;
    }
    car.steeringWheel.rotation.z = -view.steer * STEERING_WHEEL_LOCK;
    car.setLights(view.lights);
    const beam = view.lights.head ? (this.night ? 60 : 4) : 0;
    for (const lamp of this.headlamps) lamp.intensity = beam;

    for (let i = 0; i < loose.length; i++) {
      const m = this.map.cones[i];
      const l = loose[i]!;
      if (!m) continue;
      m.position.set(l.position.x, l.position.y, l.position.z);
      m.quaternion.set(l.rotation.x, l.rotation.y, l.rotation.z, l.rotation.w);
    }

    // The sun's shadow box follows the car.
    this.sun.position.copy(this.carPos).add(SUN_OFFSET);
    this.sun.target.position.copy(this.carPos);

    this.forward.set(0, 0, -1).applyQuaternion(this.carQuat);
    const yaw = Math.atan2(this.forward.x, -this.forward.z);
    const driver = this.mode === 'driver';
    car.cabin.visible = !driver;
    car.interior.visible = driver;

    if (driver && this.mirrors.length > 0) this.renderMirrors();

    const cam = this.camera;
    if (this.mode === 'chase') {
      if (!this.chaseReady) {
        this.chaseYaw = yaw;
        this.chaseReady = true;
      }
      // Swing behind the car with a little lag.
      let diff = yaw - this.chaseYaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.chaseYaw += diff * Math.min(1, dt * 5);
      const sx = Math.sin(this.chaseYaw);
      const cz = -Math.cos(this.chaseYaw);
      cam.fov = 55;
      cam.near = 0.5;
      cam.position.set(this.carPos.x - sx * 6.6, this.carPos.y + 2.5, this.carPos.z - cz * 6.6);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.carPos.x + sx * 3, this.carPos.y + 0.7, this.carPos.z + cz * 3);
    } else if (this.mode === 'free') {
      cam.fov = 55;
      cam.near = 0.3;
      const o = this.orbit;
      const flat = Math.cos(o.pitch) * o.distance;
      cam.position.set(
        this.carPos.x + Math.sin(o.yaw) * flat,
        this.carPos.y + Math.sin(o.pitch) * o.distance,
        this.carPos.z + Math.cos(o.yaw) * flat,
      );
      cam.up.set(0, 1, 0);
      cam.lookAt(this.carPos.x, this.carPos.y + 0.5, this.carPos.z);
      this.chaseReady = false;
    } else if (this.mode === 'top') {
      cam.fov = 40;
      cam.near = 2;
      cam.position.set(this.carPos.x, this.carPos.y + 44, this.carPos.z);
      // Heading-up: the car always points up the screen.
      cam.up.set(Math.sin(yaw), 0, -Math.cos(yaw));
      cam.lookAt(this.carPos);
      this.chaseReady = false;
    } else {
      cam.fov = 74;
      cam.near = 0.12;
      this.lookYaw += (view.lookYaw - this.lookYaw) * Math.min(1, dt * 10);
      this.tmp.set(DRIVER_EYE.x, DRIVER_EYE.y, DRIVER_EYE.z).applyQuaternion(this.carQuat);
      cam.position.copy(this.carPos).add(this.tmp);
      this.tmpQuat.setFromAxisAngle(this.tmp.set(0, 1, 0), -this.lookYaw);
      cam.quaternion.copy(this.carQuat).multiply(this.tmpQuat);
      this.chaseReady = false;
    }
    if (this.shakeLevel > 0.002) {
      const k = this.shakeLevel;
      cam.position.x += (Math.random() - 0.5) * k;
      cam.position.y += (Math.random() - 0.5) * k;
      cam.position.z += (Math.random() - 0.5) * k;
      this.shakeLevel *= Math.exp(-dt * 9);
    } else {
      this.shakeLevel = 0;
    }
    cam.updateProjectionMatrix();
    this.skyDome.follow(cam.position);

    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, cam);
  }

  private renderMirrors(): void {
    const { car } = this;
    // A mirror must not see itself or the dashboard.
    car.interior.visible = false;
    car.mirrors.left.visible = false;
    car.mirrors.right.visible = false;
    const n = Math.min(this.quality.mirrorsPerFrame, this.mirrors.length);
    for (let i = 0; i < n; i++) {
      const m = this.mirrors[this.mirrorCursor]!;
      this.mirrorCursor = (this.mirrorCursor + 1) % this.mirrors.length;
      this.renderer.setRenderTarget(m.target);
      this.renderer.render(this.scene, m.camera);
    }
    car.interior.visible = true;
    car.mirrors.left.visible = true;
    car.mirrors.right.visible = true;
  }

  dispose(): void {
    for (const m of this.mirrors) m.target.dispose();
    this.renderer.dispose();
  }
}

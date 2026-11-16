/**
 * Free drive: one car on the test track. This is the composition root - it
 * builds the physics world, the vehicle, the renderer, input and HUD, and
 * runs the fixed-step loop that ties them together.
 */
import testTrack from '../data/maps/testTrack.json';
import { InputFilter } from '../input/inputFilter';
import { Keyboard, type Action } from '../input/keyboard';
import { TouchControls } from '../input/touch';
import {
  CAMERA_MODES,
  GameRenderer,
  QUALITY_PRESETS,
  type CarView,
  type LooseView,
  type RenderQuality,
} from '../render/gameRenderer';
import { Ancillaries } from '../sim/ancillaries';
import { FixedStepper } from '../sim/fixedStep';
import { GEAR_NEUTRAL, GEAR_REVERSE, gearLabel } from '../sim/gearbox';
import { neutralControls } from '../sim/longitudinalCar';
import { createDefaultTuning } from '../sim/tuning';
import { Vehicle, type DriveControls, type Quat, type Vec3, type VehicleEvent } from '../sim/vehicle';
import { Hud } from '../ui/hud';
import type { StringKey } from '../ui/i18n';
import { buildMap, surfaceHeight, type MapDef } from '../world/map';
import { PhysicsWorld, initPhysics } from '../world/physics';
import type { RoadNetwork } from '../world/roads/network';
import { signalState } from '../world/roads/signals';
import { buildTown } from '../world/town';

const CAMERA_NAMES: Record<(typeof CAMERA_MODES)[number], StringKey> = {
  chase: 'camChase',
  driver: 'camDriver',
  top: 'camTop',
};

/** Where the driver's head turns for each mirror, rad (left-hand drive). */
const LOOK_YAW = { left: -0.85, centre: 0.42, right: 1.0 };

/** A tap on Start cranks for at most this long, s. */
const STARTER_ASSIST = 1.5;

function pickQuality(): RenderQuality {
  const asked = new URLSearchParams(location.search).get('q');
  if (asked === 'low' || asked === 'medium' || asked === 'high') return QUALITY_PRESETS[asked];
  const phone = matchMedia('(pointer: coarse)').matches;
  // Phones get the cheap settings but a slightly sharper picture than 1:1.
  if (phone) return { ...QUALITY_PRESETS.low, pixelRatio: 1.5 };
  return (navigator.hardwareConcurrency ?? 4) >= 8 ? QUALITY_PRESETS.high : QUALITY_PRESETS.medium;
}

function lerpPose(a: Vec3, b: Vec3, t: number, out: Vec3): void {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
}

function nlerp(a: Quat, b: Quat, t: number, out: Quat): void {
  // Take the short way round, then normalise: fine for the tiny per-step rotations here.
  const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  const s = dot < 0 ? -1 : 1;
  const x = a.x + (b.x * s - a.x) * t;
  const y = a.y + (b.y * s - a.y) * t;
  const z = a.z + (b.z * s - a.z) * t;
  const w = a.w + (b.w * s - a.w) * t;
  const n = Math.hypot(x, y, z, w) || 1;
  out.x = x / n;
  out.y = y / n;
  out.z = z / n;
  out.w = w / n;
}

export interface FreeDrive {
  vehicle: Vehicle;
  controls: DriveControls;
  ancillaries: Ancillaries;
  renderer: GameRenderer;
  /** Frames drawn and simulation steps run so far. */
  stats: { frames: number; steps: number; fps: number };
  network: RoadNetwork | null;
  teleport: (x: number, z: number, heading: number) => void;
}

export async function startFreeDrive(app: HTMLElement, canvas: HTMLCanvasElement): Promise<FreeDrive> {
  await initPhysics();

  const tuning = createDefaultTuning();
  const physics = new PhysicsWorld(tuning.sim.stepHz, tuning.body.gravity);
  // The town by default; ?map=track gives the bare test track from phase 2.
  const wantTrack = new URLSearchParams(location.search).get('map') === 'track';
  const map = wantTrack ? buildMap(testTrack as MapDef, physics) : buildTown(physics);
  const network = map.network;
  const surfaceHeightAt = (x: number, z: number) => surfaceHeight(map, x, z);
  const car = physics.createCar(tuning, map.spawn.position, map.spawn.heading);
  const vehicle = new Vehicle(tuning, car.port, physics.ground);
  const ancillaries = new Ancillaries();
  const stepper = new FixedStepper(tuning.sim.stepHz, tuning.sim.maxSubSteps);
  const filter = new InputFilter();

  const controls: DriveControls = { ...neutralControls(), steer: 0, handbrake: 1 };
  let starterAssistUntil = -1;
  let cameraIndex = 0;

  const renderer = new GameRenderer(canvas, map, tuning, pickQuality());

  const hud = new Hud(app, {
    onCamera: () => handle({ type: 'camera' }),
    onReset: () => handle({ type: 'reset' }),
    onNight: () => handle({ type: 'night' }),
  });

  // Poses either side of "now", for smooth drawing between fixed steps.
  const prevPos: Vec3 = { ...car.body.translation() };
  const currPos: Vec3 = { ...prevPos };
  const prevRot: Quat = { ...car.body.rotation() };
  const currRot: Quat = { ...prevRot };

  function reset(): void {
    car.place(map.spawn.position, map.spawn.heading);
    vehicle.resetSolver();
    filter.reset();
    touch.reset();
    controls.gear = GEAR_NEUTRAL;
    controls.handbrake = 1;
    vehicle.powertrain.state.gear = GEAR_NEUTRAL;
    Object.assign(prevPos, car.body.translation());
    Object.assign(currPos, prevPos);
    Object.assign(prevRot, car.body.rotation());
    Object.assign(currRot, prevRot);
    renderer.snapCamera();
    hud.say('msgReset', 2);
  }

  function handle(a: Action): void {
    const top = tuning.gearbox.forward.length;
    switch (a.type) {
      case 'gearUp':
        controls.gear = Math.min(top, controls.gear + 1);
        break;
      case 'gearDown':
        // Down stops at neutral: reverse has to be chosen on purpose.
        controls.gear = Math.max(GEAR_NEUTRAL, controls.gear - 1);
        break;
      case 'gear':
        controls.gear = a.gear;
        break;
      case 'handbrake':
        controls.handbrake = controls.handbrake > 0 ? 0 : 1;
        break;
      case 'ignition':
        controls.ignition = !controls.ignition;
        break;
      case 'starterTap':
        controls.ignition = true;
        starterAssistUntil = vehicle.time + STARTER_ASSIST;
        break;
      case 'indicator':
        ancillaries.toggleIndicator(a.mode);
        break;
      case 'lights':
        ancillaries.cycleHeadlights();
        break;
      case 'seatbelt':
        ancillaries.toggleSeatbelt();
        break;
      case 'mirror':
        ancillaries.glance(a.mirror);
        break;
      case 'camera':
        cameraIndex = (cameraIndex + 1) % CAMERA_MODES.length;
        renderer.mode = CAMERA_MODES[cameraIndex]!;
        renderer.snapCamera();
        break;
      case 'reset':
        reset();
        break;
      case 'help':
        hud.toggleHelp();
        break;
      case 'night':
        renderer.setNight(!renderer.isNight);
        break;
    }
  }

  const keyboard = new Keyboard(window, handle);
  const touch = new TouchControls(app, tuning.clutch, handle);

  // Show the full-size touch controls on touch devices, or as soon as a finger lands.
  const enableTouch = () => document.body.classList.add('touch');
  if (matchMedia('(pointer: coarse)').matches) enableTouch();
  window.addEventListener('touchstart', enableTouch, { once: true, passive: true });

  function report(e: VehicleEvent): void {
    if (e.type === 'stall') hud.say('msgStalled', 6);
    else if (e.type === 'gearGrind') hud.say(e.reason === 'clutch' ? 'msgGrindClutch' : 'msgGrindReverse');
    else if (e.type === 'overRev') hud.say('msgOverRev');
  }

  const stats = { frames: 0, steps: 0, fps: 60 };

  // Where the car is on the road network (looked up a few times a second, not every frame).
  let speedLimit: number | null = null;
  let locateIn = 0;
  const here = { x: 0, z: 0 };
  const signalNow = (junction: string, group: string) => {
    const plan = network?.signals.get(junction);
    return plan ? signalState(plan, group, vehicle.time) : 'red';
  };

  function simStep(dt: number): void {
    const roadSpeed = Math.abs(vehicle.telemetry.wheelSpeed);
    touch.tick(dt, roadSpeed);
    if (keyboard.held.clutch) touch.releaseClutch();
    filter.update(dt, keyboard.held, touch.state.analog, roadSpeed, tuning.clutch);
    controls.throttle = filter.throttle;
    controls.brake = filter.brake;
    controls.clutch = filter.clutch;
    controls.steer = filter.steer;
    const running = vehicle.powertrain.state.running;
    controls.starter =
      keyboard.held.starter || touch.state.starter || (!running && vehicle.time < starterAssistUntil);
    ancillaries.setHorn(keyboard.held.horn || touch.state.horn);

    Object.assign(prevPos, currPos);
    Object.assign(prevRot, currRot);
    for (const e of vehicle.step(dt, controls)) report(e);
    physics.step();
    ancillaries.step(dt, controls.steer);
    Object.assign(currPos, car.body.translation());
    Object.assign(currRot, car.body.rotation());
    stats.steps++;

    if (currPos.y < -30) reset(); // drove off the edge of the world
  }

  const view: CarView = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    wheels: [0, 1, 2, 3].map(() => ({ x: 0, y: 0, z: 0, steer: 0, spin: 0 })),
    steer: 0,
    lights: { brake: false, reverse: false, left: false, right: false, head: false },
    lookYaw: 0,
  };
  const loose: LooseView[] = map.cones.map(() => ({
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  }));
  const scratch: Vec3 = { x: 0, y: 0, z: 0 };

  let last = performance.now();
  function frame(now: number): void {
    const elapsed = Math.min((now - last) / 1000, 0.25);
    last = now;
    if (elapsed > 0) stats.fps += (1 / elapsed - stats.fps) * 0.05;
    if (!hud.helpOpen) stepper.advance(elapsed, simStep);

    const alpha = stepper.alpha;
    lerpPose(prevPos, currPos, alpha, view.position);
    nlerp(prevRot, currRot, alpha, view.rotation);
    for (let i = 0; i < 4; i++) {
      const w = vehicle.wheels[i]!;
      const p = vehicle.wheelLocalPosition(i, scratch);
      const out = view.wheels[i]!;
      out.x = p.x;
      out.y = p.y;
      out.z = p.z;
      out.steer = w.steerAngle;
      out.spin = w.spinAngle;
    }
    view.steer = controls.steer;
    const lamps = ancillaries.lamps;
    const gear = vehicle.powertrain.state.gear;
    view.lights.brake = controls.brake > 0.02;
    view.lights.reverse = gear === GEAR_REVERSE && controls.ignition;
    view.lights.left = lamps.left;
    view.lights.right = lamps.right;
    view.lights.head = ancillaries.state.headlights !== 'off';
    view.lookYaw = keyboard.held.look ? LOOK_YAW[keyboard.held.look] : 0;
    for (let i = 0; i < loose.length; i++) {
      const b = map.cones[i]!.body;
      Object.assign(loose[i]!.position, b.translation());
      Object.assign(loose[i]!.rotation, b.rotation());
    }
    if (network) {
      renderer.setSignals(signalNow);
      locateIn -= elapsed;
      if (locateIn <= 0) {
        locateIn = 0.2;
        here.x = currPos.x;
        here.z = currPos.z;
        const at = network.locate(here, (vehicle.telemetry.heading * 180) / Math.PI, 4);
        speedLimit = at ? at.lane.speedLimit : null;
      }
    }
    renderer.render(view, loose, elapsed);

    const tm = vehicle.telemetry;
    hud.update({
      speedKmh: tm.wheelSpeed * 3.6,
      rpm: tm.rpm,
      redlineRpm: tuning.engine.redlineRpm,
      gear: gearLabel(gear),
      gearPending: controls.gear !== gear,
      engineRunning: tm.running,
      ignition: controls.ignition,
      handbrake: controls.handbrake > 0,
      seatbelt: ancillaries.state.seatbelt,
      headlights: ancillaries.state.headlights,
      lampLeft: lamps.left,
      lampRight: lamps.right,
      camera: CAMERA_NAMES[renderer.mode],
      speedLimit,
    });
    touch.update({
      throttle: controls.throttle,
      brake: controls.brake,
      clutch: controls.clutch,
      steer: controls.steer,
      lever: controls.gear,
      handbrake: controls.handbrake > 0,
      seatbelt: ancillaries.state.seatbelt,
      indicator: ancillaries.state.indicator,
      lampLeft: lamps.left,
      lampRight: lamps.right,
    });

    stats.frames++;
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => renderer.resize());
  // Driving keys (Space, Enter) must not re-press whichever button was clicked last.
  app.addEventListener('click', (e) => (e.target as HTMLElement | null)?.closest('button')?.blur());
  // Let the car settle on its springs before the first picture.
  for (let i = 0; i < tuning.sim.stepHz; i++) simStep(stepper.dt);
  hud.say('msgStartHint', 8);
  requestAnimationFrame(frame);

  /** Put the car somewhere, at rest (used by automated page checks). */
  const teleport = (x: number, z: number, heading: number): void => {
    car.place({ x, y: surfaceHeightAt(x, z), z }, heading);
    vehicle.resetSolver();
    Object.assign(prevPos, car.body.translation());
    Object.assign(currPos, prevPos);
    Object.assign(prevRot, car.body.rotation());
    Object.assign(currRot, prevRot);
    renderer.snapCamera();
  };

  return { vehicle, controls, ancillaries, renderer, stats, network, teleport };
}

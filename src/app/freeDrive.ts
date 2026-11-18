/**
 * Free drive: one car on the test track. This is the composition root - it
 * builds the physics world, the vehicle, the renderer, input and HUD, and
 * runs the fixed-step loop that ties them together.
 */
import testTrack from '../data/maps/testTrack.json';
import yardJson from '../data/maps/yard.json';
import type { ManoeuvreDef } from '../examiner/yard';
import { getLang, t } from '../ui/i18n';
import { ExamSession } from './examining';
import { ROAD_ROUTE, TestSession } from './testSession';
import { ReplayPlayer } from './replayPlayer';
import { LIGHT, Recording } from '../replay/recording';
import type { ResultData } from '../ui/results';
import { ResultsScreen } from '../ui/results';
import type { GameMode } from '../ui/hud';
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
import { buildMap, surfaceHeight, type BuiltMap, type MapDef } from '../world/map';
import { PhysicsWorld, initPhysics } from '../world/physics';
import type { RoadNetwork } from '../world/roads/network';
import { signalState } from '../world/roads/signals';
import { buildTown } from '../world/town';
import { Traffic, type PlayerState } from '../traffic/traffic';
import { TrafficBodies } from '../world/trafficBodies';

const CAMERA_NAMES: Record<(typeof CAMERA_MODES)[number], StringKey> = {
  chase: 'camChase',
  driver: 'camDriver',
  top: 'camTop',
  free: 'camFree',
};

/** Where the driver's head turns for each mirror, rad (left-hand drive). */
const LOOK_YAW = { left: -0.85, centre: 0.42, right: 1.0 };

/** A replay frame is recorded every this many simulation steps (120 Hz / 6 = 20 a second). */
const FRAME_EVERY = 6;

/** Traffic drivers make decisions on every Nth simulation step (120 Hz / 4 = 30 times a second). */
const TRAFFIC_THINK_EVERY = 4;

/** A flipped car is put back on its wheels after this long, s. */
const AUTO_RIGHT_AFTER = 6;

/** A tap on Start cranks for at most this long, s. */
const STARTER_ASSIST = 1.5;

/** Address names for each mode (#road-test, #yard, ...). */
const MODE_HASH: Record<GameMode, string> = {
  town: 'town',
  yard: 'yard',
  roadTest: 'road-test',
  yardTest: 'yard-test',
  track: 'track',
};

/** Which mode to run: from the address (#road-test, #yard, ?map=track, ...); free drive in town otherwise. */
function modeChoice(): GameMode {
  const hash = location.hash.replace('#', '');
  const query = new URLSearchParams(location.search).get('map') ?? '';
  for (const v of [hash, query]) {
    for (const [mode, name] of Object.entries(MODE_HASH) as [GameMode, string][]) if (v === name) return mode;
  }
  return 'town';
}

/** Start a mode afresh. */
function switchMode(mode: GameMode): void {
  location.hash = MODE_HASH[mode];
  location.reload();
}

/** Lines for the result map: the lane centre lines in town, the bays and apron in the yard. */
function mapLines(map: BuiltMap, yard: boolean): { x: number; z: number }[][] {
  if (!yard && map.network) {
    return [...map.network.lanes.values()].map((l) => l.path.points.filter((_, i, a) => i % 3 === 0 || i === a.length - 1));
  }
  const rect = (cx: number, cz: number, w: number, l: number) => [
    { x: cx - w / 2, z: cz - l / 2 },
    { x: cx + w / 2, z: cz - l / 2 },
    { x: cx + w / 2, z: cz + l / 2 },
    { x: cx - w / 2, z: cz + l / 2 },
    { x: cx - w / 2, z: cz - l / 2 },
  ];
  const lines = map.def.roads.map((r) => {
    const cx = (r.from[0] + r.to[0]) / 2;
    const cz = (r.from[1] + r.to[1]) / 2;
    return rect(cx, cz, r.width, Math.abs(r.to[1] - r.from[1]));
  });
  for (const m of map.def.markings) if (m.type === 'rect') lines.push(rect(m.center[0], m.center[1], m.size[0], m.size[1]));
  for (const m of map.def.markings) if (m.type === 'line') lines.push([{ x: m.from[0], z: m.from[1] }, { x: m.to[0], z: m.to[1] }]);
  return lines;
}

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
  traffic: Traffic | null;
  exam: ExamSession;
  test: TestSession | null;
  results: ResultsScreen;
  recording: Recording | null;
  player: ReplayPlayer | null;
  /** The car's physics body (for automated page checks). */
  body: { setRotation(q: Quat, wake: boolean): void; setTranslation(p: Vec3, wake: boolean): void };
}

export async function startFreeDrive(app: HTMLElement, canvas: HTMLCanvasElement): Promise<FreeDrive> {
  await initPhysics();

  const tuning = createDefaultTuning();
  const physics = new PhysicsWorld(tuning.sim.stepHz, tuning.body.gravity);
  // The town by default; #yard (or ?map=yard) is the test yard, ?map=track the bare test track.
  const mode = modeChoice();
  const testing = mode === 'roadTest' || mode === 'yardTest';
  const inYard = mode === 'yard' || mode === 'yardTest';
  const map =
    mode === 'track'
      ? buildMap(testTrack as MapDef, physics)
      : inYard
        ? buildMap(yardJson as unknown as MapDef, physics)
        : buildTown(physics);
  // The road test starts where its route does.
  if (mode === 'roadTest' && map.network) {
    const lane = map.network.lane(ROAD_ROUTE.start.lane);
    const p = lane.path.pointAt(ROAD_ROUTE.start.at);
    const d = lane.path.directionAt(ROAD_ROUTE.start.at);
    map.spawn.position = { x: p.x, y: 0, z: p.z };
    map.spawn.heading = Math.atan2(d.x, -d.z);
  }
  const network = map.network;
  const surfaceHeightAt = (x: number, z: number) => surfaceHeight(map, x, z);
  const car = physics.createCar(tuning, map.spawn.position, map.spawn.heading);

  // Traffic and pedestrians, where the map has roads for them. ?traffic=N sets how many cars (0 = none).
  const params = new URLSearchParams(location.search);
  const asked = Number(params.get('traffic'));
  const phone = matchMedia('(pointer: coarse)').matches;
  const carCount = params.has('traffic') && Number.isFinite(asked) ? Math.max(0, Math.min(40, Math.round(asked))) : phone ? 10 : 14;
  const traffic = network
    ? new Traffic(network, {
        cars: carCount,
        pedestriansPerCrossing: carCount > 0 ? 2 : 0,
        seed: 2026,
        keepClear: [network.locate(map.spawn.position, (map.spawn.heading * 180) / Math.PI)?.lane.id ?? ''],
      })
    : null;
  const trafficBodies = traffic ? new TrafficBodies(physics, traffic) : null;
  const vehicle = new Vehicle(tuning, car.port, physics.ground);
  const ancillaries = new Ancillaries();
  const stepper = new FixedStepper(tuning.sim.stepHz, tuning.sim.maxSubSteps);
  const filter = new InputFilter();

  const controls: DriveControls = { ...neutralControls(), steer: 0, handbrake: 1 };
  let starterAssistUntil = -1;
  let cameraIndex = 0;
  /** Seconds the car has been lying on its side or roof. */
  let flippedFor = 0;

  const renderer = new GameRenderer(canvas, map, tuning, pickQuality());
  if (traffic) renderer.addTraffic(traffic.vehicles.cars, traffic.pedestrians.list);

  const hud = new Hud(app, {
    onCamera: () => handle({ type: 'camera' }),
    onReset: () => handle({ type: 'reset' }),
    onNight: () => handle({ type: 'night' }),
    onRightCar: () => handle({ type: 'rightCar' }),
    mode,
    // Each mode starts afresh, as at the real test centre.
    onMode: switchMode,
  });

  // Poses either side of "now", for smooth drawing between fixed steps.
  const prevPos: Vec3 = { ...car.body.translation() };
  const currPos: Vec3 = { ...prevPos };
  const prevRot: Quat = { ...car.body.rotation() };
  const currRot: Quat = { ...prevRot };

  /** Put the car back on its wheels where it is, facing the way it was going. */
  function rightCar(): void {
    const p = car.body.translation();
    car.place({ x: p.x, y: surfaceHeight(map, p.x, p.z) + 0.05, z: p.z }, vehicle.telemetry.heading);
    vehicle.resetSolver();
    Object.assign(prevPos, car.body.translation());
    Object.assign(currPos, prevPos);
    Object.assign(prevRot, car.body.rotation());
    Object.assign(currRot, prevRot);
    flippedFor = 0;
    renderer.snapCamera();
    hud.say('msgRighted', 2);
  }

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
    // Watching a replay: Space plays and pauses, V changes the camera; driving keys do nothing.
    if (replay?.active) {
      if (a.type === 'handbrake') replay.togglePlay();
      else if (a.type === 'camera') replay.nextCamera();
      return;
    }
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
      case 'rightCar':
        rightCar();
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

  // The examiner watches every drive.
  const exam = new ExamSession(
    physics,
    map,
    vehicle,
    car.collider.handle,
    () => car.body.translation(),
    controls,
    ancillaries,
    traffic,
    trafficBodies,
    tuning,
    inYard ? (yardJson.manoeuvres as ManoeuvreDef[]) : [],
    {
      // In a test the examiner keeps the faults to himself until the end, as a real one does.
      onFault: (f) => (test ? test.onFault(f) : hud.fault(f.severity, exam.examiner.rule(f.rule).title[getLang()])),
      onManoeuvre: (def, event, ok) => {
        if (event === 'start') hud.sayText(`${t('msgManoeuvreStart')}: ${def.title[getLang()]}`, 'info', 4);
        else hud.sayText(`${t(ok ? 'msgManoeuvreOk' : 'msgManoeuvreDone')}: ${def.title[getLang()]}`, ok ? 'good' : 'info', 4);
      },
    },
  );

  // Tests are recorded for the replay: the world 20 times a second, the controls every step.
  const recording = testing
    ? new Recording({ traffic: traffic?.vehicles.cars.length ?? 0, pedestrians: traffic?.pedestrians.list.length ?? 0, loose: map.cones.length })
    : null;
  let lastResult: ResultData | null = null;
  const replay = recording
    ? new ReplayPlayer(
        app,
        recording,
        renderer,
        [0, 1, 2, 3].map((i) => {
          const p = vehicle.wheelLocalPosition(i, { x: 0, y: 0, z: 0 });
          return { x: p.x, z: p.z };
        }),
        traffic?.vehicles.cars ?? [],
        traffic?.pedestrians.list ?? [],
        () => results.reopen(),
      )
    : null;

  const results = new ResultsScreen(app, {
    onRetry: () => switchMode(mode),
    onFreeDrive: () => switchMode(inYard ? 'yard' : 'town'),
    ...(replay && {
      onReplay: (at?: number) => {
        results.hide();
        const markers = (lastResult?.faults ?? []).map((f) => ({ at: f.at, n: f.n, severity: f.severity }));
        replay.open(markers, at);
      },
    }),
  });
  const test = testing
    ? new TestSession(mode === 'roadTest' ? 'road' : 'yard', exam, map.network, hud, mapLines(map, inYard), (r) => {
        lastResult = r;
        results.show(r);
      })
    : null;

  const wheelScratch = { x: 0, y: 0, z: 0 };
  function recordFrame(): void {
    const t = vehicle.telemetry;
    const lamps = ancillaries.lamps;
    const look = keyboard.held.look ?? touch.state.look;
    recording!.addFrame(vehicle.time, (w) => {
      w.car('x', currPos.x);
      w.car('y', currPos.y);
      w.car('z', currPos.z);
      w.car('qx', currRot.x);
      w.car('qy', currRot.y);
      w.car('qz', currRot.z);
      w.car('qw', currRot.w);
      const fields = [
        ['w0y', 'w0steer', 'w0spin'],
        ['w1y', 'w1steer', 'w1spin'],
        ['w2y', 'w2steer', 'w2spin'],
        ['w3y', 'w3steer', 'w3spin'],
      ] as const;
      for (let i = 0; i < 4; i++) {
        const wh = vehicle.wheels[i]!;
        w.car(fields[i]![0], vehicle.wheelLocalPosition(i, wheelScratch).y);
        w.car(fields[i]![1], wh.steerAngle);
        w.car(fields[i]![2], wh.spinAngle);
      }
      w.car('steer', controls.steer);
      w.car('throttle', controls.throttle);
      w.car('brake', controls.brake);
      w.car('clutch', controls.clutch);
      w.car('gear', vehicle.powertrain.state.gear);
      w.car('handbrake', controls.handbrake);
      w.car('rpm', t.rpm);
      w.car('speed', t.wheelSpeed);
      w.car(
        'lights',
        (controls.brake > 0.02 ? LIGHT.brake : 0) |
          (vehicle.powertrain.state.gear === GEAR_REVERSE && controls.ignition ? LIGHT.reverse : 0) |
          (lamps.left ? LIGHT.left : 0) |
          (lamps.right ? LIGHT.right : 0) |
          (ancillaries.state.headlights !== 'off' ? LIGHT.head : 0),
      );
      w.car('signalTime', traffic ? traffic.time : vehicle.time);
      w.car('lookYaw', look ? LOOK_YAW[look] : 0);
      traffic?.vehicles.cars.forEach((c, i) => {
        const flags = (c.braking || c.speed < 0.1 ? 1 : 0) | (c.indicator === 'left' ? 2 : 0) | (c.indicator === 'right' ? 4 : 0);
        w.traffic(i, c.x, c.y, c.z, c.headingDeg, c.pitch, flags);
      });
      traffic?.pedestrians.list.forEach((p, i) => {
        w.pedestrian(i, p.x, p.z, p.headingDeg, p.walked, p.state === 'crossing' ? 2 : p.state === 'waiting' ? 1 : 0);
      });
      map.cones.forEach((c, i) => {
        const p = c.body.translation();
        const q = c.body.rotation();
        w.loose(i, p.x, p.y, p.z, q.x, q.y, q.z, q.w);
      });
    });
  }

  function report(e: VehicleEvent): void {
    exam.noteEvent(e.type);
    // The examiner reports a stall as a fault; this message says what to do about it.
    if (e.type === 'stall') hud.say('msgStalled', 6);
    else if (e.type === 'gearGrind') hud.say(e.reason === 'clutch' ? 'msgGrindClutch' : 'msgGrindReverse');
    else if (e.type === 'overRev') hud.say('msgOverRev');
  }

  const stats = { frames: 0, steps: 0, fps: 60 };
  const player: PlayerState = {
    x: 0,
    z: 0,
    headingDeg: 0,
    speed: 0,
    length: tuning.chassis.wheelbase + tuning.chassis.frontOverhang + tuning.chassis.rearOverhang,
    width: tuning.chassis.bodyWidth,
  };

  // Where the car is on the road network (looked up a few times a second, not every frame).
  let speedLimit: number | null = null;
  let locateIn = 0;
  const here = { x: 0, z: 0 };
  const signalNow = (junction: string, group: string) => {
    const plan = network?.signals.get(junction);
    // The same clock the traffic uses, so what the lamps show is what the cars obey.
    return plan ? signalState(plan, group, traffic ? traffic.time : vehicle.time) : 'red';
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

    if (traffic && trafficBodies) {
      player.x = currPos.x;
      player.z = currPos.z;
      player.headingDeg = (vehicle.telemetry.heading * 180) / Math.PI;
      player.speed = vehicle.telemetry.wheelSpeed;
      // Drivers reconsider thirty times a second; in between they carry on as decided.
      const think = stats.steps % TRAFFIC_THINK_EVERY === 0;
      for (const e of traffic.step(dt, player, think, dt * TRAFFIC_THINK_EVERY)) {
        if (e.type === 'honk') hud.say('msgHonk', 3);
      }
      trafficBodies.sync();
    }

    Object.assign(prevPos, currPos);
    Object.assign(prevRot, currRot);
    recording?.addInput(vehicle.time, dt, {
      throttle: controls.throttle,
      brake: controls.brake,
      clutch: controls.clutch,
      steer: controls.steer,
      handbrake: controls.handbrake,
      gear: controls.gear,
      ignition: controls.ignition ? 1 : 0,
      starter: controls.starter ? 1 : 0,
    });
    for (const e of vehicle.step(dt, controls)) report(e);
    physics.step();
    ancillaries.step(dt, controls.steer);
    Object.assign(currPos, car.body.translation());
    Object.assign(currRot, car.body.rotation());
    exam.step(dt);
    if (recording && stats.steps % FRAME_EVERY === 0 && !test?.ended) recordFrame();
    test?.step({
      time: vehicle.time,
      dt,
      x: currPos.x,
      z: currPos.z,
      headingDeg: (vehicle.telemetry.heading * 180) / Math.PI,
      speed: vehicle.telemetry.wheelSpeed,
      handbrake: controls.handbrake > 0,
    });
    stats.steps++;

    if (currPos.y < -30) reset(); // drove off the edge of the world

    // On its side or roof: offer to right it, and do so anyway after a few seconds.
    const r = currRot;
    const upY = 1 - 2 * (r.x * r.x + r.z * r.z);
    if (upY < 0.35 && Math.abs(vehicle.telemetry.speed) < 2) flippedFor += dt;
    else flippedFor = 0;
    if (flippedFor > AUTO_RIGHT_AFTER) rightCar();
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

    if (replay?.active) {
      // The simulation stays paused; the renderer shows the recording.
      const r = replay.tick(elapsed);
      if (network) renderer.setSignals((junction, group) => {
        const plan = network.signals.get(junction);
        return plan ? signalState(plan, group, r.signalTime) : 'red';
      });
      renderer.updateTraffic(replay.cars, replay.people, r.signalTime);
      renderer.render(r.view, r.loose, elapsed);
      stats.frames++;
      requestAnimationFrame(frame);
      return;
    }

    if (!hud.helpOpen && !results.open) stepper.advance(elapsed, simStep);

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
    const look = keyboard.held.look ?? touch.state.look;
    view.lookYaw = look ? LOOK_YAW[look] : 0;
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
    if (traffic) renderer.updateTraffic(traffic.vehicles.cars, traffic.pedestrians.list, traffic.time);
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
      engaged: gear,
      handbrake: controls.handbrake > 0,
      seatbelt: ancillaries.state.seatbelt,
      indicator: ancillaries.state.indicator,
      lampLeft: lamps.left,
      lampRight: lamps.right,
    });

    hud.showRightCar(flippedFor > 1);
    stats.frames++;
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => renderer.resize());
  // Driving keys (Space, Enter) must not re-press whichever button was clicked last.
  app.addEventListener('click', (e) => (e.target as HTMLElement | null)?.closest('button')?.blur());
  // Let the car settle on its springs before the first picture.
  for (let i = 0; i < tuning.sim.stepHz; i++) simStep(stepper.dt);
  // In a test the examiner's own instruction says this.
  if (!test) hud.say('msgStartHint', 8);
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

  return { vehicle, controls, ancillaries, renderer, stats, network, teleport, traffic, exam, body: car.body, test, results, recording, player: replay };
}

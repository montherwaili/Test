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
import { LessonSession } from './lessonSession';
import { loadLessons } from '../learning/lesson';
import { recordFaults, recordLesson, recordTest } from '../learning/progress';
import { LessonsMenu } from '../ui/lessonsMenu';
import { CarAudio } from '../audio/carAudio';
import { loadSettings, saveSettings, type Settings } from '../ui/settingsStore';
import { SettingsPanel } from '../ui/settingsPanel';
import { MainMenu } from '../ui/mainMenu';
import { GamepadControls } from '../input/gamepad';
import { TiltSteering } from '../input/tiltSteering';
import { ResolutionGovernor } from '../render/resolutionGovernor';
import { loadProgress, saveProgress } from '../ui/storage';
import { LIGHT, Recording } from '../replay/recording';
import type { ResultData } from '../ui/results';
import { ResultsScreen } from '../ui/results';
import type { GameMode } from '../ui/hud';
import { InputFilter, type AnalogInput } from '../input/inputFilter';
import { Keyboard, emptyHeld, type Action } from '../input/keyboard';
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
import { buildCity, buildTown } from '../world/town';
import { impactMaterial } from '../audio/soundModel';
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
  free: 'free',
  town: 'town',
  yard: 'yard',
  roadTest: 'road-test',
  yardTest: 'yard-test',
  track: 'track',
  lesson: 'lesson',
};

const LESSONS = loadLessons();

/** The lesson asked for in the address (#lesson-gears), if any. */
function lessonChoice(): string | null {
  const m = /^#lesson-([A-Za-z]+)$/.exec(location.hash);
  return m && LESSONS.some((l) => l.id === m[1]) ? m[1]! : null;
}

/** Start a lesson afresh. */
function startLesson(id: string): void {
  location.hash = `lesson-${id}`;
  location.reload();
}

/** Which mode to run: from the address (#road-test, #yard, ?map=track, ...); free drive in town otherwise. */
function modeChoice(): GameMode {
  if (lessonChoice()) return 'lesson';
  const hash = location.hash.replace('#', '');
  const query = new URLSearchParams(location.search).get('map') ?? '';
  for (const v of [hash, query]) {
    for (const [mode, name] of Object.entries(MODE_HASH) as [GameMode, string][]) if (v === name) return mode;
  }
  return 'free';
}

/** Nothing asked for in the address: a first visit, so the home screen opens over a free drive. */
function openedPlain(): boolean {
  return !location.hash && !new URLSearchParams(location.search).get('map');
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

function pickQuality(chosen: Settings['quality']): RenderQuality {
  const q = new URLSearchParams(location.search).get('q');
  const asked = q === 'low' || q === 'medium' || q === 'high' ? q : chosen;
  if (asked !== 'auto') return QUALITY_PRESETS[asked];
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
  lesson: LessonSession | null;
  lessonsMenu: LessonsMenu;
  audio: CarAudio;
  mainMenu: MainMenu;
  gamepad: GamepadControls;
  tilt: TiltSteering;
  settings: Settings;
  /** Advance the simulation one fixed step (automated performance checks). */
  step: (dt: number) => void;
  /** The car's physics body (for automated page checks). */
  body: { setRotation(q: Quat, wake: boolean): void; setTranslation(p: Vec3, wake: boolean): void };
}

export async function startFreeDrive(app: HTMLElement, canvas: HTMLCanvasElement): Promise<FreeDrive> {
  await initPhysics();

  const tuning = createDefaultTuning();
  const physics = new PhysicsWorld(tuning.sim.stepHz, tuning.body.gravity);
  // Free drive in the city; the other town modes in the town; #yard (or ?map=yard) the test yard, ?map=track the bare test track.
  const mode = modeChoice();
  const testing = mode === 'roadTest' || mode === 'yardTest';
  const free = mode === 'free';
  const lessonDef = mode === 'lesson' ? LESSONS.find((l) => l.id === lessonChoice())! : null;
  const inYard = mode === 'yard' || mode === 'yardTest' || lessonDef?.map === 'yard';
  const map =
    mode === 'track'
      ? buildMap(testTrack as MapDef, physics)
      : inYard
        ? buildMap(yardJson as unknown as MapDef, physics)
        : free
          ? buildCity(physics)
          : buildTown(physics);
  // The road test starts where its route does.
  if (mode === 'roadTest' && map.network) {
    const lane = map.network.lane(ROAD_ROUTE.start.lane);
    const p = lane.path.pointAt(ROAD_ROUTE.start.at);
    const d = lane.path.directionAt(ROAD_ROUTE.start.at);
    map.spawn.position = { x: p.x, y: 0, z: p.z };
    map.spawn.heading = Math.atan2(d.x, -d.z);
  }
  // A lesson starts where it says.
  if (lessonDef) {
    const st = lessonDef.start;
    if ('lane' in st && map.network) {
      const lane = map.network.lane(st.lane);
      const p = lane.path.pointAt(st.at);
      const d = lane.path.directionAt(st.at);
      map.spawn.position = { x: p.x, y: 0, z: p.z };
      map.spawn.heading = Math.atan2(d.x, -d.z);
    } else if (!('lane' in st)) {
      map.spawn.position = { x: st.x, y: surfaceHeight(map, st.x, st.z), z: st.z };
      map.spawn.heading = (st.headingDeg * Math.PI) / 180;
    }
  }
  const network = map.network;
  const surfaceHeightAt = (x: number, z: number) => surfaceHeight(map, x, z);
  const car = physics.createCar(tuning, map.spawn.position, map.spawn.heading);

  // Traffic and pedestrians, where the map has roads for them. ?traffic=N sets how many cars (0 = none).
  const params = new URLSearchParams(location.search);
  const asked = Number(params.get('traffic'));
  const phone = matchMedia('(pointer: coarse)').matches;
  const carCount = params.has('traffic') && Number.isFinite(asked)
    ? Math.max(0, Math.min(40, Math.round(asked)))
    : lessonDef
      ? (lessonDef.traffic ?? 0)
      : phone
        ? free
          ? 14
          : 10
        : free
          ? 26
          : 14;
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
  let wasOnBump = false;

  const settings: Settings = loadSettings();
  const renderer = new GameRenderer(canvas, map, tuning, pickQuality(settings.quality));
  // "Auto" quality: fewer pixels when the device cannot keep up (30 fps on a phone, 60 on a computer).
  const governor =
    settings.quality === 'auto' && !new URLSearchParams(location.search).get('q')
      ? new ResolutionGovernor({ targetFps: phone ? 30 : 60, minScale: 0.5, maxScale: 1, step: 0.85 })
      : null;
  if (traffic) renderer.addTraffic(traffic.vehicles.cars, traffic.pedestrians.list);

  const hud = new Hud(app, {
    onCamera: () => handle({ type: 'camera' }),
    onReset: () => handle({ type: 'reset' }),
    onNight: () => handle({ type: 'night' }),
    onRightCar: () => handle({ type: 'rightCar' }),
    onLessons: () => lessonsMenu.show(),
    onSettings: () => settingsPanel.show(),
    onMenu: () => mainMenu.show(),
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
  const gamepad = new GamepadControls(handle);
  // What the filter is fed: keys, touch, gamepad and tilt merged (built each step, no allocation).
  const digital = emptyHeld();
  const analog: AnalogInput = {};
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
      // Free drive: nobody is checking, so faults are not shown at all.
      onFault: (f) =>
        free ? undefined : lessonRun ? lessonRun.onFault(f) : test ? test.onFault(f) : hud.fault(f.severity, exam.examiner.rule(f.rule).title[getLang()]),
      onManoeuvre: (def, event, ok) => {
        if (free) return;
        if (event === 'start') hud.sayText(`${t('msgManoeuvreStart')}: ${def.title[getLang()]}`, 'info', 4);
        else hud.sayText(`${t(ok ? 'msgManoeuvreOk' : 'msgManoeuvreDone')}: ${def.title[getLang()]}`, ok ? 'good' : 'info', 4);
      },
    },
  );

  // Tests are recorded for the replay: the world 20 times a second, the controls every step.
  const recording = testing || lessonDef
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

  const progress = loadProgress();
  const audio = new CarAudio(window);
  audio.setVolume(settings.volume);
  audio.setEnabled(settings.sound);
  const vibrate = (pattern: number | number[]) => {
    if (settings.vibration) navigator.vibrate?.(pattern);
  };

  // Steering by tilting the phone (iPhones ask permission inside a tap, so a
  // saved choice is switched back on at the first touch).
  const tilt = new TiltSteering();
  tilt.range = settings.tiltRange;
  if (settings.steering === 'tilt' && TiltSteering.supported) {
    const resume = () => {
      void tilt.enable().then((ok) => {
        if (!ok) hud.say('setTiltRefused', 4);
      });
    };
    window.addEventListener('pointerdown', resume, { once: true });
  }
  const settingsPanel = new SettingsPanel(app, settings, {
    onChange: (s, key) => {
      saveSettings(s);
      if (key === 'sound') audio.setEnabled(s.sound);
      if (key === 'volume') audio.setVolume(s.volume);
      if (key === 'tiltRange') tilt.range = s.tiltRange;
      if (key === 'steering' && s.steering === 'wheel') tilt.disable();
      if (key === 'showFps' && !s.showFps) hud.showFps(null);
    },
    enableTilt: () => tilt.enable(),
    calibrateTilt: () => tilt.calibrate(),
    gamepad,
    touch: () => document.body.classList.contains('touch'),
  });
  const lessonsMenu = new LessonsMenu(app, LESSONS, () => progress, startLesson);
  const mainMenu = new MainMenu(app, LESSONS, () => progress, {
    // Free drive is what runs behind the menu on a first visit: just close it.
    onMode: (m) => (m === mode && m === 'free' ? mainMenu.hide() : switchMode(m)),
    onLesson: startLesson,
    onAllLessons: () => lessonsMenu.show(),
    onSettings: () => settingsPanel.show(),
    onClose: () => mainMenu.hide(),
    closeLabel: mode === 'free' ? 'menuClose' : 'menuBack',
  });
  const nextLesson = lessonDef ? LESSONS[LESSONS.indexOf(lessonDef) + 1] : undefined;
  const results = new ResultsScreen(app, {
    onRetry: () => (lessonDef ? startLesson(lessonDef.id) : switchMode(mode)),
    ...(nextLesson && { onNextLesson: () => startLesson(nextLesson.id) }),
    ...(lessonDef && { onLessons: () => lessonsMenu.show() }),
    onFreeDrive: () => switchMode(inYard ? 'yard' : 'free'),
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
        // Progress: what went wrong feeds the practice suggestions.
        recordFaults(progress, exam.examiner.faults);
        recordTest(progress, r.verdict.passed);
        saveProgress(progress);
        results.show(r);
      })
    : null;
  const lessonRun = lessonDef
    ? new LessonSession(lessonDef, exam, map.network, hud, mapLines(map, inYard), (r, stars) => {
        lastResult = r;
        recordFaults(progress, exam.examiner.faults);
        if (r.lesson?.completed) recordLesson(progress, lessonDef.id, lessonDef.skill, stars);
        saveProgress(progress);
        results.show(r);
      })
    : null;

  const wheelScratch = { x: 0, y: 0, z: 0 };
  function recordFrame(): void {
    const t = vehicle.telemetry;
    const lamps = ancillaries.lamps;
    const look = keyboard.held.look ?? touch.state.look ?? gamepad.look;
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
    if (e.type === 'stall') {
      hud.say('msgStalled', 6);
      vibrate(90);
    } else if (e.type === 'gearGrind') {
      hud.say(e.reason === 'clutch' ? 'msgGrindClutch' : 'msgGrindReverse');
      audio.grind();
      vibrate(40);
    }
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
    touch.tiltSteering = tilt.active && tilt.reading;
    touch.tick(dt, roadSpeed);
    if (keyboard.held.clutch || gamepad.clutchButton) touch.releaseClutch();
    // Touch wins over the gamepad, the gamepad over tilt; keys work alongside all of them.
    const ta = touch.state.analog;
    const pa = gamepad.analog;
    analog.throttle = ta.throttle ?? pa.throttle;
    analog.brake = ta.brake ?? pa.brake;
    analog.clutch = ta.clutch ?? pa.clutch;
    analog.steer = ta.steer ?? pa.steer ?? (tilt.active && tilt.reading ? tilt.steer : undefined);
    const kh = keyboard.held;
    digital.throttle = kh.throttle;
    digital.brake = kh.brake;
    digital.clutch = kh.clutch || gamepad.clutchButton;
    digital.left = kh.left;
    digital.right = kh.right;
    // A held key takes over from an analog device for as long as it is held.
    if (kh.throttle) analog.throttle = undefined;
    if (kh.brake) analog.brake = undefined;
    if (kh.left || kh.right) analog.steer = undefined;
    filter.update(dt, digital, analog, roadSpeed, tuning.clutch);
    controls.throttle = filter.throttle;
    controls.brake = filter.brake;
    controls.clutch = filter.clutch;
    controls.steer = filter.steer;
    const running = vehicle.powertrain.state.running;
    controls.starter =
      keyboard.held.starter || touch.state.starter || (!running && vehicle.time < starterAssistUntil);
    ancillaries.setHorn(keyboard.held.horn || touch.state.horn || gamepad.horn);

    if (traffic && trafficBodies) {
      player.x = currPos.x;
      player.z = currPos.z;
      player.headingDeg = (vehicle.telemetry.heading * 180) / Math.PI;
      player.speed = vehicle.telemetry.wheelSpeed;
      // Drivers reconsider thirty times a second; in between they carry on as decided.
      const think = stats.steps % TRAFFIC_THINK_EVERY === 0;
      for (const e of traffic.step(dt, player, think, dt * TRAFFIC_THINK_EVERY)) {
        if (e.type === 'honk') {
          hud.say('msgHonk', 3);
          audio.distantHorn();
        }
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
    // Touching anything: a thump, a jolt and a buzz, harder the faster it happened.
    if (exam.observation.contacts.length) {
      const hit = Math.abs(vehicle.telemetry.wheelSpeed);
      // Several things at once: the hardest of them is what is heard.
      const contacts = exam.observation.contacts;
      audio.impact(contacts.find((k) => impactMaterial(k) === 'hard') ?? contacts[0]!, hit);
      renderer.shake(Math.min(0.35, 0.05 + hit * 0.03));
      vibrate(hit > 3 ? [120, 40, 120] : 60);
    }
    // Over a speed bump: a small jolt.
    const onBump = vehicle.wheels.some((w) => map.surfaces.get(w.surface) === 'bump');
    if (onBump && !wasOnBump && Math.abs(vehicle.telemetry.wheelSpeed) > 1.5) renderer.shake(0.03 + Math.abs(vehicle.telemetry.wheelSpeed) * 0.004);
    wasOnBump = onBump;
    if (recording && stats.steps % FRAME_EVERY === 0 && !test?.ended && !lessonRun?.ended) recordFrame();
    lessonRun?.step({ ...exam.observation, running: vehicle.powertrain.state.running });
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

  /** What the controls were last frame, so their sounds play once per change. */
  const heard = { handbrake: controls.handbrake > 0, gear: vehicle.powertrain.state.gear, belt: ancillaries.state.seatbelt, ignition: controls.ignition };

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
      // The engine sounds as it did, from the recorded revs and throttle.
      const f = replay.frame;
      if (f) {
        audio.update({
          rpm: f.car.rpm,
          load: f.car.throttle,
          running: f.car.rpm > 350,
          cranking: false,
          speed: f.car.speed,
          slipAngleDeg: 0,
          wheelspinRatio: 0,
          brakeDecel: 0,
          horn: false,
          indicatorLit: (f.car.lights & (LIGHT.left | LIGHT.right)) !== 0,
        });
      }
      if (!replay.clock?.playing) audio.quiet();
      stats.frames++;
      requestAnimationFrame(frame);
      return;
    }

    gamepad.poll(Math.abs(vehicle.telemetry.wheelSpeed), now / 1000);
    if (settingsPanel.open) settingsPanel.update();
    if (governor?.frame(elapsed)) renderer.setResolutionScale(governor.scale);
    if (settings.showFps && stats.frames % 15 === 0) {
      hud.showFps(`${Math.round(stats.fps)} ${t('fpsLabel')} · ${renderer.pixelRatio.toFixed(2)}×`);
    }
    const paused = hud.helpOpen || results.open || lessonsMenu.open || settingsPanel.open || mainMenu.open;
    if (!paused) stepper.advance(elapsed, simStep);

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
    const look = keyboard.held.look ?? touch.state.look ?? gamepad.look;
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

    // The little mechanical sounds of the controls being used.
    const pulled = controls.handbrake > 0;
    if (pulled !== heard.handbrake) audio.handbrake(pulled);
    heard.handbrake = pulled;
    const inGear = vehicle.powertrain.state.gear;
    if (inGear !== heard.gear && inGear !== GEAR_NEUTRAL) audio.gearIn();
    heard.gear = inGear;
    if (ancillaries.state.seatbelt && !heard.belt) audio.seatbelt();
    heard.belt = ancillaries.state.seatbelt;
    if (controls.ignition !== heard.ignition) audio.key();
    heard.ignition = controls.ignition;

    if (paused) {
      audio.quiet();
    } else {
      const tm = vehicle.telemetry;
      let slip = 0;
      for (const w of vehicle.wheels) if (w.grounded) slip = Math.max(slip, Math.abs(w.slipAngle));
      audio.update({
        rpm: tm.rpm,
        load: tm.engineLoad,
        running: tm.running,
        cranking: controls.starter && controls.ignition,
        speed: tm.wheelSpeed,
        slipAngleDeg: (slip * 180) / Math.PI,
        wheelspinRatio: tm.wheelspin ? tm.slipRatio : 0,
        brakeDecel: controls.brake > 0.3 ? -tm.longitudinalAccel : 0,
        horn: ancillaries.state.horn,
        indicatorLit: ancillaries.lamps.left || ancillaries.lamps.right,
      });
    }

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
  if (!test && !lessonRun) hud.say(free ? 'msgFreeHint' : 'msgStartHint', 8);
  if (openedPlain()) mainMenu.show();
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

  return { vehicle, controls, ancillaries, renderer, stats, network, teleport, traffic, exam, body: car.body, test, results, recording, player: replay, lesson: lessonRun, lessonsMenu, mainMenu, audio, gamepad, tilt, settings, step: simStep };
}

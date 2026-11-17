/**
 * Connects the examiner to the running game: turns the car, physics and
 * traffic into an observation each step, and the examiner's verdicts into
 * messages.
 */
import { Examiner, type Fault } from '../examiner/examiner';
import type { CarGeometry, ContactKind, Observation, OtherVehicle } from '../examiner/observation';
import { loadRuleBook } from '../examiner/rules';
import type { ManoeuvreDef } from '../examiner/yard';
import type { Ancillaries } from '../sim/ancillaries';
import type { VehicleTuning } from '../sim/tuning';
import type { DriveControls, Vehicle } from '../sim/vehicle';
import type { Traffic } from '../traffic/traffic';
import type { BuiltMap } from '../world/map';
import type { PhysicsWorld } from '../world/physics';
import type { TrafficBodies } from '../world/trafficBodies';

const SCENERY: Partial<Record<string, ContactKind>> = {
  pole: 'pole',
  kerb: 'kerb',
  island: 'island',
  wall: 'wall',
  building: 'building',
  palm: 'palm',
};

export function carGeometry(t: VehicleTuning): CarGeometry {
  const toRear = t.chassis.frontWeightFraction * t.chassis.wheelbase;
  const toFront = t.chassis.wheelbase - toRear;
  return { front: toFront + t.chassis.frontOverhang, rear: toRear + t.chassis.rearOverhang, width: t.chassis.bodyWidth };
}

export interface ExamHooks {
  onFault(f: Fault): void;
  /** A yard manoeuvre has begun (the car entered its zone) or finished. */
  onManoeuvre(def: ManoeuvreDef, event: 'start' | 'done', ok?: boolean): void;
}

export class ExamSession {
  readonly examiner: Examiner;
  private readonly obs: Observation;
  private readonly coneHandles: Set<number>;
  private readonly manoeuvreStates: string[];
  private events: string[] = [];
  private others: OtherVehicle[] = [];

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly map: BuiltMap,
    private readonly vehicle: Vehicle,
    private readonly carHandle: number,
    private readonly carPosition: () => { x: number; z: number },
    private readonly controls: DriveControls,
    private readonly ancillaries: Ancillaries,
    private readonly traffic: Traffic | null,
    private readonly trafficBodies: TrafficBodies | null,
    tuning: VehicleTuning,
    manoeuvres: ManoeuvreDef[],
    private readonly hooks: ExamHooks,
  ) {
    this.examiner = new Examiner(loadRuleBook(), map.network, carGeometry(tuning), manoeuvres);
    this.coneHandles = new Set(map.cones.map((c) => c.handle));
    this.manoeuvreStates = this.examiner.manoeuvres.map((m) => m.state);
    this.obs = {
      time: 0,
      dt: 0,
      signalTime: 0,
      x: 0,
      z: 0,
      headingDeg: 0,
      speed: 0,
      gear: 0,
      handbrake: true,
      seatbelt: false,
      indicator: 'off',
      indicatorFor: 0,
      mirrorLeftAt: -Infinity,
      mirrorCentreAt: -Infinity,
      mirrorRightAt: -Infinity,
      wheelsOnKerb: 0,
      contacts: [],
      events: [],
      others: [],
      crossings: map.network ? map.network.crossings.map(() => 0) : [],
    };
  }

  /** Car events from this step (stalls), passed on with the next observation. */
  noteEvent(type: string): void {
    this.events.push(type);
  }

  /** Call after the physics has stepped. */
  step(dt: number): void {
    const o = this.obs;
    const v = this.vehicle;
    const t = v.telemetry;
    const pos = this.carPosition();
    const a = this.ancillaries.state;

    o.dt = dt;
    o.time = v.time;
    o.signalTime = this.traffic ? this.traffic.time : v.time;
    o.x = pos.x;
    o.z = pos.z;
    o.headingDeg = ((t.heading * 180) / Math.PI + 360) % 360;
    o.speed = t.wheelSpeed;
    o.gear = v.powertrain.state.gear;
    o.handbrake = this.controls.handbrake > 0;
    o.seatbelt = a.seatbelt;
    o.indicator = a.indicator;
    o.indicatorFor = a.indicatorFor;
    o.mirrorLeftAt = a.mirrorLeftAt;
    o.mirrorCentreAt = a.mirrorCentreAt;
    o.mirrorRightAt = a.mirrorRightAt;

    let onKerb = 0;
    for (const w of v.wheels) {
      const kind = this.map.surfaces.get(w.surface);
      if (kind === 'kerb' || kind === 'island') onKerb++;
    }
    o.wheelsOnKerb = onKerb;

    o.contacts = [];
    for (const h of this.physics.takeContacts(this.carHandle)) {
      const scenery = SCENERY[this.map.surfaces.get(h) ?? ''];
      const moving = this.trafficBodies?.kinds.get(h);
      const kind: ContactKind | undefined = scenery ?? moving ?? (this.coneHandles.has(h) ? 'cone' : undefined);
      if (kind) o.contacts.push(kind);
    }
    o.events = this.events;
    this.events = [];

    if (this.traffic) {
      const cars = this.traffic.vehicles.cars;
      if (this.others.length !== cars.length) {
        this.others = cars.map((c) => ({ id: c.id, x: 0, z: 0, headingDeg: 0, speed: 0, accel: 0, length: c.length, lane: null, s: 0 }));
      }
      cars.forEach((c, i) => {
        const ov = this.others[i]!;
        ov.x = c.x;
        ov.z = c.z;
        ov.headingDeg = c.headingDeg;
        ov.speed = c.speed;
        ov.accel = c.accel;
        ov.lane = c.lane;
        ov.s = c.s;
      });
      o.others = this.others;
      const peds = this.traffic.pedestrians;
      for (let i = 0; i < o.crossings.length; i++) {
        const st = peds.occupied(i);
        o.crossings[i] = st.crossing ? 2 : st.waiting ? 1 : 0;
      }
    }

    for (const f of this.examiner.step(o)) this.hooks.onFault(f);

    this.examiner.manoeuvres.forEach((m, i) => {
      const before = this.manoeuvreStates[i];
      if (before === m.state) return;
      this.manoeuvreStates[i] = m.state;
      if (m.state === 'active' && before === 'idle') this.hooks.onManoeuvre(m.def, 'start');
      if (m.state === 'done') this.hooks.onManoeuvre(m.def, 'done', m.result?.ok ?? false);
    });
  }
}

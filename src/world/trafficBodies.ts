/** Gives traffic cars and pedestrians solid bodies, and keeps them where the traffic logic says. */
import type { Traffic } from '../traffic/traffic';
import { quatFromEulerDeg, type Mover, type PhysicsWorld } from './physics';

const CAR_HEIGHT = 1.3;
const PERSON_HEIGHT = 1.7;
const PERSON_RADIUS = 0.3;

export class TrafficBodies {
  readonly cars: Mover[];
  readonly people: Mover[];
  /** Collider handle -> what it is, for collision reports. */
  readonly kinds = new Map<number, 'trafficCar' | 'pedestrian'>();

  constructor(
    physics: PhysicsWorld,
    private readonly traffic: Traffic,
  ) {
    const t = traffic.vehicles.tuning;
    this.cars = traffic.vehicles.cars.map(() => {
      const m = physics.addMover({ box: { x: t.width, y: CAR_HEIGHT, z: t.length } }, CAR_HEIGHT / 2 + 0.15);
      this.kinds.set(m.handle, 'trafficCar');
      return m;
    });
    this.people = traffic.pedestrians.list.map(() => {
      const m = physics.addMover({ cylinder: { height: PERSON_HEIGHT, radius: PERSON_RADIUS } }, PERSON_HEIGHT / 2);
      this.kinds.set(m.handle, 'pedestrian');
      return m;
    });
    this.sync();
  }

  /** Call after the traffic has stepped and before the physics steps. */
  sync(): void {
    const cars = this.traffic.vehicles.cars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i]!;
      this.cars[i]!.moveTo(c.x, c.y, c.z, quatFromEulerDeg((c.pitch * 180) / Math.PI, -c.headingDeg, 0));
    }
    const people = this.traffic.pedestrians.list;
    for (let i = 0; i < people.length; i++) {
      const p = people[i]!;
      this.people[i]!.moveTo(p.x, 0, p.z, quatFromEulerDeg(0, -p.headingDeg, 0));
    }
  }
}

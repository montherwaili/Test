/**
 * The physics world: a thin wrapper over Rapier that owns the static scenery
 * colliders, loose objects (cones) and the car body, and adapts them to the
 * engine-agnostic ports the vehicle model in src/sim talks to.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type { ChassisPort, GroundHit, GroundPort, Quat, Vec3 } from '../sim/vehicle';
import type { VehicleTuning } from '../sim/tuning';

let ready: Promise<void> | null = null;

/** Load the Rapier WebAssembly module. Safe to call more than once. */
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

export function quatFromEulerDeg(xDeg: number, yDeg: number, zDeg: number): Quat {
  // Intrinsic rotations applied in Y (yaw), then X (pitch), then Z (roll) order.
  const hx = (xDeg * Math.PI) / 360;
  const hy = (yDeg * Math.PI) / 360;
  const hz = (zDeg * Math.PI) / 360;
  const cx = Math.cos(hx), sx = Math.sin(hx);
  const cy = Math.cos(hy), sy = Math.sin(hy);
  const cz = Math.cos(hz), sz = Math.sin(hz);
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz,
  };
}

/** Heading in radians (0 = facing -Z, positive = clockwise from above) as a rotation. */
export function quatFromHeading(heading: number): Quat {
  return { x: 0, y: Math.sin(-heading / 2), z: 0, w: Math.cos(-heading / 2) };
}

export interface CarBody {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly port: ChassisPort;
  /** Move the car somewhere and bring it to rest. */
  place(position: Vec3, heading: number): void;
}

export interface LooseBody {
  readonly body: RAPIER.RigidBody;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly ground: GroundPort;
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  constructor(stepHz: number, gravity = 9.81) {
    this.world = new RAPIER.World({ x: 0, y: -gravity, z: 0 });
    this.world.timestep = 1 / stepHz;

    const world = this.world;
    const ray = this.ray;
    this.ground = {
      castRay(origin: Vec3, direction: Vec3, maxDistance: number, hit: GroundHit): boolean {
        ray.origin.x = origin.x;
        ray.origin.y = origin.y;
        ray.origin.z = origin.z;
        ray.dir.x = direction.x;
        ray.dir.y = direction.y;
        ray.dir.z = direction.z;
        // Wheels only ride on fixed scenery, never on loose objects or the car itself.
        const r = world.castRayAndGetNormal(ray, maxDistance, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
        if (!r) return false;
        hit.distance = r.timeOfImpact;
        hit.nx = r.normal.x;
        hit.ny = r.normal.y;
        hit.nz = r.normal.z;
        hit.surface = r.collider.handle;
        return true;
      },
    };
  }

  /** A fixed box. `size` is full width (x), height (y), length (z). Returns the collider handle. */
  addFixedBox(center: Vec3, size: Vec3, rotation?: Quat, friction = 0.9): number {
    const desc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      .setTranslation(center.x, center.y, center.z)
      .setFriction(friction);
    if (rotation) desc.setRotation(rotation);
    return this.world.createCollider(desc).handle;
  }

  /** A fixed upright cylinder (a pole). Returns the collider handle. */
  addFixedCylinder(center: Vec3, height: number, radius: number, rotation?: Quat): number {
    const desc = RAPIER.ColliderDesc.cylinder(height / 2, radius)
      .setTranslation(center.x, center.y, center.z)
      .setFriction(0.6);
    if (rotation) desc.setRotation(rotation);
    return this.world.createCollider(desc).handle;
  }

  /** A loose object the car can knock over (a traffic cone). */
  addLooseCone(base: Vec3, height: number, radius: number, mass: number): LooseBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(base.x, base.y + height / 2, base.z)
        .setLinearDamping(0.3)
        .setAngularDamping(0.8),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cone(height / 2, radius).setMass(mass).setFriction(0.7).setRestitution(0.1),
      body,
    );
    return { body };
  }

  /** The player's car body. Its forces come from the vehicle model, not from Rapier. */
  createCar(tuning: VehicleTuning, position: Vec3, heading: number): CarBody {
    const { chassis, body: bt } = tuning;
    const [ix, iy, iz] = chassis.inertia;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y + chassis.comHeight, position.z)
        .setRotation(quatFromHeading(heading))
        // The vehicle model applies gravity itself so it can balance it
        // against tyre friction within the same step.
        .setGravityScale(0)
        .setCanSleep(false)
        .setCcdEnabled(true)
        .setAdditionalMassProperties(
          bt.mass,
          { x: 0, y: 0, z: 0 },
          { x: ix, y: iy, z: iz },
          { x: 0, y: 0, z: 0, w: 1 },
        ),
    );
    // Body shell: a box from the ground clearance up to the roof, spanning the overhangs.
    const toRear = chassis.frontWeightFraction * chassis.wheelbase;
    const toFront = chassis.wheelbase - toRear;
    const front = -(toFront + chassis.frontOverhang);
    const rear = toRear + chassis.rearOverhang;
    const bottom = chassis.groundClearance - chassis.comHeight;
    const top = chassis.bodyHeight - chassis.comHeight;
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(chassis.bodyWidth / 2, (top - bottom) / 2, (rear - front) / 2)
        .setTranslation(0, (top + bottom) / 2, (front + rear) / 2)
        .setDensity(0)
        .setFriction(0.4)
        .setRestitution(0.05)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );

    const port: ChassisPort = {
      translation: () => body.translation(),
      rotation: () => body.rotation(),
      linvel: () => body.linvel(),
      angvel: () => body.angvel(),
      setVelocity(linear: Vec3, angular: Vec3): void {
        body.setLinvel(linear, true);
        body.setAngvel(angular, true);
      },
    };

    const place = (p: Vec3, h: number): void => {
      body.setTranslation({ x: p.x, y: p.y + chassis.comHeight, z: p.z }, true);
      body.setRotation(quatFromHeading(h), true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    };

    return { body, collider, port, place };
  }

  step(): void {
    this.world.step();
  }

  free(): void {
    this.world.free();
  }
}

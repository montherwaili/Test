/** The player's car: a smooth saloon body (carBody.ts), sized from the tuning file. */
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  DoubleSide,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Texture,
} from 'three';
import { rimGeometry, sedanBody, tyreGeometry } from './carBody';
import type { CarFit, FittedCar } from './kenneyCars';
import type { VehicleTuning } from '../sim/tuning';

export interface CarLights {
  brake: boolean;
  reverse: boolean;
  left: boolean;
  right: boolean;
  head: boolean;
}

export interface CarModel {
  root: Group;
  /** One group per wheel (FL, FR, RL, RR): position + steer on the group, spin on its child. */
  wheels: { steer: Group; spin: Group }[];
  /** Roof and glass: hidden from the driver's seat. */
  cabin: Group;
  /** Dashboard, wheel and pillars: shown only from the driver's seat. */
  interior: Group;
  steeringWheel: Group;
  mirrors: { left: Mesh; centre: Mesh; right: Mesh };
  setLights(l: CarLights): void;
  setMirrorTextures(left: Texture, centre: Texture, right: Texture): void;
  /** Reflections of the sky for paint, glass and chrome. */
  setEnvironment(env: Texture): void;
  /** Swap the drawn body and wheels for a model (fitted to this car). */
  useModel(model: FittedCar): void;
  /** Where the body is, for fitting a model to it. */
  fit: CarFit;
}

/** Driver's eye in the chassis frame (left-hand drive, as in Oman). */
export const DRIVER_EYE = { x: -0.37, y: 0.68, z: 0.12 };

export function createCarModel(tuning: VehicleTuning): CarModel {
  const { chassis, body: bt } = tuning;
  const toRear = chassis.frontWeightFraction * chassis.wheelbase;
  const toFront = chassis.wheelbase - toRear;
  const front = -(toFront + chassis.frontOverhang);
  const rear = toRear + chassis.rearOverhang;
  const length = rear - front;
  const bottom = chassis.groundClearance - chassis.comHeight;
  const roof = chassis.bodyHeight - chassis.comHeight;
  const beltLine = bottom + 0.62;
  const w = chassis.bodyWidth;

  // Paint with a clear coat, tinted glass and chrome reflect the sky (setEnvironment).
  const paint = new MeshPhysicalMaterial({ color: 0xeeeeea, roughness: 0.32, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.06 });
  const glass = new MeshPhysicalMaterial({ color: 0x07090b, roughness: 0.15, metalness: 0, side: DoubleSide });
  const trim = new MeshStandardMaterial({ color: 0x17181a, roughness: 0.6 });
  const tyre = new MeshStandardMaterial({ color: 0x151515, roughness: 0.92 });
  const rim = new MeshStandardMaterial({ color: 0xc4c8cc, roughness: 0.25, metalness: 0.85 });
  const chrome = new MeshStandardMaterial({ color: 0xdfe2e5, roughness: 0.12, metalness: 1 });

  const root = new Group();
  const wheelY = bt.wheelRadius - chassis.comHeight;
  const body = sedanBody({
    front,
    rear,
    width: w,
    bottom,
    belt: beltLine,
    roof,
    axles: [-toFront, toRear],
    wheelY,
    wheelRadius: bt.wheelRadius,
  });
  const lower = new Mesh(body.paint, paint);
  lower.castShadow = true;
  root.add(lower);
  const trimMesh = new Mesh(body.trim, trim);
  root.add(trimMesh);
  /** Drawn details that a model replaces. */
  const extras: Mesh[] = [];

  // Cabin: the glass (and the roof painted over it), hidden from the driver's seat.
  const cabin = new Group();
  const glasshouse = new Mesh(body.glass, glass);
  glasshouse.castShadow = true;
  cabin.add(glasshouse);
  root.add(cabin);

  // Lamps: lenses set into the body's corners, lit by their own glow.
  const lamp = (color: number, base = 0x2a2a2a) =>
    new MeshStandardMaterial({ color: base, emissive: color, emissiveIntensity: 0, roughness: 0.15, metalness: 0.2 });
  const mats = {
    head: lamp(0xfff4d6, 0xd9dde2),
    brake: lamp(0xff1a1a, 0x5a0d0d),
    reverse: lamp(0xffffff, 0x8a8a8a),
    left: lamp(0xffa000, 0x7a4a10),
    right: lamp(0xffa000, 0x7a4a10),
  };
  const lenses: Mesh[] = [];
  const lens = (mat: MeshStandardMaterial, x: number, y: number, z: number, sx: number, sy: number, yaw = 0) => {
    const m = new Mesh(new BoxGeometry(sx, sy, 0.05), mat);
    m.position.set(x, y, z);
    m.rotation.y = yaw;
    root.add(m);
    lenses.push(m);
  };
  const lift = beltLine - bottom;
  for (const side of [-1, 1]) {
    // On the faces of the nose and tail (the body's rounded edges stand 6 cm proud of its outline).
    lens(mats.head, side * w * 0.31, bottom + lift * 0.62, front - 0.045, 0.4, 0.11);
    lens(side < 0 ? mats.left : mats.right, side * w * 0.44, bottom + lift * 0.62, front - 0.03, 0.1, 0.08);
    lens(mats.brake, side * w * 0.32, bottom + lift * 0.74, rear + 0.045, 0.42, 0.12);
    lens(mats.reverse, side * w * 0.12, bottom + lift * 0.74, rear + 0.045, 0.1, 0.08);
    lens(side < 0 ? mats.left : mats.right, side * w * 0.44, bottom + lift * 0.62, rear + 0.035, 0.09, 0.08);
  }
  // A chrome strip across the boot, and the number plates.
  const strip = new Mesh(new BoxGeometry(w * 0.38, 0.025, 0.02), chrome);
  strip.position.set(0, bottom + lift * 0.74, rear + 0.05);
  root.add(strip);
  extras.push(strip);
  const plateMat = new MeshStandardMaterial({ color: 0xf4f1e6, roughness: 0.5 });
  for (const [zz, y] of [
    [front - 0.07, bottom + lift * 0.36],
    [rear + 0.065, bottom + lift * 0.46],
  ] as const) {
    const plate = new Mesh(new BoxGeometry(0.42, 0.11, 0.02), plateMat);
    plate.position.set(0, y, zz);
    root.add(plate);
    extras.push(plate);
  }

  // Door mirrors and the interior mirror; their faces show the mirror cameras' pictures.
  const mirrorFace = () => new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: 0x8899aa }));
  const mirrors = { left: mirrorFace(), centre: mirrorFace(), right: mirrorFace() };
  const housings: Mesh[] = [];
  for (const side of [-1, 1] as const) {
    const housing = new Mesh(new BoxGeometry(0.2, 0.13, 0.08), paint);
    housing.position.set(side * (w / 2 * 0.95 + 0.07), beltLine + 0.06, front + length * 0.355);
    root.add(housing);
    housings.push(housing);
    const face = side < 0 ? mirrors.left : mirrors.right;
    face.scale.set(0.17, 0.1, 1);
    // Faces look backwards (+Z), angled slightly towards the driver.
    face.position.set(housing.position.x, housing.position.y, housing.position.z + 0.045);
    face.rotation.y = side < 0 ? 0.25 : -0.12;
    root.add(face);
  }

  // Interior, as seen from the driver's seat: laid out round the driver's eye.
  const interior = new Group();
  const E = DRIVER_EYE;
  const plastic = new MeshStandardMaterial({ color: 0x2a2b2f, roughness: 0.85 });
  const lining = new MeshStandardMaterial({ color: 0xe2ded6, emissive: 0x3a3833, roughness: 0.95, side: DoubleSide });
  const doorTrim = new MeshStandardMaterial({ color: 0x3b3c41, roughness: 0.8 });
  // Where the windscreen meets the roof and the dashboard.
  const screenTop = { y: roof - 0.03, z: E.z - 0.55 };
  const screenFoot = { y: beltLine + 0.08, z: E.z - 1.05 };
  const pillarX = w * 0.43;
  // The roof lining, from the top of the windscreen back over the head.
  const headliner = new Mesh(new PlaneGeometry(pillarX * 2 + 0.1, 1.5), lining);
  headliner.rotation.x = Math.PI / 2;
  headliner.position.set(0, screenTop.y + 0.01, screenTop.z + 0.75);
  interior.add(headliner);
  const header = new Mesh(new BoxGeometry(pillarX * 2, 0.03, 0.05), plastic);
  header.position.set(0, screenTop.y, screenTop.z);
  interior.add(header);
  // A pillars along the windscreen's sides, and the door tops beneath the side windows.
  const strut = (from: Vector3, to: Vector3, thick: number) => {
    const m = new Mesh(new BoxGeometry(thick, thick * 0.75, from.distanceTo(to)), plastic);
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.lookAt(to);
    interior.add(m);
  };
  for (const side of [-1, 1]) {
    strut(new Vector3(side * (pillarX + 0.03), screenFoot.y, screenFoot.z), new Vector3(side * (pillarX - 0.03), screenTop.y, screenTop.z), 0.07);
    const door = new Mesh(new BoxGeometry(0.08, 0.32, 1.6), doorTrim);
    door.position.set(side * (pillarX + 0.02), beltLine - 0.11, E.z - 0.25);
    interior.add(door);
    const sill = new Mesh(new BoxGeometry(0.1, 0.025, 1.6), plastic);
    sill.position.set(side * (pillarX + 0.02), beltLine + 0.06, E.z - 0.25);
    interior.add(sill);
  }
  // The dashboard: a broad top under the windscreen, and a hood over the instruments.
  const dash = new Mesh(new BoxGeometry(pillarX * 2 + 0.05, 0.16, 0.5), plastic);
  dash.position.set(0, screenFoot.y - 0.09, screenFoot.z + 0.24);
  interior.add(dash);
  const dashFace = new Mesh(new BoxGeometry(pillarX * 2, 0.22, 0.05), doorTrim);
  dashFace.position.set(0, screenFoot.y - 0.25, screenFoot.z + 0.48);
  interior.add(dashFace);
  // A low hood over the instruments, in front of the driver.
  const hood = new Mesh(new BoxGeometry(0.42, 0.07, 0.2), plastic);
  hood.position.set(E.x, screenFoot.y + 0.02, screenFoot.z + 0.42);
  interior.add(hood);
  const steeringWheel = new Group();
  const leather = new MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.6 });
  const wheelRim = new Mesh(new TorusGeometry(0.18, 0.022, 10, 36), leather);
  const hub = new Mesh(new CylinderGeometry(0.06, 0.07, 0.05, 16), leather);
  hub.rotation.x = Math.PI / 2;
  const spokeL = new Mesh(new BoxGeometry(0.13, 0.035, 0.02), leather);
  spokeL.position.set(-0.11, -0.01, 0);
  const spokeR = spokeL.clone();
  spokeR.position.x = 0.11;
  const spokeD = new Mesh(new BoxGeometry(0.035, 0.12, 0.02), leather);
  spokeD.position.y = -0.1;
  steeringWheel.add(wheelRim, hub, spokeL, spokeR, spokeD);
  steeringWheel.position.set(E.x, beltLine - 0.02, E.z - 0.5);
  steeringWheel.rotation.x = -0.35;
  interior.add(steeringWheel);
  // The interior mirror hangs from the top of the windscreen.
  mirrors.centre.scale.set(0.2, 0.06, 1);
  mirrors.centre.position.set(0, screenTop.y - 0.09, screenTop.z + 0.05);
  mirrors.centre.rotation.y = -0.3;
  const centreHousing = new Mesh(new BoxGeometry(0.22, 0.075, 0.03), plastic);
  centreHousing.position.set(0, screenTop.y - 0.09, screenTop.z + 0.03);
  centreHousing.rotation.y = -0.3;
  interior.add(centreHousing, mirrors.centre);
  // The door mirrors stand outside, just behind the foot of each A pillar, at the window line
  // (the mirror cameras are placed from these, so the pictures match).
  housings.forEach((housing, k) => {
    const side = k === 0 ? -1 : 1;
    const face = side < 0 ? mirrors.left : mirrors.right;
    face.position.set(side * (w / 2 + 0.12), beltLine + 0.12, screenFoot.z + 0.16);
    housing.position.set(face.position.x, face.position.y, face.position.z - 0.045);
  });
  interior.visible = false;
  root.add(interior);

  // Wheels: rounded tyres on five-spoke alloys.
  const wheels: CarModel['wheels'] = [];
  const tyreGeo = tyreGeometry(bt.wheelRadius, 0.2);
  const rimRight = rimGeometry(bt.wheelRadius, 0.2);
  const rimLeft = rimRight.clone();
  rimLeft.scale(-1, 1, 1);
  for (let i = 0; i < 4; i++) {
    const steer = new Group();
    const spin = new Group();
    const t = new Mesh(tyreGeo, tyre);
    t.castShadow = true;
    // Wheels 0 and 2 are on the left.
    spin.add(t, new Mesh(i % 2 === 0 ? rimLeft : rimRight, rim));
    steer.add(spin);
    root.add(steer);
    wheels.push({ steer, spin });
  }

  const lit = { overlay: false, last: { brake: false, reverse: false, left: false, right: false, head: false } as CarLights };
  const setLights = (l: CarLights): void => {
    lit.last = l;
    mats.brake.emissiveIntensity = l.brake ? 2.2 : 0.25;
    mats.reverse.emissiveIntensity = l.reverse ? 1.6 : 0;
    mats.left.emissiveIntensity = l.left ? 2.4 : 0.1;
    mats.right.emissiveIntensity = l.right ? 2.4 : 0.1;
    mats.head.emissiveIntensity = l.head ? 2 : 0.15;
    // Over a model, a lamp is only drawn while it is lit (the model has its own lamps).
    if (lit.overlay) {
      // The tail lamps: brighter when braking, and on with the headlamps.
      mats.brake.opacity = l.brake ? 1 : l.head ? 0.55 : 0;
      mats.reverse.opacity = l.reverse ? 1 : 0;
      mats.left.opacity = l.left ? 1 : 0;
      mats.right.opacity = l.right ? 1 : 0;
      mats.head.opacity = l.head ? 0.9 : 0;
    }
  };
  setLights({ brake: false, reverse: false, left: false, right: false, head: false });

  const setMirrorTextures = (left: Texture, centre: Texture, right: Texture): void => {
    const apply = (mesh: Mesh, texture: Texture) => {
      const m = mesh.material as MeshBasicMaterial;
      m.map = texture;
      m.color.set(0xffffff);
      m.needsUpdate = true;
      // A mirror swaps left and right.
      const uv = mesh.geometry.attributes['uv']!;
      for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
      uv.needsUpdate = true;
    };
    apply(mirrors.left, left);
    apply(mirrors.centre, centre);
    apply(mirrors.right, right);
  };

  const setEnvironment = (env: Texture): void => {
    for (const m of [paint, glass, rim, chrome]) {
      m.envMap = env;
      m.envMapIntensity = m === glass ? 0.2 : m === paint ? 0.9 : 1;
      m.needsUpdate = true;
    }
  };

  const fit: CarFit = {
    front,
    rear,
    frontAxle: -toFront,
    rearAxle: toRear,
    width: w,
    ground: -chassis.comHeight,
    roof,
  };
  const useModel = (model: FittedCar): void => {
    // The drawn body, glass, trim, lamps and plates go; the lamps' glow stays, laid over the model's own lamps.
    lower.visible = false;
    trimMesh.visible = false;
    glasshouse.visible = false;
    for (const m of extras) m.visible = false;
    // The model has its own door mirrors: ours (housing and picture) are seen only from the driver's seat.
    for (const h of housings) {
      root.remove(h);
      h.material = trim;
      interior.add(h);
    }
    for (const face of [mirrors.left, mirrors.right]) {
      root.remove(face);
      interior.add(face);
    }
    const kit = new Mesh(model.body, model.material);
    kit.castShadow = true;
    kit.receiveShadow = true;
    // From the driver's seat the body is hidden, as the cabin was.
    cabin.add(kit);
    wheels.forEach((w, i) => {
      w.spin.clear();
      const m = new Mesh(i % 2 === 0 ? model.wheelLeft : model.wheelRight, model.material);
      m.castShadow = true;
      w.spin.add(m);
    });
    // The lamps glow on the model's own lamps (found by their colour), not on boxes of ours.
    for (const l of lenses) l.visible = false;
    const glow = (g: BufferGeometry, mat: MeshStandardMaterial) => {
      const m = new Mesh(g, mat);
      m.renderOrder = 2;
      root.add(m);
    };
    glow(model.lamps.head, mats.head);
    glow(model.lamps.tail, mats.brake);
    glow(model.lamps.left, mats.left);
    glow(model.lamps.right, mats.right);
    for (const mat of Object.values(mats)) {
      mat.transparent = true;
      mat.depthWrite = false;
      mat.side = DoubleSide;
      mat.needsUpdate = true;
    }
    lit.overlay = true;
    setLights(lit.last);
  };

  return { root, wheels, cabin, interior, steeringWheel, mirrors, setLights, setMirrorTextures, setEnvironment, useModel, fit };
}

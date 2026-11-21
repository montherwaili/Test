/** The player's car: a smooth saloon body (carBody.ts), sized from the tuning file. */
import {
  BoxGeometry,
  Group,
  Mesh,
  DoubleSide,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  TorusGeometry,
  type Texture,
} from 'three';
import { rimGeometry, sedanBody, tyreGeometry } from './carBody';
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
  root.add(new Mesh(body.trim, trim));

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
  const lens = (mat: MeshStandardMaterial, x: number, y: number, z: number, sx: number, sy: number, yaw = 0) => {
    const m = new Mesh(new BoxGeometry(sx, sy, 0.05), mat);
    m.position.set(x, y, z);
    m.rotation.y = yaw;
    root.add(m);
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
  const plateMat = new MeshStandardMaterial({ color: 0xf4f1e6, roughness: 0.5 });
  for (const [zz, y] of [
    [front - 0.07, bottom + lift * 0.36],
    [rear + 0.065, bottom + lift * 0.46],
  ] as const) {
    const plate = new Mesh(new BoxGeometry(0.42, 0.11, 0.02), plateMat);
    plate.position.set(0, y, zz);
    root.add(plate);
  }

  // Door mirrors and the interior mirror; their faces show the mirror cameras' pictures.
  const mirrorFace = () => new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: 0x8899aa }));
  const mirrors = { left: mirrorFace(), centre: mirrorFace(), right: mirrorFace() };
  for (const side of [-1, 1] as const) {
    const housing = new Mesh(new BoxGeometry(0.2, 0.13, 0.08), paint);
    housing.position.set(side * (w / 2 * 0.95 + 0.07), beltLine + 0.06, front + length * 0.355);
    root.add(housing);
    const face = side < 0 ? mirrors.left : mirrors.right;
    face.scale.set(0.17, 0.1, 1);
    // Faces look backwards (+Z), angled slightly towards the driver.
    face.position.set(housing.position.x, housing.position.y, housing.position.z + 0.045);
    face.rotation.y = side < 0 ? 0.25 : -0.12;
    root.add(face);
  }

  // Interior, as seen from the driver's seat.
  const interior = new Group();
  // Kept lower and slimmer than a real dashboard so more of the road shows.
  const dash = new Mesh(new BoxGeometry(w * 0.9, 0.18, 0.46), trim);
  dash.position.set(0, beltLine - 0.06, DRIVER_EYE.z - 0.8);
  interior.add(dash);
  const cowl = new Mesh(new BoxGeometry(0.38, 0.07, 0.18), trim);
  cowl.position.set(DRIVER_EYE.x, beltLine + 0.06, DRIVER_EYE.z - 0.68);
  interior.add(cowl);
  for (const side of [-1, 1]) {
    const pillar = new Mesh(new BoxGeometry(0.05, 0.7, 0.05), trim);
    pillar.position.set(side * w * 0.43, beltLine + 0.32, DRIVER_EYE.z - 0.86);
    pillar.rotation.x = 0.55;
    pillar.rotation.z = side * -0.12;
    interior.add(pillar);
  }
  const header = new Mesh(new BoxGeometry(w * 0.8, 0.03, 0.1), trim);
  header.position.set(0, roof - 0.015, DRIVER_EYE.z - 0.42);
  interior.add(header);
  const steeringWheel = new Group();
  const wheelRim = new Mesh(new TorusGeometry(0.17, 0.018, 6, 20), trim);
  const spoke = new Mesh(new BoxGeometry(0.32, 0.03, 0.02), trim);
  const spoke2 = new Mesh(new BoxGeometry(0.03, 0.16, 0.02), trim);
  spoke2.position.y = -0.085;
  steeringWheel.add(wheelRim, spoke, spoke2);
  steeringWheel.position.set(DRIVER_EYE.x, beltLine - 0.02, DRIVER_EYE.z - 0.5);
  steeringWheel.rotation.x = -0.35;
  interior.add(steeringWheel);
  mirrors.centre.scale.set(0.24, 0.07, 1);
  mirrors.centre.position.set(0, roof - 0.13, DRIVER_EYE.z - 0.52);
  mirrors.centre.rotation.y = -0.3;
  interior.add(mirrors.centre);
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

  const setLights = (l: CarLights): void => {
    mats.brake.emissiveIntensity = l.brake ? 2.2 : 0.25;
    mats.reverse.emissiveIntensity = l.reverse ? 1.6 : 0;
    mats.left.emissiveIntensity = l.left ? 2.4 : 0.1;
    mats.right.emissiveIntensity = l.right ? 2.4 : 0.1;
    mats.head.emissiveIntensity = l.head ? 2 : 0.15;
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

  return { root, wheels, cabin, interior, steeringWheel, mirrors, setLights, setMirrorTextures, setEnvironment };
}

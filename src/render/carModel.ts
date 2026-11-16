/** A low-poly car built from primitives, sized from the tuning file. */
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  TorusGeometry,
  type Texture,
} from 'three';
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
}

/** Driver's eye in the chassis frame (left-hand drive, as in Oman). */
export const DRIVER_EYE = { x: -0.37, y: 0.68, z: 0.12 };

function tapered(width: number, height: number, length: number, topScaleX: number, topScaleZ: number, shiftZ: number) {
  const g = new BoxGeometry(width, height, length);
  const p = g.attributes['position']!;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      p.setX(i, p.getX(i) * topScaleX);
      p.setZ(i, p.getZ(i) * topScaleZ + shiftZ);
    }
  }
  g.computeVertexNormals();
  return g;
}

export function createCarModel(tuning: VehicleTuning): CarModel {
  const { chassis, body: bt } = tuning;
  const toRear = chassis.frontWeightFraction * chassis.wheelbase;
  const toFront = chassis.wheelbase - toRear;
  const front = -(toFront + chassis.frontOverhang);
  const rear = toRear + chassis.rearOverhang;
  const length = rear - front;
  const midZ = (front + rear) / 2;
  const bottom = chassis.groundClearance - chassis.comHeight;
  const roof = chassis.bodyHeight - chassis.comHeight;
  const beltLine = bottom + 0.62;
  const w = chassis.bodyWidth;

  const paint = new MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.45, metalness: 0.1, flatShading: true });
  const glass = new MeshStandardMaterial({ color: 0x1c2630, roughness: 0.2, metalness: 0.3, flatShading: true });
  const trim = new MeshStandardMaterial({ color: 0x22252a, roughness: 0.8, flatShading: true });
  const tyre = new MeshStandardMaterial({ color: 0x141414, roughness: 0.95, flatShading: true });
  const rim = new MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.4, metalness: 0.6, flatShading: true });

  const root = new Group();

  // Lower body, with the nose and tail pulled in a little.
  const lower = new Mesh(tapered(w, beltLine - bottom, length, 0.96, 0.97, 0), paint);
  lower.position.set(0, (bottom + beltLine) / 2, midZ);
  lower.castShadow = true;
  root.add(lower);

  const bumperF = new Mesh(new BoxGeometry(w * 0.98, 0.2, 0.12), trim);
  bumperF.position.set(0, bottom + 0.12, front + 0.03);
  const bumperR = bumperF.clone();
  bumperR.position.z = rear - 0.03;
  root.add(bumperF, bumperR);

  // Cabin: glasshouse and roof.
  const cabin = new Group();
  const cabinLength = length * 0.52;
  const cabinZ = midZ + length * 0.06;
  const glasshouse = new Mesh(tapered(w * 0.94, roof - beltLine - 0.04, cabinLength, 0.84, 0.66, 0.04), glass);
  glasshouse.position.set(0, (beltLine + roof - 0.04) / 2, cabinZ);
  glasshouse.castShadow = true;
  const roofPanel = new Mesh(new BoxGeometry(w * 0.94 * 0.84, 0.05, cabinLength * 0.66), paint);
  roofPanel.position.set(0, roof - 0.025, cabinZ + 0.04);
  cabin.add(glasshouse, roofPanel);
  root.add(cabin);

  // Lamps.
  const lamp = (color: number) =>
    new MeshStandardMaterial({ color: 0x333333, emissive: color, emissiveIntensity: 0, roughness: 0.4 });
  const mats = {
    head: lamp(0xfff4d6),
    brake: lamp(0xff1a1a),
    reverse: lamp(0xffffff),
    left: lamp(0xffa000),
    right: lamp(0xffa000),
  };
  const lampBox = (mat: MeshStandardMaterial, x: number, y: number, z: number, sx = 0.3) => {
    const m = new Mesh(new BoxGeometry(sx, 0.11, 0.06), mat);
    m.position.set(x, y, z);
    root.add(m);
  };
  const lampY = beltLine - 0.14;
  for (const side of [-1, 1]) {
    lampBox(mats.head, side * (w / 2 - 0.3), lampY, front + 0.01);
    lampBox(mats.brake, side * (w / 2 - 0.3), lampY, rear - 0.01);
    lampBox(mats.reverse, side * (w / 2 - 0.55), lampY, rear - 0.005, 0.14);
    const ind = side < 0 ? mats.left : mats.right;
    lampBox(ind, side * (w / 2 - 0.09), lampY, front + 0.03, 0.12);
    lampBox(ind, side * (w / 2 - 0.09), lampY, rear - 0.03, 0.12);
  }

  // Door mirrors and the interior mirror; their faces show the mirror cameras' pictures.
  const mirrorFace = () => new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: 0x8899aa }));
  const mirrors = { left: mirrorFace(), centre: mirrorFace(), right: mirrorFace() };
  for (const side of [-1, 1] as const) {
    const housing = new Mesh(new BoxGeometry(0.2, 0.13, 0.08), paint);
    housing.position.set(side * (w / 2 + 0.09), beltLine + 0.07, cabinZ - cabinLength * 0.36);
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

  // Wheels.
  const wheels: CarModel['wheels'] = [];
  const tyreGeo = new CylinderGeometry(bt.wheelRadius, bt.wheelRadius, 0.2, 14);
  tyreGeo.rotateZ(Math.PI / 2);
  const rimGeo = new CylinderGeometry(bt.wheelRadius * 0.62, bt.wheelRadius * 0.62, 0.21, 10);
  rimGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new BoxGeometry(0.22, bt.wheelRadius * 1.1, 0.05);
  for (let i = 0; i < 4; i++) {
    const steer = new Group();
    const spin = new Group();
    const t = new Mesh(tyreGeo, tyre);
    t.castShadow = true;
    spin.add(t, new Mesh(rimGeo, rim), new Mesh(spokeGeo, trim));
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

  return { root, wheels, cabin, interior, steeringWheel, mirrors, setLights, setMirrorTextures };
}

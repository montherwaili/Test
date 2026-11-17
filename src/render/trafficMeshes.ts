/**
 * Traffic cars and pedestrians, drawn with instancing: every car is one
 * instance of the same low-poly shape with its own paint colour, so a busy
 * town adds only a handful of draw calls.
 */
import {
  BoxGeometry,
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Pedestrian } from '../traffic/pedestrians';
import type { TrafficCar } from '../traffic/vehicles';

/** Paint colours for traffic cars (white and silver are the most common, as on Omani roads). */
const CAR_COLORS = [0xf2f2ee, 0xc9ccd1, 0xf2f2ee, 0x8d9299, 0x2f3338, 0xb23a2e, 0x2f5d8a, 0xc9b58a];

/** Robe colours for pedestrians: white dishdashas and dark abayas. */
const ROBE_COLORS = [0xf5f3ec, 0xf5f3ec, 0x1c1c1f, 0x2a2233];

function tinted(g: BufferGeometry, color: number, x: number, y: number, z: number): BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.translate(x, y, z);
  const c = new Color(color);
  const n = geo.attributes['position']!.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  geo.deleteAttribute('uv');
  return geo;
}

/** A car facing -Z with its wheels on y = 0. White body parts take the instance colour. */
function carGeometry(length: number, width: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const cabin = new BoxGeometry(width * 0.9, 0.5, length * 0.5);
  const pos = cabin.attributes['position']!;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      pos.setX(i, pos.getX(i) * 0.84);
      pos.setZ(i, pos.getZ(i) * 0.7);
    }
  }
  parts.push(tinted(new BoxGeometry(width, 0.6, length), 0xffffff, 0, 0.5, 0));
  parts.push(tinted(cabin, 0x20262c, 0, 1.05, length * 0.05));
  parts.push(tinted(new BoxGeometry(width * 0.74, 0.05, length * 0.34), 0xffffff, 0, 1.32, length * 0.05));
  const wheel = new CylinderGeometry(0.3, 0.3, 0.2, 10);
  wheel.rotateZ(Math.PI / 2);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(tinted(wheel.clone(), 0x151515, sx * (width / 2 - 0.08), 0.3, sz * length * 0.31));
    }
  }
  const merged = mergeGeometries(parts, false);
  merged.computeVertexNormals();
  return merged;
}

/** A pair of lamps (left and right, or front and rear) as one geometry. */
function lampPair(boxes: [number, number, number, number, number, number][]): BufferGeometry {
  return mergeGeometries(
    boxes.map(([x, y, z, sx, sy, sz]) => {
      const g = new BoxGeometry(sx, sy, sz);
      g.translate(x, y, z);
      return g;
    }),
    false,
  );
}

export class TrafficMeshes {
  readonly root = new Group();
  private readonly bodies: InstancedMesh;
  private readonly brake: InstancedMesh;
  private readonly left: InstancedMesh;
  private readonly right: InstancedMesh;
  private readonly robes: InstancedMesh;
  private readonly heads: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler(0, 0, 0, 'YXZ');
  private readonly v = new Vector3();
  private readonly one = new Vector3(1, 1, 1);
  private readonly lit = { brake: new Color(0xff1a1a), dimBrake: new Color(0x3a0606), amber: new Color(0xffa000), dimAmber: new Color(0x3a2600) };

  constructor(cars: readonly TrafficCar[], people: readonly Pedestrian[]) {
    const length = cars[0]?.length ?? 4.2;
    const width = cars[0]?.width ?? 1.7;
    const count = Math.max(1, cars.length);
    const half = length / 2;
    const side = width / 2 - 0.2;

    this.bodies = new InstancedMesh(
      carGeometry(length, width),
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1, flatShading: true }),
      count,
    );
    this.bodies.castShadow = true;
    const lamp = () => new MeshBasicMaterial();
    this.brake = new InstancedMesh(lampPair([[-side, 0.62, half, 0.34, 0.12, 0.05], [side, 0.62, half, 0.34, 0.12, 0.05]]), lamp(), count);
    this.left = new InstancedMesh(lampPair([[-(width / 2 - 0.06), 0.62, half, 0.12, 0.12, 0.06], [-(width / 2 - 0.06), 0.62, -half, 0.12, 0.12, 0.06]]), lamp(), count);
    this.right = new InstancedMesh(lampPair([[width / 2 - 0.06, 0.62, half, 0.12, 0.12, 0.06], [width / 2 - 0.06, 0.62, -half, 0.12, 0.12, 0.06]]), lamp(), count);

    const c = new Color();
    for (const mesh of [this.bodies, this.brake, this.left, this.right]) {
      mesh.count = cars.length;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      for (let i = 0; i < count; i++) mesh.setColorAt(i, c.set(0xffffff));
      this.root.add(mesh);
    }
    cars.forEach((car, i) => this.bodies.setColorAt(i, c.set(CAR_COLORS[car.color % CAR_COLORS.length]!)));
    this.bodies.instanceColor!.needsUpdate = true;

    // People: a robe with a head on top, and a cap or scarf.
    const pc = Math.max(1, people.length);
    const robe = new CylinderGeometry(0.2, 0.3, 1.42, 8);
    robe.translate(0, 0.71, 0);
    this.robes = new InstancedMesh(robe, new MeshStandardMaterial({ roughness: 0.9, flatShading: true }), pc);
    const head = mergeGeometries(
      [tinted(new SphereGeometry(0.13, 8, 6), 0xc99a6b, 0, 1.56, 0), tinted(new ConeGeometry(0.15, 0.14, 8), 0xffffff, 0, 1.7, 0)],
      false,
    );
    this.heads = new InstancedMesh(head, new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), pc);
    for (const mesh of [this.robes, this.heads]) {
      mesh.count = people.length;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      this.root.add(mesh);
    }
    people.forEach((p, i) => {
      this.robes.setColorAt(i, c.set(ROBE_COLORS[p.style % ROBE_COLORS.length]!));
      // Men: a pale cap over a bare face. Women: a dark headscarf.
      this.heads.setColorAt(i, c.set(p.style < 2 ? 0xffffff : 0x55504c));
    });
    if (this.robes.instanceColor) this.robes.instanceColor.needsUpdate = true;
    if (this.heads.instanceColor) this.heads.instanceColor.needsUpdate = true;
  }

  /** Move every instance to where the traffic logic has put it. `time` drives the indicator flash. */
  update(cars: readonly TrafficCar[], people: readonly Pedestrian[], time: number): void {
    const flash = (time * 1.5) % 1 < 0.5;
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]!;
      this.e.set(car.pitch, (-car.headingDeg * Math.PI) / 180, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.v.set(car.x, car.y, car.z), this.q, this.one);
      this.bodies.setMatrixAt(i, this.m);
      this.brake.setMatrixAt(i, this.m);
      this.left.setMatrixAt(i, this.m);
      this.right.setMatrixAt(i, this.m);
      this.brake.setColorAt(i, car.braking || car.speed < 0.1 ? this.lit.brake : this.lit.dimBrake);
      this.left.setColorAt(i, car.indicator === 'left' && flash ? this.lit.amber : this.lit.dimAmber);
      this.right.setColorAt(i, car.indicator === 'right' && flash ? this.lit.amber : this.lit.dimAmber);
    }
    for (const mesh of [this.bodies, this.brake, this.left, this.right]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh !== this.bodies && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (let i = 0; i < people.length; i++) {
      const p = people[i]!;
      // A slight bob while walking.
      const bob = p.state === 'crossing' ? Math.abs(Math.sin(p.walked * 4.5)) * 0.04 : 0;
      this.e.set(0, (-p.headingDeg * Math.PI) / 180, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.v.set(p.x, bob, p.z), this.q, this.one);
      this.robes.setMatrixAt(i, this.m);
      this.heads.setMatrixAt(i, this.m);
    }
    this.robes.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }
}

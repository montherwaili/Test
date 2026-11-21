/**
 * Traffic cars and pedestrians, drawn with instancing: every car is one
 * instance of the same low-poly shape with its own paint colour, so a busy
 * town adds only a handful of draw calls.
 */
import {
  BoxGeometry,
  BufferAttribute,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Pedestrian } from '../traffic/pedestrians';
import type { TrafficCar } from '../traffic/vehicles';
import { sedanBody, tyreGeometry } from './carBody';
import { headwearGeometry, robeGeometry, skinGeometry } from './props';

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

/** A car facing -Z with its wheels on y = 0: the same saloon as the player's. White parts take the instance colour. */
function carGeometry(length: number, width: number): BufferGeometry {
  const body = sedanBody({
    front: -length / 2,
    rear: length / 2,
    width,
    bottom: 0.17,
    belt: 0.8,
    roof: 1.42,
    axles: [-length * 0.31, length * 0.3],
    wheelY: 0.3,
    wheelRadius: 0.3,
  }, 0.3);
  const parts: BufferGeometry[] = [
    tinted(body.paint, 0xffffff, 0, 0, 0),
    tinted(body.glass, 0x111519, 0, 0, 0),
    tinted(body.trim, 0x151618, 0, 0, 0),
  ];
  const wheel = tyreGeometry(0.3, 0.2, 10);
  for (const sx of [-1, 1]) {
    for (const z of [-length * 0.31, length * 0.3]) {
      parts.push(tinted(wheel.clone(), 0x151515, sx * (width / 2 - 0.1), 0.3, z));
    }
  }
  for (const g of parts) {
    g.deleteAttribute('normal');
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
  private readonly skin: InstancedMesh;
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
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.15, side: DoubleSide }),
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

    // People: a long robe with arms, a face and hands, and a cap-and-scarf or headscarf.
    const pc = Math.max(1, people.length);
    this.robes = new InstancedMesh(robeGeometry(), new MeshStandardMaterial({ roughness: 0.85 }), pc);
    this.skin = new InstancedMesh(skinGeometry(), new MeshStandardMaterial({ color: 0xb98a63, roughness: 0.7 }), pc);
    this.heads = new InstancedMesh(headwearGeometry(), new MeshStandardMaterial({ roughness: 0.85, side: DoubleSide }), pc);
    for (const mesh of [this.robes, this.skin, this.heads]) {
      mesh.count = people.length;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      this.root.add(mesh);
    }
    people.forEach((p, i) => {
      this.robes.setColorAt(i, c.set(ROBE_COLORS[p.style % ROBE_COLORS.length]!));
      // Men in white dishdashas: a white ghutra. Women in black abayas: a black shayla.
      this.heads.setColorAt(i, c.set(p.style < 2 ? 0xf7f6f0 : 0x1a1a1d));
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
      this.skin.setMatrixAt(i, this.m);
      this.heads.setMatrixAt(i, this.m);
    }
    this.robes.instanceMatrix.needsUpdate = true;
    this.skin.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }
}

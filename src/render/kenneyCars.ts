/**
 * Car models from Kenney's Car Kit (CC0; public/models/cars/CREDITS.md),
 * fitted to the game's cars.
 *
 * The kit's cars are toys in proportion: a short wheelbase in a long body.
 * Each is stretched to the car it stands for - its length, width, height
 * and, above all, where its axles are - with the wheel arches kept round:
 * the body is mapped piecewise along its length so each arch keeps its
 * shape over its axle, and the doors, bonnet and boot take up the rest.
 *
 * Models face +Z in the kit; the game's cars face -Z.
 */
import { BufferGeometry, Material, Matrix4, Mesh, MeshStandardMaterial, Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** A car's measurements in its own frame (facing -Z, origin anywhere). */
export interface CarFit {
  /** z of the nose (negative) and the tail. */
  front: number;
  rear: number;
  /** z of the front and rear axles. */
  frontAxle: number;
  rearAxle: number;
  width: number;
  /** y of the ground and of the roof. */
  ground: number;
  roof: number;
}

export interface FittedCar {
  /** The body, fitted. */
  body: BufferGeometry;
  /** A wheel centred on its axle, rolling about X, outer face out: -X for the left, +X for the right. */
  wheelLeft: BufferGeometry;
  wheelRight: BufferGeometry;
  material: Material;
}

interface RawCar {
  body: BufferGeometry;
  bodyAt: [number, number, number];
  wheels: Record<string, { geometry: BufferGeometry; at: [number, number, number] }>;
  material: Material;
}

const raw = new Map<string, Promise<RawCar>>();

function load(name: string): Promise<RawCar> {
  let p = raw.get(name);
  if (!p) {
    p = new GLTFLoader().loadAsync(new URL(`models/cars/${name}.json`, document.baseURI).href).then((gltf) => {
      let body: RawCar['body'] | null = null;
      let bodyAt: RawCar['bodyAt'] = [0, 0, 0];
      let material: Material | null = null;
      const wheels: RawCar['wheels'] = {};
      gltf.scene.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        const at: [number, number, number] = [m.position.x, m.position.y, m.position.z];
        if (m.name.startsWith('body')) {
          body = m.geometry;
          bodyAt = at;
          material = m.material as Material;
        } else if (m.name.startsWith('wheel')) wheels[m.name] = { geometry: m.geometry, at };
      });
      if (!body || !material) throw new Error(`${name}: no body`);
      return { body, bodyAt, wheels, material };
    });
    raw.set(name, p);
  }
  return p;
}

/** Piecewise-linear map through matching knots (a ascending). */
function piecewise(a: number[], b: number[]): (x: number) => number {
  return (x) => {
    if (x <= a[0]!) return b[0]! + (x - a[0]!) * ((b[1]! - b[0]!) / (a[1]! - a[0]!));
    for (let i = 0; i < a.length - 1; i++) {
      if (x <= a[i + 1]!) return b[i]! + ((x - a[i]!) / (a[i + 1]! - a[i]!)) * (b[i + 1]! - b[i]!);
    }
    const n = a.length - 1;
    return b[n]! + (x - a[n]!) * ((b[n]! - b[n - 1]!) / (a[n]! - a[n - 1]!));
  };
}

/** Fit one of the kit's cars to the given measurements. */
export async function fittedCar(name: string, fit: CarFit): Promise<FittedCar> {
  const r = await load(name);
  const body = r.body.clone();
  body.translate(...r.bodyAt);
  body.computeBoundingBox();
  const bb = body.boundingBox!;
  // Kit axles (z) and wheel radius; ground at y = 0.
  const zs = Object.values(r.wheels).map((w) => w.at[2]);
  const kFront = Math.max(...zs);
  const kRear = Math.min(...zs);
  const wheelR = Object.values(r.wheels)[0]?.at[1] ?? 0.3;
  const sx = fit.width / (bb.max.x - bb.min.x);
  const sy = (fit.roof - fit.ground) / bb.max.y;
  // Each arch keeps its shape: around an axle the length scales like the width.
  const arch = wheelR * 1.15;
  const kz = [bb.min.z, kRear - arch, kRear + arch, kFront - arch, kFront + arch, bb.max.z];
  // The game's car faces -Z: the kit's +z (front) goes to negative z.
  const gz = [fit.rear, fit.rearAxle + arch * sx, fit.rearAxle - arch * sx, fit.frontAxle + arch * sx, fit.frontAxle - arch * sx, fit.front];
  const mapZ = piecewise(kz, gz);
  const p = body.attributes['position']!;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, -p.getX(i) * sx, fit.ground + p.getY(i) * sy, mapZ(p.getZ(i)));
  }
  body.deleteAttribute('tangent');
  // Mirroring x and reversing z keeps the winding; normals need redoing after the stretch.
  body.computeVertexNormals();
  body.computeBoundingBox();
  body.computeBoundingSphere();

  const wheel = (key: string) => {
    const w = Object.entries(r.wheels).find(([n]) => n.startsWith(key))![1];
    const g = w.geometry.clone();
    g.deleteAttribute('tangent');
    g.computeBoundingBox();
    const c = (g.boundingBox!.min.x + g.boundingBox!.max.x) / 2;
    g.translate(-c, 0, 0);
    // The car is turned half round, so each side's wheel is too (the kit's left faces +X; ours -X).
    g.applyMatrix4(new Matrix4().makeRotationY(Math.PI));
    return g;
  };
  return { body, wheelLeft: wheel('wheel-front-left'), wheelRight: wheel('wheel-front-right'), material: r.material };
}

/** The texture the kit's models share (for traffic, which merges them). */
export function kitTexture(m: Material): Texture | null {
  return (m as MeshStandardMaterial).map ?? null;
}

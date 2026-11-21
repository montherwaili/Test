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
import { BufferAttribute, BufferGeometry, DoubleSide, Material, Matrix4, MeshStandardMaterial, SRGBColorSpace, TextureLoader, type Texture } from 'three';

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
let sharedMaterial: Promise<Material> | null = null;

/** The kit's one material: its colour atlas, loaded as a plain image. */
function kitMaterial(): Promise<Material> {
  sharedMaterial ??= new TextureLoader().loadAsync(new URL('models/cars/colormap.png', document.baseURI).href).then((map) => {
    map.colorSpace = SRGBColorSpace;
    map.flipY = false;
    return new MeshStandardMaterial({ map, metalness: 0, roughness: 0.75, side: DoubleSide });
  });
  return sharedMaterial;
}

interface GltfJson {
  nodes: { name: string; mesh?: number; translation?: number[] }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers: { uri: string }[];
}

const SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/**
 * Read one of the kit's glTF files: fetched as plain JSON, its buffer decoded
 * here (pages served with a strict content policy may not fetch data: links,
 * which is how a glTF loader would read it), geometry built directly.
 */
function load(name: string): Promise<RawCar> {
  let p = raw.get(name);
  if (!p) {
    p = (async () => {
      const res = await fetch(new URL(`models/cars/${name}.json`, document.baseURI).href);
      if (!res.ok) throw new Error(`${name}: ${res.status}`);
      const j = (await res.json()) as GltfJson;
      const b64 = j.buffers[0]!.uri.split(',', 2)[1]!;
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
      const read = (index: number): { array: Float32Array | Uint16Array | Uint32Array; size: number } => {
        const acc = j.accessors[index]!;
        const view = j.bufferViews[acc.bufferView]!;
        const size = SIZE[acc.type]!;
        const Type = acc.componentType === 5126 ? Float32Array : acc.componentType === 5125 ? Uint32Array : Uint16Array;
        const stride = (view.byteStride ?? size * Type.BYTES_PER_ELEMENT) / Type.BYTES_PER_ELEMENT;
        const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
        const src = new Type(bin, start, (acc.count - 1) * stride + size);
        const out = new Type(acc.count * size);
        for (let i = 0; i < acc.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = src[i * stride + k]!;
        return { array: out, size };
      };
      const geometryOf = (mesh: number): BufferGeometry => {
        const prim = j.meshes[mesh]!.primitives[0]!;
        const g = new BufferGeometry();
        for (const [attr, key] of [
          ['POSITION', 'position'],
          ['NORMAL', 'normal'],
          ['TEXCOORD_0', 'uv'],
        ] as const) {
          const at = prim.attributes[attr];
          if (at === undefined) continue;
          const { array, size } = read(at);
          g.setAttribute(key, new BufferAttribute(array, size));
        }
        if (prim.indices !== undefined) g.setIndex(new BufferAttribute(read(prim.indices).array, 1));
        return g;
      };
      let body: BufferGeometry | null = null;
      let bodyAt: RawCar['bodyAt'] = [0, 0, 0];
      const wheels: RawCar['wheels'] = {};
      for (const n of j.nodes) {
        if (n.mesh === undefined) continue;
        const t = (n.translation ?? [0, 0, 0]) as [number, number, number];
        if (n.name.startsWith('body')) {
          body = geometryOf(n.mesh);
          bodyAt = t;
        } else if (n.name.startsWith('wheel')) wheels[n.name] = { geometry: geometryOf(n.mesh), at: t };
      }
      if (!body) throw new Error(`${name}: no body`);
      return { body, bodyAt, wheels, material: await kitMaterial() };
    })();
    p.catch((e: unknown) => console.warn('car model', name, e));
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

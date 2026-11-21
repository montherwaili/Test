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
import { loadKit } from './kitGltf';
import { BufferAttribute, BufferGeometry, DoubleSide, Material, Matrix4, MeshStandardMaterial, SRGBColorSpace, TextureLoader, Vector3, type Texture } from 'three';

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
  /** The model's own lamps, lifted a hair off the body, to glow when lit. */
  lamps: { head: BufferGeometry; tail: BufferGeometry; left: BufferGeometry; right: BufferGeometry };
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

/** One of the kit's cars, as stored: the body and the four wheels, each at its node's place. */
function load(name: string): Promise<RawCar> {
  let p = raw.get(name);
  if (!p) {
    p = (async () => {
      const nodes = await loadKit(`models/cars/${name}`);
      let body: BufferGeometry | null = null;
      let bodyAt: RawCar['bodyAt'] = [0, 0, 0];
      const wheels: RawCar['wheels'] = {};
      for (const n of nodes) {
        const g = n.primitives[0]?.geometry;
        if (!g) continue;
        if (n.name.startsWith('body')) {
          body = g;
          bodyAt = n.at;
        } else if (n.name.startsWith('wheel')) wheels[n.name] = { geometry: g, at: n.at };
      }
      if (!body) throw new Error(`${name}: no body`);
      return { body, bodyAt, wheels, material: await kitMaterial() };
    })();
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
  return { body, wheelLeft: wheel('wheel-front-left'), wheelRight: wheel('wheel-front-right'), material: r.material, lamps: lampsOf(body, r.material) };
}

/** The texture the kit's models share (for traffic, which merges them). */
export function kitTexture(m: Material): Texture | null {
  return (m as MeshStandardMaterial).map ?? null;
}

let paletteData: ImageData | null = null;

/** The colour atlas's pixels (read once), to tell the lamps from the paint. */
function palette(m: Material): ImageData | null {
  if (paletteData) return paletteData;
  const img = (m as MeshStandardMaterial).map?.image as CanvasImageSource & { width: number; height: number } | undefined;
  if (!img || !img.width) return null;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  paletteData = ctx.getImageData(0, 0, c.width, c.height);
  return paletteData;
}

/**
 * The model's lamps: its faces painted lamp yellow (headlamps) or lamp red
 * (tail lamps), copied and lifted 6 mm off the body along their normals.
 * The indicators flash the outer half of each side's lamps.
 */
function lampsOf(body: BufferGeometry, material: Material): FittedCar['lamps'] {
  const head: number[] = [];
  const tail: number[] = [];
  const left: number[] = [];
  const right: number[] = [];
  const pal = palette(material);
  const pos = body.attributes['position']!;
  const uv = body.attributes['uv'];
  const index = body.index;
  if (pal && uv) {
    const count = index ? index.count : pos.count;
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const n = new Vector3();
    for (let t = 0; t < count; t += 3) {
      const ia = index ? index.getX(t) : t;
      const ib = index ? index.getX(t + 1) : t + 1;
      const ic = index ? index.getX(t + 2) : t + 2;
      const u = (uv.getX(ia) + uv.getX(ib) + uv.getX(ic)) / 3;
      const v = (uv.getY(ia) + uv.getY(ib) + uv.getY(ic)) / 3;
      const px = Math.min(pal.width - 1, Math.max(0, Math.floor(u * pal.width)));
      const py = Math.min(pal.height - 1, Math.max(0, Math.floor(v * pal.height)));
      const o = (py * pal.width + px) * 4;
      const [r, g, bl] = [pal.data[o]!, pal.data[o + 1]!, pal.data[o + 2]!];
      const yellow = r > 220 && g > 170 && bl < 120;
      const red = r > 200 && g < 90 && bl < 90;
      if (!yellow && !red) continue;
      a.fromBufferAttribute(pos, ia);
      b.fromBufferAttribute(pos, ib);
      c.fromBufferAttribute(pos, ic);
      n.subVectors(c, b).cross(new Vector3().subVectors(a, b)).normalize().multiplyScalar(0.006);
      const tri = [a, b, c].flatMap((p) => [p.x + n.x, p.y + n.y, p.z + n.z]);
      (yellow ? head : tail).push(...tri);
      const x = (a.x + b.x + c.x) / 3;
      (x < 0 ? left : right).push(...tri);
    }
  }
  const geo = (arr: number[]) => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(arr), 3));
    return g;
  };
  return { head: geo(head), tail: geo(tail), left: geo(left), right: geo(right) };
}

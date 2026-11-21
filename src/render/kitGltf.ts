/**
 * Reads the Kenney kits' models (public/models), stored as glTF JSON with
 * the buffer inside. Read here rather than with a glTF loader: pages served
 * with a strict content policy may not fetch data: links, which is how a
 * loader would read the buffer.
 */
import { BufferAttribute, BufferGeometry } from 'three';

interface GltfJson {
  nodes: { name: string; mesh?: number; translation?: number[] }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number; material?: number }[] }[];
  materials?: { name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: unknown } }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers: { uri: string }[];
}

export interface KitPrimitive {
  geometry: BufferGeometry;
  /** The material's name, its colour (linear RGB) and whether it is textured. */
  material: string;
  color: [number, number, number];
  textured: boolean;
}

export interface KitNode {
  name: string;
  at: [number, number, number];
  primitives: KitPrimitive[];
}

const SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const cache = new Map<string, Promise<KitNode[]>>();

/** The meshes of a model, by node (`path` relative to the page, without .json). */
export function loadKit(path: string): Promise<KitNode[]> {
  let p = cache.get(path);
  if (!p) {
    p = (async () => {
      const res = await fetch(new URL(`${path}.json`, document.baseURI).href);
      if (!res.ok) throw new Error(`${path}: ${res.status}`);
      const j = (await res.json()) as GltfJson;
      const b64 = j.buffers[0]!.uri.split(',', 2)[1]!;
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
      const read = (index: number) => {
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
      const nodes: KitNode[] = [];
      for (const n of j.nodes) {
        if (n.mesh === undefined) continue;
        const primitives = j.meshes[n.mesh]!.primitives.map((prim) => {
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
          const m = j.materials?.[prim.material ?? 0];
          const c = m?.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1];
          return {
            geometry: g,
            material: m?.name ?? '',
            color: [c[0]!, c[1]!, c[2]!] as [number, number, number],
            textured: !!m?.pbrMetallicRoughness?.baseColorTexture,
          };
        });
        nodes.push({ name: n.name, at: (n.translation ?? [0, 0, 0]) as [number, number, number], primitives });
      }
      return nodes;
    })();
    p.catch((e: unknown) => console.warn('model', path, e));
    cache.set(path, p);
  }
  return p;
}

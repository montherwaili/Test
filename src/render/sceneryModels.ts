/**
 * Buildings and palms from Kenney's kits (CC0; public/models/scenery):
 * white flat-roofed blocks from the City Kit (Commercial) and palms from the
 * Nature Kit.
 *
 * The models are detailed (over a thousand triangles a building), so the
 * buildings are drawn as models only near the camera: each 200 m square of
 * the map within reach shows its buildings as models and hides its drawn
 * boxes; further off, the boxes stay. Palms are light, so all of them are
 * models.
 */
import { BufferAttribute, Color, DoubleSide, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, SRGBColorSpace, TextureLoader, Vector3, type BufferGeometry, type Mesh } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadKit } from './kitGltf';
import { HOUSE_CHUNK, houseChunkKey, type PlacedBuilding } from './mapMeshes';

const BUILDINGS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((c) => `building-${c}`);
/** Tallest a building is drawn, m. */
const MAX_HEIGHT = 11;
const PALMS = ['palmTall', 'palm', 'palmBend'];
/** Date-palm colours instead of the kit's turquoise. */
const PALM_COLOURS: Record<string, number> = { leafsGreen: 0x4f7a34, woodBark: 0x86653f };

interface Kind {
  mesh: InstancedMesh;
  /** Model extent: half width (x), half depth (z), height. */
  size: [number, number, number];
}

export class SceneryModels {
  private kinds: Kind[] = [];
  private choice: number[] = [];
  private shown = new Set<string>();
  private lastX = Infinity;
  private lastZ = Infinity;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);

  constructor(
    private readonly root: Group,
    private readonly buildings: PlacedBuilding[],
    private readonly houseChunks: Map<string, Mesh>,
    private readonly palms: { x: number; z: number; height: number }[],
    private readonly palmMeshes: Mesh[],
    /** How far round the camera buildings are models, m. */
    private readonly reach: number,
  ) {}

  async load(): Promise<void> {
    await Promise.all([this.loadBuildings(), this.loadPalms()]);
  }

  private async loadBuildings(): Promise<void> {
    if (this.buildings.length === 0) return;
    const map = await new TextureLoader().loadAsync(new URL('models/scenery/commercial-colormap.png', document.baseURI).href);
    map.colorSpace = SRGBColorSpace;
    map.flipY = false;
    const material = new MeshStandardMaterial({ map, roughness: 0.8 });
    const models = await Promise.all(BUILDINGS.map((n) => loadKit(`models/scenery/${n}`)));
    this.kinds = models.map((nodes) => {
      const g = nodes[0]!.primitives[0]!.geometry;
      g.computeBoundingBox();
      const b = g.boundingBox!;
      const mesh = new InstancedMesh(g, material, this.buildings.length);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      return { mesh, size: [Math.max(-b.min.x, b.max.x), Math.max(-b.min.z, b.max.z), b.max.y] as [number, number, number] };
    });
    // Each building gets the model whose plan is the nearest shape to its own (and a little variety).
    this.choice = this.buildings.map((b, i) => {
      const turned = Math.abs(Math.sin(b.faceYaw)) > 0.5;
      const want = turned ? b.depth / b.width : b.width / b.depth;
      let best = 0;
      let bestScore = Infinity;
      this.kinds.forEach((k, j) => {
        const score = Math.abs(Math.log(k.size[0] / k.size[1] / want)) + ((i * 7 + j * 3) % 5) * 0.06;
        if (score < bestScore) {
          bestScore = score;
          best = j;
        }
      });
      return best;
    });
    this.lastX = Infinity;
  }

  private async loadPalms(): Promise<void> {
    if (this.palms.length === 0) return;
    const models = await Promise.all(PALMS.map((n) => loadKit(`models/scenery/${n}`)));
    const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: DoubleSide });
    const geos = models.map((nodes) => {
      const parts: BufferGeometry[] = [];
      for (const n of nodes) {
        for (const p of n.primitives) {
          const g = p.geometry.clone().translate(...n.at);
          const c = new Color(PALM_COLOURS[p.material] ?? 0x777777);
          const count = g.attributes['position']!.count;
          const col = new Float32Array(count * 3);
          for (let i = 0; i < count; i++) col.set([c.r, c.g, c.b], i * 3);
          g.setAttribute('color', new BufferAttribute(col, 3));
          if (g.attributes['uv']) g.deleteAttribute('uv');
          parts.push(g);
        }
      }
      const merged = mergeGeometries(parts, false);
      merged.computeBoundingBox();
      return merged;
    });
    const groups = geos.map(() => [] as number[]);
    this.palms.forEach((_, i) => groups[i % geos.length]!.push(i));
    geos.forEach((g, k) => {
      const list = groups[k]!;
      const mesh = new InstancedMesh(g, material, Math.max(1, list.length));
      mesh.count = list.length;
      mesh.castShadow = true;
      const h = g.boundingBox!.max.y;
      list.forEach((pi, slot) => {
        const p = this.palms[pi]!;
        const s = p.height / h;
        this.q.setFromAxisAngle(this.up, (pi * 2.39996) % (Math.PI * 2));
        this.m.compose(new Vector3(p.x, 0, p.z), this.q, new Vector3(s, s, s));
        mesh.setMatrixAt(slot, this.m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.root.add(mesh);
    });
    for (const m of this.palmMeshes) m.visible = false;
  }

  /** Follow the camera: the 80 m squares near it show models, the rest their drawn boxes. */
  update(x: number, z: number): void {
    if (this.kinds.length === 0) return;
    if (Math.hypot(x - this.lastX, z - this.lastZ) < 15) return;
    this.lastX = x;
    this.lastZ = z;
    const near = new Set<string>();
    const r = this.reach;
    // Every square that comes within `reach` of the camera.
    const c = HOUSE_CHUNK;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) {
      for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
        const dx = Math.max(i * c - x, 0, x - (i + 1) * c);
        const dz = Math.max(j * c - z, 0, z - (j + 1) * c);
        if (dx * dx + dz * dz <= r * r) near.add(houseChunkKey(i * c + 1, j * c + 1));
      }
    }
    if (near.size === this.shown.size && [...near].every((k) => this.shown.has(k))) return;
    this.shown = near;
    for (const [key, mesh] of this.houseChunks) mesh.visible = !near.has(key);
    const counts = this.kinds.map(() => 0);
    this.buildings.forEach((b, i) => {
      if (!near.has(b.chunk)) return;
      const k = this.choice[i]!;
      const kind = this.kinds[k]!;
      const turned = Math.abs(Math.sin(b.faceYaw)) > 0.5;
      const w = turned ? b.depth : b.width;
      const d = turned ? b.width : b.depth;
      // The same scale every way, so the floors keep their proportions: to fit inside the
      // footprint, and no taller than three or four floors (most of Oman is low-rise; the
      // plot's wall stands round what is left of the footprint).
      const s = Math.min(w / (2 * kind.size[0]), d / (2 * kind.size[1]), MAX_HEIGHT / kind.size[2]);
      this.q.setFromAxisAngle(this.up, b.faceYaw);
      this.m.compose(new Vector3(b.x, 0, b.z), this.q, new Vector3(s, s, s));
      kind.mesh.setMatrixAt(counts[k]!++, this.m);
    });
    this.kinds.forEach((kind, k) => {
      kind.mesh.count = counts[k]!;
      kind.mesh.instanceMatrix.needsUpdate = true;
    });
  }
}

/**
 * A small drawing of a map's roads for the menus: straight lines between
 * junctions (bends drawn square), fast roads in amber. From the same compact
 * description the generator reads, so it costs nothing to make.
 */
interface ThumbDef {
  intersections: { id: string; x: number; z: number; type: string }[];
  roads: { from: string; to: string; lanes: number; limit: number }[];
}

export function mapThumb(def: ThumbDef, width = 220, height = 130): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const at = new Map(def.intersections.map((i) => [i.id, i]));
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const i of def.intersections) {
    minX = Math.min(minX, i.x);
    maxX = Math.max(maxX, i.x);
    minZ = Math.min(minZ, i.z);
    maxZ = Math.max(maxZ, i.z);
  }
  const pad = 14;
  const scale = Math.min((width - 2 * pad) / (maxX - minX || 1), (height - 2 * pad) / (maxZ - minZ || 1));
  const ox = (width - (maxX - minX) * scale) / 2;
  const oz = (height - (maxZ - minZ) * scale) / 2;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'map-thumb');
  svg.setAttribute('aria-hidden', 'true');
  const sorted = [...def.roads].sort((a, b) => a.limit - b.limit);
  for (const r of sorted) {
    const a = at.get(r.from);
    const b = at.get(r.to);
    if (!a || !b) continue;
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', (ox + (a.x - minX) * scale).toFixed(1));
    line.setAttribute('y1', (oz + (a.z - minZ) * scale).toFixed(1));
    line.setAttribute('x2', (ox + (b.x - minX) * scale).toFixed(1));
    line.setAttribute('y2', (oz + (b.z - minZ) * scale).toFixed(1));
    line.setAttribute('class', r.limit >= 100 ? 'fast' : r.lanes >= 2 ? 'main' : 'minor');
    svg.append(line);
  }
  for (const i of def.intersections) {
    if (i.type !== 'roundabout') continue;
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', (ox + (i.x - minX) * scale).toFixed(1));
    c.setAttribute('cy', (oz + (i.z - minZ) * scale).toFixed(1));
    c.setAttribute('r', '3');
    c.setAttribute('class', 'ring');
    svg.append(c);
  }
  return svg;
}

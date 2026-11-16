/** The town: generated from its description, then built into colliders like any other map. */
import townJson from '../data/maps/town.json';
import { buildMap, townMapDef, type BuiltMap } from './map';
import type { PhysicsWorld } from './physics';
import { generateTown, type TownDef, type TownLayout } from './roads/generate';

export function townLayout(): TownLayout {
  return generateTown(townJson as TownDef);
}

export function buildTown(physics: PhysicsWorld, layout: TownLayout = townLayout()): BuiltMap {
  return buildMap(townMapDef(layout), physics, layout.network);
}

/** The town (and the bigger free-drive city): generated from a description, then built into colliders like any other map. */
import cityJson from '../data/maps/city.json';
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

/** The free-drive city: a bigger grid of streets, a ring road and a desert highway. */
export function cityLayout(): TownLayout {
  return generateTown(cityJson as TownDef);
}

export function buildCity(physics: PhysicsWorld): BuiltMap {
  return buildTown(physics, cityLayout());
}

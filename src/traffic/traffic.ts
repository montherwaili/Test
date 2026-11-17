/** Everything that moves in the town besides the player: traffic cars and pedestrians. */
import type { RoadNetwork } from '../world/roads/network';
import { Pedestrians } from './pedestrians';
import { TrafficVehicles, type Obstacle, type TrafficEvent } from './vehicles';

export interface PlayerState {
  x: number;
  z: number;
  /** Compass heading, degrees. */
  headingDeg: number;
  /** m/s along its heading. */
  speed: number;
  length: number;
  width: number;
}

export interface TrafficOptions {
  /** Number of traffic cars. */
  cars: number;
  pedestriansPerCrossing: number;
  seed: number;
  /** Lanes to leave empty at the start (where the player is). */
  keepClear: string[];
}

/** Id used for the player in obstacle lists. */
export const PLAYER_ID = 0;

export class Traffic {
  readonly vehicles: TrafficVehicles;
  readonly pedestrians: Pedestrians;
  private readonly player: Obstacle = { id: PLAYER_ID, x: 0, z: 0, headingDeg: 0, speed: 0, length: 4.1, width: 1.7, lane: null, s: 0 };
  private readonly withPlayer: Obstacle[] = [];

  constructor(
    readonly network: RoadNetwork,
    options: TrafficOptions,
  ) {
    this.vehicles = new TrafficVehicles(network);
    this.pedestrians = new Pedestrians(network);
    this.vehicles.populate(options.cars, options.seed, options.keepClear);
    this.pedestrians.populate(options.pedestriansPerCrossing, options.seed + 101);
  }

  get time(): number {
    return this.vehicles.time;
  }

  /** Advance traffic and pedestrians. Returns the events raised (horns). */
  step(dt: number, player?: PlayerState): TrafficEvent[] {
    const others: Obstacle[] = [];
    if (player) {
      const p = this.player;
      p.x = player.x;
      p.z = player.z;
      p.headingDeg = player.headingDeg;
      p.speed = player.speed;
      p.length = player.length;
      p.width = player.width;
      const at = this.network.locate(player, player.headingDeg, 3);
      p.lane = at ? at.lane.id : null;
      p.s = at ? at.s : 0;
      others.push(p);
    }
    this.vehicles.step(dt, others, (car, lane, fromS, offset) => {
      const d = this.pedestrians.stopDistance(lane, fromS, car.speed, car.length);
      return d === Infinity ? Infinity : offset + d;
    });
    this.withPlayer.length = 0;
    this.withPlayer.push(...this.vehicles.cars, ...others);
    this.pedestrians.step(dt, this.withPlayer);
    return this.vehicles.takeEvents();
  }
}

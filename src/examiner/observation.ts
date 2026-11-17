/**
 * What the examiner sees on each simulation step. The game builds one of these
 * from the car, the physics and the traffic; tests build them by hand. Keeping
 * the examiner's input this narrow is what lets every rule be tested without
 * a browser or a physics engine.
 */

export type ContactKind =
  | 'pole'
  | 'cone'
  | 'kerb'
  | 'island'
  | 'wall'
  | 'building'
  | 'palm'
  | 'trafficCar'
  | 'pedestrian';

export interface OtherVehicle {
  id: number;
  x: number;
  z: number;
  headingDeg: number;
  /** m/s */
  speed: number;
  /** m/s² */
  accel: number;
  length: number;
  lane: string | null;
  s: number;
}

export type IndicatorState = 'off' | 'left' | 'right' | 'hazard';

export interface Observation {
  /** Seconds since the drive began. */
  time: number;
  dt: number;
  /** Clock the traffic signals run on. */
  signalTime: number;

  /** Centre of the car on the ground plane. */
  x: number;
  z: number;
  /** Compass heading, degrees (0 = north / -z, 90 = east). */
  headingDeg: number;
  /** Rolling speed, m/s; negative = backwards. */
  speed: number;

  /** -1 reverse, 0 neutral, 1..5. */
  gear: number;
  handbrake: boolean;
  seatbelt: boolean;
  indicator: IndicatorState;
  /** Seconds the indicator has been in its current state. */
  indicatorFor: number;
  /** Time of the last glance at each mirror (-Infinity if never). */
  mirrorLeftAt: number;
  mirrorCentreAt: number;
  mirrorRightAt: number;

  /** Wheels whose tyres are on a kerb, pavement or island right now. */
  wheelsOnKerb: number;
  /** Things the body started touching on this step. */
  contacts: ContactKind[];
  /** Car events on this step ('stall', ...). */
  events: string[];

  /** Traffic cars nearby. */
  others: OtherVehicle[];
  /** Per pedestrian crossing (network order): 0 empty, 1 someone waiting, 2 someone crossing. */
  crossings: number[];
}

/** The examined car's size, measured from its centre. */
export interface CarGeometry {
  /** Centre to front bumper, m. */
  front: number;
  /** Centre to rear bumper, m. */
  rear: number;
  width: number;
}

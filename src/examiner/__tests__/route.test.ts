import { describe, expect, it } from 'vitest';
import routesJson from '../../data/routes.json';
import { ANNOUNCE_M, RouteGuide, instructionsFor, planRoute, type GuideEvent, type Instruction, type RouteDef } from '../route';
import { Drive, net } from './drive';

const route = routesJson.routes[0] as RouteDef;

/** The planned lanes as a car would drive them: a lane change happens at the start of the lane. */
function drivable(lanes: string[]): string[] {
  return lanes.filter((id, i) => {
    const next = lanes[i + 1];
    const l = net.lane(id);
    return !(next && (l.left === next || l.right === next));
  });
}

const describeInstruction = (i: Instruction) =>
  i.kind === 'turn' ? `turn ${i.turn}` : i.kind === 'roundabout' ? `roundabout exit ${i.exit}` : i.kind;

/** Drive the guide's own lanes at `kmh`, collecting what it says, then pull up at the finish. */
function driveRoute(guide: RouteGuide, d: Drive, kmh: number, maxSeconds = 600) {
  const said: string[] = [];
  const events: GuideEvent[] = [];
  const at: number[] = [];
  for (let i = 0; i < maxSeconds * 30 && !guide.finished; i++) {
    const stopping = guide.onLastLane && d.s >= guide.def.finish.at;
    d.run(1 / 30, { speed: stopping ? 0 : kmh / 3.6, handbrake: stopping && d.o.speed === 0 });
    for (const e of guide.step(d.o)) {
      events.push(e);
      if (e.type === 'instruction') {
        said.push(describeInstruction(e.instruction));
        at.push(d.o.time);
      }
    }
  }
  return { said, events };
}

describe('planning the route', () => {
  it('chains the checkpoints into one connected run of lanes', () => {
    const { lanes, checkpointAt } = planRoute(net, route.start.lane, route.checkpoints);
    expect(lanes[0]).toBe('av1:f0');
    expect(lanes[lanes.length - 1]).toBe('av1:f0');
    for (let i = 0; i < lanes.length - 1; i++) {
      const l = net.lane(lanes[i]!);
      expect([...l.next, l.left, l.right], `${lanes[i]} -> ${lanes[i + 1]}`).toContain(lanes[i + 1]);
    }
    expect(checkpointAt.map((i) => lanes[i])).toEqual(route.checkpoints);
    // Strictly in order.
    for (let i = 1; i < checkpointAt.length; i++) expect(checkpointAt[i]!).toBeGreaterThan(checkpointAt[i - 1]!);
  });

  it('is a little over a kilometre and a half', () => {
    const { lanes } = planRoute(net, route.start.lane, route.checkpoints);
    const length = lanes.reduce((sum, id) => sum + net.lane(id).path.length, 0);
    expect(length).toBeGreaterThan(1200);
    expect(length).toBeLessThan(2500);
  });

  it('turns the lanes into the instructions an examiner would give', () => {
    const { lanes } = planRoute(net, route.start.lane, route.checkpoints);
    expect(instructionsFor(net, lanes).map((p) => describeInstruction(p.instruction))).toEqual([
      'roundabout exit 1', // big roundabout, south towards the T-junction
      'turn left', // out of the stop junction, east
      'turn left', // at the signals, west along the avenue
      'roundabout exit 1', // big roundabout again, north
      'roundabout exit 2', // small roundabout, west (the first exit is east)
      'turn left', // at the signals after the hill, east onto the avenue
    ]);
  });

  it('says nothing about bends in the road', () => {
    const lanes = ['n1:b0', 'A1:E0>S0', 'w1:f0'];
    expect(instructionsFor(net, lanes)).toEqual([]);
  });
});

describe('following the route', () => {
  it('announces each instruction once, ahead of the junction, then the finish', () => {
    const guide = new RouteGuide(net, route);
    const d = new Drive(drivable(guide.lanes), route.start.at);
    const { said, events } = driveRoute(guide, d, 30);
    expect(said).toEqual(['start', 'roundabout exit 1', 'turn left', 'turn left', 'roundabout exit 1', 'roundabout exit 2', 'turn left', 'finish']);
    expect(events.some((e) => e.type === 'offRoute')).toBe(false);
    expect(events[events.length - 1]).toEqual({ type: 'finished' });
    expect(guide.finished).toBe(true);
  });

  it('gives each instruction close to the announce distance', () => {
    const guide = new RouteGuide(net, route);
    const d = new Drive(drivable(guide.lanes), route.start.at);
    const distances: number[] = [];
    for (let i = 0; i < 600 * 30 && !guide.finished; i++) {
      d.run(1 / 30, { speed: 8 });
      const next = guide.plan.find((p) => p.at > guide.index);
      const before = next ? guide.distanceTo(next.at) : 0;
      for (const e of guide.step(d.o)) {
        if (e.type === 'instruction' && (e.instruction.kind === 'turn' || e.instruction.kind === 'roundabout')) distances.push(before);
      }
      if (guide.onLastLane) break;
    }
    expect(distances).toHaveLength(6);
    for (const dist of distances) {
      expect(dist).toBeLessThanOrEqual(ANNOUNCE_M + 1);
      expect(dist).toBeGreaterThan(ANNOUNCE_M - 10);
    }
  });

  it('does not finish until the car is stopped with the handbrake on', () => {
    const guide = new RouteGuide(net, route);
    const d = new Drive(drivable(guide.lanes), route.start.at);
    for (let i = 0; i < 600 * 30 && !(guide.onLastLane && d.s > route.finish.at + 5); i++) {
      d.run(1 / 30, { speed: 9 });
      guide.step(d.o);
    }
    d.run(3, { speed: 0 });
    for (let i = 0; i < 90; i++) guide.step(d.o);
    expect(guide.finished).toBe(false);
    d.run(0.1, { handbrake: true });
    for (let i = 0; i < 60; i++) guide.step({ ...d.o, dt: 1 / 30 });
    expect(guide.finished).toBe(true);
  });

  it('after a wrong turn, says so and leads the way back', () => {
    const guide = new RouteGuide(net, route);
    // At the big roundabout, take the east exit instead of the south one.
    const wrong = drivable(net.route('av1:f0', 'av2:f0')!);
    const d = new Drive([...wrong], route.start.at);
    const events: GuideEvent[] = [];
    for (let i = 0; i < 120 * 30 && d.lane !== 'av2:f0'; i++) {
      d.run(1 / 30, { speed: 8 });
      events.push(...guide.step(d.o));
    }
    d.run(3, { speed: 8 });
    events.push(...guide.step(d.o));
    for (let i = 0; i < 40; i++) {
      d.run(1 / 30, { speed: 8 });
      events.push(...guide.step(d.o));
    }
    expect(events.filter((e) => e.type === 'offRoute')).toHaveLength(1);
    // The new plan starts where the car is and still visits every checkpoint left.
    expect(guide.lanes[0]).toBe('av2:f0');
    expect(guide.remaining).toEqual(route.checkpoints);
    // And it can be followed to the finish.
    const rest = new Drive(drivable(guide.lanes), d.s);
    const { events: after } = driveRoute(guide, rest, 30);
    expect(after.filter((e) => e.type === 'offRoute')).toHaveLength(0);
    expect(guide.finished).toBe(true);
  });

  it('changing lane on the avenue is not a wrong turn', () => {
    const guide = new RouteGuide(net, route);
    const d = new Drive(['av1:f0'], route.start.at);
    const events: GuideEvent[] = [];
    for (let i = 0; i < 4 * 30; i++) {
      d.run(1 / 30, { speed: 10, lateral: -Math.min(3.5, i * 0.05) });
      events.push(...guide.step(d.o));
    }
    expect(events.filter((e) => e.type === 'offRoute')).toHaveLength(0);
  });
});

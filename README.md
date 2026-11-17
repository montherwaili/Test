# Oman Driving Test Simulator

A 3D browser simulator that prepares learners for the Royal Oman Police
driving test in a manual car. Static site (no backend), TypeScript + Vite,
Three.js for rendering, Rapier for physics, Vitest for tests.

**Status: phase 4 of 10 complete.** You can drive a manual car around a small
Omani-style town in 3D, among traffic and pedestrians that follow the rules:
roundabouts, signalled junctions, a stop junction, a hill road, speed bumps,
crossings and parking bays. There is no examiner yet.

## Run it

```bash
npm install
npm run dev        # dev server: / is the game, /debug.html the sim debug page
npm test           # all unit tests
npm run typecheck  # TypeScript only
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
```

Needs Node 22 (or 20.19+).

## Free drive (`index.html`)

To move off: start the engine, press the clutch, select first, release the
handbrake, give a little gas and bring the clutch up slowly.

| Key | Does |
| --- | --- |
| `A` `D` / `←` `→` | steer |
| `W` / `↑` | gas |
| `S` / `↓` | brake |
| hold `Shift` | clutch (rises slowly through the bite point when released) |
| `E` / `Q` | gear up / down |
| `1`–`5`, `R`, `N` | select a gear directly |
| `Space` | handbrake |
| `Enter` | starter |
| `I` | ignition off / on |
| `Z` / `X` / `C` | indicate left / hazards / indicate right |
| `L`, `H`, `B` | lights, horn, seatbelt |
| `7` / `8` / `9` | check left / centre / right mirror |
| `V` | camera: behind the car, driver's seat, from above |
| `T` | day / night |
| `Backspace` | put the car back at the start |
| `F1` | help |

On a touch screen the controls are laid out for two thumbs. Left thumb: clutch
pedal, steering wheel and indicators. Right thumb: brake, gas and the gear
lever. The steering wheel turns by dragging around it; it stays put while the
car is stopped and straightens as it rolls. The gear lever is dragged through
an H gate (1 3 5 at the top, 2 4 R at the bottom, neutral across the middle);
let go part way into a slot and it springs back to neutral. All three pedals
spring back when you lift your finger; the clutch comes up quickly to the bite
point and then eases through it, as a foot would. Landscape is easier.

The town (the default map) has a two-lane avenue with a double-lane
roundabout in the middle and signalled junctions at each end, a ring road with
a single-lane roundabout, a stop-controlled T-junction, a 9% hill, speed
bumps and pedestrian crossings, and a dead-end road lined with parking bays.
The HUD shows the speed limit of the lane you are in. `T` switches between day
and night.

Traffic cars and pedestrians share the town with you. Add `?traffic=N` to the
address to choose how many cars (0 to 40; 0 also removes the pedestrians).

Add `?map=track` to the address for the bare test track from phase 2 (road,
10% hill, kerb, loose cones, parking bays marked with poles, steering circles).

Add `?q=low`, `?q=medium` or `?q=high` to the address to force a graphics
quality.

## The debug page (`debug.html`)

Drive the sim core on a straight road with sliders or the keyboard and watch
the tachometer, speedometer, clutch torque and a 20-second trace of rpm,
speed and pedals.

| Key | Does |
| --- | --- |
| `W` / `↑` | throttle |
| `S` / `↓` | brake |
| hold `Shift` or `C` | clutch down (rises slowly on release; the time is adjustable) |
| `1`–`5`, `R`, `N` | gear lever |
| `H` | handbrake |
| `I` | ignition |
| `E` | starter |
| `P` | pause |

Things to try: start the engine, clutch down, first gear, handbrake off, then
bring the clutch up into the green band (the bite range) with a little
throttle. Dump the clutch to stall. Set the road gradient to 10% and try a
hill start.

The Tuning panel edits the live values; **Copy JSON** gives you the text to
paste into `src/data/tuning.json` to keep them.

## Layout

```
src/sim/       vehicle model - pure TypeScript: no rendering, browser or physics-engine imports
src/world/     the Rapier physics world, map building and the town
src/world/roads/  lane-level road network, town generator, signal timing - pure TypeScript
src/traffic/   traffic cars and pedestrians - pure TypeScript, seeded
src/render/    Three.js scene, car model, cameras, mirrors
src/input/     keyboard, touch, input smoothing (later: gamepad, wheel, tilt)
src/ui/        HUD and interface text (later: menus, results, replay)
src/app/       wires the above together and runs the game loop
src/data/      tuning and maps (later: lessons, routes, examiner rules) as JSON
src/debug/     the phase 1 debug page
src/examiner/  (phase 5) rule checks and scoring - pure TypeScript
```

`src/__tests__/architecture.test.ts` fails the test run if anything in
`src/sim`, `src/examiner`, `src/world/roads` or `src/traffic` imports rendering, UI or
physics-engine code, or touches browser globals, the wall clock or
`Math.random`.

## How the sim core works

- **Fixed timestep.** The simulation always advances in 1/120 s steps
  (`FixedStepper`), independent of frame rate. Same inputs give bit-identical
  results, which the replay system will rely on.
- **Engine** (`engine.ts`). Torque curve from the tuning file, friction that
  grows with rpm (engine braking), an idle controller with limited authority,
  a rev limiter, a starter motor, and intake lag. The accelerator behaves like
  a real throttle: a small opening gives strong torque at low rpm.
- **Clutch** (`clutch.ts`). A friction clutch whose torque capacity depends on
  pedal position: nothing above the bite point, rising through the bite range
  to full clamp.
- **Gearbox** (`gearbox.ts`). Five forward gears and reverse. Selecting a gear
  needs the clutch pedal down, otherwise it grinds; reverse is locked out
  while rolling forwards.
- **Driveline solver** (`driveline.ts`). Engine and wheels are two rotating
  bodies joined by three dry-friction elements (clutch, engine friction,
  brakes + rolling resistance), solved together each step. Slipping, locking,
  holding on a hill and stalling all come out of that one model rather than
  from special cases.
- **Stalling** is not scripted. The engine dies when the load drags it below
  stall speed, which happens exactly when a real one would: clutch dumped at
  idle, too high a gear, braking to a stop in gear, a hill start without gas.
- **`LongitudinalCar`** is a straight-line test car (mass, drag, rolling
  resistance, brakes, handbrake, slope) that exercises the powertrain on its
  own. The debug page uses it.
- **`Vehicle`** (`vehicle.ts`) is the full car: a rigid body on four sprung
  wheels. Each step it casts a ray per wheel for the ground, computes spring,
  damper, anti-roll and bump-stop forces, then solves tyre and driveline
  friction together as limited velocity constraints. That is what lets it stop
  dead on a line, hold on a hill on the handbrake or in gear, and roll back
  when released. Cornering grip follows a slip-angle curve inside a friction
  circle; the driven wheels can spin. Braking assumes ABS (wheels never lock).
  The body itself is integrated by Rapier, which also handles collisions; the
  vehicle reaches it through two small interfaces so `src/sim` stays
  engine-free.
- **`Ancillaries`** (`ancillaries.ts`): indicators (with self-cancel), lights,
  horn, seatbelt and mirror checks, timestamped for the examiner to come.

Every number is in `src/data/tuning.json` and is validated on load.

## The town and its road network

`src/data/maps/town.json` describes the town compactly: intersections on a
grid (roundabout, signal, priority, bend, dead end) and the roads between them
(lanes, speed limit, and features such as a hill, bumps, crossings, parking).
`src/world/roads/generate.ts` turns that into:

- a **lane-level road network** (`network.ts`): each lane has a centre line,
  width, speed limit, the lanes that follow it, its neighbours for lane
  changes, the rule at its end (signal, stop, give way) and the lanes it must
  give way to. It can find the lane under a point and plan routes. Traffic
  (phase 4), the examiner (phase 5) and test routes (phase 6) build on it;
- the **shapes** to pave, paint and put up: asphalt, markings, kerbs, medians,
  islands, signs, signal heads, buildings and palms. Colliders and meshes are
  built from the same shapes.

Traffic signals (`signals.ts`) are a pure function of time, so lamps, traffic
and the examiner always agree.

## Traffic and pedestrians

`src/traffic` is pure TypeScript and seeded, so a run can be repeated exactly.

- **Traffic cars** (`vehicles.ts`) follow the lanes of the road network. They
  keep a safe distance using the Intelligent Driver Model, obey speed limits
  and slow in time for junctions, stop at red lights and stop signs, give way
  at roundabouts and at the T-junction, indicate for turns, and sound the horn
  at a vehicle left standing in the road. They move along lane centre lines
  rather than being full physics cars; the world layer gives them solid bodies.
- **Pedestrians** (`pedestrians.ts`) use the marked crossings: they wait at the
  kerb until anything approaching could stop for them, then cross. Traffic
  stops short of the stripes for anyone waiting or crossing.
- **The player counts** for both: traffic keeps its distance from you and gives
  way to you where you have priority; pedestrians wait if you could not stop.

Drivers reconsider 30 times a second and simply keep moving in between.

### Not yet checked against Omani practice

These are sensible defaults, marked `TODO(verify ...)` in the source:

- road marking colours (white centre and lane lines, yellow edges);
- which roundabout lane may take which exit (outer lane to the right-hand exit
  lane, inner lane to the left-hand one, giving way to the outer lane);
- signal phasing and timings (each approach gets its own green; 14 s green,
  3 s amber, 2 s all-red; no flashing green);
- sign designs, wording, numerals and placement.

## Performance

Measured after phases 3 and 4, in the town.

| | |
| --- | --- |
| Physics + player's car, per 120 Hz step | 41 µs (0.5% of the 8.3 ms budget) |
| Traffic, 14 cars + 8 pedestrians, per step | 35 µs (0.4%) |
| Traffic, 30 cars + 8 pedestrians, per step | 88 µs (1.1%) |
| Generating the town and its 76 colliders | 16 ms, once at load |
| Finding the lane under the car | 9 µs |
| Draw calls per frame, no traffic / with traffic | 64 / 73 |
| Triangles per frame, 14 / 30 traffic cars | about 38,000 / 45,000 |

Static geometry is merged into a few meshes and traffic is drawn with
instancing, which is what keeps the draw calls low: more cars add triangles
but no draw calls. Frame rate on real hardware has not been measured: the
automated browser has no graphics card.

## Build phases

1. **Setup, sim core, unit tests, debug page** — done
2. **Rapier vehicle on a flat test map, cameras, keyboard and touch input** — done
3. **Town: road graph, roundabouts, junctions, signs, signals, slopes** — done
4. **Traffic AI and pedestrians** — done
5. Examiner rule engine and test yard
6. Full test route mode and result screen
7. Replay and analysis graphs
8. Learning mode, lessons, adaptive practice
9. Sound, effects, gamepad/wheel, tilt steering, quality presets, phone performance
10. Menus, Arabic/English, polish, build, GitHub Pages deployment steps

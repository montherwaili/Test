# Oman Driving Test Simulator

A 3D browser simulator that prepares learners for the Royal Oman Police
driving test in a manual car. Static site (no backend), TypeScript + Vite,
Three.js for rendering, Rapier for physics, Vitest for tests.

**Status: phase 2 of 10 complete.** You can drive a manual car around a flat
test track in 3D, from three camera views, with a keyboard or a touch screen.
There is no town, traffic or examiner yet.

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
| `Backspace` | put the car back at the start |
| `F1` | help |

On a touch screen the controls are laid out for two thumbs. Left thumb: clutch
pedal, steering wheel and indicators. Right thumb: brake, gas and the gear
lever. The steering wheel turns by dragging around it; it stays put while the
car is stopped and straightens as it rolls. The clutch pedal stays where you
leave it, so you can hold it at the bite point and move your thumb to the
wheel. Landscape is easier.

The test track has a two-lane road with a stop line and speed bumps, a 10% hill,
a kerb, loose cones, two parking bays marked with poles, and two circles for
steering practice.

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
src/world/     the Rapier physics world and map building (later: town, road graph, signs, signals)
src/render/    Three.js scene, car model, cameras, mirrors
src/input/     keyboard, touch, input smoothing (later: gamepad, wheel, tilt)
src/ui/        HUD and interface text (later: menus, results, replay)
src/app/       wires the above together and runs the game loop
src/data/      tuning and maps (later: lessons, routes, examiner rules) as JSON
src/debug/     the phase 1 debug page
src/traffic/   (phase 4) AI cars and pedestrians
src/examiner/  (phase 5) rule checks and scoring - pure TypeScript
```

`src/__tests__/architecture.test.ts` fails the test run if anything in
`src/sim` or `src/examiner` imports rendering, UI, world or physics-engine
code, or touches browser globals, the wall clock or `Math.random`.

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

## Build phases

1. **Setup, sim core, unit tests, debug page** — done
2. **Rapier vehicle on a flat test map, cameras, keyboard and touch input** — done
3. Town: road graph, roundabouts, junctions, signs, signals, slopes
4. Traffic AI and pedestrians
5. Examiner rule engine and test yard
6. Full test route mode and result screen
7. Replay and analysis graphs
8. Learning mode, lessons, adaptive practice
9. Sound, effects, gamepad/wheel, tilt steering, quality presets, phone performance
10. Menus, Arabic/English, polish, build, GitHub Pages deployment steps

# Oman Driving Test Simulator

A 3D browser simulator that prepares learners for the Royal Oman Police
driving test in a manual car. Static site (no backend), TypeScript + Vite,
Three.js for rendering, Rapier for physics, Vitest for tests.

**Status: phase 1 of 10 complete** — project setup and the simulation core
(engine, clutch, gearbox, stalling) with unit tests and a debug page.
There is no 3D yet.

## Run it

```bash
npm install
npm run dev        # dev server; open /debug.html for the sim debug page
npm test           # all unit tests
npm run typecheck  # TypeScript only
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
```

Needs Node 22 (or 20.19+).

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
src/sim/       vehicle model - pure TypeScript, no rendering, no browser APIs
src/data/      tuning (and later: lessons, routes, examiner rules) as JSON
src/debug/     the phase 1 debug page
src/world/     (phase 3) town, road graph, signs, signals
src/traffic/   (phase 4) AI cars and pedestrians
src/examiner/  (phase 5) rule checks and scoring - pure TypeScript
src/render/    (phase 2) Three.js scene, cameras, effects
src/input/     (phase 2) keyboard, touch, gamepad, wheel, tilt
src/ui/        (phase 6+) menus, HUD, results, replay
```

`src/__tests__/architecture.test.ts` fails the test run if anything in
`src/sim` or `src/examiner` imports rendering/UI code or touches browser
globals, the wall clock or `Math.random`.

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
  resistance, brakes, handbrake, slope) used to exercise the powertrain until
  the Rapier vehicle replaces it in phase 2. The `Powertrain` class is the
  part that carries forward.

Every number is in `src/data/tuning.json` and is validated on load.

## Build phases

1. **Setup, sim core, unit tests, debug page** — done
2. Rapier vehicle on a flat test map, cameras, keyboard and touch input
3. Town: road graph, roundabouts, junctions, signs, signals, slopes
4. Traffic AI and pedestrians
5. Examiner rule engine and test yard
6. Full test route mode and result screen
7. Replay and analysis graphs
8. Learning mode, lessons, adaptive practice
9. Sound, effects, gamepad/wheel, tilt steering, quality presets, phone performance
10. Menus, Arabic/English, polish, build, GitHub Pages deployment steps

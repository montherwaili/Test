# Oman Driving Test Simulator

A 3D browser simulator that prepares learners for the Royal Oman Police
driving test in a manual car. Static site (no backend), TypeScript + Vite,
Three.js for rendering, Rapier for physics, Vitest for tests.

**Status: phase 8 of 10 complete.** Seven lessons teach the controls,
moving off, gears, roundabouts, the hill start, parking and the full route,
with goals, hints and one to three stars, and suggest what to practise next.
Then you can take a full road test through a small Omani-style town among
traffic and pedestrians, or the test-yard exercises, with an examiner who
gives directions, records every fault, and gives a pass or fail with the
reasons. Every test and lesson can be watched again with graphs.

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
| `F` | put a flipped car back on its wheels |
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

If the car ends up on its side or roof, a button appears to put it back on its
wheels where it lies (it also happens by itself after six seconds).

On a phone the mirror buttons (left, centre, right) sit under the seatbelt,
lights and horn: tap to glance, hold to keep looking. The examiner counts
mirror checks.

**Lessons** (Help → Lessons, or `#lesson-controls`, `#lesson-gears`, ...):
controls, moving off and stopping, changing gear, roundabouts, hill start,
parking, and the full route. Each lesson is a short list of goals shown one at
a time at the bottom of the screen, with a Hint button (the hint also appears
by itself after 25 seconds without progress). Faults are shown as they happen,
with a tip. Stars: three for a clean lesson (within the target time where
there is one), two for at most two minor faults and nothing worse, one for
finishing. Lessons are in `src/data/lessons.json`.

**Practice suggestions.** Every fault, in lessons and tests, counts against a
skill (observation, moving off, hill start, parking, roundabouts,
junctions). The lesson list marks the lesson for the skill you get wrong most
as “Suggested for you” and offers a button for it; older mistakes count for
less over time, and three stars in a lesson takes its skill down. Stars, skill
scores and test counts are saved in the browser (`localStorage`).

**Home screen.** The game opens on a home screen (☰ Menu in the top bar
brings it back) that lays the way out in three steps: **1. Learn** — the
lessons in order, with a button for the next one not yet done; **2.
Practise** — free drive, town practice with the examiner's notes, or the
yard; **3. Test** — the yard test first, then the road test, as at the real
test. Step 1 is marked "start here" until five lessons are done, then step 3.

**Modes** (home screen, Help, or the address): free drive `#free` (no
examiner at all: no faults, no messages, no score; what runs behind the home
screen), town practice with notes `#town`, yard practice `#yard`, yard test
`#yard-test`, road test `#road-test`, a lesson `#lesson-<id>`.

In the **road test** the examiner tells you where to go (“at the roundabout,
take the second exit”) a little before each junction, and redirects you if you
take a wrong turn. At the end you are asked to pull up on the right and set
the handbrake. As in a real test, faults are not shown while you drive; the
result screen lists them at the end with a tip for each, the time, and a map
of where they happened. A collision ends the test at once. The route is in
`src/data/routes.json` (checkpoint lanes; the rest is planned automatically).

**Replay.** Every test is recorded. On the result screen, “Watch the replay”
plays it from the start, and the ▶ beside each fault plays it from three
seconds before that fault. The timeline shows the faults as numbered marks;
drag it to jump anywhere. Play / pause (or Space), ±5 s, and 0.25× to 4×
speed. The camera button cycles behind the car, the driver's seat, from
above, and a free camera you drag to turn and pinch (or scroll) to zoom. The
graphs show engine speed, road speed and the three pedals for ten seconds
either side of the moment you are watching, with the faults marked.

The **yard test** ends when all four exercises have been done. In free drive
and yard practice, faults are shown as they happen.

**Test yard:** open Help and choose a yard mode. It has four exercises: stop at the line, hill start, reverse parking
between poles, and parallel parking. Drive into an exercise's area and the
examiner announces it; finish a parking exercise by stopping with the
handbrake on (or in neutral).

Traffic cars and pedestrians share the town with you. Add `?traffic=N` to the
address to choose how many cars (0 to 40; 0 also removes the pedestrians).

Add `?map=track` to the address for the bare test track from phase 2 (road,
10% hill, kerb, loose cones, parking bays marked with poles, steering circles).

Add `?q=low`, `?q=medium` or `?q=high` to the address to force a graphics
quality.

### Gamepad and steering wheel

A gamepad works as soon as it is connected (press any of its buttons first;
browsers hide controllers until then). Standard layout:

| Gamepad | Does |
| --- | --- |
| left stick | steer (softer near the centre and at speed) |
| right trigger / left trigger | gas / brake (as far as you pull them) |
| hold left bumper | clutch (rises slowly through the bite point when released) |
| d-pad up / down | gear up / down |
| d-pad left / right | indicate left / right |
| A, B, X, Y | starter, handbrake, horn, camera |
| right bumper; left / right stick click | centre mirror; left / right mirror (tap to glance, hold to look) |
| View / Select, Menu / Start | seatbelt, help |

A **steering wheel with pedals** is taught once: Settings (⚙) → “Teach a wheel
and pedals”, then follow the prompts — turn the wheel fully right and back,
press each pedal all the way and let it up, then put the H-shifter in each
gear (a wheel without a clutch pedal or shifter can skip those steps). What
it learns is saved per device name in the browser. The shifter's gears go
straight to the gearbox, so a gear chosen without the clutch grinds, as in the
car. Buttons on the wheel follow the gamepad layout above.

### Tilt steering

On a phone, Settings → “Tilt the phone” steers by turning the phone like a
wheel (iPhones ask permission first). The way you hold the phone when you
choose it is “straight ahead”; the button below the choice sets it again.
How far to tilt for full lock is adjustable (35° by default). Touching the
on-screen wheel still steers by finger; let go and the tilt takes over again.
The motion sensor only works on pages served over HTTPS (or from the
computer itself), so not from a phone on the local network address of
`npm run dev`.

### Settings

⚙ in the top bar (or Help → Settings): sound on/off and volume, phone
vibration, touch steering (wheel or tilt), picture quality, a frames-per-second
readout, and the controller set-up. Saved in the browser.

**Picture quality.** Low (no shadows, 1:1 pixels), medium, high, or auto (the
default). Auto picks a preset for the device, then watches the frame rate: if
it stays below 30 fps on a phone (60 on a computer) for a second it draws
fewer pixels, down to half the resolution, and raises it again after four
comfortable seconds. A change of preset takes effect on reload.

### Sound and effects

The car is a small **turbodiesel** with a manual gearbox: about 1.4 litres,
205 N·m from 1800 to 2800 rpm, idle at 800 rpm, fuel cut-off at 4500 rpm
(the rev counter runs to 5000). Change up at about 2000 rpm. It has the
diesel's pull at low revs, so it is forgiving when moving off, and it cranks
for a moment before it catches. The numbers are in `src/data/tuning.json`.

**The engine is a real recording** of a four-cylinder diesel car, a Kia
Carnival 2.9 CRDi, started from cold, idling and switched off (by Joseph
Sardin, BigSoundBank, CC0 public domain; see `assets/sounds-src/CREDITS.md`):

- the real starter from its first turn (three compression strokes in about
  0.6 s, always heard in full, louder than in the recording as it is from
  the driver's seat), looping round the compression strokes if the key is
  held longer, then the real first firings and the flare to fast idle
- the engine's real combustion strokes (from its idle, about 990 rpm in the
  recording: the engine is cold) re-assembled at the engine's speed: a
  recording simply played faster sounds like a toy, because the ring of the
  block and exhaust goes up with it; laying the strokes down closer
  together raises the beat and keeps the timbre. Loops are made this way at
  the game's idle and from 1150 to 4700 rpm, blended by revs
  (`src/audio/granular.ts`, `src/audio/recordedEngine.ts`)
- under load, the same strokes with a harder knock and more exhaust body:
  the recording has no driving in it, so this part is processed, not
  recorded; it eases in and out, so gear changes do not jump between sounds
- switching off or stalling: the real run-down

The recordings download as the page opens; the synthesized engine is never
heard while they load. Their file names carry a fingerprint of the build,
so a browser never plays old copies.

`npm run sounds` rebuilds these from the original recording in
`assets/sounds-src/` (it needs ffmpeg): it cuts and lines up the strokes and
writes `public/sounds/engine/`. If the files cannot be loaded, a synthesized
diesel (`src/audio/dieselSynth.ts`) plays instead.

The smaller sounds are synthesized: the handbrake ratchet, the gear lever,
the seatbelt buckle, the indicator relay, the ignition key, the horn, tyre
squeal, road and wind noise, knocks, gears grinding when forced in without
the clutch, and other drivers' horns.

Sound starts at the first touch or key (browsers require it) and pauses with
the page. Knocks and speed bumps shake the camera and, on phones, vibrate.

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
src/ui/        HUD, interface text, result screen, replay controls
src/app/       wires the above together and runs the game loop
src/replay/    recording a drive and the replay clock - pure TypeScript
src/learning/  lessons, stars and practice suggestions - pure TypeScript
src/data/      tuning, maps, the test yard and the examiner's rules (later: lessons, routes) as JSON
src/debug/     the phase 1 debug page
src/examiner/  the examiner: rule checks, yard manoeuvres, scoring - pure TypeScript
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

## The examiner

`src/examiner` watches every simulation step and records each fault with its
time and place. Its input is a small `Observation` (the car's pose and
controls, what it touched, the traffic and pedestrians nearby), which is what
lets every rule be tested with scripted drives and no browser.

All rules live in **`src/data/rules.json`**: severity (minor, serious or
fail), the Arabic and English wording, a tip, and the thresholds. Change them
there to match the real ROP test. Pass or fail: no fail-level fault, no more
serious faults than `maxSerious` (0) and no more minor faults than
`maxMinor` (6).

| Rule | Default | What triggers it |
| --- | --- | --- |
| Seatbelt | serious | moving off unbelted |
| Mirrors on moving off | minor | no mirror check in the 6 s before moving off |
| Mirrors before a turn or lane change | minor | no centre or side mirror check in the 6 s before |
| Signal for a turn | serious | indicator not on for 2 s at the line, or the wrong way |
| Signal leaving a roundabout | minor | no right signal as you leave the ring |
| Signal for a lane change | minor | indicator not on for 1 s |
| Speeding | minor / serious | 3 km/h over for 3 s / 10 km/h over for 2 s |
| Stop sign | fail | not stationary within 6 m of the line |
| Red light | fail | front crosses the line on red |
| Amber light | minor | crossing more than 1.5 s into amber |
| Give way at a roundabout / junction | serious | a priority vehicle within 8 m or 2.5 s, or made to brake hard |
| Pedestrians | serious | driving over a crossing someone is walking on |
| Stall | minor | each stall |
| Rollback | serious | rolling back more than 30 cm out of reverse |
| Poles and cones | serious | touching one |
| Kerb | minor / serious | a tyre touching / driving more than 1 m on it |
| Lane discipline | minor | over the lane line by 30 cm for 3 s without signalling |
| Wrong side of the road | fail | for 1 s |
| Following distance | minor | under 1 s behind for 3 s above 18 km/h |
| Collision | fail | hitting a vehicle, person, wall, building or tree |
| Bay parking | serious | not wholly inside the bay, or more than 10° crooked |
| Manoeuvre time | minor | over the time limit (120 s) |
| Manoeuvre not completed | serious | leaving the exercise area part way through |
| Hill start | minor | stopping more than 1 m short of the line |
| Stop at the line | minor / serious | more than 0.5 m off / more than 1 m past |

**Every rule is marked `"verified": false`.** These are reasonable defaults,
not checked ROP requirements; please go through them and correct what differs
from the real test.

The test yard layout (bay sizes, pole positions, hill gradient, line
positions, time limits) is in `src/data/maps/yard.json`, also to be checked.

### Not yet checked against Omani practice

These are sensible defaults, marked `TODO(verify ...)` in the source:

- road marking colours (white centre and lane lines, yellow edges);
- which roundabout lane may take which exit (outer lane to the right-hand exit
  lane, inner lane to the left-hand one, giving way to the outer lane);
- signal phasing and timings (each approach gets its own green; 14 s green,
  3 s amber, 2 s all-red; no flashing green);
- sign designs, wording, numerals and placement.

## Recording and replay

`src/replay/recording.ts` keeps two streams for each test:

- **frames**, 20 a second: the car (position, rotation, wheels, pedals, gear,
  rpm, speed, lamps), each traffic car, each pedestrian and any loose cones.
  Replays play these back, so jumping anywhere is instant.
- **inputs**, every 120 Hz step, at full precision. The simulation is
  deterministic, so feeding them into a fresh world reproduces the drive bit
  for bit: `src/world/__tests__/replayDeterminism.test.ts` re-runs a 20-second
  drive with traffic and pedestrians and checks the car, every traffic car and
  every pedestrian match exactly.

A 15-minute test with 14 traffic cars takes about 20 MB. Recordings stop
growing after 30 minutes.

Caveat: “Reset”, “Right the car” and switching the engine off with a key are
not in the input stream; a re-run of a drive that used them would differ from
that point. The frame stream (what the replay shows) is not affected.

## Performance

Measured after phases 3 and 4, in the town; the whole-step and frame figures
after phase 9, in a road test.

| | |
| --- | --- |
| Physics + player's car, per 120 Hz step | 41 µs (0.5% of the 8.3 ms budget) |
| Traffic, 14 cars + 8 pedestrians, per step | 35 µs (0.4%) |
| Traffic, 30 cars + 8 pedestrians, per step | 88 µs (1.1%) |
| Generating the town and its 76 colliders | 16 ms, once at load |
| Finding the lane under the car | 9 µs |
| Whole step in a road test (car, physics, 14 cars, examiner, route, recording) | 173 µs (2.1%) |
| Same on the phone preset (10 cars) | 209 µs |
| Main-thread time per frame, desktop high: median / 95th percentile | 3.0 / 6.0 ms |
| Main-thread time per frame, phone low: median / 95th percentile | 1.8 / 4.7 ms |
| Draw calls per frame, no traffic / with traffic | 64 / 73 |
| Triangles per frame, 14 / 30 traffic cars | about 38,000 / 45,000 |
| Triangles per frame, phone preset | about 20,000 |

Static geometry is merged into a few meshes and traffic is drawn with
instancing, which is what keeps the draw calls low: more cars add triangles
but no draw calls. Frame rate on real hardware has not been measured: the
automated browser has no graphics card (it renders in software, where the
GPU work dominates and auto quality drops straight to half resolution). The
CPU side leaves plenty of room: at 30 fps a phone runs four steps a frame,
under 1 ms here; even a phone four times slower stays near 4 ms of its 33 ms.
With “Show frames per second” on, the readout gives the real figure and the
resolution scale on your device.

## Build phases

1. **Setup, sim core, unit tests, debug page** — done
2. **Rapier vehicle on a flat test map, cameras, keyboard and touch input** — done
3. **Town: road graph, roundabouts, junctions, signs, signals, slopes** — done
4. **Traffic AI and pedestrians** — done
5. **Examiner rule engine and test yard** — done
6. **Full test route mode and result screen** — done
7. **Replay and analysis graphs** — done
8. **Learning mode, lessons, adaptive practice** — done
9. **Sound, effects, gamepad/wheel, tilt steering, quality presets, phone performance** — done
10. Menus, Arabic/English, polish, build, GitHub Pages deployment steps

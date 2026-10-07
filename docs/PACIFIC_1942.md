# Pacific 1942 — Bắn Máy Bay

A second game in this repository: a vertical-scrolling arcade shooter in the spirit of the 1980s
classics, set in the Pacific War and built with the same tools as the flight simulator — Three.js,
TypeScript, Vite, every model, texture and sound generated in code. It lives on its own page,
`pacific.html`, and shares nothing at runtime with the simulator except three.js. The game's text
is in Vietnamese.

Fly a **P-38 Lightning**, an **F6F Hellcat** or an **F4U Corsair** through ten battles, from
Pearl Harbor on 7 December 1941 to the last sortie of the battleship Yamato on 7 April 1945, each
ending with a boss: a command formation, a cruiser, two carriers, three battleships, a VIP bomber
with its escort, a four-engine flying boat and the fortress of Mount Suribachi.

## Play it

`npm start`, then open **http://127.0.0.1:8092/pacific.html**. The production build
(`npm run build`) puts it next to the simulator in `dist/`. `npm run build:pacific-file` makes
**one self-contained HTML file**, `dist/pacific-standalone.html` (about 720 KB: the game, three.js
and the styles inlined) that plays opened straight from disk or sent to someone
(`scripts/pacific-standalone.mjs`).

| Keys | What they do |
| --- | --- |
| <kbd>←</kbd> <kbd>↑</kbd> <kbd>→</kbd> <kbd>↓</kbd> or <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> | Fly |
| <kbd>Space</kbd> (or <kbd>J</kbd>, <kbd>Z</kbd>) | Fire (hold); <kbd>F</kbd> toggles auto-fire |
| <kbd>X</kbd> (or <kbd>K</kbd>, <kbd>Shift</kbd>) | Evasive roll: about a second of invulnerability, limited stock |
| <kbd>P</kbd> or <kbd>Esc</kbd> | Pause |
| <kbd>M</kbd> | Sound on / off |
| <kbd>Enter</kbd> | Confirm on the briefing and result screens |

**Touch:** drag anywhere — the aircraft follows the finger's movement (offset, so the finger never
hides it) and fires on its own; a second finger or the on-screen button rolls. **Gamepad:** stick
or d-pad, A / RT fire, B / X roll, Start pause.

**Pick-ups** drop when a whole formation is shot down and from big targets: **P** guns (five
levels), **W** two escort fighters (each absorbs one hit), **R** an extra roll, **+** a hull repair,
**★** a medal. Quick kills build a chain multiplier up to ×4; every 80,000 points earns a life.

**URL options** (for testing and screenshots): `?level=1`–`10`, `?plane=p38|f6f|f4u`,
`?diff=easy|normal|hard`, `?play=1` (skip the title and briefing), `?god=1` (cannot be hurt),
`?auto=1` (the autopilot flies), `?seed=n`, `?mute=1`. In the console, `window.pacific` exposes the
state, `start(level)`, `skipToBoss()` and `stats()`.

## The ten battles

| # | Battle | Date | Boss | Look |
| --- | --- | --- | --- | --- |
| 1 | Pearl Harbor (Trân Châu Cảng) | 7/12/1941 | B5N command formation and four Zeros | Dawn; Ford Island and Battleship Row burning |
| 2 | Wake Island | 11/12/1941 | Light cruiser Yūbari | The V-shaped atoll and its airstrip |
| 3 | Coral Sea | 7/5/1942 | Light carrier Shōhō (launches aircraft) | Open sea, scattered reefs |
| 4 | Midway | 4/6/1942 | Carrier Akagi (two flight decks, port island) | Midway atoll; burning carriers |
| 5 | Guadalcanal | 13/11/1942 | Battleship Hiei | Night: moonlight and star shells |
| 6 | Operation Vengeance, Bougainville | 18/4/1943 | G4M "Betty" T1-323 and six escorting Zeros | Jungle coast |
| 7 | Philippine Sea | 19/6/1944 | H8K "Emily" flying boat (engines are targets) | Noon; US carriers below |
| 8 | Leyte Gulf | 24/10/1944 | Battleship Musashi | Rain squalls; first kamikaze |
| 9 | Iwo Jima | 23/2/1945 | The Mount Suribachi fortress | Island AA sites; landing craft |
| 10 | Okinawa, Operation Ten-Go | 7/4/1945 | Battleship Yamato | Dusk; kamikaze swarms and Ōka bombs |

Each level's briefing (in `src/pacific/levels.ts`) states what happened on the day — dates, ships,
aircraft and numbers as recorded; the fighting in the game is of course an arcade dramatisation.

## How it is built

The game follows the simulator's principles (see [CONTRIBUTING.md](../CONTRIBUTING.md)): a pure,
deterministic simulation that knows nothing of three.js or the DOM, drawing kept separate, one
config object, procedural content only, test first.

| Part | Files |
| --- | --- |
| Data | `src/pacific/config.ts` (every tunable number), `src/pacific/levels.ts`, `src/pacific/enemies.ts`, `src/pacific/bosses.ts`, `src/pacific/types.ts` |
| Simulation | `src/pacific/sim/game.ts` (`createGame()`, `stepGame()`), `src/pacific/sim/waves.ts` (`buildSchedule()`, `buildDecor()`), `src/pacific/sim/patterns.ts` (`patternPos()`), `src/pacific/sim/bot.ts` (`botInput()`), `src/pacific/sim/rng.ts` |
| Drawing | `src/pacific/render/view.ts` (the scene), `src/pacific/render/planes.ts`, `src/pacific/render/ships.ts`, `src/pacific/render/scenery.ts`, `src/pacific/render/ocean.ts`, `src/pacific/render/clouds.ts`, `src/pacific/render/particles.ts`, `src/pacific/render/kit.ts` |
| The rest | `src/pacific/app.ts` (screens and the loop), `src/pacific/ui.ts`, `src/pacific/audio.ts`, `src/pacific/input.ts`, `src/pacific/save.ts`, `src/pacific/main.ts` |

**The simulation.** `stepGame()` advances a `GameState` by one fixed step (1/120 s) given an
`Input`. All randomness comes from a seed kept in the state, so a level replays exactly. Unlike
the flight model it updates the state in place — hundreds of bullets 120 times a second — but the
state is plain data. A level runs intro → waves → warning → boss → clear; losing the last life is
game over. What happens is pushed to `state.events` (shots, hits, kills, pick-ups…), which the
view, the sound and the HUD drain each frame.

**Waves.** `buildSchedule()` turns a `LevelDef` into timed `SpawnEvent`s: formations (vees,
columns snaking along Bézier paths, line-abreast walls, crossings, fighters from behind, turning
loops, bomber stations, dive bombers aimed at the player, kamikaze swarms, Ōka attacks, ship
convoys, island gun sites) drawn from the level's roster, with the set pieces merged in time
order and a bonus formation at least every `DROP_EVERY` seconds. Enemy movement is a closed form
of age (`patternPos()`), except the homing kamikaze.

**Bosses.** A `BossDef` gives hull hit circles, destroyable parts (turrets, AA mounts, flight
decks that launch aircraft, engines, orbiting escorts) and the guns of three phases. Destroying a
part also takes `PART_TO_CORE` of its strength off the boss. A boss not shot down in time escapes.

**Two layers, one playfield.** The camera looks down at a slant from high behind the player.
Aircraft fly on the plane y = `AIR_Y`; everything on the sea — ocean, ships, islands, shadows —
lives in a group scaled about the camera so that sea level projects exactly onto that plane. A ship
under the player on screen is under the player in the simulation, whatever the perspective, and
the sea still lies deeper (parallax for the clouds, real shadows offset by the sun).

**Models.** `Kit` merges boxes, cylinders, lathed bodies and extruded planforms into one
flat-shaded, vertex-coloured geometry per model, painting faces by their normal (camouflage over,
light grey under) — one draw call per aircraft. Aircraft are drawn `AIR_SCALE` times their
~0.25 u/m size so they read on a phone; the hit circles in `src/pacific/enemies.ts` match.

**The autopilot.** `botInput()` plays through the same `Input` a person gives — guns on the
nearest threat, sliding away from bullets on a collision course, rolling only when a hit is
unavoidable. The tests use it to play every level; the title screen uses it for the demo.

## Add a level, an enemy or a boss

1. **Enemy:** add the kind to `EnemyKind` in `src/pacific/types.ts`, its entry in `ENEMIES`
   (`src/pacific/enemies.ts`; long hulls get `hull` circles), and its model — a `FighterSpec` in
   `src/pacific/render/planes.ts` or a ship spec in `src/pacific/render/ships.ts`. Use it in a
   level's roster or a set piece.
2. **Boss:** add the kind to `BossKind`, its `BossDef` in `src/pacific/bosses.ts` (hull, parts with
   three phases of guns, hold line, sway, size) and, for a ship, its hull spec in `BOSS_SPECS`.
3. **Level:** add a `LevelDef` to `LEVELS` in `src/pacific/levels.ts`, keeping the war's order:
   briefing, objective, fact, look (`LevelEnv`), roster, formation weights, set pieces, scenery,
   boss, seed.
4. Run `npx vitest run tests/pacific`: the catalogue, schedule, model and campaign tests check the
   new pieces fit (the autopilot must still shoot every boss down before it escapes).

## Tests

`tests/pacific/` covers it all, in the repository's layers: unit tests of the rules
(`tests/pacific/game.test.ts`), the level data (`tests/pacific/levels.test.ts`) and the wave
builder (`tests/pacific/waves.test.ts`), each with fast-check properties over random inputs and
seeds; functional runs of the autopilot through every level and the whole campaign
(`tests/pacific/campaign.functional.test.ts`); every model built in Node and measured
(`tests/pacific/models.test.ts`); sound against the WebAudio mock, controls, saves; and the page in
headless Chromium (`tests/pacific/pacific.e2e.test.ts`).

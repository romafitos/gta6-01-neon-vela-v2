# Neon Vela

An open-world crime game set in **Vela City**, an invented golden-hour coastal city of neon towers,
palm-lined beach and four districts (Palma Heights, Neon Mile, Old Harbor, Vela Beach). Plain static
files under `game/` (three.js vendored locally) — it runs 100% offline in a desktop browser.

## Play

```
node serve.ts        # then open http://localhost:8080
```

Click **PLAY** — you start on the street, a car waiting at the kerb. With a save in the browser the
title offers **CONTINUE** (pick up where you left off) and **NEW GAME** (start over).

| Key | Action |
| --- | --- |
| W A S D / arrows | Move / drive |
| Mouse | Look (click to lock the pointer; drag-to-look works too) |
| Shift | Sprint |
| E / F | Enter / exit car (carjack traffic) |
| Space | Handbrake |
| Mouse left | Shoot / punch (aim with the crosshair) |
| Q (hold) / Tab | Weapon wheel (time slows while open) |
| 1–6 / mouse wheel | Switch weapon |
| R | Car radio: next station / Off (in a car) |
| N | Mute / unmute sound |
| M | Big map |
| H | Hide help |
| Esc | Pause |

## Working now (checkpoint 1: core engine)

- Procedural coastal city: road grid, ~150 window-lit towers with rooftop neon, parks with fountains,
  streetlights, beach with palms and surf, sea, golden-hour sky dome with low sun and matching fog.
- Third-person on-foot player with sprint and wall-sliding collision plus an unstuck guard.
- Arcade driving (handbrake slides, sub-stepped collision so cars never tunnel into buildings),
  ambient traffic on the lane graph that brakes for obstacles, parked cars, carjacking.
- Pedestrians walking sidewalk loops who flee carjacks and get knocked down by fast cars.
- HUD: health, cash, wanted stars, vehicle readout, district name, rotating minimap with objective
  marker API, key help.

## Working now (checkpoint 2: combat + police)

- Six weapons with their own damage, fire rate, spread, range and magazines: Fists, Boardwalk Bat,
  Vela 9 Pistol, Hornet SMG, Breaker 12 Shotgun (8 pellets), Marlin Carbine. Hitscan shots stop at
  buildings, people, officers and cars, with muzzle flashes, tracers, sparks and reloads.
- Weapon wheel on Q (hold) or Tab (toggle): radial menu, time slows to a quarter, the mouse picks.
- Damage: health + armour, bystanders flee gunfire and can die, cars smoke, catch fire and explode
  into burning wrecks; the blast hurts people and cars nearby and can chain.
- Wanted level 1–5 stars from shooting, assault, killing, hit-and-run, explosions and attacking or
  robbing the police. Units hunt the last sighting; out of sight the stars flash and drop one by one.
- Police dispatch scaled by stars: foot officers who shoot, chasing cruisers, RAM at 2★, PIT
  manoeuvres and roadblocks (two cruisers + barriers on the road ahead) at 3★, the Kestrel 7 police
  helicopter whose searchlight tracks the player at 4★+. The HUD police radio announces every step.
- Wasted → Coral Cross Hospital (bill), Busted → Lantern Precinct (fine, half spare ammo taken).

## Working now (checkpoint 3: story missions)

- Ten staged story missions, an original crime saga with Marisol Reyes and Teo Vance across all
  four districts, from a sunset pickup to taking the city from the Saltjaw Crew. The next mission's
  giver is a yellow minimap marker and a tall light beacon; walk into it to start.
- Every stage sets the HUD objective, a minimap marker, a world beacon and a purple GPS route that
  follows the roads to the target. Objective variety: getaway driving, a store robbery with an
  escape, a car chase and takedown, a stealth tail, turf defence in waves, a timed delivery, an
  armoured convoy ambush, an on-foot hit on a gang boss, a beach stash-and-ambush set piece and a
  4★ finale with the Kestrel 7 overhead.
- Fail conditions (Wasted, Busted, timer, target escapes, courier spots you, turf abandoned, cargo
  wrecked) and Enter to retry. Each pass pays cash and respect, raises a named respect rank
  (Nobody → King of the Coast) and applies an unlock (armour, ammo crates) plus the next mission.
- Rival gangs: Saltjaw Crew (sea-green) and Ember Kings (flame-orange) hold posts, close in,
  strafe and shoot back with real hitscan weapons; they show on the minimap in their colours.
- J opens the mission log: every mission, its district, type, reward, unlock and status.

| # | Mission | District | Objective | Reward |
| --- | --- | --- | --- | --- |
| 1 | Sunset Pickup | Vela Beach | escort / getaway (timed, 1★) | $500 + 10 |
| 2 | Neon Till | Neon Mile | robbery, then lose 2★ | $1,200 + 15 |
| 3 | Harbor Rat | Old Harbor | car chase / takedown | $900 + 15 |
| 4 | Quiet Wheels | Palma Heights | stealth tail (7–70 m for 40 s) | $800 + 12 |
| 5 | Dockside Turf | Old Harbor | turf defence, 3 waves | $1,500 + 25 |
| 6 | Hot Cargo | Neon Mile → Vela Beach | timed delivery, car must survive | $1,000 + 15 |
| 7 | Armored Tide | Palma Heights | convoy ambush (2 of 3 armoured vans) | $2,000 + 25 |
| 8 | The Pier Contract | Vela Beach | on-foot hit: boss + 3 guards | $1,800 + 20 |
| 9 | Bonfire Standoff | Vela Beach | beach stash, ambush, drive out | $1,600 + 20 |
| 10 | King of the Coast | Neon Mile | finale: clear, grab, run at 4★ with the air unit | $5,000 + 50 |

| Key | Action |
| --- | --- |
| J | Mission log |
| Enter | Retry a failed mission |
| C | Recruit a crew member at a recruit spot / call your crew |
| G | Crew ability: shock grenade (blast + EMP) |
| 1–5 (in a garage) | Repair · respray · engine · handling · armour |

## Working now (checkpoint 4: crew, districts, races, garages)

- **Crew (up to 3):** three hireable gunmen wait at recruit spots (purple "C" icons): Lia "Static"
  Santos, Bo "Anchor" Kekoa, Dax "Wrench" Moreno. C hires the one beside you, C anywhere else
  calls them over. They follow in formation, climb into your car as passengers and get out with
  you, and shoot rival gangs (and cops while you're wanted) on foot and from the car.
- **G — shock grenade:** a crew member throws it at the nearest threat: 70 damage within 7 m and
  an EMP that kills the engines of police/AI cars within 16 m for 6 s; 18 s cooldown.
- **District standing:** Palma Heights, Neon Mile, Old Harbor and Vela Beach each have a control
  meter (0–100 %). Gang kills by you or the crew, missions and races in a district raise it;
  Wasted/Busted lower it. The HUD shows the current district's control, the big map (M) tints
  every district red → green.
- **Respect Ranks unlock gear:** you start with Fists, Bat, Vela 9 and Hornet SMG and one crew
  slot. Street Runner opens slot 2, Hustler slot 3 and the Breaker 12 shotgun, Enforcer the
  Marlin Carbine.
- **3 street races** (yellow "R" icons): Sundown Sprint (Vela Beach, 2 laps × 6 checkpoints),
  Neon Loop (Neon Mile, 2 × 5), Harbor Rush (Old Harbor, 1 × 6). Roll onto the chequered start in
  a car: 3 AI racers line up, 3-2-1, then checkpoint rings with GPS, lap/race clock, live
  position and best time. Payouts by position ($2,000–$3,000 + respect for a win).
- **3 drive-in garages** (cyan "G" icons): Coral Coast Customs, Neon Mile Body Works, Harbor Hull
  & Paint. Repair, respray (8 colours; an unseen respray loses the cops), and 3 tiers each of
  engine (top speed/acceleration), handling (grip/steering) and armour (−20/40/60 % damage).
  Upgrades stay on that car.

## Working now (checkpoint 5: sound, car radio, autosave)

- **All sound is synthesized live with the Web Audio API** — there are no audio files. Sound starts
  inside the Play / Continue click (no AudioContext exists before it); N mutes the master bus.
- **SFX:** a distinct shot for each of the 6 weapons, layered explosions, two-tone police sirens
  whose pitch shifts with closing speed, the helicopter rotor at 4★, an engine loop pitched by road
  speed, tyre screech on the handbrake, UI clicks, a mission/race win sting and race countdown beeps.
  Silent loops stop their sources.
- **Car radio, 3 original stations** played by a step sequencer: SUNSET DRIVE 88.1 (synthwave),
  PALM TAPE FM 93.4 (lo-fi with tape crackle), RADIO CALOR 101.7 (son clave, conga and tumbao bass).
  Each opens with a short jingle ident (no DJ). R cycles 1 → 2 → 3 → Off only in a car; the HUD shows
  the station; leaving the car stops it and getting back in resumes it.
- **Autosave** (`localStorage`, key `neon-vela-save-v1`, `version: 1`): cash, respect + rank,
  unlocks, crew slots, weapons owned with ammo, missions done, district control, hired crew, race
  best times, your ride's engine/handling/armour tiers and paint, and your position. Saved after a
  mission or race win, after a garage purchase and every 60 s. Broken JSON, another version or a
  wrong shape boot a fresh game with a notice; a full storage quota is reported, never thrown.

## Tests

`node tools/audit.mjs` drives headless Chromium: blocks every non-localhost request, asserts zero
console errors, first-click Play, every control's state change, and a wall/corner bot on foot and
in a car, then every weapon hitting a target, the weapon wheel, stars rising and decaying, a 3★
roadblock and RAM/PIT contact, the 4★ helicopter searchlight staying on the player, a car shot to
an explosion, Wasted/Busted respawns, all 10 missions, then rank unlocks and the crew slot cap,
crew following/boarding/shooting, the shock grenade's blast + EMP + cooldown, district control
changes and map tints, all 3 races end to end, and every garage service measured on a dyno, then sound (no AudioContext before the Play gesture,
running after it), the radio's R behaviour on foot and in a car, every SFX trigger, the autosave
triggers, a reload that Continues to the exact saved state, and corrupted / wrong-version saves. `node tools/shots.mjs` renders the screenshots in `shots.json`.

## Layout

`game/src/core` (config, input, random, math) · `world` (layout, collision, meshes, sky) ·
`actors` (player, pedestrians, instanced crowd) · `vehicles` (physics, fleet, traffic) ·
`camera` · `combat` (weapons, damage) · `police` (wanted, dispatch) · `fx` (particles) ·
`systems` (respawn, progression, races, garage, save) · `audio` (sound engine, radio) · `actors/crew.js` · `ui` (HUD, minimap, weapon wheel) · `game.js` (systems hub) · `main.js` (boot, screens, loop).

License: MIT. All names are original.

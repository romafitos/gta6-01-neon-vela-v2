# Neon Vela

An open-world crime game set in **Vela City**, an invented golden-hour coastal city of neon towers,
palm-lined beach and four districts (Palma Heights, Neon Mile, Old Harbor, Vela Beach). Plain static
files under `game/` (three.js vendored locally) — it runs 100% offline in a desktop browser.

## Play

```
node serve.ts        # then open http://localhost:8080
```

Click **PLAY** — you start on the street, a car waiting at the kerb.

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

## Tests

`node tools/audit.mjs` drives headless Chromium: blocks every non-localhost request, asserts zero
console errors, first-click Play, every control's state change, and a wall/corner bot on foot and
in a car, then every weapon hitting a target, the weapon wheel, stars rising and decaying, a 3★
roadblock and RAM/PIT contact, the 4★ helicopter searchlight staying on the player, a car shot to
an explosion, and Wasted/Busted respawns. `node tools/shots.mjs` renders the screenshots in `shots.json`.

## Layout

`game/src/core` (config, input, random, math) · `world` (layout, collision, meshes, sky) ·
`actors` (player, pedestrians, instanced crowd) · `vehicles` (physics, fleet, traffic) ·
`camera` · `combat` (weapons, damage) · `police` (wanted, dispatch) · `fx` (particles) ·
`systems` (respawn) · `ui` (HUD, minimap, weapon wheel) · `game.js` (systems hub) · `main.js` (boot, screens, loop).

License: MIT. All names are original.

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

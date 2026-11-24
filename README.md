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

## Tests

`node tools/audit.mjs` drives headless Chromium: blocks every non-localhost request, asserts zero
console errors, first-click Play, every control's state change, and a wall/corner bot on foot and
in a car. `node tools/shots.mjs` renders the screenshots in `shots.json`.

## Layout

`game/src/core` (config, input, random, math) · `world` (layout, collision, meshes, sky) ·
`actors` (player, pedestrians, instanced crowd) · `vehicles` (physics, fleet, traffic) ·
`camera` · `ui` (HUD, minimap) · `game.js` (systems hub) · `main.js` (boot, screens, loop).

License: MIT. All names are original.

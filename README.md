# Neon Vela

[![gta6-01 on make.fun](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/romafitos/gta6-01-neon-vela-v2/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard)
[![reward](https://make.fun/badge/gta6-01/romafitos/gta6-01-neon-vela-v2/reward.svg)](https://make.fun/bounty/gta6-01)

A 3D open-world crime game in **Vela City**, an invented coastal city at golden hour: neon towers,
a palm-lined beach, traffic, pedestrians and four districts — Palma Heights, Neon Mile, Old Harbor
and Vela Beach. Everything is plain static files in `game/` with three.js vendored locally, so it
runs fully offline in a desktop browser. Every feature listed here is exercised by the headless
browser audit in `tools/audit.mjs`.

## Run it

```
node serve.ts                                   # then open http://localhost:8080 and click PLAY
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts   # package game/ + screenshots/ + dossier.json
```

PLAY starts you on a street with a car at the kerb. With a save present the title screen also
offers CONTINUE and NEW GAME.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move, drive |
| Mouse | Aim and look (click to lock the pointer; drag also works) |
| Left click | Shoot / punch |
| Shift | Sprint |
| Space | Handbrake |
| E / F | Enter / exit a car, carjack traffic |
| Q (hold) / Tab | Weapon wheel, time slows while it is open |
| 1–6 / mouse wheel | Switch weapon |
| C | Hire a crew member at a recruit spot / call your crew |
| G | Crew ability: shock grenade with EMP |
| R | Car radio: next station / off |
| N | Mute |
| M | Big map with district control |
| J | Mission log |
| Enter | Retry a failed mission |
| 1–5 in a garage | Repair · respray · engine · handling · armour |
| H | Hide the help panel |
| Esc | Pause |

## What is in the game

- **10 story missions** across all four districts, each with a minimap marker, a world beacon and
  a GPS route along the roads, fail conditions with retry, and a cash + respect reward:

  | # | Mission | District | Objective |
  | --- | --- | --- | --- |
  | 1 | Sunset Pickup | Vela Beach | timed getaway drive |
  | 2 | Neon Till | Neon Mile | store robbery, then lose the heat |
  | 3 | Harbor Rat | Old Harbor | car chase and takedown |
  | 4 | Quiet Wheels | Palma Heights | tail a car without being spotted |
  | 5 | Dockside Turf | Old Harbor | hold the turf against three waves |
  | 6 | Hot Cargo | Neon Mile → Vela Beach | timed delivery, the car must survive |
  | 7 | Armored Tide | Palma Heights | ambush an armoured convoy |
  | 8 | The Pier Contract | Vela Beach | on-foot hit on a boss and guards |
  | 9 | Bonfire Standoff | Vela Beach | beach stash, ambush, drive out |
  | 10 | King of the Coast | Neon Mile | finale at 4★ with the air unit overhead |

- **6 weapons** — Fists, Boardwalk Bat, Vela 9 Pistol, Hornet SMG, Breaker 12 Shotgun, Marlin
  Carbine — each with its own damage, rate, spread, range and magazine, plus the weapon wheel.
  Cars smoke, burn and explode into burning wrecks whose blast can chain.
- **5-star police dispatch** — foot officers who shoot, chasing cruisers with light bars, RAM
  units from 2★, PIT manoeuvres and roadblocks from 3★, and the Kestrel 7 helicopter from 4★ whose
  searchlight follows you. A police radio feed on the HUD announces each escalation; break line
  of sight and the stars flash and fall. Wasted → Coral Cross Hospital, Busted → Lantern Precinct.
- **Crew of 3** — Lia "Static" Santos, Bo "Anchor" Kekoa and Dax "Wrench" Moreno follow you, ride
  in your car and shoot rival gangs (Saltjaw Crew, Ember Kings). G throws a shock grenade whose EMP
  stalls nearby police and AI cars.
- **District control and respect ranks** — each district has a 0–100 % control meter, tinted on
  the big map. Respect climbs through named ranks (Nobody → King of the Coast) that unlock crew
  slots, the shotgun and the carbine.
- **3 street races** against AI racers — Sundown Sprint, Neon Loop and Harbor Rush — with checkpoint
  rings, lap and race clocks, live position, best times and cash + respect payouts.
- **3 drive-in garages** — Coral Coast Customs, Neon Mile Body Works and Harbor Hull & Paint: repair,
  respray in 8 colours, and three tiers each of engine, handling and armour.
- **Sound, all synthesized with Web Audio** (no audio files): a distinct shot per weapon,
  explosions, sirens, helicopter rotor, engine, tyres, UI. A car radio with 3 original stations —
  SUNSET DRIVE 88.1, PALM TAPE FM 93.4, RADIO CALOR 101.7.
- **Autosave** in `localStorage` with a versioned schema: progress, gear, crew, turf, race times and
  car mods. A corrupt or old save falls back to a fresh game with a notice.

## Tests and screenshots

`node tools/audit.mjs` serves `game/` on localhost and drives headless Chromium: it blocks every
request that leaves localhost, fails on any console error, and checks real game state for each
control, the wall-collision bots, every weapon, the dispatch tiers, all ten missions, the crew,
districts and ranks, the three races, every garage service, sound, radio and save/restore.
`node tools/shots.mjs` renders the four screenshots listed in `shots.json` from staged scenes of
the running game (`?shot=chase|combat|race|garage`).

License: MIT. All names and places are original.

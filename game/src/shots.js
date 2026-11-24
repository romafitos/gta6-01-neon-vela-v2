// Screenshot scenes, staged deterministically from the seed through the game's own systems (no
// overlay is drawn by hand): every scene runs the real simulation for a few seconds so police,
// crew, gangs, racers, effects and the HUD are in the state the systems put them in.
//   start   title screen over the live city
//   chase   5-star chase on the beach road: cruisers, Kestrel 7 + searchlight, dispatch radio, GPS
//   combat  on-foot firefight with the crew against the Ember Kings beside a burning wreck
//   race    Neon Loop street race: AI racers, checkpoint ring, race HUD, car radio
//   garage  drive-in garage shop with upgrade tiers, an active mission, district-tinted big map
//   play / drive   the plain on-foot and driving views (kept for quick checks)

/** Runs n fixed simulation steps, keeping the player (and their car) alive while staging. */
function settle(game, n, keep = true) {
  for (let i = 0; i < n; i++) {
    if (keep) {
      game.player.state.health = 100;
      const c = game.player.state.car;
      if (c) c.health = Math.max(c.health, 80);
    }
    game.step(game.STEP);
  }
}

/** Seats the player in the spawn car at (x, z) facing heading. */
function seatInCar(game, x, z, heading) {
  const car = game.spawnCar;
  if (car.wrecked || car.disabled) game.vehicles.revive(car, x, z, heading);
  car.x = x; car.z = z; car.heading = heading; car.vx = car.vz = 0; car.speed = 0; car.health = 100; car.driver = null;
  game.player.placeAt(x + Math.cos(heading) * 2.3, z - Math.sin(heading) * 2.3, 0);
  game.enterNearestCar();
  return car;
}

/** A believable mid-game save: a few jobs done, a rank, cash and district standing. */
function midGame(game, { respect = 64, cash = 18450, done = 4 } = {}) {
  const p = game.player.state;
  p.cash = cash;
  game.missions.state.done = game.missions.MISSIONS.slice(0, done).map((m) => m.id);
  game.progression.addRespect(respect - p.respect, 'shot');
  const control = { 'PALMA HEIGHTS': 38, 'NEON MILE': 72, 'OLD HARBOR': 55, 'VELA BEACH': 86 };
  for (const d of game.progression.districts) if (control[d.name] != null) d.control = control[d.name];
}

export function stageShot(name, game) {
  const { player, cam, world } = game;
  const L = world.layout;
  const drive = () => { game.input.axes = () => ({ x: 0, y: 1 }); };
  const still = () => { game.input.axes = () => ({ x: 0, y: 0 }); };

  if (name === 'start') {
    cam.state.yaw = Math.PI * 0.85;
    cam.state.pitch = 0.35;
    settle(game, 30, false);
    return;
  }

  if (name === 'chase') {
    midGame(game, { respect: 96, cash: 31200, done: 9 });
    const z = L.roadZ[L.roadZ.length - 1] + 2.5;
    const car = seatInCar(game, L.roadX[1], z, Math.PI / 2);
    game.audio.unlock();
    game.audio.radio.tune(0);
    game.missions.startMission(game.missions.MISSIONS[9]);
    game.wantedSystem.force(5);
    drive();
    settle(game, 60);
    game.police.startHeli();
    for (let k = 0; k < 3; k++) game.police.spawnCruiser('chase');
    settle(game, 170);
    car.health = 100;
    game.hud.toggleHelp(); // the key list stays one H press (and the pause menu) away
    // look back down the road at the pursuit, the air unit hanging over it
    const yaw = car.heading + Math.PI * 0.86;
    cam.state.yaw = yaw;
    cam.state.pitch = 0.1;
    cam.state.idle = -100;
    const h = game.police.heli;
    h.x = car.x + Math.sin(yaw) * 46; h.z = car.z + Math.cos(yaw) * 46; h.y = 30;
    settle(game, 12);
    return;
  }

  if (name === 'combat') {
    midGame(game, { respect: 64 });
    const spot = L.findClear(L.roadX[5] + 2, L.bounds.beachStart + 22, 1.5);
    player.placeAt(spot.x, spot.z, Math.PI / 2);
    for (const m of game.crew.members) {
      const q = L.findClear(spot.x - 2 - m.id * 1.5, spot.z + (m.id - 1) * 2.4, 0.6);
      m.x = q.x; m.z = q.z;
      game.crew.recruit(m);
    }
    // a car the fight already set alight, just off the action
    const wreck = game.vehicles.cars.find((c) => c !== game.spawnCar && !c.disabled && !c.wrecked && c.driver !== 'police');
    if (wreck) {
      const q = L.findClear(spot.x + 9, spot.z - 7, 2.4);
      wreck.x = q.x; wreck.z = q.z; wreck.vx = wreck.vz = 0; wreck.speed = 0; wreck.driver = null;
      game.combat.explodeCar(wreck);
    }
    for (let k = 0; k < 4; k++) game.gang.spawn('ember', spot.x + 20 + k * 2.5, spot.z - 5 + k * 3.5, { tag: 'shot', alert: true, health: 400 });
    game.weapons.select(3);
    still();
    settle(game, 150);
    game.wantedSystem.force(2);
    game.hud.toggleHelp();
    cam.state.yaw = Math.PI / 2 + 0.38;
    cam.state.pitch = 0.16;
    settle(game, 20);
    const p = player.state;
    const def = game.weapons.current().def;
    for (let k = 0; k < 3; k++) { game.weapons.fireFrom(def, p.x, p.z, Math.PI / 2 + (k - 1) * 0.05, null, 1); settle(game, 2); }
    return;
  }

  if (name === 'race') {
    midGame(game, { respect: 64 });
    const race = game.races.RACES[1];
    const s = game.races.starts[1];
    seatInCar(game, s.x, s.z, 0);
    game.audio.unlock();
    game.audio.radio.tune(2);
    game.races.start(race);
    still();
    settle(game, 200); // countdown
    drive();
    settle(game, 75);
    const car = player.state.car;
    game.hud.toggleHelp();
    cam.state.yaw = car.heading + 0.35;
    cam.state.pitch = 0.2;
    cam.state.idle = -100;
    settle(game, 10);
    return;
  }

  if (name === 'garage') {
    midGame(game, { respect: 64, cash: 18450, done: 4 });
    const gg = game.garages.garages[0];
    const car = seatInCar(game, gg.x - 22, gg.z, Math.PI / 2);
    car.mods = { engine: 2, handling: 1, armor: 1 };
    game.combat.hurtCar(car, 40, 'shot');
    game.missions.startMission(game.missions.MISSIONS[4]);
    car.x = gg.x; car.z = gg.z; car.vx = car.vz = 0; car.speed = 0;
    still();
    settle(game, 30);
    game.minimap.toggleBig();
    game.hud.toggleHelp();
    cam.state.yaw = Math.PI / 2 + 2.4;
    cam.state.pitch = 0.32;
    cam.state.idle = -100;
    settle(game, 10);
    return;
  }

  if (name === 'drive') {
    seatInCar(game, L.roadX[3], L.roadZ[L.roadZ.length - 1] + 4.5, Math.PI / 2);
    drive();
    settle(game, 90);
    cam.state.yaw = player.state.car.heading + 0.55;
    cam.state.idle = -100;
    settle(game, 20);
    return;
  }

  // 'play': on foot in the Neon Mile looking down a street lined with towers
  player.placeAt(L.roadX[5] + 6, L.roadZ[2] + 12, Math.PI);
  cam.state.yaw = Math.PI * 0.92;
  cam.state.pitch = 0.12;
  settle(game, 40, false);
}

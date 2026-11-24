// Staged screenshot scenes for tools/shots.mjs (?shot=<name>&seed=N). Nothing here paints over
// the frame: each scene sets up a moment through the game's own systems, then runs the fixed-step
// simulation so police, crew, rival gangs, racers, effects and HUD reach it on their own.
//   chase   5-star pursuit on the beach road — cruisers, Kestrel 7 searchlight, dispatch, GPS line
//   combat  the crew and the player trading fire with the Ember Kings beside a burning wreck
//   race    Neon Loop — AI racers, checkpoint ring, race HUD, radio station banner
//   garage  drive-in garage: the mod shop menu with upgrade tiers over an active job
//   start / play / drive   title screen and the plain views, for quick checks

const SCENES = {};

/** Advance the simulation `frames` fixed steps; while `guard` is on, staging can't kill the player. */
function run(game, frames, guard = true) {
  const p = game.player.state;
  for (let f = 0; f < frames; f++) {
    if (guard) {
      p.health = Math.max(p.health, 100);
      if (p.car) p.car.health = Math.max(p.car.health, 85);
    }
    game.step(game.STEP);
  }
}

/** Point the follow camera and stop it drifting back behind the car on its own. */
function frame(game, yaw, pitch) {
  const c = game.cam.state;
  c.yaw = yaw;
  c.pitch = pitch;
  c.idle = -100;
}

/** Hold the stick: 1 = full throttle, 0 = hands off. */
function throttle(game, amount) {
  game.input.axes = () => ({ x: 0, y: amount });
}

/** Put the player behind the wheel of the kerbside spawn car at (x, z), facing `heading`. */
function driveFrom(game, x, z, heading) {
  const car = game.spawnCar;
  if (car.wrecked || car.disabled) game.vehicles.revive(car, x, z, heading);
  Object.assign(car, { x, z, heading, vx: 0, vz: 0, speed: 0, health: 100, driver: null });
  const side = 2.3;
  game.player.placeAt(x + Math.cos(heading) * side, z - Math.sin(heading) * side, 0);
  game.enterNearestCar();
  return car;
}

/** A save from the middle of the story: some jobs done, a rank, money and turf won. */
function storySoFar(game, jobsDone, respect, cash) {
  const p = game.player.state;
  const m = game.missions;
  m.state.done = m.MISSIONS.slice(0, jobsDone).map((job) => job.id);
  p.cash = cash;
  if (respect > p.respect) game.progression.addRespect(respect - p.respect, 'shot');
  const turf = { 'VELA BEACH': 88, 'NEON MILE': 70, 'OLD HARBOR': 52, 'PALMA HEIGHTS': 34 };
  for (const d of game.progression.districts) if (d.name in turf) d.control = turf[d.name];
}

/** Hide the key list so the HUD in the shot is only what play shows (H brings it back). */
function hideHelp(game) {
  game.hud.toggleHelp();
}

/** Drop the centred mission title card at once (in play it fades out after a few seconds). */
function clearTitleCard() {
  const card = document.getElementById('notice');
  if (!card) return;
  card.style.transition = 'none';
  card.classList.remove('show');
}

SCENES.chase = (game) => {
  const L = game.world.layout;
  storySoFar(game, 9, 100, 32750);
  const beachRoad = L.roadZ[L.roadZ.length - 1] + 2.5;
  const car = driveFrom(game, L.roadX[1], beachRoad, Math.PI / 2);
  game.audio.unlock();
  game.audio.radio.tune(0);
  game.missions.startMission(game.missions.MISSIONS[9]); // King of the Coast: GPS line + marker
  game.wantedSystem.force(5);
  throttle(game, 1);
  run(game, 50);
  // 5 stars: dispatch sends the Kestrel 7 on its own; add a few more cruisers to the pursuit
  for (let n = 0; n < 4; n++) game.police.spawnCruiser('chase');
  run(game, 180);
  car.health = 100;
  hideHelp(game);
  // compose the cover like a chase cam: the player's car from behind, the pursuit closing in on the
  // road ahead — a cruiser head-on in the far lane, two more angled across the lanes further up,
  // one pulling alongside — and the Kestrel 7 low over the road with its searchlight on the car
  Object.assign(car, { vx: Math.sin(car.heading) * 6, vz: Math.cos(car.heading) * 6, speed: 6 });
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const rx = fz;
  const rz = -fx;
  const live = game.police.cruisers.filter((c) => !c.disabled && !c.wrecked);
  const spots = [[15, -4.6, Math.PI], [7, 4.4, 0.05], [30, -3.5, Math.PI - 0.75], [31, 3.6, Math.PI + 0.7], [46, 0, Math.PI]];
  live.forEach((c, i) => {
    const sp = spots[i];
    if (!sp) { Object.assign(c, { x: car.x - fx * 60, z: car.z - fz * 60 }); return; }
    Object.assign(c, { x: car.x + fx * sp[0] + rx * sp[1], z: car.z + fz * sp[0] + rz * sp[1], heading: car.heading + sp[2], vx: 0, vz: 0, speed: 0 });
  });
  frame(game, car.heading + 0.14, 0.13);
  game.cam.state.dist = 11.5;
  const h = game.police.heli;
  h.x = car.x + fx * 44 - rx * 4;
  h.z = car.z + fz * 44 - rz * 4;
  h.y = 11;
  run(game, 2);
  clearTitleCard();
  run(game, 4);
};

SCENES.combat = (game) => {
  const L = game.world.layout;
  storySoFar(game, 5, 70, 21400);
  const at = L.findClear(L.roadX[5] + 2, L.bounds.beachStart + 22, 1.5);
  game.player.placeAt(at.x, at.z, Math.PI / 2);
  game.crew.members.forEach((m, i) => {
    const q = L.findClear(at.x - 2.5 - i * 1.6, at.z + (i - 1) * 2.6, 0.6);
    m.x = q.x;
    m.z = q.z;
    game.crew.recruit(m);
  });
  // a parked car the fight has already set burning, a little off to the side
  const victim = game.vehicles.cars.find((c) => c !== game.spawnCar && !c.wrecked && !c.disabled && c.driver !== 'police');
  if (victim) {
    const q = L.findClear(at.x + 8, at.z - 8, 2.4);
    Object.assign(victim, { x: q.x, z: q.z, vx: 0, vz: 0, speed: 0, driver: null });
    game.combat.explodeCar(victim);
  }
  for (let n = 0; n < 5; n++) {
    game.gang.spawn('ember', at.x + 19 + n * 2.2, at.z - 6 + n * 3, { tag: 'shot', alert: true, health: 420 });
  }
  game.weapons.select(3); // Hornet SMG
  throttle(game, 0);
  run(game, 140);
  game.wantedSystem.force(2);
  hideHelp(game);
  frame(game, Math.PI / 2 + 0.4, 0.17);
  run(game, 18);
  const p = game.player.state;
  const gun = game.weapons.current().def;
  for (const spread of [-0.05, 0, 0.05]) {
    game.weapons.fireFrom(gun, p.x, p.z, Math.PI / 2 + spread, null, 1);
    run(game, 2);
  }
};

SCENES.race = (game) => {
  storySoFar(game, 5, 70, 21400);
  const which = 1; // Neon Loop, through the lit towers
  const grid = game.races.starts[which];
  driveFrom(game, grid.x, grid.z, 0);
  game.audio.unlock();
  game.audio.radio.tune(2);
  game.races.start(game.races.RACES[which]);
  throttle(game, 0);
  run(game, 200); // the countdown
  throttle(game, 1);
  run(game, 80);
  const car = game.player.state.car;
  hideHelp(game);
  // level camera: more skyline, less of the road vanishing into a dark band at the horizon
  frame(game, car.heading + 0.32, 0.12);
  run(game, 10);
};

SCENES.garage = (game) => {
  storySoFar(game, 4, 64, 18450);
  const shop = game.garages.garages[0];
  const car = driveFrom(game, shop.x - 20, shop.z, Math.PI / 2);
  car.mods = { engine: 2, handling: 1, armor: 1 };
  game.combat.hurtCar(car, 38, 'shot'); // dented, so the repair line has a price
  game.missions.startMission(game.missions.MISSIONS[4]); // Dockside Turf stays on the objective line
  Object.assign(car, { x: shop.x, z: shop.z, vx: 0, vz: 0, speed: 0 });
  throttle(game, 0);
  run(game, 30);
  if (!game.garages.state.open) game.garages.open(shop);
  hideHelp(game);
  // high camera: the sightline clears the canopy roof so the shop sign reads above it
  frame(game, Math.PI / 2 + 2.3, 0.5);
  run(game, 8);
  clearTitleCard();
};

SCENES.start = (game) => {
  frame(game, Math.PI * 0.82, 0.32);
  run(game, 30, false);
};

SCENES.drive = (game) => {
  const L = game.world.layout;
  driveFrom(game, L.roadX[3], L.roadZ[L.roadZ.length - 1] + 4.5, Math.PI / 2);
  throttle(game, 1);
  run(game, 90);
  frame(game, game.player.state.car.heading + 0.5, 0.15);
  run(game, 20);
};

SCENES.play = (game) => {
  const L = game.world.layout;
  game.player.placeAt(L.roadX[5] + 6, L.roadZ[2] + 12, Math.PI);
  frame(game, Math.PI * 0.9, 0.12);
  run(game, 40, false);
};

export function stageShot(name, game) {
  (SCENES[name] ?? SCENES.play)(game);
}

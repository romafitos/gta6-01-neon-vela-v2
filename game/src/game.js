// The running game: owns the world, player, cars, pedestrians, camera and HUD, and advances them
// in fixed steps. Later milestones register extra systems (police, missions, crew, audio, saves)
// with addSystem(); each gets step(dt, game) and optional onEvent(name, data).
import { PLAYER, STEP } from './core/config.js';
import { createWorld } from './world/world.js';
import { createPlayer } from './actors/player.js';
import { createPedestrians } from './actors/pedestrians.js';
import { createCrowd } from './actors/crowd.js';
import { createVehicles } from './vehicles/vehicles.js';
import { createFollowCamera } from './camera/follow_camera.js';
import { createHud } from './ui/hud.js';
import { createCards } from './ui/cards.js';
import { createMinimap } from './ui/minimap.js';
import { createEffects } from './fx/effects.js';
import { createWeapons } from './combat/weapons.js';
import { createCombat } from './combat/damage.js';
import { createWanted } from './police/wanted.js';
import { createDispatch } from './police/dispatch.js';
import { createRespawn } from './systems/respawn.js';
import { createWeaponWheel } from './ui/weapon_wheel.js';
import { createGang } from './actors/gang.js';
import { createMissions } from './missions/missions.js';
import { createProgression } from './systems/progression.js';
import { createCrew } from './actors/crew.js';
import { createRaces } from './systems/races.js';
import { createGarages } from './systems/garage.js';
import { createAudio } from './audio/audio.js';
import { createSaves } from './systems/save.js';

export function createGame({ scene, random, input, aspect }) {
  const world = createWorld(scene, random);
  const crowd = createCrowd(scene, 150);
  const player = createPlayer(crowd, world);
  const vehicles = createVehicles(scene, world, random);
  const peds = createPedestrians(crowd, world, random);
  const cam = createFollowCamera(world, aspect);
  const hud = createHud();
  const minimap = createMinimap(document.getElementById('minimap'), world.layout);
  const systems = [];
  const stats = { steps: 0, carEntries: 0, carExits: 0, carjacks: 0 };

  // a ride waiting at the spawn kerb so driving is one keypress away
  const spawnCar = vehicles.parkNear(world.layout.spawn.x + 5, world.layout.spawn.z - 6, Math.PI / 2);
  cam.snap({ x: player.state.x, z: player.state.z, heading: player.state.heading, inCar: false });

  const game = {
    world, crowd, player, vehicles, peds, cam, hud, minimap, systems, stats, input, spawnCar,
    wanted: 0,
    wantedFlash: false,
    time: 0,
    timeScale: 1,
    blockFire: false,
    respawning: false,
    addSystem(sys) { systems.push(sys); return sys; },
    emit(name, data) { for (const s of systems) s.onEvent?.(name, data, game); },
    step,
    enterNearestCar,
    exitCar,
    forceExit,
  };

  // ---- combat and police (checkpoint 2) ----
  player.state.armor = 25;
  game.fx = createEffects(scene);
  game.weapons = createWeapons(game);
  game.combat = game.addSystem(createCombat(game));
  game.wantedSystem = game.addSystem(createWanted(game));
  game.police = game.addSystem(createDispatch(game, scene));
  game.respawn = game.addSystem(createRespawn(game));
  game.wheel = createWeaponWheel(game);
  // ---- story missions and rival gangs (checkpoint 3) ----
  game.gang = game.addSystem(createGang(game));
  game.missions = game.addSystem(createMissions(game, scene));
  // ---- crew, district standing + respect ranks, street races, garages (checkpoint 4) ----
  game.menuOpen = false;
  game.progression = game.addSystem(createProgression(game));
  game.crew = game.addSystem(createCrew(game));
  game.races = game.addSystem(createRaces(game, scene));
  game.garages = game.addSystem(createGarages(game, scene));
  minimap.setIcons(() => game.hudIcons);
  // ---- sound, car radio and autosave (checkpoint 5) ----
  game.audio = game.addSystem(createAudio(game));
  game.saves = game.addSystem(createSaves(game));
  // gunfire panics everyone within earshot
  game.addSystem({ onEvent(name, data) {
    if (name !== 'gunfire') return;
    for (const ped of peds.peds) if (Math.abs(ped.x - data.x) < 30 && Math.abs(ped.z - data.z) < 30) peds.scare(ped, data.x, data.z, 6);
  } });
  // running people down is a crime (and it hurts)
  peds.hooks.onCarHit = (ped, car) => {
    if (car !== player.state.car) return;
    game.combat.hurtPed(ped, Math.abs(car.speed) * 1.6, 'player');
    if (ped.mode !== 'dead') ped.mode = 'down';
    game.emit('crime', { type: 'hitAndRun', x: ped.x, z: ped.z });
  };
  hud.addHelp('Mouse L', 'Shoot / punch');
  hud.addHelp('Q / Tab', 'Weapon wheel');
  hud.addHelp('1-6 / Wheel', 'Switch weapon');
  hud.addHelp('R', 'Radio station (in a car)');
  hud.addHelp('N', 'Mute sound');

  function enterNearestCar() {
    const p = player.state;
    const car = vehicles.nearest(p.x, p.z, PLAYER.enterRange);
    if (!car) return false;
    if (car.driver === 'police' || car.driver === 'police_static') {
      hud.notify(`Stole a ${car.mesh.variant.name}!`);
      game.emit('crime', { type: 'copAssault', x: car.x, z: car.z });
      car.block = null;
    } else if (car.driver === 'ai') {
      peds.ejectDriver(car, p.x, p.z);
      stats.carjacks++;
      hud.notify(`Carjacked a ${car.mesh.variant.name}!`);
      game.emit('carjack', car);
      game.emit('crime', { type: 'carjack', x: car.x, z: car.z });
    } else {
      hud.notify(`${car.mesh.variant.name} — floor it.`);
    }
    car.driver = 'player';
    car.kind = 'player';
    car.ai = null;
    p.car = car;
    stats.carEntries++;
    game.emit('enterCar', car);
    return true;
  }

  /** Out of the car whatever its speed (explosions, Wasted/Busted). */
  function forceExit(car) {
    const p = player.state;
    if (p.car !== car) return;
    car.driver = null;
    car.controls.throttle = 0;
    p.car = null;
    player.placeAt(car.x + Math.cos(car.heading) * 2.6, car.z - Math.sin(car.heading) * 2.6, car.heading);
    game.emit('exitCar', car);
  }

  function exitCar() {
    const p = player.state;
    const car = p.car;
    if (!car) return false;
    if (Math.abs(car.speed) > 9) { hud.notify('Slow down to get out.', 1.5); return false; }
    car.driver = null;
    car.controls.throttle = 0;
    car.controls.steer = 0;
    p.car = null;
    // step out on the driver's (left) side, or wherever is clear
    const lx = car.x + Math.cos(car.heading) * 2.3;
    const lz = car.z - Math.sin(car.heading) * 2.3;
    player.placeAt(lx, lz, car.heading);
    stats.carExits++;
    game.emit('exitCar', car);
    return true;
  }

  function step(realDt) {
    const dt = realDt * game.timeScale;
    game.time += dt;
    stats.steps++;
    const look = input.takeLook();
    if (!game.wheel.step(look)) cam.addLook(look.x, look.y);
    const p = player.state;
    const control = !game.respawning;

    if (input.take('use') && control) { if (p.car) exitCar(); else enterNearestCar(); }
    if (input.take('map')) minimap.toggleBig();
    if (input.take('help')) hud.toggleHelp();
    if (input.take('mute')) game.audio.setMuted(!game.audio.state.muted);

    const axes = control ? input.axes() : { x: 0, y: 0 };
    if (p.car) {
      const c = p.car;
      c.controls.throttle = axes.y;
      c.controls.steer = -axes.x;
      c.controls.handbrake = control && input.held('handbrake');
      if (c.wrecked) { c.controls.throttle = 0; c.controls.steer = 0; }
      p.x = c.x;
      p.z = c.z;
      p.heading = c.heading;
    } else {
      player.step(dt, axes, control && input.held('sprint'), cam.state.yaw);
    }
    game.weapons.step(dt, control && input.firing(), cam.state.yaw);
    vehicles.step(dt, player);
    game.police.contacts();
    if (p.car) { p.x = p.car.x; p.z = p.car.z; p.heading = p.car.heading; }
    peds.step(dt, player, vehicles.cars);
    for (const s of systems) s.step?.(dt, game);
    world.city.update(dt);
    game.fx.step(dt);
    hud.update(realDt);
  }

  game.cards = createCards(game);

  /** Per rendered frame: meshes follow the simulation, camera and HUD refresh. */
  game.frame = (dt) => {
    const p = player.state;
    player.syncMesh();
    vehicles.syncMeshes(dt);
    peds.syncMeshes();
    crowd.sync();
    cam.update(dt, { x: p.x, z: p.z, heading: p.heading, inCar: !!p.car, speed: p.car ? p.car.speed : 0 });
    world.sky.follow(p.x, p.z);
    hud.setHealth(p.health, PLAYER.maxHealth);
    hud.setCash(p.cash);
    hud.setWanted(game.wanted, game.wantedFlash);
    hud.setArmor(p.armor);
    const team = game.crew.crew().length;
    const crewText = team ? `CREW ${team}/${game.progression.state.crewSlots} · G ${game.crew.ability.cooldown > 0 ? Math.ceil(game.crew.ability.cooldown) + 's' : 'ready'}` : '';
    hud.setWeapon([p.car ? '' : game.weapons.hudText(), crewText].filter(Boolean).join('   ·   '));
    game.police.frame(dt);
    game.gang.frame(dt);
    game.crew.frame(dt);
    game.fx.sync();
    const dist = game.progression.districtAt(p.x, p.z);
    hud.setDistrict(`${dist.name} · CONTROL ${Math.round(dist.control)}%`);
    hud.setVehicle(p.car ? `${p.car.mesh.variant.name}  ${Math.round(Math.abs(p.car.speed) * 3.6)} km/h` : '');
    if (!p.car) {
      const near = vehicles.nearest(p.x, p.z, PLAYER.enterRange);
      hud.setPrompt(near ? (near.driver === 'ai' || near.driver === 'police' || near.driver === 'police_static' ? 'E  Carjack' : 'E  Get in') : '');
    } else hud.setPrompt('');
    const extras = [];
    for (const c of game.police.cops) if (c.active && c.health > 0) extras.push({ x: c.x, z: c.z, color: '#3a7bff' });
    for (const m of game.crew.members) if (m.recruited && m.seat == null) extras.push({ x: m.x, z: m.z, color: '#b98cff', r: 3 });
    for (const c of game.races.active?.racers ?? []) if (!c.car.disabled) extras.push({ x: c.car.x, z: c.car.z, color: '#ffd23f', r: 4 });
    for (const m of game.gang.members) if (m.active && m.health > 0) extras.push({ x: m.x, z: m.z, color: game.gang.CREWS[m.crew].map, r: m.boss ? 4 : 3 });
    const h = game.police.heli;
    if (h.active) extras.push({ x: h.lightX, z: h.lightZ, color: 'rgba(255,240,180,0.55)', r: h.poolRadius });
    minimap.draw(p, cam.state.yaw, vehicles.cars, extras);
    game.cards.frame(dt);
  };

  game.STEP = STEP;
  return game;
}

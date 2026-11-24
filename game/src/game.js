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
import { createMinimap } from './ui/minimap.js';

export function createGame({ scene, random, input, aspect }) {
  const world = createWorld(scene, random);
  const crowd = createCrowd(scene, 96);
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
    time: 0,
    addSystem(sys) { systems.push(sys); return sys; },
    emit(name, data) { for (const s of systems) s.onEvent?.(name, data, game); },
    step,
    enterNearestCar,
    exitCar,
  };

  function enterNearestCar() {
    const p = player.state;
    const car = vehicles.nearest(p.x, p.z, PLAYER.enterRange);
    if (!car) return false;
    if (car.driver === 'ai') {
      peds.ejectDriver(car, p.x, p.z);
      stats.carjacks++;
      hud.notify(`Carjacked a ${car.mesh.variant.name}!`);
      game.emit('carjack', car);
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

  function step(dt) {
    game.time += dt;
    stats.steps++;
    const look = input.takeLook();
    cam.addLook(look.x, look.y);
    const p = player.state;

    if (input.take('use')) { if (p.car) exitCar(); else enterNearestCar(); }
    if (input.take('map')) minimap.toggleBig();
    if (input.take('help')) hud.toggleHelp();

    const axes = input.axes();
    if (p.car) {
      const c = p.car;
      c.controls.throttle = axes.y;
      c.controls.steer = -axes.x;
      c.controls.handbrake = input.held('handbrake');
      p.x = c.x;
      p.z = c.z;
      p.heading = c.heading;
    } else {
      player.step(dt, axes, input.held('sprint'), cam.state.yaw);
    }
    vehicles.step(dt, player);
    if (p.car) { p.x = p.car.x; p.z = p.car.z; p.heading = p.car.heading; }
    peds.step(dt, player, vehicles.cars);
    for (const s of systems) s.step?.(dt, game);
    world.city.update(dt);
    hud.update(dt);
  }

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
    hud.setWanted(game.wanted);
    hud.setDistrict(world.layout.districtAt(p.x, p.z).name);
    hud.setVehicle(p.car ? `${p.car.mesh.variant.name}  ${Math.round(Math.abs(p.car.speed) * 3.6)} km/h` : '');
    if (!p.car) {
      const near = vehicles.nearest(p.x, p.z, PLAYER.enterRange);
      hud.setPrompt(near ? (near.driver === 'ai' ? 'E  Carjack' : 'E  Get in') : '');
    } else hud.setPrompt('');
    minimap.draw(p, cam.state.yaw, vehicles.cars);
  };

  game.STEP = STEP;
  return game;
}

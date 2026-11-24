// Screenshot scenes, staged deterministically from the seed: the title over the city, the player
// on a neon street at golden hour, and a drive along the beach road.

export function stageShot(name, game) {
  const { player, vehicles, cam, world } = game;
  const L = world.layout;
  const settle = (n) => { for (let i = 0; i < n; i++) game.step(game.STEP); };

  if (name === 'start') {
    cam.state.yaw = Math.PI * 0.85;
    cam.state.pitch = 0.35;
    settle(30);
    return;
  }
  if (name === 'drive') {
    const car = game.spawnCar;
    car.x = L.roadX[3];
    car.z = L.roadZ[L.roadZ.length - 1] + 4.5;
    car.heading = Math.PI / 2;
    player.state.car = car;
    car.driver = 'player';
    car.kind = 'player';
    car.vx = Math.sin(car.heading) * 24;
    car.vz = Math.cos(car.heading) * 24;
    cam.snap({ x: car.x, z: car.z, heading: car.heading + 0.5, inCar: true });
    cam.state.pitch = 0.22;
    game.input.axes = () => ({ x: 0, y: 1 });
    settle(90);
    cam.state.yaw = car.heading + 0.55;
    cam.state.idle = -100;
    settle(20);
    return;
  }
  // 'play': on foot in the Neon Mile looking down a street lined with towers
  player.placeAt(L.roadX[5] + 6, L.roadZ[2] + 12, Math.PI);
  cam.state.yaw = Math.PI * 0.92;
  cam.state.pitch = 0.12;
  settle(40);
}
